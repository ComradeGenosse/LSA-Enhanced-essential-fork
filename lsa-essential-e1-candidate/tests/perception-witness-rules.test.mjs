import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { evaluateWitness, reportEvidence } from '../src/perception/witnessPolicy.mjs';
import { EpisodeCorrelator } from '../src/perception/episodeCorrelator.mjs';
import { EpisodeStore } from '../src/perception/episodeStore.mjs';
import { ObservationStore } from '../src/perception/observationStore.mjs';
import { validateWitnessReceipt } from '../src/perception/contracts.mjs';

test('visual, auditory and report evidence keep source, sound and hearsay boundaries distinct',()=>{
  const observer=randomUUID(),source=randomUUID(),target=randomUUID();
  const visual=evaluateWitness({event:{kind:'firing'},observer:{captureRef:observer},source:{},target:{},sample:{gameTick:20,distanceMeters:50,sameInterior:true,occlusion:'clear',facing:'in_cone'}});
  assert.equal(visual.status,'witnessed');assert.equal(visual.evidence.channel,'visual');
  assert.equal(evaluateWitness({event:{kind:'firing'},observer:{captureRef:observer},sample:{gameTick:21,distanceMeters:2,sameInterior:true,occlusion:'blocked',facing:'in_cone'}}).status,'did_not_witness');
  assert.equal(evaluateWitness({event:{kind:'firing'},observer:{captureRef:observer},sample:{gameTick:22,distanceMeters:2,sameInterior:true,occlusion:'unknown',facing:'in_cone'}}).status,'unknown');
  const self=evaluateWitness({event:{kind:'damage',targetCaptureRef:observer},observer:{captureRef:observer},sample:{gameTick:23}});
  assert.equal(self.evidence.channel,'self');
  const sound=evaluateWitness({event:{kind:'sound',soundKind:'gunshot'},observer:{captureRef:observer},sample:{gameTick:24,distanceMeters:20,soundSourceVerified:true,sameAcousticSpace:true,sourceVehicle:'on_foot',observerVehicle:'on_foot',acousticPath:'clear'}});
  assert.equal(sound.evidence.channel,'auditory');
  const uncertainSound=evaluateWitness({event:{kind:'sound',soundKind:'gunshot'},observer:{captureRef:observer},sample:{gameTick:25,distanceMeters:3,soundSourceVerified:false}});
  assert.equal(uncertainSound.status,'unknown');
  const report=reportEvidence({speakerCaptureRef:source,observerCaptureRef:observer,sampledGameTick:26,reportRef:randomUUID()});
  assert.equal(report.status,'reported');assert.equal(report.evidence.channel,'report');
  assert.equal(reportEvidence({speakerCaptureRef:observer,observerCaptureRef:observer,sampledGameTick:26,reportRef:randomUUID()}).status,'unknown');
  assert.ok(target);
});

test('episode correlation emits observer-qualified revisions, preserves uncertainty, and replays idempotently',()=>{
  let now=100;const run=randomUUID(),observer=randomUUID(),speaker=randomUUID(),victim=randomUUID();
  const live=new Set([observer,speaker,victim]);const anchors=new Map([observer,speaker,victim].map((captureRef,i)=>[captureRef,{captureRef,kind:i===2?'player':'ped'}]));
  const episodes=new EpisodeStore({now:()=>now,current:ref=>live.has(ref)}),observations=new ObservationStore({now:()=>now,current:ref=>live.has(ref)});
  const correlator=new EpisodeCorrelator({episodes,observations,now:()=>now,current:ref=>live.has(ref),anchor:ref=>anchors.get(ref),utc:()=>new Date(0).toISOString()});
  const witness={observer:{captureRef:observer,kind:'ped'},sampledGameTick:100,status:'witnessed',reason:'audibility_model',evidence:{channel:'auditory',basis:'audibility_model',sampledGameTick:100},knowsSource:false,knowsTarget:false};
  const signal={signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:speaker,gameTick:100,ageMs:0,facts:{}};
  const first=correlator.ingest({nativeRun:run,signal,witnessReceipts:[witness]});
  assert.equal(first.observations.length,1);assert.equal(first.observations[0].claims[0].source,undefined);assert.equal(first.observations[0].claims[0].evidence.channel,'auditory');
  const replay=correlator.ingest({nativeRun:run,signal,witnessReceipts:[witness]});assert.equal(replay.duplicate,true);assert.equal(replay.observations.length,0);
  now+=1000;
  const next={...signal,signalId:randomUUID(),producerSequence:2,gameTick:1100};
  const continuation=correlator.ingest({nativeRun:run,signal:next,witnessReceipts:[{...witness,sampledGameTick:1100,evidence:{...witness.evidence,sampledGameTick:1100}}]});
  assert.equal(continuation.episodeId,first.episodeId);assert.equal(continuation.observations[0].revision,2);assert.equal(continuation.observations[0].claims.length,2);
  live.delete(observer);observations.expire();assert.equal(observations.entries.size,0);
});


