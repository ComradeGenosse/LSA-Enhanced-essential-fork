import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDirectorIntent,PS6_13A_EVENTS} from '../src/perception/sceneDirector.mjs';
import {DirectorObservationPump} from '../src/perception/directorProduction.mjs';

const speaker='d34713cd-ff8e-4ab3-9f83-241a8cf812c7';
const player='24846870-fdcc-444f-9aca-7487d4c01048';
const observationId='c9f50874-c003-4437-a944-9200cf6e30e5';
const facts={speakerCaptureRef:speaker,playerCaptureRef:player,nowMonotonicMs:10000};
function evidence(eventType,channel='visual',response='eligible'){
 const kind={firing_burst:'firing',vehicle_impact:'injured',injury:'injured',death_seen:'dead',body_found:'dead',threat:'attack'}[eventType]??'location';
 return {entitlementCurrent:true,observedAtMonotonicMs:9900,
   observation:{observationId,revision:1,eventType,observer:{captureRef:speaker,kind:'ped'},
     expiresAtMonotonicMs:15000,claims:[{kind,certainty:'supported',evidence:{channel}}]},
   decision:{observationId,revision:1,decisionKey:'ps3-13a-grant',policyVersion:1,
     response,expiresAtMonotonicMs:15000},
   situation:{lifetimeCurrent:true,channelHealthy:true,perceptionSupported:true,playerCaptureRef:player}};
}
test('13a eligible event matrix: only PS3-granted, directly qualified threats enter selection',()=>{
 assert.deepEqual(PS6_13A_EVENTS,['firing_burst','vehicle_impact','injury','death_seen','body_found','threat']);
 for(const eventType of PS6_13A_EVENTS){
  assert.equal(selectDirectorIntent([evidence(eventType)],facts)?.kind,'speech',eventType);
  assert.equal(selectDirectorIntent([evidence(eventType,'report')],facts),null,eventType+' report');
  assert.equal(selectDirectorIntent([evidence(eventType,'visual','none')],facts),null,eventType+' no grant');
  assert.equal(selectDirectorIntent([{...evidence(eventType),entitlementCurrent:false}],facts),null,eventType+' stale grant');
 }
 for(const eventType of ['radio_heard','location_changed','activity_changed',
   'vehicle_transition','character_present','speech_heard','action_observed']){
  assert.equal(selectDirectorIntent([evidence(eventType)],facts),null,eventType+' cannot spontaneously speak');
 }
 const expired=evidence('injury');
 assert.equal(selectDirectorIntent([{...expired,observedAtMonotonicMs:0}],facts),null);
 assert.equal(selectDirectorIntent([evidence('threat')],{...facts,speakerCaptureRef:player}),null);
});

test('a temporarily unavailable native C-06 priority stamp does not consume PS3 candidate',async()=>{
 let stampReady=false,attempts=0,clock=10000;
 const seenReasons=[],results=[];
 const runtime={epoch:'run-1',directorRequestVersion:1,now:()=>clock,
   hostContext:{hostRunId:'run',worldEpoch:1},directorPriority:null,
   anchors:new Map([[player,{captureRef:player,kind:'player'}]]),
   observerIndex:new Map([[speaker,{kind:'ped',owned:true}]]),current:()=>true,
   directorOwnerProofFor:()=>({hostRunId:'run',worldEpoch:1,speakerCaptureRef:speaker,
     ownerIncarnationId:'owner',proofRevision:1}),
   directorCandidatesFor:()=>[evidence('firing_burst')]};
 let pump;
 pump=new DirectorObservationPump({client:{runtime},coordinator:{mode:'active',
   attempt:async()=>{attempts++;return {status:'not_admitted',diagnosticReason:'source_or_safety_veto'};}},
   now:()=>clock,stampFor:proposal=>pump.currentStamp(proposal),
   onDiagnostic:d=>seenReasons.push(d.reason),onResult:r=>results.push(r.status)});
 assert.equal((await pump.tick()).diagnosticReason,'player_priority_missing');
 assert.equal(attempts,0);
 assert.equal(pump.seen.size,0,'missing proof must never burn decision key');
 runtime.directorPriority={experimentalEnabled:true,playerTurnVersion:0,
   receivedAt:clock,hostRunId:'run',worldEpoch:1};
 assert.equal((await pump.tick()).status,'not_admitted');
 assert.equal(attempts,1,'valid native proof reaches existing independent admission');
 assert.equal(pump.seen.size,1,'actual attempt stays one-shot');
 assert.equal(await pump.tick(),null,'native veto cannot replay a spent PS3 decision');
 clock+=600;assert.equal(attempts,1);
 assert(seenReasons.includes('player_priority_missing'));
 assert.deepEqual(results,['not_admitted','not_admitted']);
 pump.stop();
});

test('stale native player priority does not burn a candidate; reconnect requires current authority',async()=>{
 let now=10000,calls=0;
 const runtime={epoch:'one',directorRequestVersion:1,now:()=>now,
   hostContext:{hostRunId:'run',worldEpoch:1},
   directorPriority:{experimentalEnabled:true,playerTurnVersion:1,receivedAt:8000,
     hostRunId:'run',worldEpoch:1},
   anchors:new Map([[player,{captureRef:player,kind:'player'}]]),
   observerIndex:new Map([[speaker,{kind:'ped',owned:true}]]),current:()=>true,
   directorOwnerProofFor:()=>({hostRunId:'run',worldEpoch:1,speakerCaptureRef:speaker,
     ownerIncarnationId:'owner',proofRevision:1}),
   directorCandidatesFor:()=>[evidence('injury')]};
 let pump; pump=new DirectorObservationPump({client:{runtime},coordinator:{mode:'active',attempt:async()=>{calls++;return {status:'not_admitted'};}},
   now:()=>now,stampFor:p=>pump.currentStamp(p)});
 assert.equal((await pump.tick()).diagnosticReason,'player_priority_stale');
 assert.equal(pump.seen.size,0);
 runtime.epoch='two';runtime.directorPriority.receivedAt=10000;
 assert.equal((await pump.tick()).status,'not_admitted');assert.equal(calls,1);
 pump.stop();
});


