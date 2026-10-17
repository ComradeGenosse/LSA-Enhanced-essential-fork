// OFFLINE end-to-end WS-5a tests: NPC speech delivery -> persistent P2 SQLite.
// Same harness as D01 (d01-harness.mjs): the patched pinned original backend,
// createRuntime, OpenAIConnection, runSequentialTurn, D01 issuer, actor ledger,
// the production D02 port behind a real IntelligenceClient, D03 and a real P2
// SQLite file are REAL. Scripted (unavoidable offline): native frames, native
// playback acknowledgements, P1 owner pipe and the OpenAI STT/model/TTS stubs.
// Nothing here is a GTA receipt; see WS-5A-HANDOFF.md for the GTA checklist.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {d01Harness,waitFor,sleep} from './d01-harness.mjs';
import {ProviderRequestError} from '../../src/openai/request.mjs';
import {journalTurnIdentityHash} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';

const sha=s=>createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');
const evidenceOf=row=>JSON.parse(row.source_json);
const assistant=x=>x.h.runtime.history.readForSession('17',1).filter(m=>m.role==='assistant');

// Native playback is scripted by hand so a test controls exactly what the
// original backend reports. Messages go through the REAL patched handler `by`.
async function nativeEvent(x,turn,type,extra={}){
  x.h.context.ws5aNative={pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,type,...extra};
  return x.h.evaluate('by(ws5aNative)');
}
const manualPlayback=x=>x.session.autoNativeAcks({completePlayback:false});
const streamEnded=(x,turn)=>waitFor(()=>x.h.sent.some(m=>m.type==='npcAudioStreamEnded'&&m.turnId===turn.id),'native stream end handed over');
const started=(x,turn)=>nativeEvent(x,turn,'npcPlaybackStarted',{reason:'started'});
const ended=(x,turn,extra)=>nativeEvent(x,turn,'npcPlaybackEnded',{hadAudio:true,playbackStarted:true,...extra});

// Observe/alter the NPC write the production runner performs, without touching
// the production path itself.
function npcSpy(x){
  const original=x.h.runtime.services.recordM2Npc;
  const spy={calls:0,results:[],args:[],before:null,original};
  x.h.runtime.services.recordM2Npc=async args=>{
    spy.calls++;spy.args.push(args);
    if(spy.before)await spy.before(args);
    const result=await original(args);
    spy.results.push(result);
    return result;
  };
  return spy;
}
// Early streaming: mirror the production decoder's 1-based public ordinals.
// The runner translates them to the private WS-5a ledger's 0-based indices.
function streamingModel(x,segments,{final=segments.join('')}={}){
  x.h.runtime.services.providerStack={reasoning:{id:'openai.reasoning'},
    speech:{id:'openai.speech'},transcription:{id:'openai.transcription'},
    decideStreaming:async({onSegment})=>{
      for(let i=0;i<segments.length;i++)await onSegment({sequence:i+1,text:segments[i]},'dialogue_only');
      return {decision:{dialogue:final,command:''},mode:'dialogue_only'};
    }};
}
const streamingConfig={structuredStreamingEnabled:true,earlyTtsEnabled:true};

