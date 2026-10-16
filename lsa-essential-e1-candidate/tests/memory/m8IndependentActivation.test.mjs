// L: memory.interpretation = "on" through the REAL original runner, D01/D03/D02
// accepted-line authority and the production P2 SQLite store (shared offline
// harness). Only GTA/native and HTTP are scripted. M4, H1 and M7 are off.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const modes=Object.freeze({
  'memory.dialogue.player':'on','memory.dialogue.npc':'on',
  'memory.journalContext':'off','memory.recall':'off','memory.commands':'off',
  'memory.interpretation':'on','memory.events':'off','memory.coverage':'off'
});
const configured=(edits={})=>({memoryK:{capabilities:{...modes,...edits}}});
const response=()=>new Response(JSON.stringify({status:'completed',output:[{
  type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue:'Got it.',command:''})}]
}]}),{headers:{'content-type':'application/json'}});
function capture(x,{beforeSend=null}={}){
  const sent=[];
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
    ...(beforeSend?{dialogueAttempt:{request:beforeSend,outputText:()=>{}}}:{}),
    fetchImpl:async(url,request)=>{
      sent.push({body:JSON.parse(request.body),frame:options.knowledgeProjection});
      return response();
    }});
  return sent;
}
async function say(x,text,expected='completed'){
  const turn=await x.typed(text),outcome=await x.settled(turn);
  assert.equal(outcome.status,expected,JSON.stringify(outcome));
}
const lanes=entry=>JSON.parse(entry.frame.modelAllocation.scene).lanes;
const diag=x=>x.h.runtime.services.memoryInterpretationDiagnostics();
const scopeOf=x=>({characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
  timelineId:x.timelineId,protagonistKey:x.native.avatar});
async function forgetLine(x,content){
  const rows=await x.store.readDialogueLines({...scopeOf(x),limit:30});
  const target=rows.find(r=>r.speaker==='player'&&r.content===content);
  const request=rows.find(r=>r.speaker==='player');
  assert.ok(target&&request);
  const done=await x.store.commitCommand({scope:scopeOf(x),commandId:randomUUID(),
    requestedByLineId:request.recordId,operation:'forget',content:request.content,
    contentHash:sha(request.content),evidenceRecordIds:[request.recordId,target.recordId],
    targetRecordId:target.recordId,requestedAtUtc:request.committedAtUtc});
  assert.equal(done.status,'committed');
}

test('M8 alone: interpretations reach the real model request with M4, H1, M5 and M7 off',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    x.store.readIntegratedRecall=()=>{throw Error('independent M8 must never call M4');};
    const sent=capture(x);
    await say(x,'Thanks, I trust you.');
    await say(x,'That crash was hilarious!');
    const last=sent.at(-1),l=lanes(last);
    assert.ok(l.RECALLED.characterOpinions?.length>=1,'M8 must contribute to the PS4 RECALLED lane');
    assert.ok(l.RECALLED.characterOpinions.every(o=>o.epistemicStatus==='character_opinion'&&
      o.verifiedWorldFact===false&&o.sourceEvidenceIds.length>0),
      'opinions are attributed and never presented as verified facts');
    assert.ok(l.RECALLED.relationshipInterpretation?.canonRelationshipUnchanged===true);
    assert.equal(l.RECALLED.evidence,undefined,'M4 is off: no factual recall evidence');
    assert.equal(last.frame.modelAllocation.messages.length,1,'H1 is off: no journal conversation lane');
    assert.equal(l.SELF.memoryAction,undefined,'M5 is off');
    assert.ok(l.SELF.canon,'authoritative P2 canon is still delivered');
    assert.ok(JSON.stringify(last.body).includes('character_opinion'));
    const state=diag(x);
    assert.equal(state.contributedToModelRequest,true);
    assert.equal(state.lastValidation.status,'ready');
    assert.equal(x.h.runtime.services.memoryRecallDiagnostics().state,'stopped');
    assert.equal(x.h.runtime.services.memoryJournalDiagnostics().state,'stopped');
  });

