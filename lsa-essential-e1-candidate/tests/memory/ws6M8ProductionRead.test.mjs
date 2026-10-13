import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createP2MemoryStorage} from '../../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {projectPreparedM8} from '../../src/context/knowledgeSelector.mjs';
import {createP2M8ProductionReader,readAuthorizedM8Snapshot} from '../../src/memory/p2M8ProductionRead.mjs';
import {readP2M8HistoricalSignals} from '../../../lsa-shared-brain/src/memory/m8SqliteHistory.mjs';
import {profile} from '../p2-fixtures.mjs';
import {worldProfileId} from '../identity-fixtures.mjs';

const uuid=()=>randomUUID();
const hash=text=>createHash('sha256').update(text).digest('hex');
async function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'ws6-agent-a-'));
 const filePath=path.join(dir,'p2.sqlite');

 const make=()=>createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
 const store=make();await store.initialize();
 const npc=await store.create(profile()),timelineId=await store.createTimeline({label:'m8'});
 store.setVerifiedHostContext({hostContextVersion:1,hostRunId:uuid(),worldEpoch:1});
 await store.confirmTimeline(timelineId);
 const scope={characterId:npc.characterId,worldProfileId,timelineId,protagonistKey:'franklin'};
 const identity={pedId:101,generationId:'gen-m8',sessionNonce:'ws6'};
 const recorder=createConversationJournalRecorder(store);
 const say=async (text,avatar='franklin')=>recorder.recordPlayerAccepted({
   characterId:npc.characterId,identity:{...identity,turnId:uuid()},
   source:'typed',text,attribution:{protagonist:avatar}});
 const authority=()=>({ ...scope,hostRunId:store.verifiedHostContext?.hostRunId,
   worldEpoch:store.verifiedHostContext?.worldEpoch,
   incarnationId:uuid(),encounterId:uuid(),observerCaptureRef:uuid(),
   turnIdentityHash:hash('accepted-original-input'),turnId:uuid(),nativeVerified:true,
   timelineWritable:true});
 let live=null,original=true;
 const reader=()=>createP2M8ProductionReader({
   store,currentIdentity:()=>live,originalCurrent:()=>original});
 const setIdentity=a=>{live={...a};};
 t.after(async()=>{if(store.available)await store.close();rmSync(dir,{recursive:true,force:true});});
 return {store,npc,scope,identity,recorder,say,authority,reader,setIdentity,
   invalidate:()=>{original=false},make,filePath};
}
async function three(f){
 const r=[];
 r.push(await f.say('Thanks for helping me, my friend.','michael'));
 r.push(await f.say('Inside joke: the flying purple car!','franklin'));
 r.push(await f.say('Running joke: the flying purple car!','trevor'));
 return r;
}

test('real P2 journal drives only source-linked opinions and jokes across avatars',async t=>{
 const f=await fixture(t),saved=await three(f);
 const ids=saved.map(s=>s.recordId),nowUtc=new Date(Date.now()+1000).toISOString();
 let originalJoke=null,originalOpinions=null;
 for(const protagonistKey of ['franklin','michael','trevor']){
  const s={...f.scope,protagonistKey},a={...f.authority(),...s};
  f.setIdentity(a);
  const reader=f.reader();
  // This verifies source-linked M8 semantics, not a latency bound. The
  // production default stays 200ms; timeout/revocation tests remain strict.
  const prepared=await reader.prepare({scope:s,authority:a,nowUtc,deadlineMs:2000});
  assert.equal(prepared.status,'ready',prepared.reason);
  assert.equal(prepared.projection.relationship.epistemicStatus,'character_opinion');
  assert.equal(prepared.projection.relationship.verifiedWorldFact,false);
  assert.ok(prepared.projection.relationship.dimensions.trust>0);
  assert.equal(prepared.projection.jokes.length,1);
  assert.equal(prepared.projection.jokes[0].callbackOptInRequired,true);
  assert.ok(prepared.projection.interpretations.every(x=>
    x.epistemicStatus==='character_opinion'&&x.verifiedWorldFact===false));
  assert.deepEqual(new Set(prepared.projection.relationship.sourceEvidenceIds),new Set(ids));
  const ps4=projectPreparedM8(prepared,{maxBytes:4096});
  assert.ok(ps4.characterOpinions.length>=2);
  assert.equal(ps4.runningJokes.length,1);
  assert.equal(ps4.relationshipInterpretation?.canonRelationshipUnchanged,true);
  assert.equal(await reader.verifyPrepared(prepared),true);
  if(originalJoke){
   assert.deepEqual(prepared.projection.jokes,originalJoke);
   assert.deepEqual(prepared.projection.interpretations,originalOpinions);
  }else{
   originalJoke=prepared.projection.jokes;
   originalOpinions=prepared.projection.interpretations;
  }
 }
});

