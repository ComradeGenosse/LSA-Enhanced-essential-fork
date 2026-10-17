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

// ---- L: independent M8 interpretation contributor -------------------------
const m8Stamp=Object.freeze({characterId:'npc',turnId:'turn-1',worldEpoch:1});
const interpreted=(over={})=>{
  const state={current:true,verifies:true,...over};
  return {status:'ready',reason:null,stamp:m8Stamp,
    preparedM8:{status:'ready',stamp:m8Stamp,projection:{interpretations:[]}},
    verifyPrepared:async()=>state.verifies,
    opinionCurrent:(_refs,seen)=>state.current&&seen?.turnId===m8Stamp.turnId,
    sendCurrent:()=>state.current,state};
};

test('M8 alone is a valid contribution with no H1/H2/M5 and no foreground authority',async()=>{
  const m8=interpreted();
  const only=composeIndependentForegroundMemory({interpretation:m8});
  assert.equal(only.status,'ready');
  assert.equal(only.interpretationPrepared,true);
  assert.equal(only.preparedM8,m8.preparedM8);
  assert.equal(only.conversationJournal,null);assert.equal(only.preparedRecall,null);
  assert.equal(only.memoryAction,null);
  assert.equal(only.opinionCurrent([],m8Stamp),false,'no opinion authority before async verification');
  assert.equal(only.sendCurrent(),false,'there is no foreground frame to authorize');
  assert.equal(await only.verifyPrepared(),true);
  assert.equal(only.opinionCurrent([],m8Stamp),true);
  assert.equal(only.opinionCurrent([],{...m8Stamp,turnId:'other'}),false);
  assert.equal(only.sendCurrent(),false,'M8 never authorizes the H1/H2/M5 memory stamp');
});

test('a non-ready or foreign M8 preparation contributes nothing and is not mistaken for ready',()=>{
  assert.equal(composeIndependentForegroundMemory({interpretation:{status:'unavailable',preparedM8:null}}),null);
  assert.equal(composeIndependentForegroundMemory({interpretation:{status:'ready',preparedM8:{status:'dropped'}}}),null);
  const withH1=composeIndependentForegroundMemory({history:journal(),
    interpretation:{status:'blocked',preparedM8:null}});
  assert.equal(withH1.interpretationPrepared,false);assert.equal(withH1.preparedM8,null);
});

test('M8 failure drops only the opinion lane; H1/H2 stay valid and cannot be poisoned',async()=>{
  const seen=[];
  const m8=interpreted({verifies:false});
  const combo=composeIndependentForegroundMemory({history:journal(),recall:recalled(),
    interpretation:m8,onValidation:x=>seen.push(x)});
  assert.equal(await combo.verifyPrepared(),true,'foreground verification is unaffected');
  assert.equal(combo.sendCurrent(),true);
  assert.equal(combo.opinionCurrent([],m8Stamp),false);
  assert.deepEqual(seen.find(x=>'m8' in x),{m8:false});
  // The failed M8 latch never recovers, even if its source later looks fine.
  m8.state.verifies=true;
  assert.equal(await combo.verifyPrepared(),true);
  assert.equal(combo.opinionCurrent([],m8Stamp),false,'failed M8 latch stays failed');
});

test('H1/H2 failure removes the foreground frame but leaves an otherwise current M8 lane',async()=>{
  let h2Current=true;
  const h2={...recalled(),sendCurrent:()=>h2Current,verifyPrepared:async()=>h2Current};
  const m8=interpreted();
  const combo=composeIndependentForegroundMemory({recall:h2,interpretation:m8});
  h2Current=false;
  assert.equal(await combo.verifyPrepared(),false);
  assert.equal(combo.sendCurrent(),false);
  assert.equal(combo.opinionCurrent([],m8Stamp),true,'M8 has its own authority and latch');
});

test('inconsistent H1/H2 accepted-line stamps still leave M8 independent',async()=>{
  const mismatch=recalled();
  mismatch.preparedRecall={...mismatch.preparedRecall,stamp:{...stamp,worldEpoch:2}};
  const result=composeIndependentForegroundMemory({history:journal(),recall:mismatch,
    interpretation:interpreted()});
  assert.equal(result.status,'ready');
  assert.equal(result.conversationJournal,null);assert.equal(result.preparedRecall,null);
  assert.equal(result.interpretationPrepared,true);
  assert.equal(await result.verifyPrepared(),true);
  assert.equal(result.opinionCurrent([],m8Stamp),true);
});

test('M8 opinion requestSent flag is independent from foreground verification',async()=>{
  let live=true;
  const h1={...journal(),sendCurrent:()=>false,sendCurrentInFlight:()=>live};
  const m8=interpreted();
  m8.opinionCurrent=(_refs,seen,{requestSent=false}={})=>
    requestSent&&live&&seen?.turnId===m8Stamp.turnId;
  const combo=composeIndependentForegroundMemory({history:h1,interpretation:m8});
  await combo.verifyPrepared();
  assert.equal(combo.sendCurrent(),false);
  assert.equal(combo.opinionCurrent([],m8Stamp,{requestSent:false}),false);
  assert.equal(combo.opinionCurrent([],m8Stamp,{requestSent:true}),true);
  live=false;
  assert.equal(combo.opinionCurrent([],m8Stamp,{requestSent:true}),false);
});
