import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPersonalTestDefaults,shouldApplyPersonalTestDefaults,PERSONAL_M7_BUDGET}
  from '../src/config/personalTestDefaults.mjs';
import {normalizeConfig} from '../src/config/e1Config.mjs';
import {ensurePersonalM7Approval} from '../src/memory/m7RuntimeCuration.mjs';
import {validateM7ProductionPricing} from '../../lsa-shared-brain/src/memory/m7Consent.mjs';

test('real personal config auto-selects prior approval and verified official Luna pricing',()=>{
  assert.equal(shouldApplyPersonalTestDefaults('C:\\Games\\plugins\\LosSantosAliveServer\\e1.config.json',{}),true);
  assert.equal(shouldApplyPersonalTestDefaults('/tmp/config.json',{}),false);
  assert.equal(shouldApplyPersonalTestDefaults('/tmp/config.json',{personalTestMode:true}),true);
  assert.equal(shouldApplyPersonalTestDefaults('/tmp/e1.config.json',{personalTestMode:false}),false);
  const c=normalizeConfig(applyPersonalTestDefaults({provider:'openai',reasoningModel:'gpt-6-luna'}),{});
  assert.deepEqual(c.memoryK.cloudCuration.personalApproval,PERSONAL_M7_BUDGET);
  assert.doesNotThrow(()=>validateM7ProductionPricing({provider:'openai',
    reasoningModel:'gpt-6-luna',reasoningBaseUrl:'https://api.openai.com/v1',
    curatorPricing:c.memoryK.cloudCuration.pricing},
    {nowUtc:'2026-10-18T16:00:00.000Z'}));
  assert.equal(c.memoryK.capabilities['memory.cloudCuration'],'on');
});
test('personal M7 provisions once without clicks; adjusts prior granted limits; respects withdrawal',async()=>{
  let record=null;const calls=[];const store={
    timelineWritable:true,
    async readM7Consent(){return record;},
    async grantM7Consent(params){
      calls.push(params);
      record={...params,mode:'experimental',cloudOptIn:true,consentRevision:calls.length};
    }};
  const args={cloud:{personalApproval:PERSONAL_M7_BUDGET},store,worldProfileId:'world',timelineId:'timeline',model:'gpt-6-luna'};
  const first=await ensurePersonalM7Approval(args);
  assert.equal(first.dailyUsd,5);assert.equal(first.monthlyUsd,50);assert.equal(first.maxBatchUsd,1);
  assert.equal(first.offTurnEvidenceUploadAccepted,true);
  await ensurePersonalM7Approval(args);
  assert.equal(calls.length,1);
  record={...record,dailyUsd:0.5,monthlyUsd:5,maxBatchUsd:0.05};
  await ensurePersonalM7Approval(args);
  assert.equal(calls.length,2);
  record={...record,mode:'off',cloudOptIn:false};
  await ensurePersonalM7Approval(args);
  assert.equal(calls.length,2,'withdrawal survives restart');
});
test('no implicit approval when personal mode is off, timeline is unwritable or price/source is unsupported',async()=>{
  let granted=0;const store={timelineWritable:false,
    readM7Consent:async()=>null,grantM7Consent:async()=>{granted++;}};
  const params={cloud:{personalApproval:PERSONAL_M7_BUDGET},store,worldProfileId:'world',timelineId:'timeline',model:'gpt-6-luna'};
  assert.equal(await ensurePersonalM7Approval(params),null);
  assert.equal(granted,0);
  store.timelineWritable=true;
  assert.equal(await ensurePersonalM7Approval({...params,cloud:{}}),null);
  assert.equal(granted,0);
  assert.throws(()=>normalizeConfig({memoryK:{cloudCuration:{personalApproval:{dailyUsd:-1,monthlyUsd:50,maxBatchUsd:1}}}},{}),/invalid budget caps/);
});
