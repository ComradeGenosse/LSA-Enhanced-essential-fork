import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { evaluateWitness, reportEvidence } from '../src/perception/witnessPolicy.mjs';
import { EpisodeCorrelator } from '../src/perception/episodeCorrelator.mjs';
import { EpisodeStore } from '../src/perception/episodeStore.mjs';
import { ObservationStore } from '../src/perception/observationStore.mjs';

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
