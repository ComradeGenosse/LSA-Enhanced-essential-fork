import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EpisodeCorrelator } from '../src/perception/episodeCorrelator.mjs';
import { EpisodeStore } from '../src/perception/episodeStore.mjs';
import { ObservationStore } from '../src/perception/observationStore.mjs';
import { validateClaim } from '../src/perception/contracts.mjs';
const fixture=()=>{
  const actor=randomUUID(),other=randomUUID(),vehicle=randomUUID(),run=randomUUID(),live=new Set([actor,other,vehicle]);
  const observations=new ObservationStore({now:()=>1,current:ref=>live.has(ref)}),episodes=new EpisodeStore({now:()=>1,current:ref=>live.has(ref)});
  const correlator=new EpisodeCorrelator({observations,episodes,now:()=>1,current:ref=>live.has(ref),anchor:ref=>({kind:ref===vehicle?'vehicle':'ped'})});
  const receipt=(observer=actor,channel='self',basis='sampled_state')=>({observer:{captureRef:observer,kind:'ped'},sampledGameTick:10,status:'witnessed',reason:'qualified_fixture',knowsTarget:true,evidence:{channel,basis,sampledGameTick:10}});
  const signal=(kind,facts,producer='state')=>({signalId:randomUUID(),producer,producerSequence:1,kind,target:actor,source:null,gameTick:10,ageMs:0,facts});
  const ingest=(value,r=receipt())=>correlator.ingest({nativeRun:run,signal:value,witnessReceipts:[r]});
  return {actor,other,vehicle,live,observations,signal,receipt,ingest};
};
test('qualified self detail variants preserve provenance and handler outcome without completion',()=>{
  for(const [kind,facts,producer,basis,field] of [
    ['action_callback',{action:'followtarget',succeeded:false},'action','native_callback','action'],
    ['location_changed',{location:'DOWNTOWN'},'state','sampled_state','location'],
    ['activity_changed',{activity:'walking'},'state','sampled_state','activity'],
  ]) {
    const f=fixture(),result=f.ingest(f.signal(kind,facts,producer),f.receipt(f.actor,'self',basis)),claim=result.observations[0].claims[0];
    assert.equal(validateClaim(claim),true);assert.equal(claim.details[field],facts[field]);assert.ok(claim.details.eventSignalId);assert.equal(Object.hasOwn(claim.details,'completed'),false);
    if(kind==='action_callback') assert.equal(claim.details.succeeded,false);
  }
});
test('visual subject knowledge cannot reveal destination, activity value or handler outcome',()=>{
  for(const [kind,facts,producer] of [['location_changed',{location:'DOWNTOWN'},'state'],['activity_changed',{activity:'walking'},'state'],['action_callback',{action:'waithere',succeeded:true},'action']]) {
    const f=fixture(),claim=f.ingest(f.signal(kind,facts,producer),f.receipt(f.other,'visual','sampled_state')).observations[0].claims[0];
    assert.deepEqual(Object.keys(claim.details).sort(),['eventSignalId','reason']);
  }
});
test('vehicle detail retains only qualified self state and retires with its vehicle reference',()=>{
  const f=fixture(),claim=f.ingest(f.signal('vehicle_transition',{vehicle:f.vehicle,driver:false})).observations[0].claims[0];
  assert.equal(claim.details.vehicle,f.vehicle);assert.equal(claim.details.driver,false);assert.equal(Object.hasOwn(claim.details,'passenger'),false);
  f.live.delete(f.vehicle);f.observations.expire();assert.equal(f.observations.entries.size,0);
});
test('healing and engine/speed changes cannot create injury or impact knowledge',()=>{
  const f=fixture();
  const healing=f.ingest(f.signal('injury_state',{health:100,armour:0,injured:false}));assert.equal(healing.accepted,true);assert.equal(healing.observations.length,0);
  const engine=f.ingest({...f.signal('vehicle_state',{engine:true,healthBand:10,speedBand:1,driver:null}),target:f.vehicle});assert.equal(engine.accepted,true);assert.equal(engine.observations.length,0);
});
test('unknown action/zone and stale sample keep generic provenance; arbitrary detail is rejected',()=>{
  const f=fixture(),generic=f.ingest(f.signal('action_callback',{action:'other',succeeded:true},'action'),f.receipt(f.actor,'self','native_callback')).observations[0].claims[0];
  assert.equal(Object.hasOwn(generic.details,'action'),false);
  assert.equal(validateClaim({...generic,details:{...generic.details,message:'invented outcome'}}),false);
  const r=f.receipt();r.sampledGameTick=9;r.evidence.sampledGameTick=9;
  const location=f.ingest(f.signal('location_changed',{location:'DOWNTOWN'}),r).observations[0].claims.at(-1);assert.equal(Object.hasOwn(location.details,'location'),false);
});