test('spent top-ranked event does not starve another independently PS3-granted event',async()=>{
 let calls=0;
 const first=evidence('firing_burst','visual','urgent');
 const second=evidence('injury','visual','eligible');
 second.observation.observationId='7d21409c-bfd0-45a3-b17b-459bc4997100';
 second.decision.observationId=second.observation.observationId;
 second.decision.decisionKey='ps3-second-event';
 const runtime={epoch:'same-run',directorRequestVersion:1,now:()=>10000,
   hostContext:{hostRunId:'run',worldEpoch:1},
   anchors:new Map([[player,{captureRef:player,kind:'player'}]]),
   observerIndex:new Map([[speaker,{kind:'ped',owned:true}]]),current:()=>true,
   directorOwnerProofFor:()=>({hostRunId:'run',worldEpoch:1,speakerCaptureRef:speaker}),
   directorCandidatesFor:()=>[first,second]};
 const attempted=[];
 const coordinator={mode:'active',attempt:async({candidates,facts})=>{
   calls++;
   const selected=selectDirectorIntent(candidates,facts);
   attempted.push(selected?.decisionKey);
   return {status:'not_admitted'};
 }};
 const pump=new DirectorObservationPump({client:{runtime},coordinator,
   now:()=>10000,stampFor:()=>({hostRunId:'run',worldEpoch:1})});
 assert.equal((await pump.tick()).status,'not_admitted');
 assert.equal((await pump.tick()).status,'not_admitted');
 assert.equal(await pump.tick(),null,'spent decisions must not replay');
 assert.equal(calls,2);
 assert.deepEqual(attempted,['ps3-13a-grant','ps3-second-event'],
   'coordinator must receive the filtered slice, never reselect spent urgent event');
 assert.equal(pump.seen.size,2);
 pump.stop();
});

test('selection diagnostic distinguishes non-13a chatter, unqualified witness and stale evidence without granting speech',async()=>{
 const {directorCandidateBlockReason}=await import('../src/perception/directorProduction.mjs');
 assert.equal(directorCandidateBlockReason([evidence('radio_heard')],facts),'non_13a_event');
 assert.equal(directorCandidateBlockReason([evidence('injury','report')],facts),'direct_witness_unavailable');
 assert.equal(directorCandidateBlockReason([{...evidence('injury'),entitlementCurrent:false}],facts),'ps3_entitlement_stale');
 assert.equal(directorCandidateBlockReason([evidence('threat','visual','none')],facts),'ps3_response_ineligible');
 assert.equal(directorCandidateBlockReason([{...evidence('firing_burst'),observedAtMonotonicMs:0}],facts),'candidate_filtered');
 const gone=evidence('death_seen');
 assert.equal(directorCandidateBlockReason([{...gone,observation:{...gone.observation,expiresAtMonotonicMs:9999}}],facts),'ps3_evidence_expired');
});

test('native preflight diagnostics expose only a whitelisted event category and reset on new epoch',async()=>{
 const events=[],runtime={epoch:'a',directorRequestVersion:1,now:()=>10000,
  anchors:new Map([[player,{captureRef:player,kind:'player'}]]),
  observerIndex:new Map([[speaker,{kind:'ped',owned:true}]]),current:()=>true,
  directorOwnerProofFor:()=>({hostRunId:'run',worldEpoch:1,speakerCaptureRef:speaker}),
  directorCandidatesFor:()=>[evidence('firing_burst')],hostContext:{hostRunId:'run',worldEpoch:1},directorPriority:null};
 let pump;pump=new DirectorObservationPump({client:{runtime},coordinator:{mode:'active',attempt:async()=>{throw Error('not admitted');}},
  stampFor:p=>pump.currentStamp(p),onDiagnostic:d=>events.push(d)});
 assert.equal((await pump.tick()).diagnosticReason,'player_priority_missing');
 assert.deepEqual(events,[{reason:'player_priority_missing',eventType:'firing_burst'}]);
 assert.equal((await pump.tick()).diagnosticReason,'player_priority_missing');
 assert.equal(events.length,1,'bounded repetition');
 runtime.epoch='b';
 assert.equal((await pump.tick()).diagnosticReason,'player_priority_missing');
 assert.equal(events.length,2,'reconnect emits new meaningful gate');
});

test('PS6 telemetry admits only closed event and gate values',async()=>{
 const {sanitizeTelemetryData}=await import('../src/observability/eventContract.mjs');
 assert.deepEqual(sanitizeTelemetryData({eventType:'injury',diagnosticReason:'stock_dispatch_exception',
  rawConversation:'private words'}),{eventType:'injury',diagnosticReason:'stock_dispatch_exception'});
 assert.deepEqual(sanitizeTelemetryData({eventType:'private NPC name',diagnosticReason:'arbitrary private content'}),{});
});