test('WS-5a E2E completed (buffered): NPC reply is journaled with reply_to, same turn hash derivation, same timeline and ordered after the player line',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=npcSpy(x);
  const turn=await x.typed('Do you remember me?');
  assert.equal((await x.settled(turn)).status,'completed');
  const j=await x.journal();
  assert.equal(j.players.length,1);assert.equal(j.npcs.length,1);
  const [p]=j.players,[n]=j.npcs;
  assert.equal(spy.results[0].status,'stored');
  assert.equal(spy.results[0].durable,true);
  assert.equal(spy.results[0].delivery,'completed');
  assert.equal(spy.results[0].replyTo,p.record_id);
  assert.equal(n.replyTo,p.record_id);
  assert.equal(n.delivery,'completed');
  assert.equal(n.content,'Got it.');
  assert.equal(n.session_id,p.session_id);
  assert.equal(n.protagonist,p.protagonist);
  assert.ok(Date.parse(n.committed_at_utc)>=Date.parse(p.committed_at_utc),'reply never precedes the line it answers');
  // The single turn-hash derivation: both speakers, one function.
  const identity=x.identityOf(turn),host=x.store.verifiedHostContext;
  for(const [row,speaker] of [[p,'player'],[n,'npc']])
    assert.equal(row.turn_identity_hash,journalTurnIdentityHash({characterId:x.profile.characterId,
      timelineId:x.timelineId,speaker,sessionId:row.session_id,hostRunId:host.hostRunId,identity}));
  assert.notEqual(p.turn_identity_hash,n.turn_identity_hash);
  // Provenance sidecar written in the same transaction.
  const e=evidenceOf(j.npcSources[0]);
  assert.equal(j.npcSources[0].record_id,n.record_id);
  assert.equal(e.playerSourceSha256,j.sources[0].source_sha256,'bound to the exact player-line provenance');
  assert.equal(e.timelineId,x.timelineId);
  assert.equal(e.speech.segments.length,1);
  assert.deepEqual(e.speech.segments[0],{sequence:0,textSha256:sha('Got it.'),textUtf8Bytes:7,providerBytes:2,forwardedBytes:2});
  assert.equal(e.speech.runnerTerminal,null,'a completed turn never needed a failure terminal');
  assert.equal(assistant(x).length,1,'RAM history behaviour is unchanged');
});

test('WS-5a E2E completed (early streamed): ordered TTS segments are journaled byte-exact, never the final model draft',{timeout:30000},async t=>{
  const x=await d01Harness(t,{config:streamingConfig}),spy=npcSpy(x);
  const parts=['Oh— ','fuck, ','you made it! 🚕 café́'];
  const spoken=[];
  // The final model draft deliberately differs from what was spoken.
  streamingModel(x,parts,{final:'A DIFFERENT FINAL DRAFT'});
  x.h.runtime.services.speak=async({dialogue,onPcm})=>{
    spoken.push(dialogue);
    await onPcm(new Uint8Array(4));await onPcm(new Uint8Array(6));
    return {bytes:10,chunks:2,discardedTrailingByte:false};
  };
  const turn=await x.typed('Say something rude and happy.');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.deepEqual(spoken,parts);
  const j=await x.journal();
  assert.equal(spy.results[0].delivery,'completed');
  assert.equal(j.npcs.length,1);
  assert.equal(Buffer.compare(Buffer.from(j.npcs[0].content,'utf8'),Buffer.from(parts.join(''),'utf8')),0);
  assert.equal(j.npcs[0].replyTo,j.players[0].record_id);
  const e=evidenceOf(j.npcSources[0]);
  assert.deepEqual(e.speech.segments.map(s=>[s.sequence,s.providerBytes,s.forwardedBytes]),[[0,10,10],[1,10,10],[2,10,10]]);
  assert.equal(e.speech.streamEnded,true);
});

test('WS-5a E2E interrupted: player barge-in after playback started journals the spoken text as `interrupted` (possibly not heard), RAM history unchanged',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=npcSpy(x);
  manualPlayback(x);
  const turn=await x.typed('Tell me a long story.');
  await streamEnded(x,turn);
  await started(x,turn);
  await ended(x,turn,{reason:'player_barge_in',wasInterrupted:true});
  const result=await x.settled(turn);
  assert.notEqual(result.status,'completed');
  assert.equal(assistant(x).length,0,'interrupted speech never enters the assistant history');
  const j=await x.journal();
  assert.equal(j.npcs.length,1);
  const [n]=j.npcs;
  assert.equal(n.delivery,'interrupted');
  assert.equal(n.content,'Got it.');
  assert.equal(n.replyTo,j.players[0].record_id);
  assert.match(n.receipt_id,/^[0-9a-f-]{36}$/);
  assert.notEqual(n.receipt_id,null);
  const e=evidenceOf(j.npcSources[0]);
  assert.equal(e.delivery,'interrupted');
  assert.equal(e.speech.nativeTerminal.wasInterrupted,true);
  assert.equal(e.speech.audibleStart,true);
  assert.equal(e.speech.historyAccepted,false);
  assert.equal(spy.results[0].delivery,'interrupted');
});

