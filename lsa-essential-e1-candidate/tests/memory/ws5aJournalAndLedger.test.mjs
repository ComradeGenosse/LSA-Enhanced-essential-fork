// OFFLINE unit tests for WS-5a building blocks: journal reply_to/delivery
// validation (real P2 SQLite) and the NPC speech delivery ledger classifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {createEssentialMemoryStorage} from '../../src/characters/memoryStorageAdapter.mjs';
import {journalIdentityUuid,journalTurnIdentityHash} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {createNpcSpeechDeliverySource} from '../../src/memory/npcSpeechDeliveryLedger.mjs';
import {worldProfileId} from '../identity-fixtures.mjs';
import {profile} from '../p2-fixtures.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const host={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
async function setup(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ws5a-journal-'));
  // Windows holds the SQLite file and WAL/SHM handles until the DB closes.
  // One ordered teardown also runs if setup fails partway through.
  let store;
  t.after(async()=>{
    try { await store?.close(); }
    finally { await fs.rm(dir,{recursive:true,force:true}); }
  });
  store=createEssentialMemoryStorage({filePath:path.join(dir,'p.sqlite'),worldProfileId,sourceRequired:true});
  await store.initialize();
  const a=await store.create(profile());
  const timelineId=await store.createTimeline({label:'ws5a'});
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timelineId,{confirmation:timelineId});
  const sessionId=journalIdentityUuid(['session',host.hostRunId,1,'17']);
  const attribution={sessionId,protagonist:'franklin',hostRunId:host.hostRunId,worldEpoch:1};
  const base={version:1,characterId:a.characterId,worldProfileId,timelineId,kind:'dialogue_line'};
  const identity=n=>({pedId:'17',turnId:'turn-'+n,generationId:1,sessionNonce:1});
  const hash=(speaker,n,sid=sessionId)=>journalTurnIdentityHash({characterId:a.characterId,timelineId,
    speaker,sessionId:sid,hostRunId:host.hostRunId,identity:identity(n)});
  const playerLine=(n='1',text='Hello there.')=>{const h=hash('player',n);
    return {...base,recordId:journalIdentityUuid(['player',h]),speaker:'player',source:'typed',content:text,
      delivery:'accepted',committedAtUtc:new Date().toISOString(),turnIdentityHash:h,utteranceId:null,
      transcription:null,deliveryReceiptId:null,replyTo:null};};
  const npcLine=(n='1',over={})=>{const h=hash('npc',n);
    return {...base,recordId:journalIdentityUuid(['npc',h]),speaker:'npc',source:'npc_generated',content:'Hi.',
      delivery:'completed',committedAtUtc:new Date().toISOString(),turnIdentityHash:h,utteranceId:null,
      transcription:null,deliveryReceiptId:journalIdentityUuid(['r',h]),replyTo:null,...over};};
  const read=()=>store.readDialogueLines({characterId:a.characterId,timelineId});
  return {store,a,timelineId,sessionId,attribution,playerLine,npcLine,read};
}

test('journal: NPC lines may reply_to the accepted player line, with completed/interrupted/failed delivery',async t=>{
  const x=await setup(t);
  const p=x.playerLine();
  assert.equal((await x.store.appendDialogueLine(p,x.attribution)).inserted,true);
  for(const [n,delivery] of [['1','completed'],['2','interrupted'],['3','failed']]){
    const q=x.playerLine(n);if(n!=='1')await x.store.appendDialogueLine(q,x.attribution);
    const line=x.npcLine(n,{delivery,replyTo:q.recordId,
      deliveryReceiptId:delivery==='failed'?null:journalIdentityUuid(['r',n])});
    assert.equal((await x.store.appendDialogueLine(line,x.attribution)).inserted,true,delivery);
  }
  const lines=await x.read();
  assert.equal(lines.length,6);
  assert.deepEqual(lines.filter(l=>l.speaker==='npc').map(l=>l.delivery).sort(),['completed','failed','interrupted']);
});

