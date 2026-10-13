// OFFLINE original-backed WS-6 acceptance: real D03 -> P2 journal/read ->
// PS4 prepared RECALLED/CONVERSE -> real runner model input. Native RPH and
// OpenAI calls are necessarily scripted by the existing D01 harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {d01Harness} from './d01-harness.mjs';

test('WS-6: a second accepted player turn receives the FIRST turn as verified SQLite recall, not merely RAM, and does not recall its own question',
  {timeout:45000},async t=>{
    const x=await d01Harness(t);
    const first=await x.typed('I drove a turquoise motorcycle yesterday.');
    assert.equal((await x.settled(first)).status,'completed');
    const journal=await x.journal();
    assert.equal(journal.players.length,1);
    const priorId=journal.players[0].record_id;
    const second=await x.typed('What did I say about my turquoise motorcycle?');
    assert.equal((await x.settled(second)).status,'completed');
    const req=x.replies.at(-1);
    assert.ok(req?.knowledgeProjection?.modelAllocation,'the original runner must receive PS4 projection');
    const projection=req.knowledgeProjection;
    const scene=JSON.parse(projection.modelAllocation.scene);
    const facts=scene.lanes.RECALLED.evidence??[];
    assert.ok(facts.some(x=>x.recordId===priorId&&
      x.content==='I drove a turquoise motorcycle yesterday.'&&
      x.mode==='exact_quote'),
      'exact historical player words are present in PS4 RECALLED');
    assert.ok(!facts.some(x=>x.content==='What did I say about my turquoise motorcycle?'),
      'current accepted player input is not retrieved as an earlier memory');
    const last=projection.modelAllocation.messages.at(-1);
    assert.equal(last.role,'user');
    assert.equal(last.content,'What did I say about my turquoise motorcycle?');
    assert.ok(projection.modelAllocation.messages.some(x=>
      x.content==='I drove a turquoise motorcycle yesterday.'),
      'journal-bounded CONVERSE includes earlier accepted dialogue');
  });
