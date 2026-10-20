import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {e01Evidence} from '../e01Evidence.mjs';
import {analyze} from '../analyze.mjs';
const kinds=['ped','vehicle','prop','pickup'];
function make(type,probe,payload,ms){return {type,record:{hostRunId:'lab-1',worldEpoch:'epoch-1',
  gameMs:ms,probe,site:'terminal',day:'day',nathan:'present',condition:'yield_off',
  task:'walk',payload}};}
function fixture({mode='extended',skip=null,writeTrial=null,ghostTrial=null,lyingResult=null}={}){
  const events=[];let ms=1000;
  const push=(type,payload)=>events.push(make(type,'e0.1',payload,ms+=250));
  push('probe_start',{durationMs:240000});
  push('e01_baseline',{mode,planned:80,perKind:20});
  for(const control of ['wrong_class','invalid_model','unowned_handle'])
    push('e01_negative_control',{control,rejected:true,actorWrites:0});
  for(let index=0;index<80;index++){
    const i=index+1,id='e01-'+String(i).padStart(3,'0');
    const kind=kinds[index%4],kindTrial=Math.floor(index/4)+1;
    const delayed=mode==='extended'&&kindTrial%5===0;
    const inc=kind+':'+i;
    push('e01_trial_start',{trial:id,kind,kindTrial,model:kind+'-model-'+(kindTrial%4),delayed,actorWrites:0});
    push('create',{Kind:kind,Incarnation:inc,Handle:i,Model:123,CreatedGameMs:ms});
    if(skip!==id+':immediate')push('e01_readback',{trial:id,phase:'immediate',success:true,kind,
      incarnation:inc,strongIdentity:kind!=='pickup',weakPickupHandle:kind==='pickup'});
    if(delayed)for(const phase of ['1000ms','5000ms'])
      if(skip!==id+':'+phase)push('e01_readback',{trial:id,phase,success:true,kind});
    push('cleanup',{Incarnation:inc,deleted:true,kind});
    for(const phase of ['250ms','750ms'])
      if(skip!==id+':delete:'+phase)push('e01_post_delete',{trial:id,phase,
        absent:ghostTrial!==id,kind});
    push('e01_trial_result',{trial:id,kind,delayed,created:true,immediate:true,
      stability:true,deleted:true,postDelete:true,
      passed:lyingResult===id?true:ghostTrial!==id,actorWrites:writeTrial===id?1:0});
  }
  push('e01_summary',{mode,planned:80,attempted:80,fullyVerified:80-(ghostTrial?1:0),
    failed:ghostTrial?1:0,negativeFailed:0,actorWrites:0});
  push('probe_stop',{reason:'completed',spawnSuccess:80});
  return events;
}
const convert=e=>e.map(x=>JSON.stringify(x));
test('extended E0.1 computes per-kind denominators, variants, delayed checkpoints and deletion',()=>{
  const e=e01Evidence(fixture());
  assert.equal(e.integrity,'internally_consistent');
  assert.equal(e.observedTrials,80);
  assert.equal(e.delayedAttempted,16);
  assert.equal(e.delayedVerified,16);
  assert.equal(e.fullyVerified,80);
  for(const kind of kinds){
    assert.equal(e.byKind[kind].attempts,20);
    assert.equal(e.byKind[kind].creationReadbacks,20);
    assert.equal(e.byKind[kind].delayedAttempted,4);
    assert.equal(e.byKind[kind].modelVariants.length,4);
  }
  assert.equal(e.acceptance,'NEEDS_GTA_VIDEO_AND_OWNER_REVIEW');
  assert.equal(analyze(convert(fixture())).integrity,'parsed_clean');
});
test('baseline is a genuine 80-trial immediate-only negative control',()=>{
  const e=e01Evidence(fixture({mode:'baseline'}));
  assert.equal(e.integrity,'internally_consistent');
  assert.equal(e.delayedAttempted,0);
  assert.equal(e.postDeleteChecks,160);
});
test('missing 5-second checkpoint cannot be credited by a claimed success',()=>{
  const e=e01Evidence(fixture({skip:'e01-020:5000ms'}));
  assert.equal(e.integrity,'incomplete_or_invalid');
  assert.ok(e.faults.some(x=>x.includes('missing_or_failed_delayed_check')));
  assert.equal(analyze(convert(fixture({skip:'e01-020:5000ms'}))).integrity,'incomplete_or_error');
});
test('post-delete reappearance is a regression even when delete acknowledged',()=>{
  const e=e01Evidence(fixture({ghostTrial:'e01-001'}));
  assert.equal(e.postDeleteFailures,2);
  assert.equal(e.integrity,'incomplete_or_invalid');
  assert.ok(e.faults.some(x=>x.includes('post_delete_incomplete_or_present')));
});
test('scene task issuance during spawn census invalidates isolation claim',()=>{
  const e=e01Evidence(fixture({writeTrial:'e01-011'}));
  assert.equal(e.writeViolations,1);
  assert.equal(e.integrity,'incomplete_or_invalid');
});
test('partial, fabricated or duplicate E0.1 results are never complete',()=>{
  const partial=fixture().slice(0,18);
  assert.equal(e01Evidence(partial).integrity,'incomplete_or_invalid');
  assert.equal(analyze(convert(partial)).integrity,'incomplete_or_error');
  const f=fixture();
  const dupe=f.find(x=>x.type==='e01_trial_result');
  f.push(dupe);
  assert.equal(e01Evidence(f).integrity,'incomplete_or_invalid');
});
test('a clean synthetically constructed trace is never labelled GTA-accepted',()=>{
  const report=analyze(convert(fixture()));
  assert.equal(report.e01.acceptance,'NEEDS_GTA_VIDEO_AND_OWNER_REVIEW');
  assert.equal(report.acceptance.final,'NOT_ACCEPTED_AUTOMATICALLY');
});