test('WS-5a E2E interrupted by supersession: a newer player turn cuts the NPC off mid-playback; both lines are kept in order',{timeout:30000},async t=>{
  const x=await d01Harness(t);
  manualPlayback(x);
  const first=await x.typed('First thing I say.');
  await streamEnded(x,first);
  await started(x,first);
  x.session.autoNativeAcks(); // the next reply plays out normally
  const second=await x.typed('Second thing, interrupting you.');
  assert.equal((await x.settled(second)).status,'completed');
  await waitFor(async()=>(await x.journal()).npcs.length===2,'both NPC lines written');
  const j=await x.journal();
  const byTurn=new Map(j.players.map(p=>[p.content,p]));
  const npcFor=text=>j.npcs.find(n=>n.replyTo===byTurn.get(text).record_id);
  assert.equal(npcFor('First thing I say.').delivery,'interrupted');
  assert.equal(npcFor('Second thing, interrupting you.').delivery,'completed');
  assert.equal(j.rows.length,4);
});

test('WS-5a E2E interrupted mid-stream: only PCM that reached native is recorded; unsynthesised segments never appear',{timeout:30000},async t=>{
  const x=await d01Harness(t,{config:{...streamingConfig,retry:{enabled:false,maxAttempts:1}}});
  manualPlayback(x);
  streamingModel(x,['One. ','Two. ','Three never spoken.']);
  let call=0;
  x.h.runtime.services.speak=async({onPcm})=>{
    call++;
    await onPcm(new Uint8Array(6));
    if(call===2){await onPcm(new Uint8Array(2));throw new ProviderRequestError('TTS dropped mid-segment',{code:'econnreset'});}
    return {bytes:6,chunks:1,discardedTrailingByte:false};
  };
  const turn=await x.typed('Count for me.');
  await started(x,turn); // playback of segment one is audible
  const result=await x.settled(turn);
  assert.notEqual(result.status,'completed');
  const j=await x.journal();
  assert.equal(j.npcs.length,1);
  assert.equal(j.npcs[0].delivery,'interrupted');
  // Segment two reached native partially, so it MAY have been heard; segment
  // three was never synthesised and is not part of the record.
  assert.equal(j.npcs[0].content,'One. Two. ');
  const e=evidenceOf(j.npcSources[0]);
  assert.deepEqual(e.speech.segments.map(s=>s.forwardedBytes),[6,8]);
});

test('WS-5a E2E failed: TTS fails before any audio reached native -> `failed` line with the planned text, no receipt, not in assistant history',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=npcSpy(x);
  x.h.runtime.services.speak=async()=>{throw new ProviderRequestError('TTS unavailable',{code:'econnreset'});};
  const turn=await x.typed('Anything?');
  const result=await x.settled(turn);
  assert.notEqual(result.status,'completed');
  assert.equal(assistant(x).length,0);
  const j=await x.journal();
  assert.equal(j.npcs.length,1);
  const [n]=j.npcs;
  assert.equal(n.delivery,'failed');
  assert.equal(n.content,'Got it.');
  assert.equal(n.receipt_id,null,'a failed line was never delivered, so no delivery receipt exists');
  assert.equal(n.replyTo,j.players[0].record_id);
  const e=evidenceOf(j.npcSources[0]);
  assert.equal(e.delivery,'failed');
  assert.equal(e.speech.audibleStart,false);
  assert.equal(e.speech.runnerTerminal,'tts_error');
  assert.equal(e.speech.nativeTerminal.type,'fail','native reported the failure itself');
  assert.equal(e.speech.nativeTerminal.hadAudio,false);
  assert.equal(spy.results[0].delivery,'failed');
});

test('WS-5a E2E failed: native authorization rejected means nothing was audible',{timeout:30000},async t=>{
  const x=await d01Harness(t);
  x.h.context.ws5aReject=(message)=>{
    if(message.type==='npcAudioTurnStart')queueMicrotask(()=>{x.h.context.ws5aMsg={...message,type:'npcAudioTurnRejected',reason:'speaker_invalid'};x.h.evaluate('by(ws5aMsg)');});
  };
  x.h.evaluate('autoNativeAck = message => ws5aReject(message)');
  const turn=await x.typed('Hello?');
  assert.notEqual((await x.settled(turn)).status,'completed');
  const j=await x.journal();
  assert.equal(j.npcs.length,1);
  assert.equal(j.npcs[0].delivery,'failed');
  assert.equal(j.npcs[0].receipt_id,null);
  assert.equal(evidenceOf(j.npcSources[0]).speech.runnerTerminal,'native_auth_rejected');
});

