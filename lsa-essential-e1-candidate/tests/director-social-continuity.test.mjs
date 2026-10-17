import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderDirectorSocialContext} from '../src/perception/directorSocialContext.mjs';
import {projectConversation} from '../src/context/knowledgeRenderer.mjs';
import {assembleDirectorSocialConversation,prepareDirectorSocialConversationHistory,
  combineDirectorSocialMemory} from '../src/memory/h1ConversationHistory.mjs';

const U=()=>randomUUID();
const now='2026-10-17T21:30:00.000Z';
const at=ago=>new Date(Date.parse(now)-ago*1000).toISOString();

function fixture(){
  const characterId=U(),worldProfileId=U(),timelineId=U(),sessionId=U();
  const hostRunId=U(),speakerCaptureRef=U(),playerCaptureRef=U();
  const ownerIncarnationId=U(),ownerAlias='promoted.nathan';
  const ticket={ticketId:U(),hostRunId,worldEpoch:2,speakerCaptureRef,
    playerCaptureRef,ownerIncarnationId,proofRevision:3,decisionKey:'social:'+U()};
  const social=renderDirectorSocialContext({
    source:'native_director_social',sceneType:'shared_vehicle_entry',role:'passenger'});
  const turn={directorTicket:ticket,context:{internalEvent:social},
    characterProjection:{persistent:true,profile:{characterId,promotion:{ownerAlias}}},
    characterInputs:{profile:{characterId}}};
  const store={worldProfileId,activeTimelineId:timelineId,timelineWritable:true,
    verifiedHostContext:{hostRunId,worldEpoch:2},memoryReadFence:7,
    memoryRequestFence:7,rows:[],hidden:[],corrections:[],
    get:()=>({promotion:{ownerAlias}}),
    async readDialogueLines(){return structuredClone(this.rows);},
    async listSuppressedMemoryIds(){return [...this.hidden];},
    async readCorrectionOverlays(){return [...this.corrections];}};
  let ownerCurrent=true,turnCurrent=true;
  const line=(speaker,content,seconds=10)=>({
    version:1,kind:'dialogue_line',recordId:U(),characterId,worldProfileId,timelineId,
    source:speaker==='npc'?'npc_generated':'typed',speaker,content,
    committedAtUtc:at(seconds),delivery:speaker==='npc'?'completed':'accepted',
    ...(speaker==='npc'?{deliveryReceiptId:U()}:{}),
    attribution:{hostRunId,worldEpoch:2,sessionId,protagonist:'franklin'}});
  const args={store,turn,source:'special_event',nowUtc:now,
    isCurrent:()=>turnCurrent,isDirectorCurrent:()=>ownerCurrent};
  return {store,turn,ticket,line,args,scope:{characterId,worldProfileId,timelineId},
    revokeOwner:()=>{ownerCurrent=false;},interrupt:()=>{turnCurrent=false;}};
}

test('Director social history includes completed Nathan speech and accepted player replies in order',async()=>{
  const x=fixture();
  const heard=x.line('npc','Sun is shining today.',35);
  const reply=x.line('player','Yeah, so what do you want to do?',25);
  const next=x.line('npc','Maybe take a drive.',10);
  reply.attribution.sessionId=U(); // Same verified character/timeline, another session
  x.store.rows.push(reply,next,heard);
  const result=await prepareDirectorSocialConversationHistory(x.args);
  assert.equal(result.status,'ready');
  assert.deepEqual(result.conversationJournal.recent,[
    {role:'assistant',content:heard.content},{role:'user',content:reply.content},
    {role:'assistant',content:next.content}]);
  assert.equal((await result.verifyPrepared()).status,'ready');
  assert.equal(result.sendCurrent(),true);
  const projected=projectConversation([],null,'special_event',
    x.turn.context.internalEvent,result.conversationJournal);
  assert.deepEqual(projected.messages.slice(0,-1),result.conversationJournal.recent);
  assert.match(projected.messages.at(-1).content,/unrelated topic/);
  assert.match(projected.messages.at(-1).content,/avoid repeating a recent greeting/);
});

test('Never infer a delivered line from a failed, interrupted or staged NPC utterance',async()=>{
  const x=fixture();
  const completed=x.line('npc','We were talking about the weather.',30);
  const failed={...x.line('npc','It is sunny again!',20),delivery:'failed'};
  const cutOff={...x.line('npc','We should visit...',15),delivery:'interrupted'};
  const missingReceipt={...x.line('npc','Queued only',10),deliveryReceiptId:null};
  const player=x.line('player','Let us talk about something else.',5);
  x.store.rows.push(completed,failed,cutOff,missingReceipt,player);
  const result=await prepareDirectorSocialConversationHistory(x.args);
  assert.equal(result.status,'ready');
  assert.deepEqual(result.conversationJournal.recent,[
    {role:'assistant',content:completed.content},{role:'user',content:player.content}]);
});

