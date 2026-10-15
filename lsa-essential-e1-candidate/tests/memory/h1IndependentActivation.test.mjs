// H1-B integration tests use the original bundled OpenAI turn runner,
// D01/D03/D02 accepted line and durable P2 SQLite. Only GTA/native and HTTP
// are scripted by the existing shared offline harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const modes=Object.freeze({
  'memory.dialogue.player':'on','memory.dialogue.npc':'on',
  'memory.journalContext':'on','memory.recall':'off','memory.commands':'off',
  'memory.interpretation':'off','memory.events':'off','memory.coverage':'off'
});
const configured=(edits={})=>({memoryK:{capabilities:{...modes,...edits}}});
const response=()=>new Response(JSON.stringify({status:'completed',output:[{
  type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue:'Got it.',command:''})}]
}]}),{headers:{'content-type':'application/json'}});
function realDecisions(x,fetchImpl){
  const submissions=[];
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
    fetchImpl:async(url,request)=>{
      submissions.push({body:JSON.parse(request.body),options});
      return fetchImpl?fetchImpl(url,request):response();
    }});
  return submissions;
}
async function say(x,line){
  const turn=await x.typed(line),result=await x.settled(turn);
  assert.equal(result.status,'completed',JSON.stringify(result));
}
const frame=record=>record.options.knowledgeProjection;
const lanes=record=>JSON.parse(frame(record).modelAllocation.scene).lanes;
const scope=x=>({characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
  timelineId:x.timelineId,protagonistKey:x.native.avatar});
async function forget(x,target){
  const latest=(await x.store.readDialogueLines({...scope(x),limit:20}))
    .find(row=>row.speaker==='player');
  return x.store.commitCommand({scope:scope(x),commandId:randomUUID(),
    requestedByLineId:latest.recordId,operation:'forget',content:latest.content,
    contentHash:sha(latest.content),evidenceRecordIds:[latest.recordId,target],
    targetRecordId:target,requestedAtUtc:latest.committedAtUtc});
}

test('H1 on / M4 M5 M8 off: real original runner sends source-verified SQLite dialogue without unrelated memory', 
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  x.store.readIntegratedRecall=()=>{throw Error('independent H1 must never call M4');};
  const sent=realDecisions(x);
  await say(x,'The violet accordion is in my kitchen.');
  await say(x,'What did I say about the accordion?');
  assert.equal(sent.length,2);
  const f=frame(sent.at(-1)),messages=f.modelAllocation.messages;
  assert.ok(JSON.stringify(sent.at(-1).body).includes('The violet accordion is in my kitchen.'),
    'the actual provider body must contain admitted SQLite history');
  assert.ok(messages.some(row=>row.role==='user'&&row.content==='The violet accordion is in my kitchen.'));
  assert.equal(messages.at(-1).content,'What did I say about the accordion?');
  assert.equal(messages.filter(row=>row.content==='What did I say about the accordion?').length,1);
  const l=lanes(sent.at(-1));
  assert.equal(l.RECALLED.evidence,undefined);
  assert.equal(l.RECALLED.characterOpinions,undefined);
  assert.equal(l.SELF.memoryAction,undefined);
  assert.equal(x.h.runtime.memoryM3,undefined);
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,true);
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().lastValidation.status,'ready');
});

test('H1 off / M4 off performs no optional H1 preparation or RAM substitution', 
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured({'memory.journalContext':'off'})});
  let reads=0;const original=x.store.readDialogueLines.bind(x.store);
  x.store.readDialogueLines=async(...args)=>{reads++;return original(...args);};
  const sent=realDecisions(x);
  await say(x,'The private yellow lighthouse.');
  await say(x,'Do you recall the yellow lighthouse?');
  assert.equal(reads,0,'H1 off must not read SQLite conversation history');
  assert.equal(sent.length,2);
  assert.equal(frame(sent.at(-1)).modelAllocation.messages.length,1);
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().effectiveMode,'off');
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,false);
});

test('H1 off / M4 requested does not implicitly run H1, M5 or M8 (H2 activation remains separate)',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured({'memory.journalContext':'off','memory.recall':'on'})});
  let reads=0;const original=x.store.readDialogueLines.bind(x.store);
  x.store.readDialogueLines=async(...args)=>{reads++;return original(...args);};
  await say(x,'I said the meadow is peaceful.');
  assert.equal(reads,0);
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().state,'stopped');
});

test('H1 on retains exact historical roles across protagonist switches with unrelated workers off',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  const sent=realDecisions(x);
  await say(x,'The sapphire bicycle is near the garage.');
  x.native.avatar='michael';await x.native.sample();
  await say(x,'Did I mention my sapphire bicycle?');
  assert.ok(frame(sent.at(-1)).modelAllocation.messages.some(row=>
    row.role==='user'&&row.content==='The sapphire bicycle is near the garage.'));
  assert.equal(lanes(sent.at(-1)).RECALLED.evidence,undefined);
  assert.equal(x.h.runtime.memoryM3,undefined);
});