test('journal: delivery/receipt/reply_to contradictions and dangling or cross-scope replies are rejected',async t=>{
  const x=await setup(t);
  const p=x.playerLine();
  await x.store.appendDialogueLine(p,x.attribution);
  const put=(over,attr=x.attribution)=>x.store.appendDialogueLine(x.npcLine('9',over),attr);
  await assert.rejects(put({delivery:'failed',replyTo:p.recordId}),/journal_unverified_playback/,'failed never has a receipt');
  await assert.rejects(put({delivery:'interrupted',deliveryReceiptId:null,replyTo:p.recordId}),/journal_unverified_playback/);
  await assert.rejects(put({delivery:'accepted',replyTo:p.recordId}),/journal_unverified_playback/);
  await assert.rejects(put({delivery:'possibly_heard',replyTo:p.recordId}),/journal_unverified_playback/);
  await assert.rejects(put({replyTo:'not-a-uuid'}),/journal_invalid_reply_to/);
  await assert.rejects(put({replyTo:randomUUID()}),/journal_reply_to_unresolved/,'dangling');
  await assert.rejects(put({replyTo:p.recordId},{...x.attribution,sessionId:randomUUID()}),/journal_reply_to_unresolved/,'other session');
  await assert.rejects(x.store.appendDialogueLine({...p,recordId:randomUUID(),turnIdentityHash:sha('x'),replyTo:p.recordId},x.attribution),
    /journal_invalid_reply_to/,'a player line cannot reply to anything');
  // An NPC line is not a valid parent.
  const good=x.npcLine('9',{replyTo:p.recordId});
  await x.store.appendDialogueLine(good,x.attribution);
  await assert.rejects(x.store.appendDialogueLine(x.npcLine('10',{replyTo:good.recordId}),x.attribution),/journal_reply_to_unresolved/);
  assert.equal((await x.read()).length,2);
});

test('journal: legacy lines without replyTo stay valid; replay with a different outcome is a conflict, never an upgrade',async t=>{
  const x=await setup(t);
  const p=x.playerLine();delete p.replyTo;
  await x.store.appendDialogueLine(p,x.attribution);
  const n=x.npcLine('1',{delivery:'interrupted',replyTo:p.recordId});
  assert.equal((await x.store.appendDialogueLine(n,x.attribution)).inserted,true);
  assert.equal((await x.store.appendDialogueLine(n,x.attribution)).inserted,false,'exact replay');
  const upgrade={...n,delivery:'completed',deliveryReceiptId:journalIdentityUuid(['other'])};
  await assert.rejects(x.store.appendDialogueLine(upgrade,x.attribution),/journal_replay_conflict/);
  await assert.rejects(x.store.appendDialogueLine({...n,content:'Different text.'},x.attribution),/journal_replay_conflict/);
  assert.equal((await x.read()).filter(l=>l.speaker==='npc')[0].delivery,'interrupted');
});

// ---- ledger classifier -----------------------------------------------------
const id=n=>({pedId:'17',turnId:'t'+n,generationId:1,sessionNonce:1});
function ledger(){
  let tick=0;
  const src=createNpcSpeechDeliverySource({now:()=>new Date(Date.UTC(2026,9,13,12,0,tick++))});
  const open=(n='1')=>src.recorder.openTurn({identity:id(n),source:'player_text',connection:{},signal:new AbortController().signal});
  return {src,open,evaluate:n=>src.verifier.evaluate(id(n))};
}
const nativeOf=(n,type,extra={})=>({...id(n),type,...extra});
function speak(turn,text,bytes=4,{providerBytes=bytes,sequence=0}={}){
  const s=turn.beginSegment({sequence,text});s.forwarded(bytes);s.completed(providerBytes);return s;
}
const ended=(n,extra={})=>nativeOf(n,'playback_ended',{reason:'completed',hadAudio:true,playbackStarted:true,wasInterrupted:false,...extra});

test('ledger: in-flight turn has no outcome; ledger is private per tuple and rejects non-player sources',()=>{
  const l=ledger(),turn=l.open();
  assert.equal(l.evaluate('1'),null);
  speak(turn,'Hi.');turn.native(nativeOf('1','audio_turn_accepted'));
  assert.equal(l.evaluate('1'),null,'audio handed over, no terminal yet');
  assert.equal(l.open('1'),null,'one ledger per tuple');
  assert.equal(l.src.recorder.openTurn({identity:id('2'),source:'special_event',connection:{},signal:new AbortController().signal}),null);
  assert.equal(l.src.recorder.openTurn({identity:{...id('3'),pedId:'0'},source:'player_text',connection:{},signal:new AbortController().signal}),null);
});

