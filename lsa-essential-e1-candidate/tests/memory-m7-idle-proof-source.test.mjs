// W07: the joined native + original-backend idle proof. Offline source simulation
// over the REAL ShadowRuntime intake and the REAL OriginalEssentialTurnTimeline;
// only the GTA process and the P2 owner ledger are faked. Not a GTA receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {CAPABILITIES,M7_NATIVE_CORE_QUIET_FIELDS,M7_UNAVAILABLE_CORE_FIELDS} from '../src/perception/contracts.mjs';
import {ShadowRuntime} from '../src/perception/shadowRuntime.mjs';
import {OriginalEssentialTurnTimeline} from '../src/perception/essentialTurnPriority.mjs';
import {createM7IdleProofSource} from '../src/memory/m7IdleProofSource.mjs';
import {validateM7IdleProof,M7_PRIORITY_QUIET_FIELDS} from '../../lsa-shared-brain/src/memory/m7Consent.mjs';

const IDLE_STORES={micStatus:'idle',micActiveTurnId:'',micReleasedBeforeContextReady:false,
  micBufferedChunks:0,liveTurns:0,activeTurnMappings:0,pendingSessionOpens:0,pendingOutputOwners:0,
  retiringOutputOwners:0,activeOutputOwners:0,pendingPlayerContext:0,pendingConversationContext:0,
  playerTurnRecoveries:0};

function rig({resolves=true,director=false}={}){
  const hostRunId=uuid(),adapterEpoch=uuid(),streamId=uuid(),ref=uuid(),
    incarnationId=uuid(),encounterId=uuid(),characterId=uuid();
  const r={hostRunId,streamId,ref,incarnationId,encounterId,characterId,mono:10_000,tick:5_000,seq:0,
    stores:{...IDLE_STORES},director,resolves,diagSubs:new Set(),boundary:new Set(),stock:new Set()};
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>1000});
  const frame=(type,payload)=>({version:1,type,adapterEpoch,streamId,sequence:++r.seq,payload});
  const ingest=f=>assert.equal(runtime.ingest(f,{authenticated:true}),true);
  ingest({version:1,type:'hello',adapterEpoch,streamId,hostContextVersion:1,hostRunId,worldEpoch:1,
    observerIndexVersion:1,capabilities:Object.fromEntries(CAPABILITIES.map(x=>[x,false]))});
  ingest(frame('anchors',[{captureRef:ref,kind:'ped',observer:true,owned:true}]));
  ingest(frame('observer_index',[{captureRef:ref,kind:'ped',owned:true,incarnationId,encounterId}]));
  const intelligence={runtime,
    subscribeAuthenticatedNativeM7Diagnostic:(listener,onRetire)=>{
      const s={listener,onRetire};r.diagSubs.add(s);return()=>r.diagSubs.delete(s);},
    subscribeWorldBoundary:l=>{r.boundary.add(l);return()=>r.boundary.delete(l);}};
  const timeline=new OriginalEssentialTurnTimeline();
  r.timeline=timeline;
  const backend={sample:()=>timeline.sample({...r.stores}),leaseActive:()=>timeline.leaseCount>0,
    observe:o=>{r.stock.add(o);return()=>r.stock.delete(o);}};
  r.store={get:id=>id===characterId?{characterId}:null,worldProfileId:uuid(),activeTimelineId:uuid(),
    timelineWritable:true,verifiedHostContext:{hostRunId,worldEpoch:1}};
  r.timers=[];
  r.source=createM7IdleProofSource({intelligence,backend,store:r.store,
    resolveOwner:x=>r.resolves&&x.observerCaptureRef===ref&&x.hostRunId===hostRunId?
      {nativeVerified:true,current:true,characterId,ownerProof:{observerCaptureRef:ref,incarnationId,encounterId}}:null,
    directorBusy:()=>r.director,monotonicNow:()=>r.mono,wallNow:()=>Date.now(),
    setIntervalFn:fn=>{const t={fn,unref(){}};r.timers.push(t);return t;},
    clearIntervalFn:t=>{r.timers=r.timers.filter(x=>x!==t);}});
  // One authenticated native sample, 1 s after the previous one.
  r.sample=({advance=1000,tick=advance,quiet={}}={})=>{
    r.mono+=advance;r.tick+=tick;
    const payload={nativeM7DiagnosticVersion:1,kind:'native_idle_diagnostic_v1',nativeVerified:false,
      hostRunId,worldEpoch:1,sampledGameTick:r.tick,observerCaptureRef:ref,incarnationId,encounterId,
      priorityEvidence:{...Object.fromEntries(M7_NATIVE_CORE_QUIET_FIELDS.map(k=>[k,true])),
        ...Object.fromEntries(M7_UNAVAILABLE_CORE_FIELDS.map(k=>[k,false])),...quiet},
      missingCoreCapabilities:[...M7_UNAVAILABLE_CORE_FIELDS]};
    const f=frame('memory_m7_idle_diagnostic',payload);
    ingest(f);
    for(const s of [...r.diagSubs])s.listener({frame:f});
  };
  r.idle=(n=3)=>{for(let i=0;i<n;i++)r.sample();};
  r.stockEvent=event=>{r.timeline.transition(event);for(const o of [...r.stock])o(event);};
  r.validate=proof=>validateM7IdleProof(proof,{store:r.store,characterId,nowUtc:new Date().toISOString()});
  return r;
}

