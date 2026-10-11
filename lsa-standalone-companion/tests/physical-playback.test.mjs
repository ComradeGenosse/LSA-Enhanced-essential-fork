import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { awaitNativePhysicalPlayback } from '../src/audio/physicalPlayback.mjs';
import { stageNativePcmStream } from '../src/audio/nativePcm.mjs';
import { stageNativeSpeechSegments } from '../src/conversation/segmentPipeline.mjs';

const claims = () => ({
  streamId: randomUUID(), audioLeaseId: randomUUID(),
  audioGeneration: '7', turnId: randomUUID(),
  actorIncarnationId: randomUUID()
});
const progress = (playedBytes, completedSegments, markedSegments, extra = {}) => ({
  status: 'device_progress', playbackState: playedBytes ? 'playback_started' : 'device_accepted',
  playedBytes, submittedBytes: 1920, mouthLevel: 42,
  sealed: true, finalSegments: true, completedSegments, markedSegments, ...extra
});

test('physical playback waits for exact second segment then acknowledges once, no history', async () => {
  const exact = claims(), seen = [], calls = [], steps = [
    {status:'device_unavailable'},
    progress(0,0,2),
    progress(960,1,2),
    progress(1440,1,2),
    progress(1920,2,2,{status:'playback_completed',playbackState:'playback_completed'})
  ];
  const client = { async request(kind, packet) {
    assert.deepEqual(packet, exact);
    calls.push(kind);
    if (kind === 'audio.playback') return steps.shift();
    if (kind === 'audio.playback.ack') return {status:'ok'};
    throw new Error('unexpected_request');
  }};
  const receipt = await awaitNativePhysicalPlayback(client,exact,{
    expectedBytes:1920,expectedSegments:2,pollMs:10,
    onProgress:p => seen.push([p.playedBytes,p.completedSegments])
  });
  assert.deepEqual(receipt,{
    status:'device_playback_completed',verified:true,
    playedBytes:1920,completedSegments:2,historyCommitted:false
  });
  assert.deepEqual(seen,[[960,1],[1440,1],[1920,2]]);
  assert.equal(calls.filter(t=>t==='audio.playback.ack').length,1);
});

test('no final segment completion from bytes accepted by device alone', async () => {
  const client = {async request(type) {
    if(type==='audio.playback') return progress(0,0,1,{
      status:'playback_completed',playbackState:'playback_completed'
    });
    throw Error('should_not_ack');
  }};
  await assert.rejects(awaitNativePhysicalPlayback(client,claims(),{
    expectedBytes:1920,expectedSegments:2,pollMs:10
  }),/invalid_native_physical_progress/);
});

test('driver failed, stale protocol and monotonicity violations fail closed', async () => {
  for (const states of [
    [{status:'device_failed'}],
    [progress(960,1,2),progress(480,0,2)],
    [progress(1920,2,2,{status:'playback_completed',
      playbackState:'playback_completed',finalSegments:false})]
  ]) {
    let at=0;
    const client={async request(kind) {
      assert.equal(kind,'audio.playback');
      return states[Math.min(at++,states.length-1)];
    }};
    await assert.rejects(awaitNativePhysicalPlayback(client,claims(),{
      expectedBytes:1920,expectedSegments:2,pollMs:10
    }),/playback_device_failed|invalid_native_physical_progress/);
  }
});

test('device stop without progress triggers bounded watchdog, never acknowledges', async () => {
  let requests=0;
  const client={async request(kind) {
    assert.equal(kind,'audio.playback'); requests++;
    return progress(0,0,2);
  }};
  await assert.rejects(awaitNativePhysicalPlayback(client,claims(),{
    expectedBytes:1920,expectedSegments:2,pollMs:10,
    stallMs:110,timeoutMs:400
  }),/playback_device_stalled/);
  assert.ok(requests>=2);
});

test('cancelled wait never claims completion or sends ack', async () => {
  const cancel=new AbortController();cancel.abort();
  let calls=0;
  await assert.rejects(awaitNativePhysicalPlayback({
    async request(){ calls++; throw Error('not_reached'); }
  },claims(),{expectedBytes:960,expectedSegments:1,signal:cancel.signal}),
  /playback_cancelled/);
  assert.equal(calls,0);
});

test('legacy PCM mode can opt in to exactly one native device completion', async () => {
  const turn={turnId:randomUUID(),actorIncarnationId:randomUUID(),
    leaseId:randomUUID(),generation:'1'};
  const exact=claims();
  let count=0;
  const calls=[];
  const client={async request(kind, packet){
    calls.push(kind);
    switch(kind){
      case 'audio.open': return {status:'audio_authorized_not_playing',
        ...exact,sampleRate:24000};
      case 'audio.chunk':assert.equal(packet.chunkIndex,count++);return {status:'buffered_not_played'};
      case 'audio.end':return {status:'sealed_not_played'};
      case 'audio.playback':return progress(960,1,1,{submittedBytes:960,
        status:'playback_completed',playbackState:'playback_completed'});
      case 'audio.playback.ack':return {status:'ok'};
      default: throw Error('unexpected_'+kind);
    }
  }};
  async function* pcm(){yield Buffer.alloc(960);}
  const answer=await stageNativePcmStream(client,turn,pcm(),{
    confirmPlayback:true
  });
  assert.equal(answer.status,'sealed_not_played');
  assert.equal(answer.physicalReceipt.verified,true);
  assert.equal(answer.physicalReceipt.historyCommitted,false);
  assert.equal(calls.at(-1),'audio.playback.ack');
});

test('early speech can confirm two segments without committing staged assistant history',async()=>{
  const exact=claims();
  const offer={turnId:exact.turnId,actorIncarnationId:exact.actorIncarnationId};
  const claim={turnId:exact.turnId,actorIncarnationId:exact.actorIncarnationId,
    leaseId:randomUUID(),generation:'4'};
  const calls=[];let audio=0;
  const client={async request(kind,packet){
    calls.push(kind);
    switch(kind){
      case 'turn.segment':return {status:'segment_staged_not_played'};
      case 'audio.open':return {status:'audio_authorized_not_playing',
        ...exact,sampleRate:24000};
      case 'audio.chunk': audio+=Buffer.from(packet.pcmBase64,'base64').length;
        return {status:'buffered_not_played'};
      case 'audio.segment':return {status:'segment_audio_buffered_not_played'};
      case 'turn.segments.end':return {status:'segments_final_not_played'};
      case 'audio.end':return {status:'sealed_not_played'};
      case 'audio.playback':return progress(audio,2,2,{
        submittedBytes:audio,status:'playback_completed',
        playbackState:'playback_completed'
      });
      case 'audio.playback.ack':return {status:'ok'};
      default:throw Error('unexpected_'+kind);
    }
  }};
  async function* text(){yield 'First sentence.';yield 'Second sentence.';}
  const tts={async *streamPcm(){yield Buffer.alloc(960);}};
  const answer=await stageNativeSpeechSegments({
    client,offer,claims:claim,modelSegments:text(),tts,confirmPlayback:true
  });
  assert.equal(answer.status,'sealed_not_played');
  assert.equal(answer.segmentCount,2);
  assert.equal(answer.physicalReceipt.completedSegments,2);
  assert.equal(answer.physicalReceipt.historyCommitted,false);
  assert.equal(calls.filter(t=>t==='audio.playback.ack').length,1);
});