test('forged authority, wrong NPC/world/timeline, expired source and delayed read fail shut',async t=>{
 const f=await fixture(t);await three(f);
 const a=f.authority();f.setIdentity(a);const reader=f.reader();
 const before=await reader.prepare({scope:f.scope,authority:a});
 assert.equal(before.status,'ready',before.reason);
 assert.equal(await reader.verifyPrepared(before),true);
 for(const s of [
  {...f.scope,characterId:uuid()},{...f.scope,worldProfileId:uuid()},
  {...f.scope,timelineId:uuid()}]){
  const p=await reader.prepare({scope:s,authority:{...a,...s}});
  assert.equal(p.status,'dropped');
 }
 assert.equal((await reader.prepare({scope:f.scope,authority:{...a,incarnationId:uuid()}})).status,'dropped');
 f.invalidate();
 assert.equal(await reader.verifyPrepared(before),false);
 assert.equal((await reader.prepare({scope:f.scope,authority:a})).status,'dropped');
});

test('correction/forget revokes previously prepared facts, including across restart',async t=>{
 const f=await fixture(t);const ids=await three(f);
 let a=f.authority();f.setIdentity(a);const reader=f.reader();
 const before=await reader.prepare({scope:f.scope,authority:a});
 assert.equal(before.status,'ready',before.reason);
 const ack=await f.say('Forget the original inside joke','michael');
 const requested=(await f.store.readDialogueLines({
   characterId:f.npc.characterId,timelineId:f.scope.timelineId,limit:2}))
   .find(x=>x.recordId===ack.recordId);
 assert.ok(requested);
 const forgotten=await f.store.commitCommand({
   scope:{...f.scope,protagonistKey:'michael'},commandId:uuid(),
   requestedByLineId:requested.recordId,operation:'forget',
   content:requested.content,contentHash:hash(requested.content),
   evidenceRecordIds:[requested.recordId,ids[1].recordId],
   targetRecordId:ids[1].recordId,requestedAtUtc:requested.committedAtUtc});
 assert.equal(forgotten.status,'committed');
 assert.equal(await reader.verifyPrepared(before),false,
   'previously prepared PS4 frame cannot survive a P2 forget');
 const after=await reader.prepare({scope:f.scope,authority:a});
 assert.equal(after.status,'ready',after.reason);
 assert.equal(after.projection.jokes.length,0);
 assert.ok(!after.projection.interpretations.some(x=>x.sourceEvidenceIds.includes(ids[1].recordId)));
 await f.store.close();
 const reopened=f.make();await reopened.initialize();
 try{
  reopened.setVerifiedHostContext({hostContextVersion:1,hostRunId:uuid(),worldEpoch:2});
  await reopened.confirmTimeline(f.scope.timelineId);
  const active={...a,hostRunId:reopened.verifiedHostContext.hostRunId,worldEpoch:2,
    incarnationId:uuid(),encounterId:uuid(),observerCaptureRef:uuid(),turnId:uuid()};
  const restored=createP2M8ProductionReader({store:reopened,
    currentIdentity:()=>active,originalCurrent:()=>true});
  const p=await restored.prepare({scope:f.scope,authority:active});
  assert.equal(p.status,'ready',p.reason);
  assert.equal(p.projection.jokes.length,0);
  assert.equal(await restored.verifyPrepared(p),true);
 }finally{await reopened.close();}
});

test('failed NPC speech and unsupported witnessed sidecar never become M8 fact receipts',async t=>{
 const f=await fixture(t);await f.say('Thanks for your help','franklin');
 const a=f.authority();f.setIdentity(a);const reader=f.reader();
 const failed={version:1,kind:'dialogue_line',characterId:f.scope.characterId,
   worldProfileId:f.scope.worldProfileId,timelineId:f.scope.timelineId,recordId:uuid(),
   speaker:'npc',source:'npc_generated',content:'Inside joke, never played!',
   delivery:'failed',committedAtUtc:new Date().toISOString(),turnIdentityHash:hash(uuid()),
   utteranceId:null,transcription:null,deliveryReceiptId:null};
 await f.store.appendDialogueLine(failed,{sessionId:uuid(),protagonist:'unknown',
   hostRunId:a.hostRunId,worldEpoch:a.worldEpoch});
 const prepared=await reader.prepare({scope:f.scope,authority:a});
 assert.equal(prepared.status,'ready',prepared.reason);
 assert.ok(!prepared.projection.facts.some(x=>x.recordId===failed.recordId));
 assert.ok(!prepared.projection.interpretations.some(x=>x.sourceEvidenceIds.includes(failed.recordId)));
 assert.equal(await reader.verifyPrepared(prepared),true);
 // An event with no signed observation sidecar is NOT source proof.
 const event={version:1,kind:'journal_event',characterId:f.scope.characterId,
   worldProfileId:f.scope.worldProfileId,timelineId:f.scope.timelineId,
   recordId:uuid(),observationId:uuid(),revision:1,eventType:'crash',
   receivedAtUtc:new Date().toISOString(),sourceHash:'a'.repeat(64),
   ownerProof:{ownerAlias:f.npc.promotion.ownerAlias,hostRunId:a.hostRunId,
     worldEpoch:a.worldEpoch,incarnationId:uuid(),encounterId:uuid(),
     observerCaptureRef:uuid()},receiptStatus:'witnessed',
   claims:[{kind:'crash',modality:'visual',certainty:'direct',
     durableSubject:'vehicle',sourceEvidenceId:uuid()}]};
 await f.store.appendJournalEvent(event);
 assert.equal(await reader.verifyPrepared(prepared),false);
 // If the durable event-sidecar binding is absent, entire projection is unavailable.
 assert.equal((await reader.prepare({scope:f.scope,authority:a})).status,'dropped');
});