test('sampled injury, callback damage and death correlate as one victim-scoped harm episode without inventing causality',()=>{
  let now=100;const run=randomUUID(),observer=randomUUID(),attacker=randomUUID(),victim=randomUUID();
  const live=new Set([observer,attacker,victim]);const anchors=new Map([[observer,{captureRef:observer,kind:'ped'}],[attacker,{captureRef:attacker,kind:'ped'}],[victim,{captureRef:victim,kind:'ped'}]]);
  const episodes=new EpisodeStore({now:()=>now,current:ref=>live.has(ref)}),observations=new ObservationStore({now:()=>now,current:ref=>live.has(ref)});
  const correlator=new EpisodeCorrelator({episodes,observations,now:()=>now,current:ref=>live.has(ref),anchor:ref=>anchors.get(ref),utc:()=>new Date(0).toISOString()});
  const visual=tick=>({observer:{captureRef:observer,kind:'ped'},sampledGameTick:tick,status:'witnessed',reason:'visual_clear',evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:tick},knowsTarget:true});
  const injury={signalId:randomUUID(),producer:'state',producerSequence:1,kind:'injury_state',target:victim,source:null,gameTick:100,ageMs:0,facts:{health:80,armour:0,injured:true}};
  const first=correlator.ingest({nativeRun:run,signal:injury,witnessReceipts:[visual(100)]});
  assert.equal(first.accepted,true);assert.equal(first.observations[0].eventType,'injury');assert.equal(first.observations[0].claims[0].kind,'injured');assert.equal(first.observations[0].claims[0].target.captureRef,victim);
  now+=500;
  const damage={signalId:randomUUID(),producer:'ped_damage',producerSequence:1,kind:'damage',target:victim,source:attacker,gameTick:600,ageMs:0,facts:{damage:20,armour:0,classification:'bullet'}};
  const second=correlator.ingest({nativeRun:run,signal:damage,witnessReceipts:[{...visual(600),knowsSource:true}]});
  assert.equal(second.episodeId,first.episodeId);
  now+=500;
  const death={signalId:randomUUID(),producer:'state',producerSequence:2,kind:'death',target:victim,source:null,gameTick:1100,ageMs:0,facts:{}};
  const third=correlator.ingest({nativeRun:run,signal:death,witnessReceipts:[visual(1100)]});
  assert.equal(third.episodeId,first.episodeId);assert.equal(third.observations[0].eventType,'death_seen');
  assert.deepEqual(third.observations[0].claims.map(c=>c.kind),['injured','injured','dead']);
  const episode=episodes.entries.get(first.episodeId);
  assert.deepEqual(new Set(episode.participants.map(p=>p.captureRef)),new Set([attacker,victim]));
  const deadClaim=episode.claims.at(-1);assert.equal(deadClaim.kind,'dead');assert.equal(deadClaim.source,undefined);assert.equal(deadClaim.target.captureRef,victim);
});