test('ledger: completed needs equal provider/forwarded bytes, stream end, native completed AND history acceptance',()=>{
  const l=ledger(),turn=l.open();
  speak(turn,'Hello ');speak(turn,'world.',6,{sequence:1});
  turn.planned('Hello world.');turn.native(nativeOf('1','playback_started'));
  turn.finalized();turn.native(ended('1'));
  assert.equal(l.evaluate('1').delivery,'interrupted','no history acceptance yet => cannot claim completed');
  assert.equal(turn.historyAccepted({...ended('1')}),true);
  const done=l.evaluate('1');
  assert.equal(done.delivery,'completed');assert.equal(done.text,'Hello world.');
  assert.equal(done.segments.length,2);assert.match(done.evidenceSha256,/^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(done));
});

test('ledger: mismatched bytes, gaps, overlapping segments and bad counts poison the turn (never completed)',()=>{
  for(const sabotage of [
    t=>speak(t,'x',4,{providerBytes:6}),
    t=>{t.beginSegment({sequence:1,text:'gap'});},
    t=>{t.beginSegment({sequence:0,text:'a'});t.beginSegment({sequence:1,text:'b'});},
    t=>{const s=t.beginSegment({sequence:0,text:'a'});s.forwarded(0);},
    t=>{t.beginSegment({sequence:0,text:'   '});},
  ]){
    const l=ledger(),turn=l.open();
    sabotage(turn);
    turn.native(nativeOf('1','playback_started'));turn.finalized();turn.native(ended('1'));
    turn.historyAccepted(ended('1'));
    assert.notEqual(l.evaluate('1')?.delivery,'completed');
  }
});

test('ledger: interrupted records exactly the segments whose PCM reached native, only after audible start',()=>{
  const l=ledger(),turn=l.open();
  speak(turn,'One. ');
  const second=turn.beginSegment({sequence:1,text:'Two. '});second.forwarded(2);second.failed();
  turn.beginSegment({sequence:2,text:'Three.'}); // poisoned: previous segment not completed
  turn.native(nativeOf('1','playback_started'));
  turn.native(ended('1',{reason:'player_barge_in',wasInterrupted:true}));
  const out=l.evaluate('1');
  assert.equal(out.delivery,'interrupted');
  assert.equal(out.text,'One. Two. ');
  // Without an audible start the same evidence is a failure, not a speech.
  const l2=ledger(),t2=l2.open();
  speak(t2,'Quiet.');t2.planned('Quiet.');
  t2.native(nativeOf('1','audio_turn_rejected',{reason:'speaker_invalid'}));t2.terminal('native_auth_rejected');
  const failed=l2.evaluate('1');
  assert.equal(failed.delivery,'failed');assert.equal(failed.audibleStart,false);
});

test('ledger: forged native events (other tuple, unknown type, repeated/late terminals) cannot rewrite the outcome',()=>{
  const l=ledger(),turn=l.open();
  speak(turn,'Hi.');turn.planned('Hi.');
  assert.equal(turn.native(nativeOf('2','playback_started')),false,'other turn');
  assert.equal(turn.native({...id('1'),type:'playback_ended',pedId:'18'}),false,'other ped');
  turn.native(nativeOf('1','playback_started'));
  turn.native(ended('1',{reason:'player_barge_in',wasInterrupted:true}));
  turn.native(ended('1')); // a later, contradictory terminal is ignored
  turn.finalized();turn.historyAccepted(ended('1'));
  const out=l.evaluate('1');
  assert.equal(out.delivery,'interrupted');
  assert.equal(turn.terminal('definitely_made_up'),false);
});

test('ledger: failed text is the host-validated plan; retire/release/clear drop evidence',()=>{
  const l=ledger(),turn=l.open();
  turn.planned('The plan.');turn.terminal('model_error');
  assert.equal(l.evaluate('1').delivery,'failed');
  assert.equal(l.evaluate('1').text,'The plan.');
  l.src.recorder.retireSession({pedId:'17',sessionNonce:1});
  assert.equal(l.evaluate('1'),null);
  assert.equal(turn.native(nativeOf('1','playback_started')),false,'a retired turn accepts nothing');
  const l2=ledger(),t2=l2.open();t2.planned('x');t2.terminal('tts_error');
  t2.release();assert.equal(l2.evaluate('1'),null);
  const l3=ledger(),t3=l3.open();t3.planned('x');t3.terminal('tts_error');
  l3.src.recorder.clear();assert.equal(l3.evaluate('1'),null);
});