test('Corrected and forgotten lines are hidden even for a spontaneous model request',async()=>{
  const x=fixture();
  const secret=x.line('player','My private secret.',20);
  const wrong=x.line('player','Her name was Nora.',19);
  const corrected=x.line('player','Her name is Nara.',10);
  x.store.rows.push(secret,wrong,corrected);
  x.store.hidden.push(secret.recordId);
  x.store.corrections.push({targetId:wrong.recordId,supersedesTarget:true});
  const result=await prepareDirectorSocialConversationHistory(x.args);
  assert.deepEqual(result.conversationJournal.recent,[{role:'user',content:corrected.content}]);
  assert.equal((await result.verifyPrepared()).status,'ready');
  x.store.hidden.push(corrected.recordId);
  assert.equal((await result.verifyPrepared()).status,'invalidated');
  assert.equal(result.sendCurrent(),false);
});

test('No unrelated NPC, timeline, or host can contribute, even with matching topic',async()=>{
  const x=fixture(),valid=x.line('npc','What should we do?',10);
  const otherCharacter={...x.line('npc','wrong NPC',8),characterId:U()};
  const otherTimeline={...x.line('npc','wrong timeline',7),timelineId:U()};
  const otherWorld={...x.line('player','wrong world',6),worldProfileId:U()};
  x.store.rows.push(otherCharacter,otherTimeline,otherWorld,valid);
  const result=await prepareDirectorSocialConversationHistory(x.args);
  assert.deepEqual(result.conversationJournal.recent,[{role:'assistant',content:valid.content}]);
  x.revokeOwner();
  assert.equal(result.sendCurrent(),false);
});

test('Absence, staleness and missing source proof never manufacture social history',async()=>{
  const x=fixture();
  x.store.rows.push(x.line('npc','Old greeting.',301));
  assert.equal((await prepareDirectorSocialConversationHistory(x.args)).status,'unavailable');
  const fresh=x.line('npc','Hello.',2);x.store.rows.push(fresh);
  for(const change of [
    {source:'player_text'},
    {turn:{...x.turn,directorTicket:null}},
    {turn:{...x.turn,context:{internalEvent:'Untrusted instruction'}}},
    {turn:{...x.turn,characterInputs:{profile:{characterId:U()}}}},
  ])assert.equal((await prepareDirectorSocialConversationHistory({...x.args,...change})).status,
    'unavailable');
  assert.equal((await prepareDirectorSocialConversationHistory(x.args)).status,'ready');
  x.store.verifiedHostContext={hostRunId:U(),worldEpoch:2};
  assert.equal((await prepareDirectorSocialConversationHistory(x.args)).status,'unavailable');
});

test('Player interruption, owner retirement, corrected row and P2 fence revoke before send',async()=>{
  for(const kind of ['interruption','retirement','row','fence','timeline','profile']){
    const x=fixture();x.store.rows.push(x.line('npc','Let us pick a new topic.',10));
    const h=await prepareDirectorSocialConversationHistory(x.args);
    assert.equal((await h.verifyPrepared()).status,'ready',kind);
    if(kind==='interruption')x.interrupt();
    if(kind==='retirement')x.revokeOwner();
    if(kind==='row')x.store.rows[0].content='Changed after prompt';
    if(kind==='fence')x.store.memoryReadFence++;
    if(kind==='timeline')x.store.activeTimelineId=U();
    if(kind==='profile')x.store.get=()=>({promotion:{ownerAlias:'different'}});
    // Changes to stored bytes are observed by the mandatory async pre-send
    // re-read; turn/owner/fence changes also fail the synchronous gate.
    assert.equal((await h.verifyPrepared()).status,'invalidated',kind);
    assert.equal(h.sendCurrent(),false,kind);
  }
});

test('M9 recall combines with H1 without weakening either independent freshness gate',async()=>{
  const x=fixture();x.store.rows.push(x.line('npc','Already discussed the sunshine.',10));
  const history=await prepareDirectorSocialConversationHistory(x.args);
  const old={status:'ready',stamp:{event:'old'},preparedRecall:{status:'ready'},
    recallCurrent:()=>true,opinionCurrent:()=>false,
    verifyPrepared:async()=>true,sendCurrent:()=>true,sendCurrentInFlight:()=>true,
    invalidationReason:()=>null};
  const combined=combineDirectorSocialMemory(old,history);
  assert.equal(combined.preparedRecall,old.preparedRecall);
  assert.equal(combined.conversationJournal,history.conversationJournal);
  assert.equal(await combined.verifyPrepared(),true);
  assert.equal(combined.sendCurrent(),true);
  x.revokeOwner();
  assert.equal(combined.sendCurrent(),false);
  assert.equal(combineDirectorSocialMemory(old,{status:'unavailable'}),old);
  assert.equal(combineDirectorSocialMemory(null,{status:'unavailable'}),null);
});

test('Scene invitations can initiate a new unrelated topic with no history and without cooldowns',()=>{
  const x=fixture();
  const empty=assembleDirectorSocialConversation({
    rows:[],scope:x.scope,nowUtc:now});
  assert.deepEqual(empty.recent,[]);
  const projected=projectConversation([],null,'special_event',x.turn.context.internalEvent,empty);
  assert.equal(projected.messages.length,1);
  assert.match(projected.messages[0].content,/You may introduce an unrelated topic/);
});