test('missing durable accepted receipt never revives stale RAM history and gives truthful denial diagnostics',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  const sent=realDecisions(x);
  await say(x,'This forgotten strawberry clue is private.');
  x.h.runtime.services.recordM2Player=async()=>null;
  await say(x,'What was the strawberry clue?');
  assert.equal(frame(sent.at(-1)).modelAllocation.messages.length,1);
  assert.ok(!JSON.stringify(frame(sent.at(-1)).includes('This forgotten strawberry clue is private.'));
  const diagnostic=x.h.runtime.services.memoryJournalDiagnostics();
  assert.equal(diagnostic.lastPreparation.reason,'accepted_line_authority_missing');
  assert.equal(diagnostic.contributedToModelRequest,false);
});

test('H1 denial from source read failure does not reuse RAM, commands, or background memory',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  const sent=realDecisions(x);
  await say(x,'The private ceramic kangaroo.');
  x.store.readDialogueLines=async()=>{throw Error('read failed');};
  await say(x,'What did I say about the kangaroo?');
  assert.equal(frame(sent.at(-1)).modelAllocation.messages.length,1);
  assert.ok(!JSON.stringify(frame(sent.at(-1)).includes('The private ceramic kangaroo.'));
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,false);
});

test('H1 suppression between model composition and HTTP admission blocks stale history', 
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  await say(x,'The secret red balloon is behind the gate.');
  const target=(await x.journal()).players[0].record_id;
  let sent=0,queued=null;
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
    dialogueAttempt:{request:()=>{queued??=forget(x,target);},outputText:()=>{}},
    fetchImpl:async()=>{sent++;return response();}});
  const turn=await x.typed('Where is the secret red balloon?');
  assert.notEqual((await x.settled(turn)).status,'completed');
  await queued;
  assert.equal(sent,0);
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,false);
});

test('H1 preserves exact verified request on retry, never makes a revoked retry', 
  {timeout:45000},async t=>{
  for(const revoke of [false,true]){
    await t.test('revoked='+revoke,async t2=>{
      const x=await d01Harness(t2,{config:configured()});
      await say(x,'Remember the old silver umbrella.');
      const target=(await x.journal()).players[0].record_id;
      const bodies=[];
      x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
        fetchImpl:async(_url,req)=>{
          bodies.push(req.body);
          if(bodies.length===1){
            if(revoke)await forget(x,target);
            return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
          }
          return response();
        }});
      const turn=await x.typed('Was it a silver umbrella?'),result=await x.settled(turn);
      if(revoke){assert.notEqual(result.status,'completed');assert.equal(bodies.length,1);}
      else{
        assert.equal(result.status,'completed',JSON.stringify(result));
        assert.equal(bodies.length,2);
        assert.equal(bodies[0],bodies[1]);
      }
    });
  }
});

test('H1 explicit shadow is not silently modeled as real private evaluation',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured({'memory.journalContext':'shadow'})});
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().state,'unavailable');
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().reason,'shadow_not_supported');
  const turn={get m2Capture(){throw Error('disabled H1 port touched');}};
  assert.equal(await x.h.runtime.services.prepareLiveTurnMemory({turn}),null);
});

for(const boundary of ['native_owner','timeline','host']){
  test('H1 source revocation before provider send fails closed: '+boundary,
    {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    await say(x,'The violet piano is hidden by the window.');
    let requests=0;
    x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
      dialogueAttempt:{request:()=>{
        if(boundary==='native_owner'){x.native.stop();x.client.stop();}
        if(boundary==='timeline')x.store.onBoundary({reason:'timeline_change'});
        if(boundary==='host')x.store.setVerifiedHostContext(null);
      },outputText:()=>{}},
      fetchImpl:async()=>{requests++;return response();}});
    const turn=await x.typed('Where is the violet piano?');
    assert.notEqual((await x.settled(turn)).status,'completed');
    assert.equal(requests,0,'revoked optional history must never reach the HTTP provider');
    const diagnostic=x.h.runtime.services.memoryJournalDiagnostics();
    assert.equal(diagnostic.state,'blocked',
      'revoked optional history must not be reported as simply waiting');
    assert.equal(diagnostic.lastValidation?.status,'invalidated');
    assert.equal(diagnostic.contributedToModelRequest,false);
  });
}

test('H1 synchronous final fence blocks a P2 write after last awaited verification',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  await say(x,'The copper map is on the table.');
  let checked=false;
  x.h.runtime.services.decide=async options=>{
    await options.knowledgeDelivery.verifyBeforeRequest();
    const old=x.store.memoryReadFence;
    await x.store.withP2SqliteTransaction(scope(x),db=>
      db.prepare('UPDATE dialogue_journal SET content=content WHERE speaker=?').run('player'));
    assert.notEqual(x.store.memoryReadFence,old);
    assert.throws(()=>options.knowledgeDelivery.beforeRequest({notSent:true}),
      {code:'knowledge_request_stale'});
    checked=true;
    throw Object.assign(new Error('knowledge_request_stale'),{code:'knowledge_request_stale'});
  };
  const turn=await x.typed('Where did I put the copper map?');
  assert.notEqual((await x.settled(turn)).status,'completed');
  assert.equal(checked,true);
});

test('H1 on with M5 off never commits an explicit memory command or asserts success',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:configured()});
  const sent=realDecisions(x);
  await say(x,'Remember that I prefer guava tea.');
  const l=lanes(sent.at(-1));
  assert.equal(l.SELF.memoryAction,undefined);
  const rows=await x.store.readPermanentMemoryRows({
    characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
    timelineId:x.timelineId,protagonistKey:'franklin'},{limit:20});
  assert.equal(rows.length,0,'M5 off cannot turn a conversational request into a durable fact');
});
