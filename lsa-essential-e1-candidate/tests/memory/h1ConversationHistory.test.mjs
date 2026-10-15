import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareH1ConversationHistory,openH1ConversationSource,
  assembleJournalConversation} from '../../src/memory/h1ConversationHistory.mjs';

const U=()=>randomUUID();
const now='2026-10-15T12:00:00.000Z';
const when=seconds=>new Date(Date.parse(now)-seconds*1000).toISOString();
function fixture(){
  const characterId=U(),worldProfileId=U(),timelineId=U(),hostRunId=U(),sessionId=U();
  const host={hostRunId,worldEpoch:2},ownerAlias='promoted.nathan';
  const scope={characterId,worldProfileId,timelineId,protagonistKey:'franklin'};
  let sourceCurrent=true,failReads=false,readCount=0;
  const line=(speaker,content,age=0)=>({
    version:1,kind:'dialogue_line',recordId:U(),characterId,worldProfileId,timelineId,
    speaker,content,committedAtUtc:when(age),turnIdentityHash:'a'.repeat(64),
    source:speaker==='player'?'typed':'npc_generated',
    delivery:speaker==='player'?'accepted':'completed',
    ...(speaker==='npc'?{deliveryReceiptId:U()}:{}),
    attribution:{...host,sessionId,protagonist:'franklin'}
  });
  const accepted=line('player','Current line?');
  const store={
    worldProfileId,activeTimelineId:timelineId,verifiedHostContext:host,
    timelineWritable:true,memoryReadFence:1,
    rows:[accepted],suppressed:[],corrections:[],
    get:()=>({promotion:{ownerAlias}}),
    async readDialogueLines(){readCount++;if(failReads)throw Error('read unavailable');
      return this.rows.map(x=>structuredClone(x));},
    async listSuppressedMemoryIds(){return [...this.suppressed];},
    async readCorrectionOverlays(){return [...this.corrections];}
    // Intentionally no readIntegratedRecall, M4, M5, M8 or separate SQLite handle.
  };
  const turn={characterProjection:{persistent:true,profile:{characterId,promotion:{ownerAlias}}},
    characterInputs:{profile:{characterId}},
    m2Capture:{openMemoryCurrent:async()=>sourceCurrent,
      verifyMemoryCurrent:()=>sourceCurrent}};
  const args={store,turn,acceptedReceipt:{
    status:'stored',durable:true,recordId:accepted.recordId,protagonistKey:'franklin'},
    input:accepted.content,source:'player_text',isCurrent:()=>sourceCurrent,nowUtc:now};
  return {accepted,line,store,args,scope,
    revoke:()=>{sourceCurrent=false;},
    fail:()=>{failReads=true;},
    reads:()=>readCount};
}

