// L: independent M8 interpretation, module level. REAL P2 SQLite store, REAL
// conversation recorder and REAL M8 evaluator/reader. The only doubles are the
// turn's M2 authority callbacks, derived from live store state so retiring the
// host, owner or timeline revokes them like production. The full D01/D03/D02
// runner path is covered in m8IndependentActivation.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createP2MemoryStorage} from '../../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {profile} from '../p2-fixtures.mjs';
import {worldProfileId} from '../identity-fixtures.mjs';
import {projectPreparedM8} from '../../src/context/knowledgeSelector.mjs';
import {prepareIndependentM8,deriveM8PersonalityFromCanon} from '../../src/memory/m8IndependentInterpretation.mjs';

const id=()=>randomUUID();
const sha=x=>createHash('sha256').update(x).digest('hex');
const personalityOf=traits=>({description:'Authoritative editor canon.',traits});

async function fixture(t,npcTraits){
  const dir=await mkdtemp(path.join(tmpdir(),'m8-independent-'));
  const store=createP2MemoryStorage({filePath:path.join(dir,'p2.sqlite'),worldProfileId,sourceRequired:true});
  await store.initialize();
  t.after(async()=>{try{await store.close();}catch{}await rm(dir,{recursive:true,force:true});});
  const npcs=[];
  for(const traits of npcTraits)npcs.push(await store.create(profile({personality:personalityOf(traits)})));
  const timelineId=await store.createTimeline({label:'m8 independent'});
  store.setVerifiedHostContext({hostContextVersion:1,hostRunId:id(),worldEpoch:1});
  await store.confirmTimeline(timelineId);
  const recorder=createConversationJournalRecorder(store);
  const f={store,npcs,timelineId,live:true,recorder};
  const owner=npcs.map(()=>({incarnationId:id(),encounterId:id(),observerCaptureRef:id()}));
  f.scope=(i,avatar='franklin')=>({characterId:npcs[i].characterId,worldProfileId,
    timelineId:store.activeTimelineId,protagonistKey:avatar});
  f.say=async(i,text,avatar='franklin')=>{
    const receipt=await recorder.recordPlayerAccepted({characterId:npcs[i].characterId,
      identity:{pedId:100+i,turnId:id(),generationId:'g',sessionNonce:'m8-session'},
      source:'typed',text,attribution:{protagonist:avatar}});
    return {status:'stored',durable:true,recordId:receipt.recordId,protagonistKey:avatar};
  };
  // Turn whose authority tracks live store state, including the FULL native
  // identity shape D03 issues (nativeVerified, turn id/hash, avatar).
  f.turn=(i,avatar='franklin')=>{
    const alias=npcs[i].promotion.ownerAlias,turnHash=sha('turn-'+i+avatar);
    const turnId=id();
    return {characterProjection:{persistent:true,profile:npcs[i]},
      characterInputs:{profile:{characterId:npcs[i].characterId}},
      m2Capture:{openMemoryCurrent:async()=>f.live,verifyMemoryCurrent:()=>f.live,
        memoryIdentity:()=>f.live&&store.verifiedHostContext&&store.get(npcs[i].characterId)
          ?Object.freeze({...f.scope(i,avatar),hostRunId:store.verifiedHostContext.hostRunId,
            worldEpoch:store.verifiedHostContext.worldEpoch,ownerAlias:alias,...owner[i],
            turnIdentityHash:turnHash,turnId,nativeVerified:true,timelineWritable:true}):null}};
  };
  f.prepare=async(i,text,{avatar='franklin',accept=true,source='player_text',args={}}={})=>{
    const receipt=accept?await f.say(i,text,avatar):f.lastReceipt;
    f.lastReceipt=receipt;
    const prepared=await prepareIndependentM8({store,turn:f.turn(i,avatar),acceptedReceipt:receipt,
      input:text,source,isCurrent:()=>f.live,...args});
    return {prepared,receipt};
  };
  return f;
}
const opinions=prepared=>projectPreparedM8(prepared.preparedM8,{maxBytes:4096}).characterOpinions;

test('deriveM8PersonalityFromCanon maps only approved traits and lets structured canon win',()=>{
  assert.deepEqual(deriveM8PersonalityFromCanon({description:'sarcastic prose is ignored',traits:['patient']}),
    {description:'sarcastic prose is ignored',traits:['patient']});
  const p=deriveM8PersonalityFromCanon({description:'',traits:['Sarcastic wit','very cautious','loyal','loves music']});
  assert.equal(p.humor.style,'sarcastic');
  assert.equal(p.caution,.9);assert.equal(p.loyalty,.9);assert.deepEqual(p.interests,['music']);
  assert.equal(deriveM8PersonalityFromCanon({traits:['goofy'],humor:{style:'dark'}}).humor.style,'dark');
  assert.deepEqual(deriveM8PersonalityFromCanon(null),{});
});

