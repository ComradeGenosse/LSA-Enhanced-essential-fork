#!/usr/bin/env node
// Static implementation-plan integrity only: NEVER a runtime/GTA acceptance test.
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>JSON.parse(readFileSync(path.join(root,name),'utf8'));
const manifest=read('tools/memory-sim/closure-workstreams.v1.json');
const m0=read('tools/memory-sim/scenarios.v0.json');
const plan=readFileSync(path.join(root,manifest.planPath),'utf8');
const sha=/^[a-f0-9]{40}$/;

assert.equal(manifest.version,1);
assert.equal(manifest.kind,'memory_k_production_closure_workstreams');
assert.equal(manifest.status,'plan_only_no_feature_acceptance');
assert.match(manifest.base.headSha,sha);
assert.equal(manifest.base.pr,94);
assert.equal(manifest.approval.mergeToMain,false);
assert.equal(manifest.approval.gtaInstalled,false);
assert.equal(manifest.approval.physicalGtaReceipts,false);
assert.equal(manifest.approval.automaticCloudUsage,false);
assert.ok(['NO_GO','GO'].includes(manifest.approval.controlledGtaTesting));
assert.match(plan,/PLAN ONLY \/ NOT IMPLEMENTED \/ CONTROLLED GTA NO-GO/);

const unique=(arr,label)=>{
  assert.equal(new Set(arr).size,arr.length,label+' contains duplicates');
  return new Set(arr);
};
const tasks=manifest.workstreams;
const taskIds=unique(tasks.map(x=>x.id),'workstream IDs');
const gateIds=unique(manifest.gates.map(x=>x.id),'acceptance gate IDs');
assert.deepEqual([...taskIds].sort(),
  Array.from({length:11},(_,i)=>'W'+String(i).padStart(2,'0')));
assert.deepEqual([...gateIds].sort(),
  Array.from({length:12},(_,i)=>'A'+String(i).padStart(2,'0')));
const byId=new Map(tasks.map(x=>[x.id,x]));
const byGate=new Map(manifest.gates.map(x=>[x.id,x]));
const kExclusive=unique(manifest.kExclusiveFiles,'K exclusive files');
const codeOwners=new Map();
for(const pathname of kExclusive){
  assert.ok(pathname&&typeof pathname==='string'&&
    existsSync(path.join(root,pathname)),'Missing K-owned file: '+pathname);
}
for(const w of tasks){
  assert.match(w.id,/^W(?:0\d|10)$/);
  assert.ok(Number.isSafeInteger(w.phase)&&w.phase>=0&&w.phase<=5);
  assert.equal(w.owner,w.id==='W00'||w.id==='W10'?'K':'T'+Number(w.id.slice(1)));
  assert.ok(['planned','in_progress','source_reviewed','offline_verified'].includes(w.status),
    'Invalid work status '+w.id);
  assert.match(w.handoff,/^docs\/plans\/promoted-npc-memory\/closure-handoffs\/PRODUCTION-W(?:0\d|10)\.md$/);
  assert.ok(plan.includes('### '+w.id+' '),'Plan missing task section '+w.id);
  assert.ok(w.existingAnchors.length>0,'Task has no grounded code anchors '+w.id);
  for(const anchor of w.existingAnchors)
    assert.ok(existsSync(path.join(root,anchor)),
      'Code anchor unavailable (revise plan to actual source): '+anchor);
  for(const dep of w.dependsOn){
    assert.ok(taskIds.has(dep),'Undefined prerequisite '+w.id+' -> '+dep);
    assert.notEqual(dep,w.id,'Self cycle: '+w.id);
    assert.ok(byId.get(dep).phase<=w.phase,'Dependency on a later phase: '+w.id+' -> '+dep);
  }
  unique(w.dependsOn,w.id+' dependencies');
  assert.ok(w.gates.length>0);
  unique(w.gates,w.id+' gates');
  for(const gate of w.gates){
    assert.ok(gateIds.has(gate),'Unknown gate '+gate);
    assert.equal(byGate.get(gate).owner,w.id,'Gate assigned to wrong owner');
  }
  assert.ok(Array.isArray(w.exclusiveWritePaths),'Missing explicit file ownership '+w.id);
  for(const own of w.exclusiveWritePaths){
    assert.ok(!kExclusive.has(own),'Specialist claims shared K-only file '+own);
    assert.ok(!codeOwners.has(own),
      'Conflicting specialist write owners for '+own+': '+codeOwners.get(own)+', '+w.id);
    codeOwners.set(own,w.id);
  }
  if(w.status==='source_reviewed'||w.status==='offline_verified'){
    assert.match(w.implementationSha||'',sha,'Reviewed implementation must have exact commit');
    assert.ok(Number.isSafeInteger(w.prNumber)&&w.prNumber>=1,
      'Reviewed implementation requires a real PR');
  }
  if(w.status==='offline_verified')
    assert.ok(typeof w.offlineReceiptUrl==='string'&&
      w.offlineReceiptUrl.startsWith('https://github.com/'),
      'Offline verified status needs exact workflow proof');
}
for(const gate of manifest.gates)
  assert.ok(taskIds.has(gate.owner),'Gate lacks workstream '+gate.id);
const visiting=new Set(),visited=new Set();
function visit(id){
  if(visited.has(id))return;
  assert.ok(!visiting.has(id),'Dependency cycle at '+id);
  visiting.add(id);
  for(const next of byId.get(id).dependsOn)visit(next);
  visiting.delete(id);
  visited.add(id);
}
for(const id of taskIds)visit(id);

const scenarioIds=m0.scenarios.map(x=>x.id);
unique(scenarioIds,'original M0 scenarios');
assert.deepEqual([...scenarioIds].sort(),
  Array.from({length:10},(_,i)=>'S'+String(i+1).padStart(2,'0')));
assert.deepEqual(Object.keys(manifest.acceptanceScenarios).sort(),[...scenarioIds].sort());
for(const [id,coverage] of Object.entries(manifest.acceptanceScenarios)){
  assert.ok(coverage.length>=3,'No cross-source replay plan '+id);
  unique(coverage,id+' coverage');
  assert.ok(coverage.includes('W09')&&coverage.includes('W10'),
    'Scenario missing harness and final integration '+id);
  for(const w of coverage)assert.ok(taskIds.has(w),'Scenario '+id+' unknown task '+w);
}
const implemented=m0.scenarios.filter(x=>x.implemented===true);
if(implemented.length){
  for(const scenario of implemented){
    assert.match(scenario.acceptanceSha||'',sha,
      'Completed scenario requires exact integration SHA: '+scenario.id);
    assert.ok(typeof scenario.receiptPath==='string'&&
      existsSync(path.join(root,scenario.receiptPath)),
      'Scenario lacks real replay receipt '+scenario.id);
  }
}
if(manifest.approval.controlledGtaTesting==='GO'){
  assert.equal(implemented.length,10,'Cannot GO without all ten integrated M0 scenarios');
  assert.equal(manifest.approval.evidenceStatus,'verified_exact_head');
  assert.match(manifest.approval.finalHeadSha||'',sha);
  for(const w of tasks)assert.equal(w.status,'offline_verified',
    'GO requires every workstream verified on final head');
}
console.log('PLAN STRUCTURE VALID ONLY — '+tasks.length+' workstreams, '+
  manifest.gates.length+' gates and '+scenarioIds.length+' original scenarios.');
console.log('This validation makes NO claim that source code, native builds, GTA or M0 replays passed.');
