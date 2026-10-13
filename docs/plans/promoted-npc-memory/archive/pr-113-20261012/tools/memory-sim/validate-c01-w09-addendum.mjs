#!/usr/bin/env node
// Planning integrity only; NEVER a production C-01, S01-S10 or physical GTA pass.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const f=relative=>path.join(root,relative);
const cfg=JSON.parse(readFileSync(f('tools/memory-sim/closure-c01-w09-addendum.v1.json'),'utf8'));
const plan=readFileSync(f(cfg.planPath),'utf8');
const ids=new Set(cfg.streams.map(x=>x.id));
const gateIds=new Set(cfg.gates.map(x=>x.id));
const sha=/^[0-9a-f]{40}$/;
assert.equal(cfg.version,1);
assert.equal(cfg.status,'plan_only_no_source_implementation');
assert.equal(cfg.architecture.nativeAcceptedTurnCallbackExposed,false);
assert.equal(cfg.architecture.nativeOwnerRequired,true);
assert.equal(cfg.architecture.stableHumanPlayerIdentityAcrossAvatars,true);
assert.equal(cfg.architecture.singleP2SQLiteWriter,true);
assert.equal(cfg.architecture.onePS4Frame,true);
assert.equal(cfg.architecture.defaultFailClosed,true);
assert.equal(cfg.constraints.noFakeOriginalNativeAcceptedCallback,true);
assert.equal(cfg.constraints.noT1V2WithoutRealOriginalNativeProducer,true);
assert.equal(cfg.constraints.noMergeMain,true);
assert.equal(cfg.constraints.noGtaInstall,true);
assert.equal(cfg.constraints.noPaidCloud,true);
assert.equal(cfg.constraints.changeLegacyGeminiNames,false);
assert.deepEqual(cfg.architecture.avatarKeys.sort(),['franklin','michael','trevor','unknown']);
assert.equal(ids.size,7);
assert.deepEqual([...ids].sort(),['D01','D02','D03','D04','D05','D06','D07']);
assert.equal(gateIds.size,8);
assert.deepEqual([...gateIds].sort(),['A01a','A01b','A01c','A01d','A09a','A09b','A10','A11']);
assert.match(cfg.sourceRefs.t1AuditHead,sha);
assert.match(cfg.sourceRefs.t9Head,sha);
assert.match(cfg.sourceRefs.productionPlanHead,sha);
assert.ok(plan.includes('**Status: IMPLEMENTATION PLAN ONLY'));
assert.ok(plan.includes('OriginalBackendAcceptedInputV1'));
assert.ok(plan.includes('NativeCurrentPlayerAndOwnerV1'));
assert.ok(plan.includes('JoinedAcceptedPlayerTurnV1'));
assert.ok(plan.includes('source-simulation'));
assert.ok(cfg.t9Review.originalRunnerScenariosPassed===0);
assert.equal(cfg.t9Review.acceptance,'NO_GO');
assert.equal(cfg.t9Review.physicalGTA,'not_run');

const map=new Map(cfg.streams.map(x=>[x.id,x]));
const gates=new Map(cfg.gates.map(x=>[x.id,x]));
const visiting=new Set(),visited=new Set();
function visit(id){
  if(visited.has(id))return;
  assert.ok(!visiting.has(id),'dependency cycle: '+id);
  visiting.add(id);
  for(const dep of map.get(id).dependsOn){
    assert.ok(ids.has(dep),'missing dependency: '+id+' => '+dep);
    visit(dep);
  }
  visiting.delete(id);visited.add(id);
}
for(const task of cfg.streams){
  visit(task.id);
  assert.equal(task.status,'planned','plan PR must not claim implementation: '+task.id);
  assert.ok(plan.includes('### '+task.id+' '),'missing implementation section: '+task.id);
  assert.ok(task.existingAnchors.length>0);
  assert.equal(task.handoff.startsWith('docs/plans/promoted-npc-memory/closure-handoffs/'),true);
  // T9 code lives on separate unmerged PR #111, so do not mislabel absence
  // from this planning branch as missing implementation.
  for(const anchor of task.existingAnchors)
    assert.ok(typeof anchor==='string'&&anchor.length>8,'invalid source anchor');
  for(const id of task.gates){
    assert.ok(gateIds.has(id),'unknown gate '+id);
    assert.equal(gates.get(id).owner,task.id,'gate assigned to different workstream');
  }
}
for(const gate of cfg.gates){
  assert.equal(gate.status,'blocked','No acceptance gate may pass in a plan-only PR');
  assert.ok(ids.has(gate.owner));
}
assert.equal(cfg.architecture.nativeAcceptedTurnCallbackExposed,false);
console.log('C01+W09 PLAN VALID ONLY: 7 planned streams, 8 blocked acceptance gates,');
console.log('source-sim T9 success and original-runner S01-S10 still unaccepted.');
console.log('Not a runtime fix, no native C-01 accepted callback, no GTA GO.');