test('WS-5a E2E no reply was ever planned: a model failure writes the player line only',{timeout:30000},async t=>{
  const x=await d01Harness(t,{config:{retry:{enabled:false,maxAttempts:1}}});
  x.h.runtime.services.decide=async()=>{throw new ProviderRequestError('model down',{code:'econnreset'});};
  const turn=await x.typed('Are you there?');
  assert.notEqual((await x.settled(turn)).status,'completed');
  const j=await x.journal();
  assert.equal(j.players.length,1,'the accepted player line stands (memory plan 5.5)');
  assert.equal(j.npcs.length,0,'no invented NPC line');
});

test('WS-5a E2E forged arguments: text, status and a completed receipt passed to the service change nothing',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=npcSpy(x);
  manualPlayback(x);
  spy.before=null;
  const real=x.h.runtime.services.recordM2Npc;
  x.h.runtime.services.recordM2Npc=args=>real({...args,text:'FORGED NPC LINE',delivery:'completed',
    mode:'buffered',receipt:{type:'playback_ended',reason:'completed',ok:true,wasInterrupted:false,
      playbackStarted:true,hadAudio:true,...args.turn.identity},spokenSegments:['FORGED NPC LINE']});
  const turn=await x.typed('Be honest.');
  await streamEnded(x,turn);
  await started(x,turn);
  await ended(x,turn,{reason:'player_barge_in',wasInterrupted:true});
  await x.settled(turn);
  const j=await x.journal();
  assert.equal(j.rows.some(r=>r.content.includes('FORGED')),false);
  assert.deepEqual(j.npcs.map(n=>[n.content,n.delivery]),[['Got it.','interrupted']]);
});

test('WS-5a E2E forged evidence surface: the recorder and verifier are unreachable from runtime, services, history or the bridge',{timeout:30000},async t=>{
  const x=await d01Harness(t);
  for(const holder of [x.h.runtime,x.h.runtime.services,x.h.runtime.history]){
    for(const key of Object.getOwnPropertyNames(holder))
      assert.equal(/speechDelivery|speechLedger|openTurn|beginSegment/i.test(key),false,key);
  }
  assert.deepEqual(Object.keys(x.h.runtime.services).filter(k=>/M2/.test(k)).sort(),
    ['bindM2Turn','recordM2Npc','recordM2Player']);
  assert.equal('admitM2SpeechSegment' in x.h.runtime.services,false,'caller-supplied byte counts are gone');
  const turn=await x.typed('Check.');
  assert.equal((await x.settled(turn)).status,'completed');
  // Direct service call with no ledger entry for a tuple the runtime never ran.
  const ghost={identity:{pedId:'17',turnId:'ghost',generationId:9,sessionNonce:1},m2Capture:null};
  assert.equal(await x.h.runtime.services.recordM2Npc({turn:ghost,text:'ghost',delivery:'completed'}),null);
  assert.equal((await x.journal()).npcs.length,1);
});

for(const [label,perturb,expectReason] of [
  ['session closes after the reply played',x=>x.session.connection.close(),null],
  ['world epoch changes after the reply played',async x=>{x.native.worldEpoch=2;await x.native.send('world_epoch',{epoch:2,reason:'clock_regression'});await x.native.sample();},null],
  ['original acceptance source run is retired (bridge replaced / host change)',x=>x.h.runtime.retireOriginalAcceptanceSourceRun(),null],
  ['the NPC is recycled: new anchor and incarnation for the same ped handle',async x=>{
    x.native.stop();
    x.native.npcRef=randomUUID();x.native.incarnationId=randomUUID();x.native.encounterId=randomUUID();
    await x.native.roster();await x.native.sample();x.native.start();},null],
  ['the human switches avatar between the player line and the reply',async x=>{
    x.native.avatar='michael';
    const before=x.native.samples;
    await waitFor(()=>x.native.samples>=before+2,'two samples as Michael');},'d03_npc_continuity_lost'],
  ['a different timeline is confirmed before the reply is written',async x=>{
    const next=await x.store.createTimeline({label:'a diverging future'});
    await x.store.confirmTimeline(next,{confirmation:next});
    x.restoreTimeline=true;},null],
])test(`WS-5a E2E stale: ${label} -> the reply is not journaled, the earlier player line stands`,{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=npcSpy(x);
  spy.before=()=>perturb(x);
  const turn=await x.typed('Remember what I said.');
  await x.settled(turn);
  await waitFor(()=>spy.results.length===1,'NPC write settled');
  assert.equal(spy.results[0].status,'not_stored',label);
  if(expectReason)assert.equal(spy.results[0].reason,expectReason);
  // Re-select the original timeline so its journal can be read back.
  if(x.restoreTimeline)await x.store.confirmTimeline(x.timelineId,{confirmation:x.timelineId});
  const rows=(await x.journal()).rows;
  assert.deepEqual(rows.map(r=>r.speaker),['player'],label);
});

