import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assembleJournalConversation,prepareLiveTurnMemory} from '../../src/memory/liveTurnMemory.mjs';
import {projectConversation,renderKnowledge,pruneKnowledgeFrame} from '../../src/context/knowledgeRenderer.mjs';
import {createKnowledgeDelivery} from '../../src/context/knowledgeDelivery.mjs';

const U=()=>randomUUID();
const at='2026-10-13T14:00:00.000Z',before='2026-10-13T13:59:00.000Z';
const world=U(),characterId=U(),timelineId=U(),sessionId=U(),hostRunId=U();
const scope={characterId,worldProfileId:world,timelineId,protagonistKey:'franklin'};
const host={hostRunId,worldEpoch:42},ownerAlias='promoted.nathan';
const hash='a'.repeat(64);
const accepted=(content='Remember the red car',time=at)=>({
  version:1,kind:'dialogue_line',recordId:U(),characterId,worldProfileId:world,
  timelineId,speaker:'player',source:'typed',delivery:'accepted',content,
  committedAtUtc:time,turnIdentityHash:hash,
  attribution:{...host,sessionId,protagonist:'franklin'}
});
const npc=(content,time=before,delivery='completed')=>({
  ...accepted(content,time),recordId:U(),speaker:'npc',source:'npc_generated',
  delivery,deliveryReceiptId:delivery==='failed'?null:U()
});
const turn=()=>({
  identity:{pedId:'42',turnId:U(),generationId:1,sessionNonce:1},
  characterProjection:{persistent:true,profile:{characterId,promotion:{ownerAlias}}},
  characterInputs:{profile:{characterId}},
  m2Capture:{openMemoryCurrent:async()=>true,verifyMemoryCurrent:()=>true}
});
const p2=(line,extra=[])=>({
  worldProfileId:world,activeTimelineId:timelineId,
  verifiedHostContext:host,timelineWritable:true,
  // Real P2 exposes a generation fence; missing it must fail closed.
  memoryReadFence:1,
  get:()=>({promotion:{ownerAlias}}),
  readDialogueLines:async()=>[line,...extra],
  listSuppressedMemoryIds:async()=>[],
  readIntegratedRecall:async()=>({rows:[],coverageComplete:false})
});

