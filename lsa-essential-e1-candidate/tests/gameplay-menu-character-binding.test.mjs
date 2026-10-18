import test from 'node:test';
import assert from 'node:assert/strict';
import {CharacterService} from '../src/characters/characterService.mjs';

const id='11111111-1111-4111-8111-111111111111';
const owner='promoted.'+id;
const encounter='22222222-2222-4222-8222-222222222222';
const token='33333333-3333-4333-8333-333333333333';
const incarnation='44444444-4444-4444-8444-444444444444';
function fixture(){
  let selected='some-other-ambient-npc',currentToken=token;
  let nativeRoster={owned:[{ownerAlias:owner,status:'spawned'}]};
  const telemetryEvents=[];
  const calls=[],assignments=[];
  const binding=()=>({encounterId:encounter,ownerAlias:owner,ownershipToken:currentToken,claim:{incarnationId:incarnation},activityOffer:{safe:true}});
  const store={available:true,get:characterId=>characterId===id?{characterId:id,promotion:{ownerAlias:owner}}:null,
    list:()=>[{characterId:id,promotion:{ownerAlias:owner}}]};
  const nativeOwner={async request(operation,args){
    calls.push({operation,args});
    if(operation==='roster') {if(nativeRoster instanceof Error) throw nativeRoster;return nativeRoster;}
    if(operation==='inspect') {assert.equal(args.ownerAlias,owner);return binding();}
    if(operation==='capture') return {encounterId:selected,ownerAlias:'ambient',pedId:'9'};
    throw new Error('unexpected_native_request');
  }};
  const config={promotedCharacters:{storageMode:'json',storePath:'fake.json'},persistentIdentity:{worldProfileId:id,storePath:'different.json'}};
  const service=new CharacterService(config,{store,nativeOwner,telemetry:{emit:(event,identity,source,data)=>telemetryEvents.push({event,data})}});
  service.initialize=async()=>true;
  service.ready=true;
  service.bindActivities({engine:{config:{mode:'on'}},
    assign(proposal,actor){assignments.push({proposal,actor});return {ok:true,status:'accepted'};},
    status:characterId=>({characterId,stage:'running'}),
    history:characterId=>[{characterId}]});
  return {service,calls,assignments,telemetryEvents,setRoster:value=>{nativeRoster=value},setToken:value=>{currentToken=value},setSelection:value=>{selected=value}};
}
test('F11 roster binding is an authenticated owner + incarnation, not a ped handle',async()=>{
  const {service,calls}=fixture();
  const lease=await service.activityBinding(id);
  assert.deepEqual(lease,{characterId:id,ownerAlias:owner,encounterId:encounter,ownershipToken:token,safe:true});
  assert.deepEqual(calls.map(x=>x.operation),['inspect']);
});
test('roster character ACT dispatch never asks for currently selected ambient NPC',async()=>{
  const {service,calls,assignments,setSelection}=fixture();
  const lease=await service.activityBinding(id);
  setSelection('unrelated');
  const result=await service.activity('assign',{characterId:id,expectedEncounterId:lease.encounterId,
    expectedOwnershipToken:lease.ownershipToken,intent:'hold_position',slots:{}});
  assert.equal(result.ok,true);
  assert.equal(assignments.length,1);
  assert.equal(assignments[0].actor.ownerAlias,owner);
  assert.equal(assignments[0].actor.ownershipToken,token);
  assert.deepEqual(calls.map(x=>x.operation),['inspect','inspect']);
});
test('changing the native incarnation before F11 submit rejects stale action',async()=>{
  const {service,setToken,assignments}=fixture();
  const lease=await service.activityBinding(id);
  setToken('55555555-5555-4555-8555-555555555555');
  await assert.rejects(service.activity('assign',{characterId:id,expectedEncounterId:lease.encounterId,
    expectedOwnershipToken:lease.ownershipToken,intent:'vehicle_trip',slots:{place:{kind:'waypoint'}}}),/target_changed/);
  assert.equal(assignments.length,0);
});
test('invalid or absent native leases never fall back to current NPC',async()=>{
  const {service,calls}=fixture();
  await assert.rejects(service.activity('assign',{characterId:id,expectedEncounterId:encounter,
    intent:'hold_position',slots:{}}),/native_stale/);
  await assert.rejects(service.activity('status',{characterId:'invalid-id',expectedEncounterId:encounter,
    expectedOwnershipToken:token}),/native_stale/);
  assert.equal(calls.length,0);
});

test('F11 list marks failed native roster unverified, not absent, and logs recovery',async()=>{
  const {service,setRoster,telemetryEvents}=fixture();
  assert.equal((await service.list())[0].runtimeStatus,'spawned');
  setRoster(new Error('native timeout'));
  assert.equal((await service.list())[0].runtimeStatus,'unverified');
  assert.equal((await service.list())[0].runtimeStatus,'unverified');
  setRoster({owned:[{ownerAlias:owner,status:'suspended'}]});
  assert.equal((await service.list())[0].runtimeStatus,'suspended');
  assert.deepEqual(telemetryEvents.filter(e=>e.event==='character_roster_status').map(e=>e.data.rosterState),
    ['active','unavailable','active']);
});
test('invalid native roster cannot masquerade as an empty roster',async()=>{
  const {service,setRoster}=fixture();
  setRoster({owned:[{ownerAlias:owner,status:'invented'}]});
  assert.equal((await service.list())[0].runtimeStatus,'unverified');
  setRoster({owned:[]});
  assert.equal((await service.list())[0].runtimeStatus,'absent',
    'persisted profile state cannot impersonate a currently spawned native owner');
});
