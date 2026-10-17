// W03/A03 offline source-fixture tests. Real temporary P2 SQLite; no GTA/native
// binary proof, paid cloud call, or replacement original C-01 producer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createM2EssentialCapture} from '../src/memory/m2EssentialCapture.mjs';
import {createEssentialMemoryStorage} from '../src/characters/memoryStorageAdapter.mjs';
import {worldProfileId} from './identity-fixtures.mjs';
import {profile} from './p2-fixtures.mjs';

const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const equalTurn=(a,b)=>!!a&&!!b&&
  ['pedId','turnId','generationId','sessionNonce'].every(k=>a[k]===b[k]);
const protagonists=['franklin','michael','trevor','unknown'];

async function sqliteFixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'memory-k-w03-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'profiles.sqlite');
  const store=createEssentialMemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const character=await store.create(profile());
  const timelineId=await store.createTimeline({label:'W03 actual SQLite'});
  const host={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timelineId,{confirmation:timelineId});
  return {filePath,store,character,timelineId,host,
    read:()=>store.readDialogueLines({characterId:character.characterId,timelineId,limit:1000})};
}

// Source-specific fixture ledgers simulate, but do not implement, T1's C-01
// native authority, original host accepted-input ledger or native PCM terminal.
function trustedFixture(x,{turnId=randomUUID(),protagonist='unknown',source='typed'}={}){
  const identity={pedId:'ped-101',turnId,generationId:'1',sessionNonce:'7'};
  const s={live:true,source,protagonist,incarnationId:randomUUID(),
    encounterId:randomUUID(),observerIndex:3,
    accepted:null,historyReceipt:null,completedAudioReceipt:null,
    finalized:false,mode:null,forwarded:new Map()};
  const ownerAlias=x.character.promotion.ownerAlias;
  const verifySource=()=>{
    if(!s.live)return null;
    return {nativeVerified:true,current:true,identity,characterId:x.character.characterId,
      ownerAlias,hostRunId:x.host.hostRunId,worldEpoch:x.host.worldEpoch,
      protagonistKey:s.protagonist,incarnationId:s.incarnationId,
      encounterId:s.encounterId,observerIndex:s.observerIndex};
  };
  const nativeAuthority={verifyCurrentTurn:()=>verifySource()};
  const acceptedInput={verifyAccepted:({identity:given,source:givenSource,text,host})=>
    verifySource()&&s.accepted?.final===true&&s.accepted.source===givenSource&&
    s.accepted.text===text&&equalTurn(identity,given)&&
    host.hostRunId===x.host.hostRunId&&host.worldEpoch===x.host.worldEpoch
      ? {accepted:true,final:true,source:givenSource,text,identity}:null};
  const playbackHistory={verifyCompleted:({identity:given,receipt,host})=>
    verifySource()&&s.historyReceipt===receipt&&equalTurn(identity,given)&&
    host.hostRunId===x.host.hostRunId&&receipt?.type==='playback_ended'&&
    receipt.reason==='completed'&&receipt.ok===true&&receipt.playbackStarted===true&&
    receipt.hadAudio===true&&receipt.wasInterrupted===false
      ? {nativeVerified:true,historyAccepted:true,identity,receipt}:null};
  const speechTransport={
    verifyForwardedSegment:({identity:given,segment})=>{
      const actual=s.forwarded.get(segment.sequence);
      return verifySource()&&equalTurn(identity,given)&&actual&&
        actual.text===segment.text&&actual.audioBytes===segment.audioBytes&&
        actual.forwardedBytes===segment.forwardedBytes&&actual.providerCompleted===true
        ? {accepted:true,identity,...actual}:null;
    },
    verifyFinalizedAudio:({identity:given,mode,segments,receipt})=>
      verifySource()&&equalTurn(identity,given)&&s.finalized===true&&
      s.completedAudioReceipt===receipt&&s.mode===mode&&
      segments?.length===s.forwarded.size&&segments.every((seg,i)=>{
        const actual=s.forwarded.get(i);
        return actual&&seg.sequence===i&&seg.text===actual.text&&
          seg.audioBytes===actual.audioBytes&&seg.forwardedBytes===actual.forwardedBytes;
      }) ? {complete:true,identity,mode,segmentCount:segments.length,receipt}:null
  };
  const capture=createM2EssentialCapture({
    store:x.store,characterId:x.character.characterId,ownerAlias,identity,
    nativeAuthority,acceptedInput,playbackHistory,speechTransport,
    isCurrent:()=>s.live
  });
  const accept=(text,mode=source)=>{s.accepted={source:mode,text,final:true};};
  const stage=(sequence,text,{audioBytes=64,forwardedBytes=64}={})=>{
    const segment={sequence,text,audioBytes,forwardedBytes,providerCompleted:true};
    s.forwarded.set(sequence,segment);
    return {sequence,text,audioBytes,forwardedBytes};
  };
  const terminal=()=>({...identity,type:'playback_ended',reason:'completed',
    ok:true,wasInterrupted:false,playbackStarted:true,hadAudio:true,
    receiptId:randomUUID()});
  const finish=(receipt,mode='buffered')=>{
    s.mode=mode;s.finalized=true;s.completedAudioReceipt=receipt;s.historyReceipt=receipt;
  };
  return {capture,state:s,identity,accept,stage,terminal,finish};
}

