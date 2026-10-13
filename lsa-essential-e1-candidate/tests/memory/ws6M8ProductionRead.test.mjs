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
import {profile} from '../p2-fixtures.mjs';
import {worldProfileId} from '../identity-fixtures.mjs';

const uuid=()=>randomUUID();
const hash=text=>createHash('sha256').update(text).digest('hex');
async function fixture(t){
 const dir=mkdtempSync(path.join(tmpdir(),'ws6-agent-a-'));
 const filePath=path.join(dir,'p2.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
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
 t.after(async()=>{if(store.available)await store.close();});
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
  const prepared=await reader.prepare({scope:s,authority:a,nowUtc});
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
   ...f.store.verifiedHostContext});
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
