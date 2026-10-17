import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityEngine } from '../src/activities/activityEngine.mjs';
import { validateAdmission } from '../src/activities/activityValidator.mjs';
import { ACT6_CAPABILITY_IDS, normalizeActivityConfig, validateFrame } from '../src/activities/contracts.mjs';
import { ACT6_INTENTS, planSpec, buildPlan } from '../src/activities/intentTemplates.mjs';
import { loadCapabilityRegistry } from '../src/activities/capabilityRegistry.mjs';
import { validateAct5Choice } from '../src/activities/act5Dialogue.mjs';

const registry = loadCapabilityRegistry();
const character = '11111111-1111-4111-8111-111111111111';
const encounter = '22222222-2222-4222-8222-222222222222';
const incarnation = '33333333-3333-4333-8333-333333333333';
const nativeRun = '44444444-4444-4444-8444-444444444444';
const adapterEpoch = '55555555-5555-4555-8555-555555555555';
const placeRef = '66666666-6666-4666-8666-666666666666';
const binding = () => ({characterId:character, ownerAlias:'promoted.'+character, ownershipToken:'77777777-7777-4777-8777-777777777777', encounterId:encounter, incarnationId:incarnation});
let seq = 0;
const id = () => '88888888-8888-4888-8888-' + String(++seq).padStart(12,'0');
const proposal = (intent, place={kind:'waypoint'}) => ({proposalVersion:1,proposalId:id(),source:'player_ux',subject:{characterId:character},intent,slots:{place},priority:'player_direct',origin:{},proposedAtMs:10000});
const probes = [...new Set(['walk_to','drive_to'].flatMap(capability => registry.get(capability).probes))];
const hello = {type:'hello', nativeRun,adapterEpoch,capabilities:{walk_to:true,drive_to:true,hold_position:true}};
function rig({gate=['walk_to','drive_to'],capabilities=hello.capabilities,mode='on',passed=probes}={}) {
  seq=0;
  const frames=[];
  const engine=new ActivityEngine({registry,config:normalizeActivityConfig({mode,act6Capabilities:gate,passedProbes:passed}),id,now:()=>10000,onCommand:frame=>frames.push(frame)});
  engine.noteHello({...hello,capabilities});
  return {engine,frames};
}
function pump(engine,frames) {
  const seen=[];
  for(let tries=0;frames.length && tries<30;tries++) {
    const frame=frames.shift();seen.push(frame);
    if(frame.type==='actor.acquire') engine.ingest({type:'actor.acquired',requestId:frame.requestId,encounterId:encounter,incarnationId:incarnation,leaseEpoch:1});
    else if(frame.type==='anchor.resolve') engine.ingest({type:'anchor.resolved',requestId:frame.requestId,results:[{role:'place',ref:placeRef,reason:null,label:'Player waypoint',distanceBand:'far'}]});
    else if(frame.type==='step.preflight') engine.ingest({type:'step.preflighted',requestId:frame.requestId,verdicts:[],alreadySatisfied:false,reason:null});
  }
  return seen;
}
function receipt(frame,state,epoch=1) {return {type:'receipt',receipt:{executionId:frame.executionId,capability:frame.capability, state, evidence:state==='PHYSICALLY_COMPLETED'?[{kind:'distance',strength:'strong',gameMs:123,detail:null}]:[], epochs:{nativeRun,adapterEpoch,leaseEpoch:epoch},milestones:{requestedGameMs:123}, reason:null}};}

