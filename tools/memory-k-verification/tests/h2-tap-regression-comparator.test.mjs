import test from 'node:test';
import assert from 'node:assert/strict';
import {compareTapLogs} from '../compare-tap-regressions.mjs';

function tap(cases){
  const failed=cases.filter(x=>x.error);
  return ['TAP version 13',...cases.flatMap((x,i)=>[
    `${x.error?'not ok':'ok'} ${i+1} - ${x.name}`,
    ...(x.error?['  ---',`  error: '${x.error}'`,'  ...']:[])]),
    `1..${cases.length}`,`# tests ${cases.length}`,
    `# pass ${cases.length-failed.length}`,`# fail ${failed.length}`,
    '# cancelled 0','# skipped 0','# todo 0',''].join('\n');
}
const base=tap([{name:'S01',error:'SOURCE_BLOCKED_S01: original source unavailable'},
  {name:'concurrent write verified'}, {name:'S02',error:'SOURCE_BLOCKED_S02'}]);

test('keeps original source-blocked failures visible',()=>{
  const r=compareTapLogs(base,base);
  assert.equal(r.pass,true);
  assert.equal(r.report.inheritedFailures,2);
  assert.deepEqual(r.report.newFailures,[]);
});
test('rejects a newly failing test even with inherited failures',()=>{
  const changed=tap([{name:'S01',error:'SOURCE_BLOCKED_S01: original source unavailable'},
    {name:'concurrent write verified',error:'source was dropped'},
    {name:'S02',error:'SOURCE_BLOCKED_S02'}]);
  assert.equal(compareTapLogs(base,changed).pass,false);
});
test('rejects a changed failure reason under the same test name',()=>{
  const changed=tap([{name:'S01',error:'unexpected corrupted receipt'},
    {name:'concurrent write verified'}, {name:'S02',error:'SOURCE_BLOCKED_S02'}]);
  const r=compareTapLogs(base,changed);
  assert.equal(r.pass,false);
  assert.match(r.report.newFailures[0],/unexpected corrupted receipt/);
});
test('rejects missing tests or incomplete TAP output',()=>{
  const changed=tap([{name:'S01',error:'SOURCE_BLOCKED_S01: original source unavailable'},
    {name:'S02',error:'SOURCE_BLOCKED_S02'}]);
  assert.equal(compareTapLogs(base,changed).pass,false);
  assert.throws(()=>compareTapLogs(base,'TAP version 13\n'),/incomplete TAP/);
});
test('allows a baseline failure to be fixed',()=>{
  const improved=tap([{name:'S01'}, {name:'concurrent write verified'},
    {name:'S02',error:'SOURCE_BLOCKED_S02'}]);
  assert.equal(compareTapLogs(base,improved).pass,true);
});
