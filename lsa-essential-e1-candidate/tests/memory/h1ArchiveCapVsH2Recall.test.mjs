// Regression for the 2026-10-15 live "favorite soda" failure.
//
// Intended behaviour being pinned (NOT a defect):
//   H1 (memory.journalContext) is bounded conversation history: lines within a
//   5-minute gap chain (max 20 messages / 12 KiB) plus at most FOUR labelled
//   older lines (2 KiB) in CONVERSE.earlier. It is not factual retrieval, so a
//   fifth older line is correctly absent and "H1 ready/contributed" never means
//   a specific older fact was selected.
//   H2 (memory.recall) is the durable factual retrieval path: M4 over the P2
//   projection (FTS-ranked lexical candidates + recent window), labelled by the
//   G3 evidence policy, fenced by the same source/identity/world/timeline,
//   privacy and read-fence checks as H1.
//
// Real: P2 SQLite store, conversation recorder, H1 assembler, H2, M4 engine,
// evidence policy, PS4 allocation, the original OpenAI runner and the D01/D03/D02
// harness. Scripted: native frames and the provider HTTP response only. This is
// NOT a GTA pass and does not call a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import {p2Fixture} from './h2-p2-fixture.mjs';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';
import {assembleJournalConversation} from '../../src/memory/h1ConversationHistory.mjs';
import {createConversationJournalRecorder} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';

const SODA='Hell yeah, man, I like purple soda.';
const QUESTION='What was my favorite soda?';
// Seconds before the question, copied from the live trace (22:56:59.914Z).
const LIVE=[
  [SODA,2419.1,'stt'],
  ['Come on, man, follow me.',2132.9],
  ['How you been, man?',2118.9],
  ['Can you hear me?',2110.9],
  ['Is my favorite soda.',1728.9],
  ["How's it going, man?",9],
];
const iso=(base,secondsAgo)=>new Date(base-secondsAgo*1000).toISOString();
const items=h2=>h2.preparedRecall?.contribution?.items??[];

async function seeded(t){
  const f=await p2Fixture(t),base=Date.now();
  let soda=null;
  for(const [text,ago] of LIVE){
    const receipt=await f.say(text,{at:iso(base,ago)});
    if(text===SODA)soda=receipt;
  }
  return {f,base,soda};
}

test('H1 is bounded: the original soda line is the fifth older line and is excluded',async t=>{
  const {f,base}=await seeded(t);
  const nowUtc=iso(base,0);
  const {receipt}=await f.ask(QUESTION,{nowUtc});
  const sc=f.scope(0,'franklin');
  const rows=await f.store.readDialogueLines({characterId:sc.characterId,timelineId:sc.timelineId,limit:200});
  assert.equal(rows.length,7);
  const accepted=rows.find(r=>r.recordId===receipt.recordId);
  const journal=assembleJournalConversation({rows,accepted,scope:sc,suppressed:[],nowUtc});
  assert.deepEqual(journal.recent.map(x=>x.content),["How's it going, man?"]);
  assert.deepEqual(journal.earlier.map(x=>x.content),[
    'Is my favorite soda.','Can you hear me?','How you been, man?','Come on, man, follow me.']);
  assert.equal([...journal.recent,...journal.earlier].some(x=>x.content===SODA),false);
});

test('H2 over the same journal retrieves the exact soda bytes, labelled, and survives revalidation',async t=>{
  const {f,base,soda}=await seeded(t);
  const {h2}=await f.ask(QUESTION,{nowUtc:iso(base,0)});
  assert.equal(h2.status,'ready');
  const hit=items(h2).find(x=>x.recordId===soda.recordId);
  assert.ok(hit,'original statement retrieved');
  assert.equal(hit.content,SODA);
  assert.equal(hit.category,'exact_quote');
  assert.equal(hit.sourceKind,'dialogue_line');
  assert.equal(await h2.verifyPrepared(),true);
  assert.equal(h2.sendCurrent(),true);
});

test('H2 retrieval does not depend on archive position (lexical FTS beyond the 384-row recent window)',
  {timeout:60000},async t=>{
  const f=await p2Fixture(t),base=Date.now();
  const soda=await f.say(SODA,{at:iso(base,36000)});
  for(let i=0;i<450;i++)await f.say('filler talk '+i+' about nothing',{at:iso(base,30000-i*20)});
  const {h2}=await f.ask(QUESTION,{nowUtc:iso(base,0)});
  assert.equal(h2.status,'ready');
  assert.ok(items(h2).some(x=>x.recordId===soda.recordId&&x.content===SODA));
});

