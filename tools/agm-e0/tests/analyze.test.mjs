import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {analyze} from '../analyze.mjs';

function l(type,probe,payload={},opts={}){
  return JSON.stringify({type,record:{hostRunId:'h',worldEpoch:'e',gameMs:opts.time??100,
    probe,site:'terminal',day:'day',nathan:'absent',condition:'yield_on',
    task:'walk',payload}});
}
test('a clean lifecycle still cannot prove GTA task retention by itself',()=>{
  const lines=[
    l('probe_start','e0.2',{}),
    l('create','e0.2',{Incarnation:'m:100:42:777'}),
    l('task_issued','e0.2',{policy:'walk'}),
    l('sample','e0.2',{Task:'walk',taskStatus:-999}),
    l('cleanup','e0.2',{Incarnation:'m:100:42:777',deleted:true}),
    l('probe_stop','e0.2',{reason:'completed'})];
  const result=analyze(lines);
  assert.equal(result.integrity,'parsed_clean');
  assert.equal(result.reports[0].taskRetention,'not_measurable_offline');
  assert.equal(result.acceptance.final,'NOT_ACCEPTED_AUTOMATICALLY');
});
test('orphaned entity yields a failing analysis even if probe says completed',()=>{
  const a=analyze([
    l('probe_start','e0.7'),l('create','e0.7',{Incarnation:'1'}),
    l('cleanup','e0.7',{Incarnation:'1',deleted:false}),
    l('probe_stop','e0.7',{reason:'completed'})]);
  assert.equal(a.integrity,'incomplete_or_error');assert.equal(a.acceptance.orphanCount,1);
});
test('fabricated sensor statement does not become verified ground truth',()=>{
  const a=analyze([l('probe_start','e0.5'),l('sensor','e0.5',{collected:true}),
    l('probe_stop','e0.5',{reason:'completed'})]);
  assert.equal(a.reports[0].sensorError,null);
  assert.equal(a.acceptance.final,'NOT_ACCEPTED_AUTOMATICALLY');
});
test('bad JSON and host mixing flagged',()=>{
  const a=analyze(['{broken',l('probe_start','e0.1'),
    JSON.stringify({type:'probe_stop',record:{hostRunId:'DIFFERENT',worldEpoch:'e',gameMs:500,
      probe:'e0.1',payload:{reason:'completed'}}})]);
  assert.ok(a.errors.some(x=>x.includes('invalid_json')));
  assert.ok(a.errors.some(x=>x.includes('mixed_host_epoch')));
});
test('sensor error uses only explicit independently labelled video ground truth',()=>{
  const a=analyze([l('probe_start','e0.5'),l('ground_truth','e0.5',{videoLabel:'pass'}),
    l('ground_truth','e0.5',{videoLabel:'fail'}),l('probe_stop','e0.5',{reason:'completed'})]);
  assert.equal(a.reports[0].sensorError,0.5);
});
