import { Phase2NativeClient } from '../src/native/phase2Wire.mjs';
import { awaitNativePhysicalPlayback } from '../src/audio/physicalPlayback.mjs';

// This fixture tests the REAL net481 native host + strict Node wire protocol.
// Its compiled FixtureOutput fabricates device callbacks by design. This is
// NOT device audibility, NPC animation, an Essential bridge or GTA acceptance.
const client=new Phase2NativeClient();
try {
  await client.connect();
  const offer=await client.request('turn.next');
  if(offer.status!=='ok'||offer.source!=='player_text')
    throw Error('no_native_offer');
  const turn={
    turnId:offer.turnId,actorIncarnationId:offer.actorIncarnationId,
    leaseId:offer.leaseId,generation:offer.generation
  };
  await client.request('turn.confirm',{
    ...turn,sessionNonce:offer.sessionNonce,source:offer.source
  });
  await client.request('turn.segment',{
    ...turn,segmentIndex:0,segmentText:'A vehicle arrived.'
  });
  const audio=await client.request('audio.open',{
    ...turn,sampleRate:24000
  });
  if(audio.status!=='audio_authorized_not_playing')
    throw Error('native_audio_open_failed');
  const stream={
    streamId:audio.streamId,audioLeaseId:audio.audioLeaseId,
    audioGeneration:audio.audioGeneration,
    turnId:turn.turnId,actorIncarnationId:turn.actorIncarnationId
  };
  // First 20ms source PCM and authenticated sentence boundary.
  await client.request('audio.chunk',{
    ...stream,chunkIndex:0,pcmBase64:Buffer.alloc(960,2).toString('base64')
  });
  await client.request('audio.segment',{
    ...stream,segmentIndex:0,totalBytes:960
  });
  await client.request('turn.segment',{
    ...turn,segmentIndex:1,segmentText:'Then the driver stopped.'
  });
  await client.request('audio.chunk',{
    ...stream,chunkIndex:1,pcmBase64:Buffer.alloc(960,4).toString('base64')
  });
  await client.request('audio.segment',{
    ...stream,segmentIndex:1,totalBytes:1920
  });
  await client.request('turn.segments.end',{
    ...turn,segmentCount:2
  });
  const sealed=await client.request('audio.end',{
    ...stream,chunkCount:2,totalBytes:1920
  });
  if(sealed.status!=='sealed_not_played')
    throw Error('source_eos_misrepresented');
  const result=await awaitNativePhysicalPlayback(client,stream,{
    expectedBytes:1920,expectedSegments:2,pollMs:20,
    timeoutMs:5000,stallMs:1500
  });
  if(result.status!=='device_playback_completed'||result.playedBytes!==1920||
      result.completedSegments!==2||result.historyCommitted!==false)
    throw Error('invalid_physical_completion');
  let duplicateDenied=false;
  try { await client.request('audio.playback.ack',stream); }
  catch(e) { duplicateDenied=e.message==='native_rejected_playback_not_completed'; }
  if(!duplicateDenied) throw Error('duplicate_terminal_ack_accepted');
  console.log(JSON.stringify({
    status:result.status,playedBytes:result.playedBytes,
    completedSegments:result.completedSegments,
    duplicateTerminalAckRejected:true,
    device:'SYNTHETIC_FAKE_ONLY',gta:false,audible:false,
    history:'not_committed'
  }));
} catch(error) {
  console.error('physical_playback_pipe_fixture_failed:'+error.message);
  process.exitCode=1;
} finally {client.close();}