test('same saved character after a new host run: stale prepared recall latches invalid, fresh preparation recovers the fact',async t=>{
  const {f,base,soda}=await seeded(t);
  const first=await f.ask(QUESTION,{nowUtc:iso(base,0)});
  assert.ok(items(first.h2).some(x=>x.recordId===soda.recordId));
  f.newHost();
  assert.equal(await first.h2.verifyPrepared(),false,'old host cannot revalidate');
  assert.equal(first.h2.sendCurrent(),false);
  // A new launch/host run suspends the timeline until the user's explicit
  // confirmation (existing, intended behaviour; nothing here auto-resumes it).
  await assert.rejects(()=>f.say('anything',{at:new Date().toISOString()}),/timeline_write_suspended/);
  await f.store.confirmTimeline(f.timelineId,{confirmation:f.timelineId});
  const second=await f.ask(QUESTION,{nowUtc:new Date().toISOString()});
  assert.ok(items(second.h2).some(x=>x.recordId===soda.recordId&&x.content===SODA));
  assert.equal(await second.h2.verifyPrepared(),true);
});

test('source revocation blocks recall; a forgotten soda line is never recalled',async t=>{
  const {f,base,soda}=await seeded(t);
  const before=await f.ask(QUESTION,{nowUtc:iso(base,0)});
  assert.equal(await before.h2.verifyPrepared(),true);
  await f.forget(soda.recordId);
  assert.equal(await before.h2.verifyPrepared(),false,'prepared recall is invalidated by the forget');
  const after=await f.ask(QUESTION,{nowUtc:new Date().toISOString()});
  assert.equal(items(after.h2).some(x=>x.recordId===soda.recordId),false);
  assert.equal(JSON.stringify(after.h2.preparedRecall??{}).includes('purple soda'),false);
  f.live=false;
  const revoked=await f.ask(QUESTION,{nowUtc:new Date().toISOString()});
  assert.equal(revoked.h2.status,'blocked');
});

// ---- whole provider request through the original runner + PS4 -------------
const live=(extra={})=>({memoryK:{capabilities:{
  'memory.dialogue.player':'on','memory.dialogue.npc':'on','memory.journalContext':'on',
  'memory.recall':'off','memory.commands':'off','memory.interpretation':'off',
  'memory.events':'off','memory.coverage':'off',...extra}}});
const completed=()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',
  content:[{type:'output_text',text:JSON.stringify({dialogue:'ok',command:''})}]}]}),
  {headers:{'content-type':'application/json'}});
async function wholeRequest(t,config){
  const x=await d01Harness(t,{config});
  const sent=[];
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
    fetchImpl:async(url,request)=>{
      sent.push({body:JSON.parse(request.body),frame:options.knowledgeProjection});
      return completed();
    }});
  const recorder=createConversationJournalRecorder(x.store),base=Date.now();
  let n=0;
  for(const [text,ago,source] of LIVE)await recorder.recordPlayerAccepted({
    characterId:x.profile.characterId,
    identity:{pedId:'17',turnId:'seed-'+ ++n,generationId:'g1',sessionNonce:'seed-session'},
    text,source:source==='stt'?'stt':'typed',attribution:{protagonist:'franklin'},
    committedAtUtc:iso(base,ago)});
  const turn=await x.typed(QUESTION),outcome=await x.settled(turn);
  assert.equal(outcome.status,'completed',JSON.stringify(outcome));
  const last=sent.at(-1);
  return {x,last,lanes:JSON.parse(last.frame.modelAllocation.scene).lanes,
    whole:JSON.stringify(last.body)};
}

test('live configuration (H1 on, H2 off): CONVERSE.earlier holds four archived lines and the whole request has no soda',
  {timeout:60000},async t=>{
  const r=await wholeRequest(t,live());
  assert.deepEqual(r.last.frame.modelAllocation.messages.map(m=>m.content),["How's it going, man?",QUESTION]);
  assert.deepEqual((r.lanes.CONVERSE?.earlier??[]).map(e=>e.content),[
    'Is my favorite soda.','Can you hear me?','How you been, man?','Come on, man, follow me.']);
  assert.equal(r.lanes.RECALLED.evidence,undefined);
  assert.equal(r.whole.includes('purple soda'),false,
    'H1 reporting contributed=true does not mean the older fact was selected');
  assert.equal(r.x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,true);
  assert.equal(r.x.h.runtime.services.memoryRecallDiagnostics().state,'stopped');
});

test('H1 on + H2 on: soda is in RECALLED.evidence and in the actual provider body',
  {timeout:60000},async t=>{
  const r=await wholeRequest(t,live({'memory.recall':'on'}));
  assert.ok((r.lanes.RECALLED.evidence??[]).some(e=>e.content===SODA));
  assert.equal(r.whole.includes('purple soda'),true);
  assert.equal(r.x.h.runtime.services.memoryRecallDiagnostics().contributedToModelRequest,true);
  assert.equal(r.x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,true);
});

test('H1 off + H2 on: factual recall works without any journal conversation lane',
  {timeout:60000},async t=>{
  const r=await wholeRequest(t,live({'memory.recall':'on','memory.journalContext':'off'}));
  assert.deepEqual(r.last.frame.modelAllocation.messages.map(m=>m.content),[QUESTION]);
  assert.equal(r.lanes.CONVERSE,undefined);
  assert.ok((r.lanes.RECALLED.evidence??[]).some(e=>e.content===SODA));
  assert.equal(r.whole.includes('purple soda'),true);
});