test('different NPCs interpret the same player facts differently, each grounded only in its own evidence',
  {timeout:30000},async t=>{
    const f=await fixture(t,[['sarcastic'],['cautious'],[]]);
    const facts=['Thanks, I trust you.','That crash was hilarious!'];
    const out=[];
    for(let i=0;i<3;i++){
      await f.say(i,facts[0]);
      const {prepared,receipt}=await f.prepare(i,facts[1]);
      assert.equal(prepared.status,'ready',prepared.reason);
      const ids=new Set((await f.store.readDialogueLines({characterId:f.npcs[i].characterId,
        timelineId:f.timelineId,limit:10})).map(r=>r.recordId));
      assert.ok(ids.has(receipt.recordId));
      const list=opinions(prepared);
      for(const o of list){
        assert.equal(o.epistemicStatus,'character_opinion');
        assert.equal(o.verifiedWorldFact,false);
        assert.ok(o.sourceEvidenceIds.every(x=>ids.has(x)),'only this NPC\'s own journal');
      }
      out.push(list.map(o=>o.opinion).sort());
    }
    const joke=out.map(list=>list.find(x=>/joke|funny/.test(x)));
    assert.deepEqual(joke,['I find that joke deliciously dry.','I am not sure that joke is funny.','I find that funny.']);
    assert.equal(new Set(joke).size,3);
  });

test('M8 stands alone: no M4 read, no H1 history, canon stays authoritative and unchanged',
  {timeout:30000},async t=>{
    const f=await fixture(t,[['sarcastic']]);
    f.store.readIntegratedRecall=()=>{throw Error('M8 must never call M4');};
    const before=JSON.stringify(f.store.get(f.npcs[0].characterId).personality);
    await f.say(0,'Thanks, I trust you.');
    const {prepared}=await f.prepare(0,'That crash was hilarious!');
    assert.equal(prepared.status,'ready',prepared.reason);
    assert.equal(prepared.preparedM8.projection.relationship.canonRelationshipUnchanged,true);
    assert.equal(JSON.stringify(f.store.get(f.npcs[0].characterId).personality),before);
    assert.equal(await prepared.verifyPrepared(),true);
    assert.equal(prepared.sendCurrent(),true);
  });

test('no interpretable evidence abstains instead of fabricating an opinion',{timeout:30000},async t=>{
  const f=await fixture(t,[[]]);
  const {prepared}=await f.prepare(0,'What time is it?');
  assert.equal(prepared.status,'abstained');
  assert.equal(prepared.preparedM8,null);
  assert.equal(await prepared.verifyPrepared(),false);
});

test('forgotten or stale evidence revokes a prepared frame and never reappears',{timeout:30000},async t=>{
  const f=await fixture(t,[[]]);
  const thanks=await f.say(0,'Thanks, I trust you.');
  const {prepared}=await f.prepare(0,'That crash was hilarious!');
  assert.equal(prepared.status,'ready',prepared.reason);
  assert.equal(await prepared.verifyPrepared(),true);
  const seen={...prepared.preparedM8.stamp};
  assert.equal(prepared.opinionCurrent([],seen),true);
  assert.ok(opinions(prepared).some(o=>o.sourceEvidenceIds.includes(thanks.recordId)));
  // A real P2 forget after preparation: the whole optional frame must die.
  const rows=await f.store.readDialogueLines({characterId:f.npcs[0].characterId,timelineId:f.timelineId,limit:10});
  const request=rows.find(r=>r.speaker==='player'&&r.content==='That crash was hilarious!');
  const done=await f.store.commitCommand({scope:f.scope(0),commandId:id(),requestedByLineId:request.recordId,
    operation:'forget',content:request.content,contentHash:sha(request.content),
    evidenceRecordIds:[request.recordId,thanks.recordId],targetRecordId:thanks.recordId,
    requestedAtUtc:request.committedAtUtc});
  assert.equal(done.status,'committed');
  assert.equal(await prepared.verifyPrepared(),false);
  assert.equal(prepared.sendCurrent(),false);
  assert.equal(prepared.opinionCurrent([],seen),false);
  assert.equal(await prepared.verifyPrepared(),false,'a failed proof cannot resurrect');
  const again=await f.prepare(0,'Tell me about earlier.');
  assert.equal(again.prepared.status,'ready',again.prepared.reason);
  assert.ok(opinions(again.prepared).length>0,'unforgotten evidence still interprets');
  assert.ok(!opinions(again.prepared).some(o=>o.sourceEvidenceIds.includes(thanks.recordId)),
    'forgotten source is excluded from a fresh preparation');
});

test('host renewal, owner revocation and a wrong stamp fail closed',{timeout:30000},async t=>{
  const f=await fixture(t,[[]]);
  await f.say(0,'Thanks, I trust you.');
  const {prepared}=await f.prepare(0,'That crash was hilarious!');
  assert.equal(await prepared.verifyPrepared(),true);
  assert.equal(prepared.opinionCurrent([],{...prepared.preparedM8.stamp,turnId:id()}),false);
  assert.equal(prepared.opinionCurrent([],null),false);
  f.store.setVerifiedHostContext({hostContextVersion:1,hostRunId:id(),worldEpoch:2});
  assert.equal(await prepared.verifyPrepared(),false);
  assert.equal(prepared.sendCurrent(),false);
  f.live=false;
  const gone=await f.prepare(0,'Still here?',{accept:false});
  assert.equal(gone.prepared.status,'blocked');
  assert.equal(gone.prepared.preparedM8,null);
});
