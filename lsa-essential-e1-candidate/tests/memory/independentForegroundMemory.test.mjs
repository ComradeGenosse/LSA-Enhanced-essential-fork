import test from 'node:test';
import assert from 'node:assert/strict';
import {composeIndependentForegroundMemory} from '../../src/memory/independentForegroundMemory.mjs';

const stamp=Object.freeze({characterId:'npc',recordId:'accepted',worldEpoch:1});
const journal=()=>({status:'ready',stamp,conversationJournal:{recent:[],earlier:[]},
  verifyPrepared:async()=>({status:'ready'}),sendCurrent:()=>true});
const recalled=()=>({status:'ready',preparedRecall:{status:'ready',stamp,contribution:{items:[]}},
  recallCurrent:(_refs,s)=>s?.recordId===stamp.recordId,
  verifyPrepared:async()=>true,sendCurrent:()=>true});

test('H1, H2, and both produce independent PS4-facing sections',async()=>{
  const onlyH1=composeIndependentForegroundMemory({history:journal()});
  assert.equal(onlyH1.h1Only,true);
  assert.equal(onlyH1.preparedRecall,null);
  assert.equal(await onlyH1.verifyPrepared(),true);
  const onlyH2=composeIndependentForegroundMemory({recall:recalled()});
  assert.equal(onlyH2.h1Only,false);
  assert.equal(onlyH2.conversationJournal,null);
  assert.equal(await onlyH2.verifyPrepared(),true);
  const together=composeIndependentForegroundMemory({history:journal(),recall:recalled()});
  assert.ok(together.conversationJournal);
  assert.ok(together.preparedRecall);
  assert.equal(together.sendCurrent(),false,'no authority before async verification');
  assert.equal(await together.verifyPrepared(),true);
  assert.equal(together.sendCurrent(),true);
});

test('differing H1/H2 source stamps are blocked, never combined',()=>{
  const mismatch=recalled();
  mismatch.preparedRecall={...mismatch.preparedRecall,stamp:{...stamp,worldEpoch:2}};
  const result=composeIndependentForegroundMemory({history:journal(),recall:mismatch});
  assert.equal(result.status,'blocked');
  assert.equal(result.conversationJournal,undefined);
});

test('either source invalidating after success revokes the entire outgoing frame',async()=>{
  let h1Current=true,h2Current=true;
  const h1={...journal(),sendCurrent:()=>h1Current};
  const h2={...recalled(),sendCurrent:()=>h2Current};
  const combo=composeIndependentForegroundMemory({history:h1,recall:h2});
  assert.equal(await combo.verifyPrepared(),true);
  h2Current=false;
  assert.equal(combo.sendCurrent(),false);
  assert.equal(await combo.verifyPrepared(),false);
  h2Current=true;
  assert.equal(combo.sendCurrent(),false,'failed combined proof cannot resurrect');
  h1Current=false;
  assert.equal(combo.sendCurrent(),false);
});

test('independently abstained H2 cannot poison valid H1',async()=>{
  const combo=composeIndependentForegroundMemory({history:journal(),recall:{status:'abstained'}});
  assert.equal(combo.h1Only,true);
  assert.equal(combo.preparedRecall,null);
  assert.equal(await combo.verifyPrepared(),true);
});

test('source-verified abstained H2 preserves conservative count evidence',async()=>{
  const h2={...recalled(),status:'abstained',
    preparedRecall:{...recalled().preparedRecall,
      answerEvidence:{dialogueCount:{status:'incomplete',reason:'unsupported_query',
        exactCount:null,first:null,last:null}}}};
  const only=composeIndependentForegroundMemory({recall:h2});
  assert.equal(only.status,'ready');
  assert.equal(only.preparedRecall.answerEvidence.dialogueCount.status,'incomplete');
  assert.equal(only.sendCurrent(),false);
  assert.equal(await only.verifyPrepared(),true);
  assert.equal(only.sendCurrent(),true);
  const together=composeIndependentForegroundMemory({history:journal(),recall:h2});
  assert.ok(together.conversationJournal);
  assert.equal(together.preparedRecall.answerEvidence.dialogueCount.status,'incomplete');
  assert.equal(await together.verifyPrepared(),true);
});
