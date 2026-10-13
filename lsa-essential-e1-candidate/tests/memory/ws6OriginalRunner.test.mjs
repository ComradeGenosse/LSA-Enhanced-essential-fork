// OFFLINE original-backed WS-6 acceptance: real D03 -> P2 journal/read ->
// PS4 prepared RECALLED/CONVERSE -> real runner model input. Native RPH and
// OpenAI calls are necessarily scripted by the existing D01 harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import {d01Harness} from './d01-harness.mjs';

test('WS-6: a second accepted player turn receives the FIRST turn as verified SQLite recall, not merely RAM, and does not recall its own question',
  {timeout:45000},async t=>{
    const x=await d01Harness(t);
    const debug=[];
    const original=x.h.runtime.services.prepareLiveTurnMemory;
    x.h.runtime.services.prepareLiveTurnMemory=async args=>{
      const value=await original(args);
      debug.push({status:value?.status,reason:value?.reason,
        items:value?.preparedRecall?.contribution?.items?.length??null,
        journal:value?.conversationJournal?.recent?.length??null,
        canAuthorize:value?.recallCurrent?.([],value?.preparedRecall?.stamp)??null,
        receipt:args.acceptedReceipt?.status,
        hasProjection:!!args.turn?.characterProjection,
        profile:args.turn?.characterProjection?.persistent===true,
        profileMatches:args.turn?.characterProjection?.profile?.characterId===args.turn?.characterInputs?.profile?.characterId,
        source:args.source,
        hasM2:!!args.turn?.m2Capture,
        memoryCurrent:args.turn?.m2Capture?.verifyMemoryCurrent?.()??null,
        hasTimeline:!!x.store.activeTimelineId,
        timelineWritable:x.store.timelineWritable,
        alias:x.store.get(x.profile.characterId)?.promotion?.ownerAlias===
          args.turn?.characterProjection?.profile?.promotion?.ownerAlias,
        hostValid:!!x.store.verifiedHostContext,
        storeRead:typeof x.store.readIntegratedRecall,
        storeSuppression:typeof x.store.listSuppressedMemoryIds,
        captureState:args.acceptedReceipt?.status,
        inputValid:typeof args.input==='string'});
      return value;
    };
    const first=await x.typed('I drove a turquoise motorcycle yesterday.');
    const outcomeOne=await x.settled(first);
    assert.equal(outcomeOne.status,'completed',JSON.stringify({outcomeOne,debug,
      modelCalls:x.replies.length,sent:x.h.sent.slice(-8).map(e=>({
        type:e.type,reason:e.reason}))}));
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
    assert.ok(facts.length>0,JSON.stringify({debug,
      hasRecallStamp:!!projection.recallStamp,
      hasMemoryStamp:!!projection.memoryStamp,
      recalledKeys:Object.keys(scene.lanes.RECALLED),
      journalRows:(await x.journal()).players.length,
      memoryPreview:scene.lanes.RECALLED.memories?.length}));
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


test('WS-6 M5: a real accepted explicit remember command produces one durable P2 record and a verified PS4 SELF acknowledgement',
  {timeout:45000},async t=>{
    const x=await d01Harness(t);
    const debug=[];
    const original=x.h.runtime.services.prepareLiveTurnMemory;
    x.h.runtime.services.prepareLiveTurnMemory=async args=>{
      const result=await original(args);
      debug.push({status:result?.status,action:result?.memoryAction,
        receipt:args.acceptedReceipt?.status,
        prepared:!!result?.preparedRecall,
        proof:result?.recallCurrent?.([],result?.preparedRecall?.stamp)??null});
      return result;
    };
    const turn=await x.typed('Remember that I love ginger tea.');
    const result=await x.settled(turn);
    assert.equal(result.status,'completed',JSON.stringify(result));
    const req=x.replies.at(-1);
    assert.ok(req?.knowledgeProjection?.modelAllocation);
    const scene=JSON.parse(req.knowledgeProjection.modelAllocation.scene);
    assert.deepEqual(scene.lanes.SELF.memoryAction,[{outcome:'saved',durableCommit:true}],
      JSON.stringify({debug,sceneMemoryAction:scene.lanes.SELF.memoryAction,
        journalPlayers:(await x.journal()).players.length,
        sceneKeys:Object.keys(scene.lanes.SELF),
        knownTurnStatus:result.status}));
    const rows=await x.store.readPermanentMemoryRows({
      characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
      timelineId:x.timelineId,protagonistKey:'franklin'},{limit:20});
    assert.ok(rows.some(row=>JSON.stringify(row).includes('I love ginger tea')),
      'memory must actually survive in the P2 permanent-memory table');
  });