test('ACT6 is not enabled by registry declaration, unsupported config or model-generated coordinates', () => {
  assert.deepEqual(ACT6_CAPABILITY_IDS,['walk_to','drive_to']);
  assert.equal(normalizeActivityConfig({mode:'on'}).act6Capabilities,undefined);
  assert.deepEqual(normalizeActivityConfig({act6Capabilities:['walk_to','walk_to','bogus',4]}).act6Capabilities,['walk_to']);
  assert.equal(rig({gate:[]}).engine.assign(proposal('go_to_place'),binding()).reason,'capability_disabled');
  assert.equal(rig({capabilities:{walk_to:false,drive_to:false}}).engine.assign(proposal('go_to_place'),binding()).reason,'capability_disabled');
  assert.equal(rig({mode:'shadow'}).engine.assign(proposal('go_to_place'),binding()).reason,'capability_disabled');
  assert.equal(rig({passed:[]}).engine.assign(proposal('go_to_place'),binding()).reason,'capability_disabled');
  assert.equal(rig().engine.assign(proposal('go_to_place',{kind:'coordinates',x:1,y:2,z:3}),binding()).reason,'policy_denied');
});
test('closed intent plans require actual destination and preserve ACT3 plus ACT5 consent', () => {
  assert.deepEqual(ACT6_INTENTS,['go_to_place','vehicle_trip','move_to_and_hold']);
  assert.deepEqual(planSpec('go_to_place',{place:{kind:'waypoint'}}).steps.map(s=>s.capability),['walk_to']);
  assert.deepEqual(planSpec('vehicle_trip',{place:{kind:'waypoint'}}).steps.map(s=>s.capability),['drive_to']);
  assert.deepEqual(planSpec('move_to_and_hold',{place:{kind:'waypoint'}}).steps.map(s=>s.capability),['walk_to','hold_position']);
  assert.equal(planSpec('vehicle_trip',{vehicle:{kind:'turn_alias',alias:'X'},place:{kind:'waypoint'}}).reason,'unsupported_combination');
  assert.equal(planSpec('go_to_place',{}).reason,'place_unresolved');
  assert.equal(buildPlan('go_to_place',{place:{kind:'waypoint'}},{id,registry}).steps[0].completion.adapter,'place_arrival');
  assert.equal(validateAct5Choice({intent:'go_to_place',slots:{place:{kind:'waypoint'}}},['go_to_place']),true);
  assert.equal(validateAct5Choice({intent:'go_to_place',slots:{place:{kind:'named',query:'airport'}}},['go_to_place']),false);
});
test('native waypoint resolution and execution flow do not complete on dispatch/accepted', () => {
  const {engine,frames}=rig();
  assert.equal(engine.assign(proposal('go_to_place'),binding()).ok,true);
  const seen=pump(engine,frames);
  const resolve=seen.find(f=>f.type==='anchor.resolve');
  assert.deepEqual(resolve.refs,[{role:'place',slot:{kind:'place',place:{kind:'waypoint'}}}]);
  const begin=seen.find(f=>f.type==='step.begin');
  assert.equal(begin.capability,'walk_to');
  assert.deepEqual(begin.args.place,{kind:'place',placeRef});
  engine.ingest(receipt(begin,'HANDLER_ACCEPTED'));
  assert.equal(engine.activities[0].status,'running');
  engine.ingest(receipt(begin,'MODE_ESTABLISHED'));
  assert.notEqual(engine.activities[0].status,'completed');
  engine.ingest(receipt(begin,'PHYSICALLY_COMPLETED',99));
  assert.notEqual(engine.activities[0].status,'completed','stale lease must never complete an ACT6 task');
  engine.ingest(receipt(begin,'PHYSICALLY_COMPLETED'));
  assert.equal(engine.activities[0].status,'completed');
});
test('driving cannot run unless driver capability and native route adapter are both exposed', () => {
  const partial=rig({gate:['walk_to']});
  assert.equal(partial.engine.assign(proposal('vehicle_trip'),binding()).reason,'capability_disabled');
  const {engine,frames}=rig();
  assert.equal(engine.assign(proposal('vehicle_trip'),binding()).ok,true);
  const begin=pump(engine,frames).find(f=>f.type==='step.begin');
  assert.equal(begin.capability,'drive_to');
  assert.equal(begin.completion.adapter,'drive_arrival');
});
test('multi-step arrival does not complete the whole activity and resolves a fresh hold destination', () => {
  const {engine,frames}=rig({capabilities:{...hello.capabilities},passed:[...new Set([...probes,'Q1','FR1'])]});
  assert.equal(engine.assign(proposal('move_to_and_hold'),binding()).ok,true);
  const begin=pump(engine,frames).find(f=>f.type==='step.begin');
  engine.ingest(receipt(begin,'PHYSICALLY_COMPLETED'));
  assert.notEqual(engine.activities[0].status,'completed');
  const next=frames.find(f=>f.type==='anchor.resolve');
  assert.ok(next && next.refs[0].slot.place.kind==='here');
});
test('ACT6 place frame accepts bounded waypoint and named query, refuses injected world coordinates', () => {
  const base={version:1,type:'anchor.resolve',sequence:1,requestId:id(),encounterId:encounter,leaseId:id()};
  assert.equal(validateFrame({...base,refs:[{role:'place',slot:{kind:'place',place:{kind:'waypoint'}}}]}),true);
  assert.equal(validateFrame({...base,refs:[{role:'place',slot:{kind:'place',place:{kind:'named',query:'airport'}}}]}),true);
  assert.equal(validateFrame({...base,refs:[{role:'place',slot:{kind:'place',place:{kind:'coord',x:0,y:0,z:0}}}]}),false);
});