test('W03 A03: 205 typed/final-STT accepted lines retain exact Unicode/profanity and source at actual SQLite restart',async t=>{
  const x=await sqliteFixture(t);
  try{
    const inputs=[];
    for(let i=0;i<205;i++){
      const source=i%2===0?'typed':'stt';
      const protagonist=protagonists[i%4];
      const line='  #'+i+' — fuck\tthat, déjà vu e\u0301 🚗 中文\n"don\'t"  ';
      const f=trustedFixture(x,{turnId:'line-'+i,source,protagonist});
      f.accept(line);
      const transcription=source==='stt'?{provider:'source-fixture',model:'final',confidence:null}:null;
      const first=await f.capture.acceptPlayer({source,text:line,transcription});
      assert.equal(first.status,'stored','line '+i);
      assert.equal(first.durable,true,'line '+i);
      assert.equal(first.scope.timelineId,x.timelineId);
      assert.equal(first.scope.characterId,x.character.characterId);
      assert.equal(first.proof.kind,'original_c01_accepted_turn');
      assert.equal(first.proof.contentSha256,sha(line));
      assert.equal(first.proof.source,source);
      assert.equal(first.proof.protagonistKey,protagonist);
      assert.equal(first.proof.identity.turnId,f.identity.turnId);
      // A replay carries the same transcription metadata; different metadata is a
      // journal_replay_conflict (asserted separately below), not a duplicate.
      const again=await f.capture.acceptPlayer({source,text:line,transcription});
      assert.equal(again.status,'duplicate','line '+i);
      assert.equal(again.durable,true);
      assert.equal(again.recordId,first.recordId);
      f.capture.retire();
      inputs.push({id:first.recordId,source,text:line,protagonist});
    }
    const rows=await x.read();
    assert.equal(rows.length,205);
    for(const line of inputs){
      const row=rows.find(r=>r.recordId===line.id);
      assert.ok(row);
      assert.equal(row.source,line.source);
      assert.equal(row.speaker,'player');
      assert.equal(row.delivery,'accepted');
      assert.equal(row.attribution.protagonist,line.protagonist);
      assert.equal(Buffer.compare(Buffer.from(row.content,'utf8'),Buffer.from(line.text,'utf8')),0);
    }
    await x.store.close();
    const raw=new DatabaseSync(x.filePath,{readOnly:true});
    try {
      assert.equal(raw.prepare("SELECT count(*) n FROM dialogue_journal WHERE speaker='player'").get().n,205);
    }finally{raw.close();}
    const reopened=createEssentialMemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await reopened.initialize();
    try {
      const persisted=await reopened.readDialogueLines({
        characterId:x.character.characterId,timelineId:x.timelineId,limit:1000});
      assert.equal(persisted.length,205);
      assert.ok(persisted.some(r=>r.content===inputs[204].text));
      assert.equal(reopened.timelineWritable,false,'a restart does not reinstate native authority');
    }finally{await reopened.close();}
  }finally{await x.store.close();}
});

test('W03 A03: no M5 durable receipt if P2 readback is absent, despite a writer acknowledgment',async t=>{
  const x=await sqliteFixture(t);
  try {
    const f=trustedFixture(x);
    const raw='  Accepted but readback is unavailable. 🧠  ';
    f.accept(raw);
    x.store.findExactQuote=async()=>[];
    const result=await f.capture.acceptPlayer({source:'typed',text:raw});
    assert.equal(result.status,'not_stored');
    assert.equal(result.reason,'m2_commit_readback_unverified');
    assert.equal(result.durable,undefined);
    assert.equal(result.recordId,undefined);
    assert.equal((await x.read()).length,1,'writer may have committed, but M5 cannot acknowledge it');
  }finally{await x.store.close();}
});

test('W03 A03: host-final STT correction is not an interim hypothesis and cannot alter committed bytes',async t=>{
  const x=await sqliteFixture(t);
  try {
    const f=trustedFixture(x,{source:'stt'});
    const intended='  I said STOP, not shop. Qué carajo!  ';
    f.state.accepted={source:'stt',text:intended,final:false};
    assert.equal((await f.capture.acceptPlayer({source:'stt',text:intended})).status,'not_stored');
    f.accept(intended,'stt');
    assert.equal((await f.capture.acceptPlayer({source:'stt',text:'I said shop'})).status,'not_stored');
    assert.equal((await f.capture.acceptPlayer({source:'stt',text:intended})).status,'stored');
    f.accept('I said shop','stt');
    const replay=await f.capture.acceptPlayer({source:'stt',text:'I said shop'});
    assert.equal(replay.status,'not_stored');
    assert.equal(replay.reason,'journal_replay_conflict');
    assert.deepEqual((await x.read()).map(r=>r.content),[intended]);
  }finally{await x.store.close();}
});