test('WS-6b: same-NPC/timeline journal assembles exact current dialogue but excludes other NPCs, forgotten and unplayed speech',()=>{
  const current=accepted('what happened');
  const good=npc('There was a crash.');
  const bad={...npc('not heard',before,'failed')};
  const other={...npc('other NPC'),characterId:U()};
  const forgotten=npc('private memory');
  const old=npc('a long time ago','2026-10-12T00:00:00.000Z');
  const c=assembleJournalConversation({
    accepted:current,scope,nowUtc:at,rows:[current,old,good,bad,other,forgotten],
    suppressed:[forgotten.recordId]
  });
  assert.deepEqual(c.recent,[{role:'assistant',content:'There was a crash.'}]);
  assert.equal(c.earlier[0].status,'archived');
  assert.equal(c.earlier[0].content,'a long time ago');
  assert(!JSON.stringify(c).includes('private memory'));
  assert(!JSON.stringify(c).includes('not heard'));
  assert(!JSON.stringify(c).includes('other NPC'));
});
test('WS-6b: journal history bounds to 20 messages and 12 KiB; RAM is only fallback',()=>{
  const line=accepted('current');
  const rows=Array.from({length:30},(_,i)=>npc('text '+i,
    new Date(Date.parse(at)-(i+1)*1000).toISOString()));
  const c=assembleJournalConversation({accepted:line,scope,rows,nowUtc:at});
  assert.equal(c.recent.length,20);
  assert(bytes(c.recent)<=12*1024);
  const projection=projectConversation([{role:'assistant',content:'RAM only'}],
    'current','player_text',null,c);
  assert.equal(projection.messages.length,21);
  assert(!JSON.stringify(projection.messages).includes('RAM only'));
  assert.equal(projection.messages.at(-1).content,'current');
});
const bytes=x=>Buffer.byteLength(JSON.stringify(x),'utf8');
test('WS-6a: a real accepted-line readback prepares a typed PS4 RECALLED contribution, scoped and frozen',async()=>{
  const current=accepted('what did I say about the red car?');
  const prior=accepted('I remember the red car',before);
  const stored={
    ...scope,recordId:prior.recordId,sourceKind:'dialogue_line',
    evidenceState:'verified',atUtc:before,protagonistKey:'franklin',envelope:prior
  };
  const store=p2(current,[prior]);
  store.readIntegratedRecall=async()=>({rows:[stored],coverageComplete:false});
  const t=turn();let ok=true;
  t.m2Capture.verifyMemoryCurrent=()=>ok;
  const p=await prepareLiveTurnMemory({store,turn:t,acceptedReceipt:{
    status:'stored',durable:true,recordId:current.recordId,protagonistKey:'franklin'
  },input:current.content,source:'player_text',isCurrent:()=>true,nowUtc:at});
  assert.equal(p.status,'ready');
  assert.equal(p.preparedRecall.status,'ready');
  assert.equal(p.preparedRecall.contribution.contributor,'m4_recall');
  assert.equal(p.preparedRecall.contribution.items[0]?.content,prior.content);
  assert.equal(p.conversationJournal.recent[0].content,prior.content);
  assert.equal(p.recallCurrent([],{...p.preparedRecall.stamp}),true,'PS4 copies stamps into immutable frame');
  ok=false;
  assert.equal(p.recallCurrent([],p.preparedRecall.stamp),false);
});
test('WS-6a: no D03 receipt, wrong readback or revoked D02 authority denies all model-visible memory',async()=>{
  const current=accepted('what do you remember?'),store=p2(current),t=turn();
  const receipt={status:'stored',durable:true,recordId:current.recordId,protagonistKey:'franklin'};
  for(const bad of [
    {...receipt,status:'not_stored'}, {...receipt,recordId:U()},null
  ]){
    const p=await prepareLiveTurnMemory({store,turn:t,acceptedReceipt:bad,
      input:current.content,source:'player_text',isCurrent:()=>true,nowUtc:at});
    assert.equal(p.status,'unavailable');
    assert.equal(p.preparedRecall,null);
  }
  t.m2Capture.verifyMemoryCurrent=()=>false;
  assert.equal((await prepareLiveTurnMemory({store,turn:t,acceptedReceipt:receipt,
    input:current.content,source:'player_text',isCurrent:()=>true,nowUtc:at})).status,'unavailable');
  t.m2Capture.verifyMemoryCurrent=()=>true;
  store.readDialogueLines=async()=>[{...current,content:'forged bytes'}];
  assert.equal((await prepareLiveTurnMemory({store,turn:t,acceptedReceipt:receipt,
    input:current.content,source:'player_text',isCurrent:()=>true,nowUtc:at})).status,'unavailable');
});
test('WS-6a: source/timeline revocation during asynchronous read denies previously admitted data',async()=>{
  const current=accepted('my bicycle'),store=p2(current),t=turn();
  let resume;
  store.readDialogueLines=()=>new Promise(resolve=>{resume=()=>resolve([current]);});
  const promise=prepareLiveTurnMemory({store,turn:t,acceptedReceipt:{
    status:'stored',durable:true,recordId:current.recordId,protagonistKey:'franklin'
  },input:current.content,source:'player_text',isCurrent:()=>true,nowUtc:at});
  await Promise.resolve();
  store.activeTimelineId=U();
  resume();
  const p=await promise;
  assert.equal(p.status,'unavailable');
});

test('WS6 count-only answer is source fenced and pruned even when no M4 item matched',()=>{
 const base=renderKnowledge({input:'How many?',source:'player_text'});
 const preparedRecall={status:'ready',stamp:{...scope},contribution:{contributor:'m4_recall',
  lane:'RECALLED',status:'unavailable',items:[],unknownReason:'no_matches'},
  answerEvidence:{dialogueCount:{status:'complete',exactCount:0,first:null,last:null,
   predicate:{speaker:'player',containsText:'absent'}},negativeWitnessing:'unavailable'}};
 const frame=renderKnowledge({input:'How many?',source:'player_text',preparedRecall,recallAuthorization:()=>true});
 assert.equal(frame.recallReferences.length,0);assert.ok(frame.recallStamp);
 assert.equal(JSON.parse(frame.modelAllocation.scene).lanes.RECALLED.answerEvidence.dialogueCount.exactCount,0);
 const delivery=createKnowledgeDelivery({frame,baseFrame:base,isCurrent:()=>true,recallCurrent:()=>false,
  pruneRecall:f=>pruneKnowledgeFrame(f,()=>true,()=>true,()=>true,()=>false)});
 const pruned=delivery.prepare();
 assert.equal(pruned.recallStamp,null);assert.equal(pruned.recallAnswerEvidence,false);
 assert.equal(JSON.parse(pruned.modelAllocation.scene).lanes.RECALLED.answerEvidence,undefined);
});
