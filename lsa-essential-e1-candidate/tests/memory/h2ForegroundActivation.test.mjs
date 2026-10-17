import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';

const requested={
  'memory.dialogue.player':'on','memory.dialogue.npc':'on',
  'memory.journalContext':'off','memory.recall':'on',
  'memory.commands':'off','memory.interpretation':'off',
  'memory.events':'off','memory.coverage':'off'
};
const configured=(changes={})=>({memoryK:{capabilities:{...requested,...changes}}});
const response=()=>new Response(JSON.stringify({status:'completed',output:[{
  type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue:'Sure.',command:''})}]
}]}),{headers:{'content-type':'application/json'}});
function capture(x){
  const sent=[];
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
    fetchImpl:async(url,req)=>{
      sent.push({body:JSON.parse(req.body),frame:options.knowledgeProjection});
      return response();
    }});
  return sent;
}
async function say(x,text){
  const turn=await x.typed(text),outcome=await x.settled(turn);
  assert.equal(outcome.status,'completed',JSON.stringify(outcome));
}
const scene=entry=>JSON.parse(entry.frame.modelAllocation.scene).lanes;

test('H2 alone brings previously accepted P2 facts to PS4 while H1/M5/M8 are off',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x);
    await say(x,'My cedar compass is buried under the violet bridge.');
    await say(x,'What did I say about the cedar compass under the violet bridge?');
    const expectedQuestion='What did I say about the cedar compass under the violet bridge?';
    const last=sent.findLast(entry=>entry.frame?.modelAllocation?.messages?.at(-1)?.content===expectedQuestion);
    assert.ok(last,'The actual second-turn model request must be captured');
    const lanes=scene(last);
    assert.equal(last.frame.modelAllocation.messages.length,1,'H1 off means no journal conversation lane');
    const state=x.h.runtime.services.memoryRecallDiagnostics();
    const players=(await x.journal()).players;
    assert.ok(players.some(row=>row.content==='My cedar compass is buried under the violet bridge.'),
      'The first player input must have been durably accepted before testing its recall');
    assert.ok(Array.isArray(lanes.RECALLED.evidence) &&
      lanes.RECALLED.evidence.some(item=>item.content.includes('cedar compass')),
      'H2 must make prior SQLite content visible to the actual model request; '+
      JSON.stringify({state,playerRows:players.map(row=>({source:row.source,delivery:row.delivery,
        content:row.content})),sceneRecall:lanes.RECALLED,requests:sent.length}));
    assert.ok(JSON.stringify(last.body).includes('cedar compass is buried'));
    assert.equal(lanes.RECALLED.characterOpinions,undefined);
    assert.equal(lanes.SELF.memoryAction,undefined);
    assert.equal(state.contributedToModelRequest,true);
    assert.equal(state.lastValidation.status,'ready');
  });

test('H1 and H2 together admit journal CONVERSE and independent labelled recall',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured({'memory.journalContext':'on'})});
    const sent=capture(x);
    await say(x,'The blue atlas is on my bookshelf.');
    await say(x,'Where did I put the blue atlas?');
    const last=sent.at(-1),lanes=scene(last);
    assert.ok(last.frame.modelAllocation.messages.some(x=>x.content==='The blue atlas is on my bookshelf.'));
    assert.ok(lanes.RECALLED.evidence.some(x=>x.content.includes('blue atlas')));
    assert.equal(x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,true);
    assert.equal(x.h.runtime.services.memoryRecallDiagnostics().contributedToModelRequest,true);
    assert.equal(lanes.SELF.memoryAction,undefined);
  });

test('H2 off with H1 off never invokes M4 P2 integrated recall',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured({'memory.recall':'off'})});
    let reads=0;
    const original=x.store.readIntegratedRecall.bind(x.store);
    x.store.readIntegratedRecall=(...args)=>{reads++;return original(...args);};
    const sent=capture(x);
    await say(x,'The canary telescope is silver.');
    await say(x,'Do you remember my telescope?');
    assert.equal(reads,0);
    assert.equal(sent.at(-1).frame.modelAllocation.messages.length,1);
    assert.equal(x.h.runtime.services.memoryRecallDiagnostics().state,'stopped');
  });

test('H2 source-read failure falls back to current input, not stale RAM or M5',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x);
    await say(x,'The secret coral envelope is under the sink.');
    x.store.readIntegratedRecall=async()=>{throw Error('unavailable P2 read');};
    await say(x,'What did I say about the coral envelope?');
    const last=sent.at(-1);
    assert.equal(last.frame.modelAllocation.messages.length,1);
    assert.equal((scene(last).RECALLED.evidence??[]).length,0);
    assert.equal(x.h.runtime.services.memoryRecallDiagnostics().contributedToModelRequest,false);
  });

test('H2 source revocation before HTTP send prevents stale recall request',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    await say(x,'A pearl snowglobe is in the cupboard.');
    let http=0;
    x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
      dialogueAttempt:{request:()=>x.store.onBoundary({reason:'timeline_change'}),outputText:()=>{}},
      fetchImpl:async()=>{http++;return response();}});
    const turn=await x.typed('Where is my pearl snowglobe?');
    assert.notEqual((await x.settled(turn)).status,'completed');
    assert.equal(http,0,'retired recall cannot reach HTTP');
    assert.equal(x.h.runtime.services.memoryRecallDiagnostics().contributedToModelRequest,false);
  });

test('H2 respects durable forget with M5 command consumer turned off',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x);
    await say(x,'The secret amber sextant is inside the greenhouse.');
    await say(x,'I want to forget the old location of my sextant.');
    const scope={characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
      timelineId:x.timelineId,protagonistKey:x.native.avatar};
    const rows=(await x.store.readDialogueLines({...scope,limit:20})).filter(x=>x.speaker==='player');
    const target=rows.find(x=>x.content==='The secret amber sextant is inside the greenhouse.');
    const request=rows.find(x=>x.content==='I want to forget the old location of my sextant.');
    assert.ok(target&&request);
    const forgotten=await x.store.commitCommand({scope,commandId:randomUUID(),
      requestedByLineId:request.recordId,operation:'forget',content:request.content,
      contentHash:createHash('sha256').update(request.content).digest('hex'),
      evidenceRecordIds:[request.recordId,target.recordId],targetRecordId:target.recordId,
      requestedAtUtc:request.committedAtUtc});
    assert.equal(forgotten.status,'committed');
    await say(x,'Where did I put the amber sextant?');
    const last=sent.at(-1);
    assert.ok(!JSON.stringify(last.body).includes('inside the greenhouse'),
      'suppressed journal content cannot reappear via independent M4');
    assert.equal(x.h.runtime.services.memoryRecallDiagnostics().contributedToModelRequest,
      !!last.frame.recallAnswerEvidence||(last.frame.recallReferences?.length??0)>0);
  });

test('shadow mode is explicitly unsupported and makes no M4 reads',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured({'memory.recall':'shadow'})});
    let reads=0;
    const original=x.store.readIntegratedRecall.bind(x.store);
    x.store.readIntegratedRecall=(...args)=>{reads++;return original(...args);};
    await say(x,'There is a bronze clock under the bench.');
    assert.equal(reads,0);
    const diagnostics=x.h.runtime.services.memoryRecallDiagnostics();
    assert.equal(diagnostics.reason,'shadow_not_supported');
    assert.equal(diagnostics.state,'unavailable');
  });
