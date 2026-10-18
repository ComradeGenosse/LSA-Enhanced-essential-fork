import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectGameplayMenuReadiness } from '../src/activities/navigationReadiness.mjs';

function sample() {
  const probes=['Q1','F1','V1','V2','V3','V4','SVE1','NV1','NV2','FR1','Q2','L1','D1','D2','D3','A1','S1'];
  const ids=['approach_person','stop_and_face','enter_vehicle_seat','exit_vehicle','hold_position','walk_away_from','resume_ambient','take_cover','scenario_here','drive_to','walk_to'];
  const registry=new Map(ids.map(id=>[id,{id,phase:['drive_to','walk_to'].includes(id)?'ACT6':['hold_position','resume_ambient'].includes(id)?'ACT2':'ACT3',probes:id==='drive_to'?['NV2','D1']:['Q1'],
    execution:{path:'queue'},allowedSources:['player_ux','player_dialogue'],allowedPriority:['player_direct']}]));
  const config={mode:'on',act3Capabilities:ids.filter(id=>registry.get(id).phase==='ACT3'),act6Capabilities:['drive_to','walk_to'],passedProbes:probes};
  const hello={nativeRun:'native-1',adapterEpoch:5,capabilities:Object.fromEntries(ids.map(id=>[id,true]))};
  const activities={engine:{config,hello,registry},client:{runtime:{ready:true,nativeRun:'native-1',adapterEpoch:5}}};
  return {activities,config};
}
test('F11 readiness requires opt-in, registry, native hello, probes and correct source',()=>{
  const {activities,config}=sample();
  const ready=inspectGameplayMenuReadiness(activities,config);
  assert.equal(ready.drive.eligibleForPreflight,true);
  assert.equal(ready.walk.eligibleForPreflight,true);
  assert.equal(ready.act3.board_vehicle.eligibleForPreflight,true);
  assert.equal(ready.act3.approach_and_face.eligibleForPreflight,true);
  const originalProbes=[...config.passedProbes],originalAct3=[...config.act3Capabilities];
  activities.engine.config.passedProbes=['Q1'];
  assert.equal(inspectGameplayMenuReadiness(activities,config).drive.reason,'native_probes_missing');
  activities.engine.config.passedProbes=originalProbes;
  activities.engine.config.act3Capabilities=[];
  assert.equal(inspectGameplayMenuReadiness(activities,config).act3.board_vehicle.reason,'capability_disabled');
  activities.engine.config.act3Capabilities=originalAct3;
  activities.client.runtime.ready=false;
  assert.equal(inspectGameplayMenuReadiness(activities,config).act3.board_vehicle.reason,'native_unavailable');
});
test('F11 readiness reports eligibility only, never a physical completion',()=>{
  const {activities,config}=sample();
  const value=inspectGameplayMenuReadiness(activities,config);
  assert.equal(value.drive.eligibleForPreflight,true);
  assert.equal(Object.hasOwn(value.drive,'completed'),false);
  assert.equal(Object.hasOwn(value.act3.board_vehicle,'arrived'),false);
  activities.engine.hello.capabilities.enter_vehicle_seat=false;
  assert.equal(inspectGameplayMenuReadiness(activities,config).act3.board_vehicle.reason,'native_capability_missing');
});
