import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EpisodeCorrelator} from '../src/perception/episodeCorrelator.mjs';
import {EpisodeStore} from '../src/perception/episodeStore.mjs';
import {ObservationStore} from '../src/perception/observationStore.mjs';
import {SalienceCache,normalizeSalienceSituation} from '../src/perception/salienceEngine.mjs';
import {selectDirectorIntent} from '../src/perception/sceneDirector.mjs';

// Real PS2 and PS3 modules with source-shaped *offline* native fixtures.
// The final original P2/C-06/native witness receipt still needs real GTA proof.
const NOW=10000;
function fixture(){
 const run=randomUUID(),speaker=randomUUID(),player=randomUUID(),
   victim=randomUUID(),vehicle=randomUUID();
 const anchors=new Map([[speaker,{captureRef:speaker,kind:'ped'}],
  [player,{captureRef:player,kind:'player'}],
  [victim,{captureRef:victim,kind:'ped'}],
  [vehicle,{captureRef:vehicle,kind:'vehicle'}]]);
 const current=ref=>anchors.has(ref),now=()=>NOW;
 const observations=new ObservationStore({now,current});
 const episodes=new EpisodeStore({now,current});
 const correlator=new EpisodeCorrelator({episodes,observations,now,current,
   anchor:ref=>anchors.get(ref),utc:()=>new Date(0).toISOString()});
 const salience=new SalienceCache();
 const situation=normalizeSalienceSituation({nowMonotonicMs:NOW,playerCaptureRef:player,
   lifetimeCurrent:true,channelHealthy:true,perceptionSupported:true});
 const facts={speakerCaptureRef:speaker,playerCaptureRef:player,nowMonotonicMs:NOW};
 return {run,speaker,player,victim,vehicle,anchors,observations,correlator,
   salience,situation,facts};
}
function signal(kind,producer,source,target,facts={}){
 return {signalId:randomUUID(),producer,producerSequence:1,
   kind,source,target,gameTick:100,ageMs:0,facts};
}
function witness(speaker){
 return {observer:{captureRef:speaker,kind:'ped'},sampledGameTick:100,
   status:'witnessed',reason:'visual_clear',knowsSource:false,knowsTarget:true,
   evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:100}};
}
function admitOffline(f,raw,receipts){
 const result=f.correlator.ingest({nativeRun:f.run,signal:raw,witnessReceipts:receipts});
 const observation=result.observations?.[0];
 if(!observation)return {result,observation:null,decision:null,proposal:null};
 const decision=f.salience.evaluate(observation,f.situation);
 const sidecar=f.observations.entries.get(f.speaker+':'+observation.episodeId);
 const candidate={observation,decision,situation:f.situation,entitlementCurrent:true,
   observedAtMonotonicMs:sidecar?.observedAtMonotonicMs};
 return {result,observation,decision,proposal:selectDirectorIntent([candidate],f.facts)};
}
test('source-shaped shooting signal with original visual witness reaches PS3 and 13a selection',()=>{
 const f=fixture();
 const r=admitOffline(f,signal('firing','shooting',f.player,null),[witness(f.speaker)]);
 assert.equal(r.result.accepted,true);
 assert.equal(r.observation.eventType,'firing_burst');
 assert.equal(r.observation.claims[0].evidence.channel,'visual');
 assert.equal(r.decision.response,'eligible');
 assert.equal(r.proposal?.kind,'speech');
 assert.equal(r.proposal?.speakerCaptureRef,f.speaker);
});
test('sampled player injury and witnessed NPC death have distinct PS2/PS3/PS6 paths',()=>{
 for(const [kind,target,eventType] of [['injury_state','player','injury'],
                                      ['death','victim','death_seen']]){
  const f=fixture();
  const raw=signal(kind,'state',null,f[target],kind==='injury_state'?
    {health:75,armour:0,injured:true}:{});
  const r=admitOffline(f,raw,[witness(f.speaker)]);
  assert.equal(r.observation?.eventType,eventType,kind);
  assert.equal(r.decision?.response,'eligible',kind);
  assert.equal(r.proposal?.kind,'speech',kind);
 }
});
test('damage and vehicle callbacks lacking source-time witness cannot manufacture 13a speech',()=>{
 for(const [producer,kind,target,source] of [
  ['ped_damage','damage','victim','player'],
  ['player_damage','damage','player','victim'],
  ['vehicle_damage','vehicle_damage','vehicle','player']]){
  const f=fixture();
  const r=admitOffline(f,signal(kind,producer,f[source],f[target],
    {damage:25,armour:0,classification:'collision'}),[]);
  assert.equal(r.result.accepted,true,producer);
  assert.equal(r.result.observations.length,0,producer);
  assert.equal(r.decision,null,producer);
  assert.equal(r.proposal,null,producer);
 }
});
test('body_found and generic threat are NOT synthesized by unsupported raw producer kinds',()=>{
 for(const kind of ['body_found','threat']){
  const f=fixture();
  const r=admitOffline(f,signal(kind,'state',null,f.victim),[witness(f.speaker)]);
  assert.equal(r.result.accepted,false,kind);
  assert.equal(r.result.reason,'unsupported_event',kind);
  assert.equal(r.proposal,null,kind);
 }
});
test('PS2 duplicate gunfire evidence does not generate a second observation or entitlement',()=>{
 const f=fixture(),raw=signal('firing','shooting',f.player,null);
 const first=admitOffline(f,raw,[witness(f.speaker)]);
 const second=admitOffline(f,raw,[witness(f.speaker)]);
 assert.equal(first.proposal?.kind,'speech');
 assert.equal(second.result.duplicate,true);
 assert.equal(second.proposal,null);
});