test('WS-5a E2E stale: a reply for an interrupted turn is refused once the session has been retired',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=npcSpy(x);
  manualPlayback(x);
  spy.before=()=>x.session.connection.close();
  const turn=await x.typed('Hold on.');
  await streamEnded(x,turn);await started(x,turn);
  await ended(x,turn,{reason:'player_barge_in',wasInterrupted:true});
  await x.settled(turn);
  await waitFor(()=>spy.results.length===1,'NPC write settled');
  assert.equal(spy.results[0].status,'not_stored');
  assert.deepEqual((await x.journal()).rows.map(r=>r.speaker),['player']);
});

test('WS-5a E2E duplicate: replaying the NPC write is idempotent (one row, one provenance sidecar) and a different outcome cannot overwrite it',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=npcSpy(x);
  let replay=null;
  x.h.runtime.services.recordM2Npc=async args=>{
    const first=await spy.original(args),again=await spy.original(args);
    replay={first,again};
    return first;
  };
  const turn=await x.typed('Say it once.');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.deepEqual([replay.first.status,replay.again.status],['stored','duplicate']);
  assert.equal(replay.first.recordId,replay.again.recordId);
  const j=await x.journal();
  assert.equal(j.npcs.length,1);assert.equal(j.npcSources.length,1);
});

test('WS-5a E2E a late completed/interrupted/failed write cannot be repeated after the turn is finished',{timeout:30000},async t=>{
  const x=await d01Harness(t),spy=npcSpy(x);
  const turn=await x.typed('One turn.');
  assert.equal((await x.settled(turn)).status,'completed');
  const args=spy.args[0];
  // The capture and the ledger entry are retired when the turn finishes.
  assert.equal(await args.turn.m2Capture.recordNpcOutcome().then(r=>r.status),'not_stored');
  assert.equal((await x.journal()).npcs.length,1);
});

test('WS-5a E2E non-player turns (Director / special event) never produce an NPC memory line',{timeout:30000},async t=>{
  const x=await d01Harness(t);
  const turn=await x.h.evaluate('kb({ speakerPedId: "17", listenerPedId: "player", content: "A car alarm is sounding.", reason: "scene_event" })');
  assert.equal(turn.source,'special_event');
  assert.equal((await x.settled(turn)).status,'completed');
  assert.equal((await x.journal()).rows.length,0);
});

test('WS-5a E2E the timeline is preserved across a conversation: player/reply pairs stay ordered and linked',{timeout:30000},async t=>{
  const x=await d01Harness(t);
  const lines=['First.','Second.','Third.'];
  for(const line of lines){
    const turn=await x.typed(line);
    assert.equal((await x.settled(turn)).status,'completed');
    await sleep(3);
  }
  const j=await x.journal();
  assert.equal(j.rows.length,6);
  for(const p of j.players){
    const replies=j.npcs.filter(n=>n.replyTo===p.record_id);
    assert.equal(replies.length,1,p.content);
    assert.ok(Date.parse(replies[0].committed_at_utc)>=Date.parse(p.committed_at_utc));
  }
  const order=j.rows.map(r=>r.record_id);
  const times=j.rows.map(r=>Date.parse(r.committed_at_utc));
  for(let i=0;i<j.players.length;i++)
    assert.ok(order.indexOf(j.npcs.find(n=>n.replyTo===j.players[i].record_id).record_id)>order.indexOf(j.players[i].record_id));
  assert.deepEqual([...times].sort((a,b)=>a-b).length,times.length);
});