test('H1-A independently reconstructs recent exact Unicode, roles and cross-session dialogue',async()=>{
  const x=fixture();
  const player=x.line('player','“Café” — 你好, 😀!?',80);
  const npc=x.line('npc','I heard: “Café” — 你好, 😀!?',30);
  npc.attribution.sessionId=U();
  x.store.rows.push(player,npc);
  const h=await prepareH1ConversationHistory(x.args);
  assert.equal(h.status,'ready');
  assert.deepEqual(h.conversationJournal.recent,[
    {role:'user',content:player.content},{role:'assistant',content:npc.content}]);
  assert(!JSON.stringify(h.conversationJournal).includes(x.accepted.content));
  assert.equal((await h.verifyPrepared()).status,'ready');
  assert.equal(h.sendCurrent(),true);
  assert(x.reads()>=3);
});
test('H1-A earlier dialogue has explicit archive status; bounded 20/12KiB and 4/2KiB',async()=>{
  const x=fixture();
  const recent=Array.from({length:24},(_,i)=>x.line('npc','recent '+i,i+1));
  const old=Array.from({length:8},(_,i)=>x.line('player','old '+i,3600+i));
  x.store.rows.push(...recent,...old);
  const h=await prepareH1ConversationHistory(x.args);
  assert.equal(h.status,'ready');
  assert.equal(h.conversationJournal.recent.length,20);
  assert(h.conversationJournal.earlier.length<=4);
  assert(h.conversationJournal.earlier.length>0);
  assert(h.conversationJournal.earlier.every(row=>row.status==='archived'));
  assert(Buffer.byteLength(JSON.stringify(h.conversationJournal.recent))<=12288);
  assert(Buffer.byteLength(JSON.stringify(h.conversationJournal.earlier))<=2048);
});
test('H1-A omits unplayed NPC speech and wrong world, character or timeline',async()=>{
  const x=fixture();
  const heard=x.line('npc','heard',10);
  const interrupted={...x.line('npc','interrupted',20),delivery:'interrupted'};
  const failed={...x.line('npc','failed',30),delivery:'failed',deliveryReceiptId:null};
  const badScope=[{characterId:U()},{worldProfileId:U()},{timelineId:U()}]
    .map(change=>({...x.line('npc','wrong scope',40),...change}));
  x.store.rows.push(heard,interrupted,failed,...badScope);
  const h=await prepareH1ConversationHistory(x.args);
  assert.deepEqual(h.conversationJournal.recent,[{role:'assistant',content:'heard'}]);
});
test('H1-A retains permitted unified-player history across source avatars, but demands current receipt avatar',async()=>{
  const x=fixture();
  const older=x.line('player','prior as Michael',20);
  older.attribution.protagonist='michael';
  x.store.rows.push(older);
  const h=await prepareH1ConversationHistory(x.args);
  assert.deepEqual(h.conversationJournal.recent,[{role:'user',content:'prior as Michael'}]);
  assert.equal((await prepareH1ConversationHistory({...x.args,
    acceptedReceipt:{...x.args.acceptedReceipt,protagonistKey:'trevor'}})).status,
    'unavailable');
});
test('H1-A suppression and transcript corrections remove durable history',async()=>{
  const x=fixture();
  const forgotten=x.line('player','forgotten secret',20);
  const corrected=x.line('player','incorrect transcript',30);
  const visible=x.line('npc','public statement',15);
  x.store.rows.push(forgotten,corrected,visible);
  x.store.suppressed.push(forgotten.recordId);
  x.store.corrections.push({targetId:corrected.recordId,supersedesTarget:true});
  const h=await prepareH1ConversationHistory(x.args);
  assert.deepEqual(h.conversationJournal.recent,[{role:'assistant',content:'public statement'}]);
  assert(!JSON.stringify(h.conversationJournal).includes('secret'));
  assert(!JSON.stringify(h.conversationJournal).includes('incorrect'));
});
test('H1-A revokes prepared history on changed row, suppression, accepted line or source fence',async()=>{
  for(const change of ['row','suppression','accepted','fence','timeline','host','owner']){
    const x=fixture(),past=x.line('player','sensitive source',10);
    x.store.rows.push(past);
    const h=await prepareH1ConversationHistory(x.args);
    assert.equal((await h.verifyPrepared()).status,'ready');
    if(change==='row')x.store.rows[1].content='changed source';
    if(change==='suppression')x.store.suppressed.push(past.recordId);
    if(change==='accepted')x.store.rows[0].content='forged current';
    if(change==='fence')x.store.memoryReadFence++;
    if(change==='timeline')x.store.activeTimelineId=U();
    if(change==='host')x.store.verifiedHostContext={hostRunId:U(),worldEpoch:2};
    if(change==='owner')x.store.get=()=>({promotion:{ownerAlias:'other'}});
    if(change==='fence')assert.equal(h.sendCurrent(),false);
    else assert.equal((await h.verifyPrepared()).status,'invalidated',change);
    assert.equal(h.sendCurrent(),false,change);
  }
});
test('H1-A unavailable is distinct for absent authority and failed history; no RAM fallback',async()=>{
  const x=fixture();
  assert.equal((await prepareH1ConversationHistory({...x.args,acceptedReceipt:null})).reason,
    'source_authority_missing');
  const opened=await openH1ConversationSource(x.args);
  assert.equal(opened.status,'ready');
  x.fail();
  const h=await opened.prepare();
  assert.equal(h.status,'unavailable');
  assert.equal(h.reason,'history_unavailable');
  assert.equal(h.conversationJournal,null);
});
test('H1-A accepted line cannot be suppressed or fabricated',async()=>{
  const x=fixture();
  x.store.suppressed.push(x.accepted.recordId);
  assert.equal((await prepareH1ConversationHistory(x.args)).status,'unavailable');
  const y=fixture();y.store.rows=[];
  assert.equal((await prepareH1ConversationHistory(y.args)).reason,'source_authority_missing');
});
test('H1-A preserves original assembly outputs on the same rows',async()=>{
  const x=fixture(),prior=x.line('npc','same output',15);
  x.store.rows.push(prior);
  const h=await prepareH1ConversationHistory(x.args);
  assert.deepEqual(h.conversationJournal,assembleJournalConversation({
    rows:x.store.rows,accepted:x.accepted,scope:x.scope,suppressed:[],nowUtc:now}));
});