test('snapshot reader never writes another DB or presents unverified sources',async t=>{
 const f=await fixture(t);await f.say('An ordinary accepted quote');
 const snapshot=await f.store.withP2SqliteRead(f.scope,
   db=>readAuthorizedM8Snapshot(db,f.scope));
 assert.equal(snapshot.sources.length,1);
 assert.ok(snapshot.sources.every(x=>x.committed&&x.sourceVerified));
 assert.equal(typeof snapshot.seal,'string');
 assert.equal(snapshot.seal.length,64);
});


test('P2 transcript correction removes an earlier mistaken joke; a counter-claim is not a verified fact',async t=>{
 const f=await fixture(t);
 const a=f.authority();f.setIdentity(a);const reader=f.reader();
 const misheard=await f.recorder.recordPlayerAccepted({
   characterId:f.npc.characterId,identity:{...f.identity,turnId:uuid()},
   source:'stt',text:'Inside joke: the flying purple car!',
   attribution:{protagonist:'franklin'}});
 await f.say('Running joke: the flying purple car!','trevor');
 const before=await reader.prepare({scope:f.scope,authority:a});
 assert.equal(before.status,'ready',before.reason);
 assert.equal(before.projection.jokes.length,1);
 const correction=await f.say('No, I actually said the small blue truck.','franklin');
 const source=(await f.store.readDialogueLines({
   characterId:f.npc.characterId,timelineId:f.scope.timelineId,limit:1}))[0];
 assert.equal(source.recordId,correction.recordId);
 const done=await f.store.commitCommand({
   scope:f.scope,commandId:uuid(),requestedByLineId:correction.recordId,
   operation:'correct',correctionMode:'transcript',content:'the small blue truck',
   contentHash:hash('the small blue truck'),
   evidenceRecordIds:[correction.recordId,misheard.recordId],
   targetRecordId:misheard.recordId,requestedAtUtc:source.committedAtUtc});
 assert.equal(done.status,'committed');
 assert.equal(await reader.verifyPrepared(before),false);
 const after=await reader.prepare({scope:f.scope,authority:a});
 assert.equal(after.status,'ready',after.reason);
 assert.ok(!after.projection.interpretations.some(x=>x.sourceEvidenceIds.includes(misheard.recordId)));
 assert.equal(after.projection.jokes.length,0);
});

test('source revocation during an outstanding serialized read and host renewal fail closed',async t=>{
 const f=await fixture(t);await three(f);
 const a=f.authority();f.setIdentity(a);
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const paused=new Proxy(f.store,{
  get(target,key){
   if(key==='withP2SqliteRead')return async (scope,fn)=>{
    await gate;return target.withP2SqliteRead(scope,fn);
   };
   const v=Reflect.get(target,key,target);
   return typeof v==='function'?v.bind(target):v;
  }});
 let active=true;
 const reader=createP2M8ProductionReader({
   store:paused,currentIdentity:()=>a,originalCurrent:()=>active});
 const pending=reader.prepare({scope:f.scope,authority:a});
 active=false;
 release();
 const prepared=await pending;
 assert.equal(prepared.status,'dropped');
 // A fresh turn cannot adopt old authority after a native host change.
 f.store.setVerifiedHostContext(null);
 assert.equal((await reader.prepare({scope:f.scope,authority:a})).status,'dropped');
});

test('durable historical count excludes legacy dialogue with no original native host receipt',async t=>{
 const f=await fixture(t);
 const a=await f.say('Inside joke: the flying purple car!','franklin');
 const b=await f.say('Running joke: the flying purple car!','michael');
 const before=await f.store.withP2SqliteRead(f.scope,db=>readP2M8HistoricalSignals(db,f.scope));
 assert.equal(before.categories.find(x=>x.category==='humor_quote')?.count,2);
 // Simulate a legacy/unverified acceptance row: checksum of the verbatim
 // envelope still matches, but original native source metadata is absent.
 await f.store.withP2SqliteTransaction(f.scope,db=>{
  db.prepare('UPDATE dialogue_journal SET host_run_id=NULL,world_epoch=NULL WHERE record_id=?')
    .run(a.recordId);
 });
 const after=await f.store.withP2SqliteRead(f.scope,db=>readP2M8HistoricalSignals(db,f.scope));
 assert.equal(after.categories.find(x=>x.category==='humor_quote')?.count,1);
 assert.deepEqual(after.categories.find(x=>x.category==='humor_quote')?.sourceEvidenceIds,[b.recordId]);
 // With an unverified persisted row still among recent sources, Agent A's
 // optional projection conservatively drops instead of trusting its bytes.
 const authority=f.authority();f.setIdentity(authority);
 assert.equal((await f.reader().prepare({scope:f.scope,authority})).status,'dropped');
});
