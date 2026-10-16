// Memory K L: memory.interpretation activates M8 independently through the REAL
// original runner (D01/D03/D02 harness, production P2 SQLite store, PS4 frame
// and provider request path). Only the GTA/RPH process, owner evidence pipe and
// OpenAI endpoints are stubbed; see d01-harness.mjs. Nothing here is a GTA receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';
import {memoryKM8Activation} from '../../src/memory/runtimeComposition.mjs';

const requested={
  'memory.dialogue.player':'on','memory.dialogue.npc':'on',
  'memory.journalContext':'off','memory.recall':'off',
  'memory.commands':'off','memory.interpretation':'on',
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
const FACTS=['Thanks for helping me, my friend.','Inside joke: the flying purple car!',
  'Running joke: the flying purple car!'];
async function seed(x){for(const line of FACTS)await say(x,line);}
// The M8 snapshot reader is the only caller of this exact statement. M2/D03 also
// use withP2SqliteRead, so count M8 reads by SQL rather than by entry point.
const M8_SQL='%received_at_utc DESC,record_id DESC LIMIT 128';
function spyM8Reads(store){
  const counter={reads:0};
  const original=store.withP2SqliteRead.bind(store);
  store.withP2SqliteRead=(scope,fn)=>original(scope,db=>fn(new Proxy(db,{get(target,key){
    const value=target[key];if(typeof value!=='function')return value;
    return key==='prepare'?sql=>{
      if(String(sql).includes(M8_SQL.slice(1)))counter.reads++;return target.prepare(sql);}
      :value.bind(target);}})));
  return counter;
}

test('activation matrix: explicit on needs only the M2 accepted player line; off/shadow/missing stay off',()=>{
  const cfg=(caps)=>({memoryK:{capabilities:caps}});
  const on=memoryKM8Activation(cfg({'memory.dialogue.player':'on','memory.interpretation':'on'}));
  assert.equal(on.mode,'on');assert.equal(on.legacy,false);assert.equal(on.reason,null);
  // Neither M4 recall, H1 history, M5 commands, nor M6/M7 is a prerequisite.
  for(const siblings of [{},{'memory.recall':'off','memory.journalContext':'off','memory.commands':'off',
      'memory.deterministic':'off','memory.cloudCuration':'off'}])
    assert.equal(memoryKM8Activation(cfg({'memory.dialogue.player':'on',
      'memory.interpretation':'on',...siblings})).mode,'on');
  const off=memoryKM8Activation(cfg({'memory.dialogue.player':'on','memory.interpretation':'off'}));
  assert.equal(off.mode,'off');assert.equal(off.reason,'optional_consumer_stopped');
  const absent=memoryKM8Activation(cfg({'memory.dialogue.player':'on'}));
  assert.equal(absent.mode,'off');assert.equal(absent.reason,'optional_consumer_stopped');
  const shadow=memoryKM8Activation(cfg({'memory.dialogue.player':'on','memory.interpretation':'shadow'}));
  assert.equal(shadow.mode,'off');assert.equal(shadow.reason,'shadow_not_supported');
  const blocked=memoryKM8Activation(cfg({'memory.interpretation':'on'}));
  assert.equal(blocked.mode,'off');
  assert.equal(blocked.reason,'dependency_not_requested_or_available:memory.dialogue.player');
  // M6 alone is a background add-on; it does not turn the legacy bundle (or M8) into an explicit map.
  assert.equal(memoryKM8Activation(cfg({'memory.deterministic':'on'})).legacy,true);
});

test('M8 alone brings grounded character opinions to the actual model request (H1/H2/M5 off)',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const spy=spyM8Reads(x.store);
    const sent=capture(x);
    await seed(x);
    await say(x,'How are you doing today?');
    assert.ok(spy.reads>0,'positive control: the spy sees the M8 snapshot read when M8 is on');
    const last=sent.at(-1),lanes=scene(last);
    assert.equal(last.frame.modelAllocation.messages.length,1,'H1 off: no journal conversation lane');
    assert.equal(lanes.RECALLED.evidence,undefined,'M4 off: no recalled evidence');
    assert.equal(lanes.SELF.memoryAction,undefined,'M5 off');
    assert.ok(lanes.RECALLED.characterOpinions?.length>=2,'interpretations reach PS4');
    assert.ok(lanes.RECALLED.runningJokes?.length>=1);
    assert.equal(lanes.RECALLED.relationshipInterpretation.canonRelationshipUnchanged,true);
    // Interpretations are labelled subjective opinions, never established facts.
    for(const item of lanes.RECALLED.characterOpinions){
      assert.equal(item.epistemicStatus,'character_opinion');
      assert.equal(item.verifiedWorldFact,false);
    }
    // Authoritative NPC canon/personality still rides the same frame untouched.
    assert.ok(lanes.SELF.canon,'SELF canon preserved alongside interpretations');
    assert.equal(lanes.RECALLED.relationshipInterpretation.verifiedWorldFact,false);
    const state=x.h.runtime.services.memoryInterpretationDiagnostics();
    assert.equal(state.contributedToModelRequest,true);
    assert.equal(state.lastValidation.status,'ready');
    assert.equal(state.state,'ready');
    // Siblings were never started.
    assert.equal(x.h.runtime.services.memoryRecallDiagnostics().state,'stopped');
    assert.equal(x.h.runtime.services.memoryJournalDiagnostics().state,'stopped');
    assert.equal(x.h.runtime.services.memoryCommandDiagnostics().state,'stopped');
  });