test('W03 A03: ordered early TTS requires provider/PCM completion and exact authenticated native playback',async t=>{
  const x=await sqliteFixture(t);
  try {
    const f=trustedFixture(x);
    const parts=['Oh—','fuck, ', 'you made it! 🚕'];
    for(let i=0;i<parts.length;i++)
      assert.equal(f.capture.admitSpeechSegment({mode:'early_streamed',
        ...f.stage(i,parts[i])}).status,'admitted');
    const terminal=f.terminal();
    f.finish(terminal,'early_streamed');
    assert.equal((await f.capture.completeNpc({receipt:terminal})).status,'stored');
    assert.equal((await f.capture.completeNpc({receipt:terminal})).status,'not_stored');
    const rows=await x.read();
    assert.equal(rows.length,1);
    assert.equal(rows[0].content,parts.join(''));
    assert.equal(rows[0].delivery,'completed');
    assert.equal(rows[0].deliveryReceiptId,terminal.receiptId);
    assert.equal(rows[0].speaker,'npc');
  }finally{await x.store.close();}
});

test('W03 A03: partial, cancelled, old native, recycled and duplicate speech receipts cannot commit',async t=>{
  const x=await sqliteFixture(t);
  try {
    const partial=trustedFixture(x,{turnId:'partial'});
    partial.stage(0,'Provider succeeded but native forwarded only half.',{audioBytes:200,forwardedBytes:100});
    assert.equal(partial.capture.admitSpeechSegment({mode:'buffered',sequence:0,
      text:'Provider succeeded but native forwarded only half.',
      audioBytes:200,forwardedBytes:100}).status,'not_stored');
    assert.equal((await partial.capture.completeNpc({receipt:partial.terminal()})).status,'not_stored');
    const unfinished=trustedFixture(x,{turnId:'unfinished'});
    unfinished.capture.admitSpeechSegment({mode:'buffered',...unfinished.stage(0,'Never played')});
    const terminal=unfinished.terminal();unfinished.finish(terminal);
    unfinished.state.finalized=false;
    assert.equal((await unfinished.capture.completeNpc({receipt:terminal})).status,'not_stored');
    const wrong=trustedFixture(x,{turnId:'wrong'});
    wrong.capture.admitSpeechSegment({mode:'buffered',...wrong.stage(0,'Unheard speech')});
    const original=wrong.terminal(),lookalike={...original};
    wrong.finish(original);
    assert.equal((await wrong.capture.completeNpc({receipt:lookalike})).status,'not_stored');
    const interrupted=trustedFixture(x,{turnId:'interrupted'});
    interrupted.capture.admitSpeechSegment({mode:'buffered',...interrupted.stage(0,'Interrupted speech')});
    const interruptedReceipt={...interrupted.terminal(),reason:'interrupted',wasInterrupted:true};
    interrupted.finish(interruptedReceipt);
    assert.equal((await interrupted.capture.completeNpc({receipt:interruptedReceipt})).status,'not_stored');
    const recycled=trustedFixture(x,{turnId:'recycled'});
    recycled.capture.admitSpeechSegment({mode:'buffered',...recycled.stage(0,'Old owner')});
    const recycledTerminal=recycled.terminal();recycled.finish(recycledTerminal);
    recycled.state.incarnationId=randomUUID();
    assert.equal((await recycled.capture.completeNpc({receipt:recycledTerminal})).status,'not_stored');
    assert.equal((await x.read()).length,0);
  }finally{await x.store.close();}
});

test('W03 A03: queued P2 write, epoch loss, timeline suspension and late source recovery fail closed',async t=>{
  const x=await sqliteFixture(t);
  try {
    const f=trustedFixture(x,{turnId:'queued'});
    f.accept('No late completion after owner loss.');
    const original=x.store.withTimelineWrite.bind(x.store);
    let resume;
    x.store.withTimelineWrite=(timeline,fn)=>new Promise((resolve,reject)=>{
      resume=()=>original(timeline,fn).then(resolve,reject);
    });
    const pending=f.capture.acceptPlayer({source:'typed',text:'No late completion after owner loss.'});
    assert.equal(typeof resume,'function');
    f.state.live=false;
    resume();
    assert.equal((await pending).status,'not_stored');
    f.state.live=true;
    assert.equal((await f.capture.acceptPlayer({source:'typed',text:'No late completion after owner loss.'})).status,'not_stored');
    x.store.withTimelineWrite=original;
    const changed=trustedFixture(x,{turnId:'epoch'});
    changed.accept('Epoch gone.');
    x.store.setVerifiedHostContext(null);
    assert.equal((await changed.capture.acceptPlayer({source:'typed',text:'Epoch gone.'})).status,'not_stored');
    x.store.setVerifiedHostContext(x.host);
    await x.store.confirmTimeline(x.timelineId,{confirmation:x.timelineId});
    assert.equal((await changed.capture.acceptPlayer({source:'typed',text:'Epoch gone.'})).status,'not_stored');
    assert.equal((await x.read()).length,0);
  }finally{await x.store.close();}
});