test('W07 mints verified_native_idle_v1 only from sustained native + backend agreement',()=>{
  const r=rig();
  assert.equal(r.source.snapshot(),null,'silence is not idle');
  r.sample();r.sample();
  assert.equal(r.source.snapshot(),null,'1 s of observation is not enough');
  r.sample();
  const proof=r.source.snapshot();
  assert.ok(proof);
  assert.equal(r.source.verifyAuthenticatedSource(proof),true);
  assert.equal(r.validate(proof).characterId,r.characterId);
  assert.ok(M7_PRIORITY_QUIET_FIELDS.every(k=>proof.priorityEvidence[k]===true));
  assert.equal(proof.sessionId,r.streamId);
  assert.ok(proof.idleForMs>=1600);
  // Forged and copied proofs are never authenticated, even field-for-field equal.
  assert.equal(r.source.verifyAuthenticatedSource({...proof}),false);
  assert.equal(r.source.verifyAuthenticatedSource(JSON.parse(JSON.stringify(proof))),false);
});

test('W07 backend turn activity aborts at once and a lease/PS3-style reservation grants nothing',()=>{
  const r=rig();r.idle();
  let aborted=0;
  const off=r.source.subscribeInvalidation(()=>{aborted++;});
  const proof=r.source.snapshot();assert.ok(proof);
  r.stockEvent('mic_capture');            // between two 1 Hz native samples
  assert.equal(aborted,1,'synchronous cancellation');
  assert.equal(r.source.verifyAuthenticatedSource(proof),false);
  assert.equal(r.source.snapshot(),null);
  off();
  r.idle(3);                              // continuity restarts from the next quiet sample
  assert.ok(r.source.snapshot());
  // A Director-style backend lease (the ticket mechanism) blocks, never grants.
  const snap=r.timeline.sample({...r.stores});
  assert.ok(r.timeline.acquire(uuid(),snap));
  r.sample();
  assert.equal(r.source.snapshot(),null);
  assert.equal(r.source.diagnostics().reason,'director_reservation_active');
});

test('W07 busy backend stores, Director state and unresolved owners all block',()=>{
  for(const [name,mutate,expected] of [
    ['live turn',r=>{r.stores.liveTurns=1;},'backend_essential_turn_active'],
    ['output owner',r=>{r.stores.activeOutputOwners=1;},'backend_essential_turn_active'],
    ['mic active',r=>{r.stores.micStatus='capturing';r.stores.micActiveTurnId='t';},'backend_player_turn_active'],
    ['buffered mic',r=>{r.stores.micBufferedChunks=2;},'backend_player_turn_active'],
    ['director busy',r=>{r.director=true;},'director_busy'],
  ]){
    const r=rig();r.idle(2);mutate(r);r.sample();
    assert.equal(r.source.snapshot(),null,name);
    assert.equal(r.source.diagnostics().reason,expected,name);
  }
  const r=rig({resolves:false});r.idle(4);
  assert.equal(r.source.snapshot(),null,'no authenticated P2 owner => no character => no proof');
});

test('W07 any native negative, gap, stalled game clock or retirement restarts the streak',()=>{
  for(const field of M7_NATIVE_CORE_QUIET_FIELDS){
    const r=rig();r.idle(3);assert.ok(r.source.snapshot());
    r.sample({quiet:{[field]:false}});
    assert.equal(r.source.snapshot(),null,field);
    r.idle(2);assert.equal(r.source.snapshot(),null,'needs a fresh observed window: '+field);
    r.sample();assert.ok(r.source.snapshot(),'recovers after a new quiet window: '+field);
  }
  let r=rig();r.idle(2);r.sample({advance:4000});     // lost samples: continuity unproven
  assert.equal(r.source.snapshot(),null);
  r=rig();r.idle(2);r.mono+=2600;                      // stale native sample
  assert.equal(r.source.snapshot(),null);
  r=rig();for(let i=0;i<3;i++)r.sample({tick:100});    // game clock crawling: treated as paused
  assert.equal(r.source.snapshot(),null);
  assert.equal(r.source.diagnostics().reason,'game_clock_stalled');
  r=rig();r.idle(2);r.sample({tick:0});                // frozen game clock: continuity lost
  assert.equal(r.source.snapshot(),null);
  r=rig();r.idle(3);for(const s of r.boundary)s();
  assert.equal(r.source.snapshot(),null,'world boundary');
  r=rig();r.idle(3);for(const s of r.diagSubs)s.onRetire();
  assert.equal(r.source.snapshot(),null,'native source retired');
  r=rig();r.idle(3);r.store.verifiedHostContext={hostRunId:uuid(),worldEpoch:1};
  assert.equal(r.source.snapshot(),null,'P2 host context no longer matches');
});

test('W07 watchdog aborts in-flight work when native samples stop; dispose is final',()=>{
  const r=rig();r.idle(3);
  let aborted=0;
  const off=r.source.subscribeInvalidation(()=>{aborted++;});
  assert.equal(r.timers.length,1);
  r.timers[0].fn();assert.equal(aborted,0,'fresh');
  r.mono+=3000;r.timers[0].fn();
  assert.equal(aborted,1);
  off();assert.equal(r.timers.length,0);
  r.idle(3);const proof=r.source.snapshot();assert.ok(proof);
  r.source.dispose();
  assert.equal(r.source.snapshot(),null);
  assert.equal(r.source.verifyAuthenticatedSource(proof),false);
});