test('M8 off: no interpretation, no M8 P2 read, and M2 recording is unaffected',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured({'memory.interpretation':'off'})});
    const spy=spyM8Reads(x.store);
    const sent=capture(x);
    await seed(x);
    await say(x,'How are you doing today?');
    const last=sent.at(-1),lanes=scene(last);
    assert.equal(lanes.RECALLED.characterOpinions,undefined);
    assert.equal(lanes.RECALLED.runningJokes,undefined);
    assert.equal(lanes.RECALLED.relationshipInterpretation,undefined);
    assert.equal(spy.reads,0,'a disabled M8 performs no P2 interpretation read');
    const diagnostics=x.h.runtime.services.memoryInterpretationDiagnostics();
    assert.equal(diagnostics.state,'stopped');assert.equal(diagnostics.reason,'optional_consumer_stopped');
    assert.equal(diagnostics.contributedToModelRequest,false);
    assert.ok((await x.journal()).players.length>=4,'M2 still recorded every accepted line');
    assert.equal(x.h.runtime.services.memoryDialogueDiagnostics()['memory.dialogue.player'].state,'ready');
  });

test('M8 requested without the M2 player line is blocked and reads nothing',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured({'memory.dialogue.player':'off','memory.dialogue.npc':'off'})});
    const spy=spyM8Reads(x.store);
    const sent=capture(x);
    await say(x,FACTS[0]);await say(x,FACTS[1]);await say(x,FACTS[2]);
    assert.equal(scene(sent.at(-1)).RECALLED.characterOpinions,undefined);
    const diagnostics=x.h.runtime.services.memoryInterpretationDiagnostics();
    assert.equal(diagnostics.state,'blocked');
    assert.equal(diagnostics.reason,'dependency_not_requested_or_available:memory.dialogue.player');
    assert.equal(spy.reads,0);
    assert.equal((await x.journal()).rows.length,0);
  });

test('shadow M8 is explicitly unsupported and contributes nothing',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured({'memory.interpretation':'shadow'})});
    const sent=capture(x);
    await seed(x);
    assert.equal(scene(sent.at(-1)).RECALLED.characterOpinions,undefined);
    const diagnostics=x.h.runtime.services.memoryInterpretationDiagnostics();
    assert.equal(diagnostics.reason,'shadow_not_supported');
    assert.equal(diagnostics.state,'unavailable');
  });

test('forgetting the joke source removes the running joke from the next real request',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x);
    await seed(x);
    await say(x,'What do you think of me?');
    assert.ok(scene(sent.at(-1)).RECALLED.runningJokes?.length>=1,'precondition: joke interpreted');
    const scope={characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
      timelineId:x.timelineId,protagonistKey:x.native.avatar};
    const rows=(await x.store.readDialogueLines({...scope,limit:50})).filter(r=>r.speaker==='player');
    const request=rows.find(r=>r.content==='What do you think of me?');
    const target=rows.find(r=>r.content===FACTS[2]);
    assert.ok(request&&target);
    const forgotten=await x.store.commitCommand({scope,commandId:randomUUID(),
      requestedByLineId:request.recordId,operation:'forget',content:request.content,
      contentHash:createHash('sha256').update(request.content).digest('hex'),
      evidenceRecordIds:[request.recordId,target.recordId],targetRecordId:target.recordId,
      requestedAtUtc:request.committedAtUtc});
    assert.equal(forgotten.status,'committed');
    await say(x,'Do we have any private jokes?');
    const lanes=scene(sent.at(-1));
    assert.equal(lanes.RECALLED.runningJokes?.length??0,0,'the single remaining joke line is no recurring motif');
    const ids=sent.at(-1).frame.opinionReferences?.flatMap(r=>r.sourceEvidenceIds??[])??[];
    assert.ok(!ids.includes(target.recordId));
  });