test('M8 off (explicit), shadow, or without M2 never reads or contributes',
  {timeout:60000},async t=>{
    const off=await d01Harness(t,{config:configured({'memory.interpretation':'off',
      'memory.recall':'on'})});
    const sentOff=capture(off);
    await say(off,'Thanks, I trust you.');
    await say(off,'That crash was hilarious!');
    assert.equal(lanes(sentOff.at(-1)).RECALLED.characterOpinions,undefined);
    assert.equal(diag(off).state,'stopped');
    assert.equal(diag(off).lastPreparation,null);
    // M2/H2 are untouched by M8 being off.
    assert.equal(off.h.runtime.services.memoryRecallDiagnostics().contributedToModelRequest,
      (sentOff.at(-1).frame.recallReferences?.length??0)>0);
    assert.ok((await off.journal()).players.length>=2,'M2 still records');

    const shadow=await d01Harness(t,{config:configured({'memory.interpretation':'shadow'})});
    const sentShadow=capture(shadow);
    await say(shadow,'Thanks, I trust you.');
    assert.equal(lanes(sentShadow.at(-1)).RECALLED.characterOpinions,undefined);
    assert.equal(diag(shadow).reason,'shadow_not_supported');

    const noM2=await d01Harness(t,{config:configured({'memory.dialogue.player':'off'})});
    const sentNoM2=capture(noM2);
    await say(noM2,'Thanks, I trust you.');
    assert.equal(lanes(sentNoM2.at(-1)).RECALLED.characterOpinions,undefined);
    assert.equal(diag(noM2).reason,'dependency_not_requested_or_available:memory.dialogue.player');
  });

test('a durably forgotten source disappears from later opinions',{timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  const sent=capture(x);
  await say(x,'Thanks, I trust you.');
  await say(x,'Nice weather today.');
  assert.ok(JSON.stringify(sent.at(-1).body).includes('I feel appreciated by those words.'),
    'the gratitude line is interpreted before it is forgotten');
  await forgetLine(x,'Thanks, I trust you.');
  await say(x,'Anything new?');
  const body=JSON.stringify(sent.at(-1).body);
  assert.ok(!body.includes('I feel appreciated by those words.'),
    'a forgotten source can no longer shape any opinion');
  assert.equal(lanes(sent.at(-1)).RECALLED.characterOpinions?.length??0,0);
});

test('source revoked between preparation and send never reaches HTTP with a stale opinion',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    await say(x,'Thanks, I trust you.');
    let http=0;
    x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
      dialogueAttempt:{request:()=>x.store.onBoundary({reason:'timeline_change'}),outputText:()=>{}},
      fetchImpl:async()=>{http++;return response();}});
    const turn=await x.typed('That crash was hilarious!');
    assert.notEqual((await x.settled(turn)).status,'completed');
    assert.equal(http,0,'retired M8 frame cannot reach HTTP');
    assert.equal(diag(x).contributedToModelRequest,false);
  });

test('M8 composes with H1, H2 and M5 without changing their contributions',{timeout:60000},async t=>{
  const x=await d01Harness(t,{config:configured({'memory.journalContext':'on',
    'memory.recall':'on','memory.commands':'on'})});
  const sent=capture(x);
  await say(x,'Thanks, I trust you. My cedar compass is under the violet bridge.');
  await say(x,'That crash was hilarious!');
  await say(x,'Where is my cedar compass?');
  const last=sent.at(-1),l=lanes(last);
  assert.ok(last.frame.modelAllocation.messages.length>1,'H1 conversation lane present');
  assert.ok(l.RECALLED.evidence?.some(i=>i.content.includes('cedar compass')),'H2 evidence present');
  assert.ok(l.RECALLED.characterOpinions?.length>=1,'M8 opinions present beside the facts');
  assert.ok(l.RECALLED.evidence.every(i=>i.epistemicStatus===undefined),
    'interpretations stay in their own lane, apart from recalled facts');
  for(const name of ['memoryJournalDiagnostics','memoryRecallDiagnostics','memoryInterpretationDiagnostics'])
    assert.equal(x.h.runtime.services[name]().contributedToModelRequest,true,name);
});