test('reported evidence passes the closed contract and remains hearsay in observer knowledge',()=>{
  let now=100;const run=randomUUID(),observer=randomUUID(),speaker=randomUUID();
  const live=new Set([observer,speaker]);const anchors=new Map([[observer,{captureRef:observer,kind:'ped'}],[speaker,{captureRef:speaker,kind:'ped'}]]);
  const episodes=new EpisodeStore({now:()=>now,current:ref=>live.has(ref)}),observations=new ObservationStore({now:()=>now,current:ref=>live.has(ref)});
  const correlator=new EpisodeCorrelator({episodes,observations,now:()=>now,current:ref=>live.has(ref),anchor:ref=>anchors.get(ref),utc:()=>new Date(0).toISOString()});
  const raw=reportEvidence({speakerCaptureRef:speaker,observerCaptureRef:observer,sampledGameTick:100,reportRef:randomUUID()});
  const report={...raw,observer:{captureRef:observer,kind:'ped'},sampledGameTick:100};
  assert.equal(validateWitnessReceipt(report),true);
  const signal={signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:speaker,gameTick:100,ageMs:0,facts:{}};
  const result=correlator.ingest({nativeRun:run,signal,witnessReceipts:[report]});
  assert.equal(result.observations.length,1);
  const claim=result.observations[0].claims[0];
  assert.equal(claim.kind,'report');assert.equal(claim.evidence.channel,'report');assert.equal(claim.evidence.reportRef,report.evidence.reportRef);
  assert.equal(claim.source,undefined);assert.equal(claim.target,undefined);
});

test('PS2 native bullet callback joins only a recent same-observer visually seen shooter',()=>{
 let now=1000;const run=randomUUID(),observer=randomUUID(),player=randomUUID(),victim=randomUUID();
 const live=new Set([observer,player,victim]),anchors=new Map([
   [observer,{captureRef:observer,kind:'ped'}],
   [player,{captureRef:player,kind:'player'}],
   [victim,{captureRef:victim,kind:'ped'}]]);
 const episodes=new EpisodeStore({now:()=>now,current:ref=>live.has(ref)});
 const observations=new ObservationStore({now:()=>now,current:ref=>live.has(ref)});
 const correlation=new EpisodeCorrelator({episodes,observations,now:()=>now,
   current:ref=>live.has(ref),anchor:ref=>anchors.get(ref),utc:()=>new Date(0).toISOString()});
 const sight=(tick,knowsSource,knowsTarget)=>({
   observer:{captureRef:observer,kind:'ped'},sampledGameTick:tick,status:'witnessed',
   reason:'visual_clear',knowsSource,knowsTarget,
   evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:tick}});
 const fire={signalId:randomUUID(),producer:'shooting',producerSequence:1,
   kind:'firing',source:player,target:null,gameTick:1000,ageMs:0,facts:{}};
 const seen=correlation.ingest({nativeRun:run,signal:fire,witnessReceipts:[sight(1000,true,false)]});
 assert.equal(seen.observations[0].claims[0].source.kind,'player');
 now=1200;
 const damage={signalId:randomUUID(),producer:'ped_damage',producerSequence:1,
   kind:'damage',source:player,target:victim,gameTick:1200,ageMs:0,
   facts:{classification:'bullet',damage:15,armour:0}};
 const hit=correlation.ingest({nativeRun:run,signal:damage,witnessReceipts:[sight(1200,false,true)]});
 const claim=hit.observations[0].claims[0];
 assert.equal(claim.kind,'injured');
 assert.equal(claim.source.captureRef,player);
 assert.equal(claim.target.captureRef,victim);
 assert.equal(claim.details.classification,'bullet');
 now=3500;
 const stale=correlation.ingest({nativeRun:run,signal:{...damage,signalId:randomUUID(),
   producerSequence:2,gameTick:3500},witnessReceipts:[sight(3500,false,true)]});
 assert.equal(stale.observations[0].claims.at(-1).source,undefined);
 correlation.clear();
 assert.equal(correlation.visualShots.size,0);
});