// Control: with M8 OFF the very same hooks do not stop the turn, so the aborts
// below are attributable to the prepared M8 evidence and nothing else.
for(const [interpretation,hook,aborts] of [['off','boundary',false],['off','forget',false],
    ['on','boundary',true],['on','forget',true]])
  test(`M8 ${interpretation}: ${hook} between preparation and send ${aborts?'aborts before HTTP':'does not affect the turn'}`,
    {timeout:60000},async t=>{
      const x=await d01Harness(t,{config:configured({'memory.interpretation':interpretation})});
      await seed(x);
      const scope={characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
        timelineId:x.timelineId,protagonistKey:x.native.avatar};
      const forget=async()=>{
        const rows=(await x.store.readDialogueLines({...scope,limit:50})).filter(r=>r.speaker==='player');
        const request=rows.find(r=>r.content==='Remember our jokes?');
        const target=rows.find(r=>r.content===FACTS[2]);
        return x.store.commitCommand({scope,commandId:randomUUID(),requestedByLineId:request.recordId,
          operation:'forget',content:request.content,
          contentHash:createHash('sha256').update(request.content).digest('hex'),
          evidenceRecordIds:[request.recordId,target.recordId],targetRecordId:target.recordId,
          requestedAtUtc:request.committedAtUtc});
      };
      let http=0;const bodies=[];
      x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
        dialogueAttempt:{request:()=>hook==='boundary'?x.store.onBoundary({reason:'timeline_change'}):forget(),
          outputText:()=>{}},
        fetchImpl:async(url,req)=>{http++;bodies.push(req.body);return response();}});
      const turn=await x.typed('Remember our jokes?');
      const outcome=await x.settled(turn);
      if(aborts){
        assert.notEqual(outcome.status,'completed');
        assert.equal(http,0,'retired/forgotten M8 evidence can never reach HTTP');
        assert.equal(x.h.runtime.services.memoryInterpretationDiagnostics().contributedToModelRequest,false);
      }else{
        assert.equal(outcome.status,'completed');
        assert.equal(http,1);
        assert.ok(!bodies.some(body=>body.includes('character_opinion')));
      }
    });

test('M8 coexists with H1 and H2: each contributes independently from the same accepted turn',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured({'memory.journalContext':'on','memory.recall':'on'})});
    const sent=capture(x);
    await seed(x);
    await say(x,'What did I say about the flying purple car?');
    const last=sent.at(-1),lanes=scene(last);
    assert.ok(last.frame.modelAllocation.messages.length>1,'H1 journal conversation');
    assert.ok(lanes.RECALLED.evidence?.some(item=>item.content.includes('flying purple car')),'H2 factual recall');
    assert.ok(lanes.RECALLED.characterOpinions?.length>=2,'M8 interpretation');
    // Facts stay in evidence; subjective opinions stay in their own typed lane.
    assert.ok(!JSON.stringify(lanes.RECALLED.evidence).includes('character_opinion'));
    for(const id of ['memoryJournalDiagnostics','memoryRecallDiagnostics','memoryInterpretationDiagnostics'])
      assert.equal(x.h.runtime.services[id]().contributedToModelRequest,true,id);
  });

test('M8 unavailable (P2 read fault) falls back to the base frame without breaking the turn',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x);
    await seed(x);
    x.store.withP2SqliteRead=async()=>{throw Error('unavailable P2 read');};
    await say(x,'Any thoughts?');
    const last=sent.at(-1);
    assert.equal(scene(last).RECALLED.characterOpinions,undefined);
    assert.equal(x.h.runtime.services.memoryInterpretationDiagnostics().contributedToModelRequest,false);
  });
