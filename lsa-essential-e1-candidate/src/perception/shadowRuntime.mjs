import {readPrimaryBehaviorOwner} from '../context/primaryBehaviorOwner.mjs';
import { BOUNDS, CAPABILITIES, validateFrame } from './contracts.mjs';
import { ObservationStore } from './observationStore.mjs';
import { EpisodeStore } from './episodeStore.mjs';
import { EpisodeCorrelator } from './episodeCorrelator.mjs';
import { SharedTranscriptStore } from './sharedTranscriptStore.mjs';
import { SalienceCache, situationFromCharacterView, sameSalienceSituationPolicy } from './salienceEngine.mjs';
import { readHostContext } from '../context/hostContext.mjs';
import { RadioTrackTextCatalog, normalizeRadioSignal } from './radioTrackTextCatalog.mjs';
import { traceCode } from '../observability/traceCode.mjs';

const MAX_COUNTER = 2147483647;
export const OWNER_STALL_BOUNDS = Object.freeze({ startMs: 1500, resetMs: 60000 });
// Per-event PS2/PS3 traces are rate-bounded: no per-frame logging. Events
// involving an owned (P2) observer get the larger budget.
export const PERCEPTION_TRACE_BOUNDS = Object.freeze({ windowMs: 10000, owned: 20, other: 6, radio: 16 });
const TRACED_KINDS = new Set(['firing','damage','death','injury_state']);
const RESPONSE_ORDER = Object.freeze({ not_evaluated: -1, none: 0, eligible: 1, urgent: 2 });
const PS3_REASON_COUNTERS = Object.freeze({
  safety_self_danger:'safetySelfDanger',
  safety_player_harm:'safetyPlayerHarm',
  safety_nearby_threat:'safetyNearbyThreat',
  repetition_suppressed:'repetitionSuppressed',
  revision_stale:'revisionStale',
  novelty_escalation:'noveltyEscalation',
  suppression_capacity:'suppressionCapacity',
});

export class ShadowRuntime {
  constructor({ mode='off', radio='off', radioCatalog=null, now=()=>Math.floor(performance.now()), situationFor=()=>({}), acceptedObservationTap=null, consumers=null, m9Events=null, trace=null, stall=null }={}) {
    this.mode=mode;this.radio=radio==='shadow'?'shadow':'off';this.now=now;this.anchors=new Map();this.signals=[];this.sequence=0;this.producers=new Map();this.epoch=null;this.stream=null;this.lastReceipt=0;
    this.hostContext=null;this.observerIndexVersion=null;this.memoryCurrentOwnerPlayerVersion=null;this.m9SampleVersion=null;this.observerIndex=new Map();this.observerSituations=new Map();this.observerSituationVersion=null;this.primaryBehaviorOwnerVersion=null;this.directorRequestVersion=null;this.directorPriority=null;this.directorReceipts=[];this.socialScenes=new Map();this.situationProvider=situationFor;
    this.counters=Object.fromEntries(['received','dropped','stale','malformed','duplicate','gaps','expired','resets'].map(k=>[k,0]));
    this.historyDiagnostics={expired:0,evicted:0,skipped:0,highWater:0};
    this.dropDiagnostics={anchorCapacity:0,observerCapacity:0};
    this.resetDiagnostics={initializations:0,disconnects:0,faults:0,timeouts:0,manual:0};
    // Bounded local explanation for P0 tokens missing after retire/lease/reset.
    // Never persist these capture refs or infer replacement actors.
    this.missingRefReasons=new Map();this.lastResetReason='none';
    this.capabilities=Object.fromEntries(CAPABILITIES.map(k=>[k,false]));this.diagnostics=null;
    // Pause presentation leases during bounded native owner-fiber stalls.
    // Memory authority continues to require its independent wall-clock proof.
    this.leaseBase=0;this.stallNotified=false;this.stallDiagnostics={stalls:0,maxMs:0};
    // Optional bounded diagnostic sinks; they never affect perception state.
    this.onTrace=typeof trace==='function'?trace:null;this.onStall=typeof stall==='function'?stall:null;
    this.traceWindow={start:-Infinity,owned:0,other:0,radio:0};this.traceDiagnostics={emitted:0,suppressed:0};
    this.radioDiagnostics={changed:0,stopped:0,known:0,unknown:0,mismatch:0,off:0,observations:0,ownedObservations:0};
    this.consumerActivation=consumers;
    const ps2=mode==='shadow'&&(consumers===null||consumers.ps2?.enabled===true);
    const ps3=ps2&&(consumers===null||consumers.ps3?.enabled===true);
    this.radioCatalog=ps2?(radioCatalog??RadioTrackTextCatalog.unavailable()):null;
    this.observations=ps2?new ObservationStore({now,current:ref=>this.current(ref)}):null;
    this.episodes=ps2?new EpisodeStore({now,current:ref=>this.current(ref)}):null;
    this.correlator=ps2?new EpisodeCorrelator({episodes:this.episodes,observations:this.observations,now,current:ref=>this.current(ref),anchor:ref=>this.anchors.get(ref)}):null;
    this.transcripts=ps2?new SharedTranscriptStore({now,current:ref=>this.current(ref)}):null;
    this.salience=ps3?new SalienceCache({now}):null;
    this.ps2Diagnostics={correlated:0,witnessed:0,ownedWitnessed:0,duplicates:0,dropped:0,speechGate:'unsupported_capture_receipt'};
    // M3 opt-in synchronous acceptance tap. Off by default. It may enqueue a
    // frozen receipt, never do async SQLite or let an exception break PS2.
    this.acceptedObservationTap=ps2&&typeof acceptedObservationTap==='function'?acceptedObservationTap:null;
    this.memoryTapDiagnostics={delivered:0,rejected:0,faults:0};
    // M9 is construction-time only and never reachable without PS2.
    this.m9Events=ps2&&m9Events&&typeof m9Events.ingest==='function'?m9Events:null;
    this.ps3Diagnostics={decisions:0,urgent:0,eligible:0,staged:0,suppressed:0,faults:0,ownedDecisions:0,ownedEligible:0,ownedUrgent:0,reasons:Object.fromEntries(Object.values(PS3_REASON_COUNTERS).map(k=>[k,0]))};
  }
  #tapAcceptedObservation(observation) {
    if(!this.acceptedObservationTap)return;
    const ref=observation?.observer?.captureRef;
    const row=this.observerIndex.get(ref);
    const anchor=this.anchors.get(ref);
    const stored=this.observations.entries.get(`${ref}:${observation.episodeId}`)?.value;
    // Correlator's observations come only from successfully stored PS2 source
    // receipts. Never use name, proximity or a retired ped handle as proof.
    if(!this.hostContext || !this.current(ref) || !anchor?.observer ||
       !row?.owned || !row.encounterId || !row.incarnationId ||
       !stored || stored.observationId!==observation.observationId ||
       stored.revision!==observation.revision) {
      this.bump(this.memoryTapDiagnostics,'rejected');return;
    }
    try {
      const result=this.acceptedObservationTap(Object.freeze({
        observation:stored,adapterEpoch:this.epoch,
        hostRunId:this.hostContext.hostRunId,worldEpoch:this.hostContext.worldEpoch,
        observerIndex:row
      }));
      if(result && typeof result.then==='function')
        throw new Error('async_memory_tap_not_supported');
      this.bump(this.memoryTapDiagnostics,'delivered');
    } catch {
      // Memory tap is non-authoritative for game behavior. Missed persistence
      // is counted, not silently treated as a confirmed journal write.
      this.bump(this.memoryTapDiagnostics,'faults');
    }
  }
  bump(target,k) { target[k]=Math.min(MAX_COUNTER,(target[k]||0)+1); }
  // Native-active time. While the owner fiber is silent beyond startMs the
  // clock stands still, so anchor/situation leases neither expire nor renew.
  leaseNow() {
    const now=this.now();
    if(!this.epoch) return now-this.leaseBase;
    return now-this.leaseBase-Math.max(0,now-this.lastReceipt-OWNER_STALL_BOUNDS.startMs);
  }
  stalled() { return Boolean(this.epoch) && this.now()-this.lastReceipt>OWNER_STALL_BOUNDS.startMs; }
  // Companion state equals native's last publication on this live stream.
  // Negotiated Memory K evidence never inherits presentation stall tolerance.
  sourceSilenceMs() { return this.memoryCurrentOwnerPlayerVersion===1||!this.observations?3000:OWNER_STALL_BOUNDS.resetMs; }
  channelFresh() { return Boolean(this.epoch) && this.now()-this.lastReceipt<=this.sourceSilenceMs(); }
  noteReceipt() {
    const now=this.now(),silent=now-this.lastReceipt;
    if(this.epoch && silent>OWNER_STALL_BOUNDS.startMs) {
      this.leaseBase+=silent-OWNER_STALL_BOUNDS.startMs;
      this.bump(this.stallDiagnostics,'stalls');
      this.stallDiagnostics.maxMs=Math.max(this.stallDiagnostics.maxMs,Math.min(MAX_COUNTER,silent));
      if(this.stallNotified) try {this.onStall?.(Object.freeze({stage:'resumed',stallMs:Math.min(MAX_COUNTER,silent)}));} catch {}
    }
    this.stallNotified=false;this.lastReceipt=now;
  }
  count(k) { this.bump(this.counters,k); }
  recordMissingRef(ref,reason) {
    if(typeof ref!=='string')return;
    this.missingRefReasons.delete(ref);
    this.missingRefReasons.set(ref,{reason,at:this.now()});
    while(this.missingRefReasons.size>256)
      this.missingRefReasons.delete(this.missingRefReasons.keys().next().value);
  }
  missingRefReason(ref) {
    const record=this.missingRefReasons.get(ref);
    return record && this.now()>=record.at && this.now()-record.at<=60000 ?
      record.reason:'not_tracked';
  }
  reset(reason='manual') {
    const kind=['initialization','disconnect','fault','timeout','manual'].includes(reason)?reason:'manual';
    this.lastResetReason='reset_'+kind;
    for(const ref of this.anchors.keys())this.recordMissingRef(ref,this.lastResetReason);
    this.hostContext=null;this.observerIndexVersion=null;this.memoryCurrentOwnerPlayerVersion=null;this.m9SampleVersion=null;this.m9Events?.reset();this.observerIndex.clear();this.observerSituations.clear();this.observerSituationVersion=null;this.primaryBehaviorOwnerVersion=null;this.directorRequestVersion=null;this.directorPriority=null;this.directorReceipts=[];this.socialScenes.clear();
    this.anchors.clear();this.signals=[];this.producers.clear();this.observations?.clear();this.episodes?.clear();this.correlator?.clear();this.salience?.clear();this.transcripts?.setActiveRun(null);this.epoch=null;this.stream=null;this.sequence=0;this.lastReceipt=0;this.leaseBase=0;this.stallNotified=false;this.diagnostics=null;this.capabilities=Object.fromEntries(CAPABILITIES.map(k=>[k,false]));this.count('resets');
    const key={initialization:'initializations',disconnect:'disconnects',fault:'faults',timeout:'timeouts',manual:'manual'}[reason]||'manual';this.bump(this.resetDiagnostics,key);
  }
  current(ref) {const a=this.anchors.get(ref);return Boolean(a && a.expires>this.leaseNow() && this.epoch);}
  owned(ref) { return this.observerIndex.get(ref)?.owned===true; }
  // Fixed-vocabulary, rate-bounded per-event diagnostics. Only a one-way trace
  // code of the random native signal ID is emitted, never refs or content.
  emitTrace(event,ownedRelevant,record) {
    if(!this.onTrace) return;
    const now=this.now(),window=this.traceWindow;
    if(!(now>=window.start && now-window.start<PERCEPTION_TRACE_BOUNDS.windowMs)) {window.start=now;window.owned=0;window.other=0;window.radio=0;}
    const lane=event==='radio_trace'?'radio':ownedRelevant?'owned':'other';
    if(window[lane]>=PERCEPTION_TRACE_BOUNDS[lane]) {this.bump(this.traceDiagnostics,'suppressed');return;}
    window[lane]++;this.bump(this.traceDiagnostics,'emitted');
    try {this.onTrace(event,Object.freeze(record));} catch {}
  }
  qualifiedObservers(receipts) {
    const refs=new Set();
    for(const r of receipts) if(r && (r.status==='witnessed'||r.status==='reported') && r.evidence && this.current(r.observer?.captureRef) && this.anchors.get(r.observer.captureRef)?.kind==='ped') refs.add(r.observer.captureRef);
    return refs;
  }
  // PS3 per observation; records the best owned-observer outcome for traces.
  noteObservations(observations,outcome) {
    for(const observation of observations||[]) {
      const decision=this.noteSalience(observation);
      if(!this.owned(observation.observer.captureRef)) continue;
      outcome.ownedObservations++;
      const response=decision?.response??'not_evaluated';
      if((RESPONSE_ORDER[response]??-1)>RESPONSE_ORDER[outcome.ps3Owned]) {outcome.ps3Owned=response;outcome.ps3Reason=decision?.reasons?.[0]??'none';}
      else if(outcome.ps3Reason==='none' && decision?.reasons?.length) outcome.ps3Reason=decision.reasons[0];
    }
  }
  expire() {
    if(this.epoch && this.now()-this.lastReceipt>this.sourceSilenceMs()) {this.reset('timeout');return;}
    if(this.stalled() && !this.stallNotified) {
      this.stallNotified=true;
      try {this.onStall?.(Object.freeze({stage:'stalled',stallMs:Math.min(MAX_COUNTER,this.now()-this.lastReceipt)}));} catch {}
    }
    for(const [ref,a] of this.anchors) if(a.expires<=this.leaseNow()) this.retire(ref,'lease_expired');
    this.signals=this.signals.filter(s=>{ if(s.expires<=this.now()) {this.bump(this.historyDiagnostics,'expired');return false;} return true; });
    this.observations?.expire();
    this.episodes?.expire();
    this.salience?.expire(this.now());
  }
  retire(ref,reason='retire') { if(this.anchors.has(ref))this.recordMissingRef(ref,reason);this.salience?.releaseReference(ref);this.anchors.delete(ref);this.observerIndex.delete(ref);this.observerSituations.delete(ref);this.socialScenes.delete(ref);this.signals=this.signals.filter(s=>s.value.target!==ref && s.value.source!==ref && s.value.facts.vehicle!==ref);this.observations?.expire();this.episodes?.expire(); }
  retainSignal(value,critical,expires) {
    if(!critical && this.signals.filter(x=>!x.critical).length>=192) {
      const index=this.signals.findIndex(x=>!x.critical);
      if(index>=0) {this.signals.splice(index,1);this.bump(this.historyDiagnostics,'evicted');}
    }
    if(this.signals.length>=256) {
      const index=this.signals.findIndex(x=>!x.critical);
      if(index<0) {this.bump(this.historyDiagnostics,'skipped');return;}
      this.signals.splice(index,1);this.bump(this.historyDiagnostics,'evicted');
    }
    this.signals.push({value,critical,expires});
    this.historyDiagnostics.highWater=Math.max(this.historyDiagnostics.highWater,this.signals.length);
  }
  ingest(v, { authenticated=false }={}) {
    if(this.mode!=='shadow' || !authenticated) return false;
    this.expire();
    if(!validateFrame(v)) {this.count('malformed');return false;}
    if(v.type==='hello') {this.reset('initialization');this.epoch=v.adapterEpoch;this.stream=v.streamId;this.hostContext=readHostContext(v);this.observerIndexVersion=v.observerIndexVersion??null;this.memoryCurrentOwnerPlayerVersion=v.memoryCurrentOwnerPlayerVersion??null;this.m9SampleVersion=v.m9SampleVersion??null;this.observerSituationVersion=v.observerSituationVersion??null;this.primaryBehaviorOwnerVersion=v.primaryBehaviorOwnerVersion??null;this.directorRequestVersion=v.directorRequestVersion??null;this.capabilities=Object.freeze({...v.capabilities});this.transcripts?.setActiveRun(this.epoch);this.lastReceipt=this.now();return true;}
    if(v.adapterEpoch!==this.epoch || v.streamId!==this.stream) {this.count('stale');return false;}
    if(v.sequence<=this.sequence) {this.count('duplicate');return false;}
    if(v.sequence!==this.sequence+1) {this.count('gaps');this.reset('fault');return false;}
    this.sequence=v.sequence;this.noteReceipt();
    if(v.type==='world_epoch') {
      if(!this.hostContext || v.payload.epoch<this.hostContext.worldEpoch || v.payload.epoch>this.hostContext.worldEpoch+1) {this.reset('fault');return false;}
      if(v.payload.epoch===this.hostContext.worldEpoch) return true;
      const context=Object.freeze({...this.hostContext,worldEpoch:v.payload.epoch});
      const epoch=this.epoch,stream=this.stream,sequence=this.sequence,capabilities=this.capabilities;
      const m9SampleVersion=this.m9SampleVersion,memoryCurrentOwnerPlayerVersion=this.memoryCurrentOwnerPlayerVersion,observerIndexVersion=this.observerIndexVersion,observerSituationVersion=this.observerSituationVersion,primaryBehaviorOwnerVersion=this.primaryBehaviorOwnerVersion,directorRequestVersion=this.directorRequestVersion;
      this.reset('manual');this.m9SampleVersion=m9SampleVersion;this.memoryCurrentOwnerPlayerVersion=memoryCurrentOwnerPlayerVersion;this.observerIndexVersion=observerIndexVersion;this.observerSituationVersion=observerSituationVersion;this.primaryBehaviorOwnerVersion=primaryBehaviorOwnerVersion;this.directorRequestVersion=directorRequestVersion;this.directorPriority=null;this.hostContext=context;this.epoch=epoch;this.stream=stream;this.sequence=sequence;
      this.capabilities=capabilities;this.transcripts?.setActiveRun(epoch);this.lastReceipt=this.now();return true;
    }
    // EA protagonist frame only confirms transport/order + current native host.
    // It does not grant D01, D02, PS2 or a memory actor binding.
    if(v.type==='protagonist_model') {
      if(!this.hostContext ||
         v.payload.hostRunId!==this.hostContext.hostRunId ||
         v.payload.worldEpoch!==this.hostContext.worldEpoch) {
        this.reset('fault');return false;
      }
      return true;
    }
    if(v.type==='memory_authority') {
      if(!this.hostContext||v.payload.hostRunId!==this.hostContext.hostRunId||
         v.payload.worldEpoch!==this.hostContext.worldEpoch)return false;
      // Native owner frame must agree with already accepted PS2 index.
      return v.payload.owners.every(o=>{
        const row=this.observerIndex.get(o.observerCaptureRef);
        return this.current(o.observerCaptureRef)&&row?.owned===true&&
          row.incarnationId===o.incarnationId&&row.encounterId===o.encounterId;
      });
    }
    if(v.type==='memory_m7_idle_diagnostic') {
      const p=v.payload,index=this.observerIndex.get(p.observerCaptureRef);
      // Diagnostics must be from the same authenticated stream and current
      // native observer incarnation. Never feed these fields to an idle grant.
      return this.hostContext?.hostRunId===p.hostRunId &&
        this.hostContext?.worldEpoch===p.worldEpoch &&
        this.current(p.observerCaptureRef) &&
        index?.kind==='ped' && index?.owned===true &&
        index.incarnationId===p.incarnationId &&
        index.encounterId===p.encounterId;
    }
    if(v.type==='memory_current_owner_player') {
      const p=v.payload;
      // Only negotiated native owner-fiber samples, after authenticated
      // stream/sequence and exact current P2 incarnation/encounter admission.
      if(this.memoryCurrentOwnerPlayerVersion!==1 || !this.hostContext ||
         p.hostRunId!==this.hostContext.hostRunId ||
         p.worldEpoch!==this.hostContext.worldEpoch ||
         !this.current(p.protagonist.playerCaptureRef) ||
         this.anchors.get(p.protagonist.playerCaptureRef)?.kind!=='player')
        return false;
      // K-21 samples are complete for *currently provable* owners, not
      // necessarily every live native observer. An owner that is suspended,
      // faulting or fails lifetime proof is intentionally omitted by the
      // production sampler. Omission grants NO authority; asserted owners
      // must individually match the authenticated live anchor and index.
      for(const owner of p.owners) {
        const row=this.observerIndex.get(owner.observerCaptureRef);
        const anchor=this.anchors.get(owner.observerCaptureRef);
        if(!this.current(owner.observerCaptureRef) ||
           !anchor?.observer || !anchor.owned || anchor.kind!=='ped' ||
           !row?.owned || row.kind!=='ped' ||
           row.incarnationId!==owner.incarnationId ||
           row.encounterId!==owner.encounterId)return false;
      }
      return true;
    }
    if(v.type==='m9_sample') {
      const p=v.payload;
      // Negotiated, authenticated native sample only. Anything else is stale
      // transport noise: it never resets the stream and never grants authority.
      const player=this.anchors.get(p.playerCaptureRef),vehicle=p.vehicleCaptureRef?this.anchors.get(p.vehicleCaptureRef):null;
      if(!this.m9Events || this.m9SampleVersion!==1 || !this.hostContext ||
         p.hostRunId!==this.hostContext.hostRunId || p.worldEpoch!==this.hostContext.worldEpoch ||
         !this.current(p.playerCaptureRef) || player?.kind!=='player' ||
         p.vehicleCaptureRef && (!this.current(p.vehicleCaptureRef) || vehicle?.kind!=='vehicle') ||
         p.witnessReceipts.length && !this.capabilities.witness ||
         p.ageMs>=BOUNDS.signalTtlMs) {this.count('stale');return true;}
      this.count('received');
      try {this.m9Events.ingest({runtime:this,payload:p,streamId:v.streamId,sequence:v.sequence});}
      catch {this.count('dropped');}
      // An ignored/disabled optional sample must never look like a transport
      // fault: a false return would retire the D02 native owner-player leases.
      return true;
    }
    if(v.type==='director_social') {
      const p=v.payload,owner=this.directorOwnerProofFor(p.speakerCaptureRef);
      if(!this.hostContext || p.hostRunId!==this.hostContext.hostRunId ||
         p.worldEpoch!==this.hostContext.worldEpoch ||
         !owner || owner.ownerIncarnationId!==p.ownerIncarnationId ||
         owner.proofRevision!==p.ownerProofRevision ||
         !this.current(p.playerCaptureRef) ||
         this.anchors.get(p.playerCaptureRef)?.kind!=='player'){
        this.count('stale');return true;
      }
      this.socialScenes.set(p.speakerCaptureRef,Object.freeze({...p,receivedAt:this.now()}));
      return true;
    }
    if(v.type==='director_priority') {
      if(this.directorRequestVersion!==1 || !this.hostContext) return false;
      this.directorPriority=Object.freeze({...v.payload,receivedAt:this.now(),
        hostRunId:this.hostContext.hostRunId,worldEpoch:this.hostContext.worldEpoch});
      return true;
    }
    if(v.type==='director_response') {
      if(this.directorRequestVersion!==1)return false;
      // Preview-only, no grant/turn submission/auto-memory side effects.
      this.directorReceipts.push(Object.freeze({ticketId:v.payload.ticketId,status:v.payload.status}));
      if(this.directorReceipts.length>32)this.directorReceipts.shift();
      return true;
    }
    if(v.type==='anchors') {
      const projected=new Map(this.anchors);
      for(const a of v.payload) {
        const old=projected.get(a.captureRef);
        if(old && old.kind!==a.kind || !old && projected.size>=BOUNDS.anchors) {this.count('dropped');this.bump(this.dropDiagnostics,'anchorCapacity');this.reset('fault');return false;}
        projected.set(a.captureRef,{...a,expires:this.leaseNow()+BOUNDS.anchorLeaseMs});
      }
      if([...projected.values()].filter(a=>a.observer).length>BOUNDS.observers) {this.bump(this.dropDiagnostics,'observerCapacity');this.reset('fault');return false;}
      // Commit a validated roster frame at once, so a paired demotion/promotion
      // batch cannot expose a transient 17-observer state to companion logic.
      this.anchors=projected;
      for(const a of v.payload)this.missingRefReasons.delete(a.captureRef);
      return true;
    }
    if(v.type==='observer_situation') {
      if(this.observerSituationVersion!==1 || !this.hostContext) {this.reset('fault');return false;}
      for(const row of v.payload) {
        const old=this.observerSituations.get(row.captureRef);
        const original=this.observerIndex.get(row.captureRef);
        if(row.primaryOwner!=null && (this.primaryBehaviorOwnerVersion!==1 || !original?.incarnationId) ||
           row.ownerProofRevision!=null && (!original?.owned || !original.incarnationId || !row.primaryOwner) ||
           !this.current(row.captureRef) || !original ||
           this.anchors.get(row.captureRef).kind!=='ped' ||
           old && (row.situationRevision<=old.situationRevision ||
             row.ownerProofRevision!=null && old.ownerProofRevision!=null &&
             row.ownerProofRevision<old.ownerProofRevision)) {this.reset('fault');return false;}
      }
      for(const row of v.payload) this.observerSituations.set(row.captureRef,Object.freeze({...row,primaryOwner:readPrimaryBehaviorOwner(row.primaryOwner),expires:this.leaseNow()+BOUNDS.anchorLeaseMs}));
      for(const row of v.payload)this.refreshSalience(row.captureRef);
      return true;
    }
    if(v.type==='observer_index') {
      if(this.observerIndexVersion!==1 || !this.hostContext) {this.reset('fault');return false;}
      const next=new Map(this.observerIndex);
      for(const row of v.payload) {
        const anchor=this.anchors.get(row.captureRef);
        if(!this.current(row.captureRef) || anchor.kind!==row.kind || Boolean(anchor.owned)!==row.owned || !next.has(row.captureRef) && next.size>=BOUNDS.anchors) {this.reset('fault');return false;}
        const old=next.get(row.captureRef);
        if(old && (old.encounterId!==row.encounterId || old.incarnationId!==row.incarnationId)) {this.reset('fault');return false;}
        next.set(row.captureRef,Object.freeze({...row}));
      }
      this.observerIndex=next;return true;
    }
    if(v.type==='retire') {this.retire(v.payload.captureRef);return true;}
    if(v.type==='retire_batch') {for(const ref of v.payload) this.retire(ref,'retire_batch');return true;}
    if(v.type==='diagnostics') {const radio=v.payload.radio?Object.freeze({...v.payload.radio}):undefined;this.diagnostics=Object.freeze({...v.payload,damageCallbacks:Object.freeze({...v.payload.damageCallbacks}),...(radio?{radio}:{})});this.capabilities=Object.freeze({...v.payload.capabilities});return true;}
    const s=v.payload, cap={ped_damage:'pedDamage',player_damage:'playerDamage',vehicle_damage:'vehicleDamage',shooting:'shooting',state:'state',action:'action',playback:'playback'}[s.producer];
    if(s.producer==='radio') { if(this.radio!=='shadow') {this.count('stale');return false;} }
    else if(!this.capabilities[cap]) {this.count('stale');return false;}
    if(s.witnessReceipts?.length && !this.capabilities.witness) {this.count('stale');return false;}
    if(s.producerSequence<=(this.producers.get(s.producer)||0)) {this.count('duplicate');return false;}
    // Producer gaps reflect bounded callback loss, never proof of an outcome.
    if(s.producerSequence>(this.producers.get(s.producer)||0)+1) this.count('gaps');
    this.producers.set(s.producer,s.producerSequence);
    if([s.target,s.source,s.facts.vehicle].some(ref=>ref && !this.current(ref))) {this.count('stale');return false;}
    if(s.kind==='vehicle_transition' && s.facts.vehicle && this.anchors.get(s.facts.vehicle)?.kind!=='vehicle') {this.count('stale');return false;}
    if(s.source && this.anchors.get(s.source).kind==='vehicle' || s.kind==='vehicle_state' && s.facts.driver && (!this.current(s.facts.driver) || this.anchors.get(s.facts.driver).kind==='vehicle')) {this.count('stale');return false;}
    if(s.target && ((['vehicle_damage','vehicle_state','radio_changed','radio_stopped'].includes(s.kind)) !== (this.anchors.get(s.target).kind==='vehicle')) || s.producer==='player_damage' && s.target && this.anchors.get(s.target).kind!=='player') {this.count('stale');return false;}
    if(s.ageMs>=BOUNDS.signalTtlMs) {this.count('expired');return false;}
    const critical=s.kind==='death' || ['damage','vehicle_damage'].includes(s.kind) && Boolean(this.anchors.get(s.target)?.observer || this.anchors.get(s.target)?.kind==='player');
    const facts={...s.facts};if(facts.collision) facts.collision=Object.freeze({...facts.collision});
    const value=Object.freeze({...s,facts:Object.freeze(facts)});
    this.count('received');
    // Complete envelope, source/producer sequence, capabilities, reference
    // kinds and TTL have all been checked. Off consumers retain no semantic
    // history and cannot receive an accepted-observation tap.
    if(!this.correlator)return true;
    if(s.producer==='radio') {
      this.retainSignal(value,false,this.now()+BOUNDS.signalTtlMs-s.ageMs);
      const normalized=s.kind==='radio_changed'?normalizeRadioSignal(s,this.radioCatalog):null;
      this.bump(this.radioDiagnostics,s.kind==='radio_changed'?'changed':'stopped');
      const catalog=s.kind==='radio_stopped'?'stopped':!normalized?'invalid':normalized.contentKind==='off'?'off':
        normalized.trackKnown?'known':normalized.catalogMismatch?'mismatch':'unknown';
      if(['known','unknown','mismatch','off'].includes(catalog)) this.bump(this.radioDiagnostics,catalog);
      const catalogRow=s.kind==='radio_changed' ? this.radioCatalog?.tracks?.[String(s.facts.trackTextId)] : null;
      const catalogReason=s.kind==='radio_stopped'?'radio_stopped':
         !this.radioCatalog?.loaded?'catalog_unavailable':
         !Number.isSafeInteger(s.facts.trackTextId)||s.facts.trackTextId<=0?'text_id_unavailable':
         !catalogRow?'text_id_not_cataloged':
         !catalogRow.stations.includes(s.facts.station)?'station_mismatch':
         normalized?.contentKind==='off'?'semantic_off':
         normalized?.trackKnown?'resolved':'catalog_metadata_incomplete';
      const radioReceipts=s.witnessReceipts||[],radioWitnesses=this.qualifiedObservers(radioReceipts);
      const radioTrace={traceCode:traceCode(s.signalId),signalKind:s.kind,catalog,catalogReason,
         trackTextId:Number.isSafeInteger(s.facts.trackTextId)?s.facts.trackTextId:0,
         soundHashPresent:Number.isSafeInteger(s.facts.soundHash)&&s.facts.soundHash!==0,
         catalogStationCount:Array.isArray(catalogRow?.stations)?catalogRow.stations.length:0,
         stationCataloged:Boolean(this.radioCatalog?.stations?.[s.facts.station]),receipts:radioReceipts.length,
        qualified:radioWitnesses.size,ownedQualified:[...radioWitnesses].filter(ref=>this.owned(ref)).length,
        ownedObservers:[...this.observerIndex.values()].filter(row=>row.owned && this.current(row.captureRef)).length,
        ps2:'dropped',ps2Reason:'none',observations:0,ownedObservations:0,ps3Owned:'not_evaluated',ps3Reason:'none'};
      if(s.kind==='radio_changed' && !normalized) {this.ps2Diagnostics.dropped=Math.min(MAX_COUNTER,this.ps2Diagnostics.dropped+1);radioTrace.ps2Reason='radio_normalization_failed';this.emitTrace('radio_trace',radioTrace.ownedQualified>0,radioTrace);return true;}
      const semanticOff=normalized?.contentKind==='off';
      const correlationSignal=semanticOff?{...s,kind:'radio_stopped',facts:{station:'',soundHash:0,trackTextId:0}}:s;
      const correlated=this.correlator.ingest({nativeRun:this.epoch,signal:correlationSignal,radio:semanticOff?null:normalized,witnessReceipts:semanticOff?[]:radioReceipts});
      if(correlated.duplicate) this.ps2Diagnostics.duplicates=Math.min(MAX_COUNTER,this.ps2Diagnostics.duplicates+1);
      else if(correlated.accepted) {this.ps2Diagnostics.correlated=Math.min(MAX_COUNTER,this.ps2Diagnostics.correlated+Number(Boolean(correlated.episodeId)));this.ps2Diagnostics.witnessed=Math.min(MAX_COUNTER,this.ps2Diagnostics.witnessed+correlated.observations.length);}
      if(!correlated.accepted) this.ps2Diagnostics.dropped=Math.min(MAX_COUNTER,this.ps2Diagnostics.dropped+1);
      for(const observationId of correlated.removedObservationIds||[]) this.salience?.forgetObservation(observationId);
      for(const observation of correlated.observations||[]) this.#tapAcceptedObservation(observation);
      // R4 ranks radio locally only. R5 remains responsible for model-visible projection.
      this.noteObservations(correlated.observations,radioTrace);
      this.radioDiagnostics.observations=Math.min(MAX_COUNTER,this.radioDiagnostics.observations+(correlated.observations?.length??0));
      this.radioDiagnostics.ownedObservations=Math.min(MAX_COUNTER,this.radioDiagnostics.ownedObservations+radioTrace.ownedObservations);
      this.ps2Diagnostics.ownedWitnessed=Math.min(MAX_COUNTER,this.ps2Diagnostics.ownedWitnessed+radioTrace.ownedObservations);
      radioTrace.ps2=correlated.duplicate?'duplicate':!correlated.accepted?'dropped':(correlated.observations?.length?'accepted':'unwitnessed');
      radioTrace.ps2Reason=correlated.reason??'none';radioTrace.observations=correlated.observations?.length??0;
      this.emitTrace('radio_trace',radioTrace.ownedQualified>0||radioTrace.ownedObservations>0,radioTrace);
      return true;
    }
    const selfReceipts=[];
    for(const anchor of this.anchors.values()) {
      if(!anchor.observer || anchor.kind!=='ped') continue;
      const involved=s.target===anchor.captureRef&&(s.kind==='damage'||s.kind==='death'||s.kind==='injury_state') || s.source===anchor.captureRef&&s.kind==='firing';
      if(involved) selfReceipts.push({observer:{captureRef:anchor.captureRef,kind:'ped'},sampledGameTick:s.gameTick,status:'witnessed',reason:'self_involvement',knowsSource:s.source===anchor.captureRef,knowsTarget:s.target===anchor.captureRef,evidence:{channel:'self',basis:s.producer==='state'?'sampled_state':'native_callback',sampledGameTick:s.gameTick}});
    }
    const receipts=[...(s.witnessReceipts||[]),...selfReceipts];
    const correlated=this.correlator.ingest({nativeRun:this.epoch,signal:s,witnessReceipts:receipts});
    if(correlated.duplicate) this.ps2Diagnostics.duplicates=Math.min(MAX_COUNTER,this.ps2Diagnostics.duplicates+1);
    else if(correlated.accepted) {this.ps2Diagnostics.correlated=Math.min(MAX_COUNTER,this.ps2Diagnostics.correlated+Number(Boolean(correlated.episodeId)));this.ps2Diagnostics.witnessed=Math.min(MAX_COUNTER,this.ps2Diagnostics.witnessed+correlated.observations.length);}
    if(!correlated.accepted) this.ps2Diagnostics.dropped=Math.min(MAX_COUNTER,this.ps2Diagnostics.dropped+1);
    for(const observation of correlated.observations||[]) this.#tapAcceptedObservation(observation);
    const traced=TRACED_KINDS.has(s.kind) && (s.kind!=='injury_state' || s.facts.injured===true);
    const witnesses=traced?this.qualifiedObservers(receipts):null;
    const outcome={traceCode:traced?traceCode(s.signalId):null,signalKind:s.kind,producer:s.producer,
      receipts:(s.witnessReceipts||[]).length,selfReceipts:selfReceipts.length,qualified:witnesses?.size??0,
      ownedQualified:witnesses?[...witnesses].filter(ref=>this.owned(ref)).length:0,
      ownedObservers:traced?[...this.observerIndex.values()].filter(row=>row.owned && this.current(row.captureRef)).length:0,
      ps2:correlated.duplicate?'duplicate':!correlated.accepted?'dropped':(correlated.observations?.length?'accepted':'unwitnessed'),
      ps2Reason:correlated.reason??'none',observations:correlated.observations?.length??0,ownedObservations:0,ps3Owned:'not_evaluated',ps3Reason:'none'};
    this.noteObservations(correlated.observations,outcome);
    this.ps2Diagnostics.ownedWitnessed=Math.min(MAX_COUNTER,this.ps2Diagnostics.ownedWitnessed+outcome.ownedObservations);
    if(traced) this.emitTrace('perception_trace',outcome.ownedQualified>0||outcome.ownedObservations>0,outcome);
    // Raw signals are retained only for bounded diagnostics. Retention pressure
    // must never reject an otherwise valid signal before PS2/PS3 processing.
    this.retainSignal(value,critical,this.now()+BOUNDS.signalTtlMs-s.ageMs);
    return true;
  }
  // M9 candidate -> PS2. Invoked ONLY from the authenticated m9_sample path
  // above (through M9RuntimeEvents' bridge). Observations are delivered to the
  // synchronous M3 tap and deliberately NOT to PS3 salience: M9 incidents are
  // journal-only and never become an autonomous speech trigger by themselves.
  acceptM9Candidate({candidate,witnessReceipts=[],sourceAgeMs=0}={}) {
    if(!this.correlator||!this.epoch)return {accepted:false,reason:'ps2_unavailable'};
    const correlated=this.correlator.ingestM9({nativeRun:this.epoch,candidate,witnessReceipts,sourceAgeMs});
    if(correlated.duplicate)this.ps2Diagnostics.duplicates=Math.min(MAX_COUNTER,this.ps2Diagnostics.duplicates+1);
    else if(correlated.accepted){
      this.ps2Diagnostics.correlated=Math.min(MAX_COUNTER,this.ps2Diagnostics.correlated+Number(Boolean(correlated.episodeId)));
      this.ps2Diagnostics.witnessed=Math.min(MAX_COUNTER,this.ps2Diagnostics.witnessed+correlated.observations.length);
    }
    if(!correlated.accepted)this.ps2Diagnostics.dropped=Math.min(MAX_COUNTER,this.ps2Diagnostics.dropped+1);
    for(const observation of correlated.observations||[])this.#tapAcceptedObservation(observation);
    return correlated;
  }
  situationFor(ref,playerCaptureRef=null) {
    let view={};try {view=this.situationProvider(ref)??{};} catch {}
    const sample=this.observerSituations.get(ref),live=sample && sample.expires>this.leaseNow() && this.current(ref);
    return situationFromCharacterView({...view,bindings:[],nowMonotonicMs:this.now(),lifetimeCurrent:this.current(ref),channelHealthy:Boolean(this.epoch),perceptionSupported:true,playerCaptureRef,activity:live?sample.activity:'unknown',primaryOwner:live?sample.primaryOwner:null,ownerProofRevision:live?sample.ownerProofRevision:0,situationRevision:live?sample.situationRevision:0});
  }
  // Native P2-origin, incarnation-scoped source revision. This is
  // transport evidence ONLY, never a grant or global player-turn version.
  // TTL, world reset, retirement and association checks are independently
  // required before using it as a candidate stamp.
  directorOwnerProofFor(observerRef) {
    const index=this.observerIndex.get(observerRef);
    const row=this.observerSituations.get(observerRef);
    if(!this.hostContext || !this.current(observerRef) ||
       !index?.owned || index.kind!=='ped' || !index.incarnationId ||
       !this.anchors.get(observerRef)?.observer ||
       !row || row.expires<=this.leaseNow() || !row.primaryOwner ||
       !Number.isSafeInteger(row.ownerProofRevision) ||
       row.ownerProofRevision<=0 || row.ownerProofRevision>2147483647)
      return null;
    return Object.freeze({
      hostRunId:this.hostContext.hostRunId,
      worldEpoch:this.hostContext.worldEpoch,
      speakerCaptureRef:observerRef,
      ownerIncarnationId:index.incarnationId,
      proofRevision:row.ownerProofRevision,
    });
  }
  // Native-social source is independently sampled by the native owner fiber,
  // not inferred from a PS3 salience candidate, a player utterance or an
  // arbitrary JS prompt. It is never itself permission to speak.
  directorSocialFor(speaker) {
    const sample=this.socialScenes.get(speaker),now=this.now();
    if(!sample || !Number.isSafeInteger(now) ||
       now<sample.receivedAt || now-sample.receivedAt>9000 ||
       !this.epoch || !this.hostContext ||
       sample.hostRunId!==this.hostContext.hostRunId ||
       sample.worldEpoch!==this.hostContext.worldEpoch ||
       !this.current(sample.playerCaptureRef))return null;
    const owner=this.directorOwnerProofFor(speaker);
    if(!owner || owner.ownerIncarnationId!==sample.ownerIncarnationId ||
       owner.proofRevision!==sample.ownerProofRevision)return null;
    return Object.freeze({
      kind:'speech',source:'native_director_social',
      speakerCaptureRef:speaker,playerCaptureRef:sample.playerCaptureRef,
      observationId:sample.sceneId,observationRevision:1,
      decisionKey:'social:'+sample.sceneId,policyVersion:1,
      urgency:['shared_vehicle_entry','reunion','manual'].includes(sample.sceneType)?'urgent':'routine',
      sceneType:sample.sceneType,role:sample.role,
      expiresAtMonotonicMs:sample.receivedAt+9000,
    });
  }
  directorSocialEntitlementFor(proposal,stamp) {
    if(proposal?.source!=='native_director_social' ||
       !stamp || proposal.speakerCaptureRef!==stamp.speakerCaptureRef ||
       proposal.playerCaptureRef!==stamp.playerCaptureRef ||
       proposal.policyVersion!==stamp.policyVersion ||
       stamp.hostRunId!==this.hostContext?.hostRunId ||
       stamp.worldEpoch!==this.hostContext?.worldEpoch)return null;
    const native=this.directorSocialFor(proposal.speakerCaptureRef);
    if(!native || native.observationId!==proposal.observationId ||
       native.decisionKey!==proposal.decisionKey ||
       native.urgency!==proposal.urgency ||
       native.sceneType!==proposal.sceneType ||
       native.role!==proposal.role)return null;
    const owner=this.directorOwnerProofFor(proposal.speakerCaptureRef);
    if(!owner || owner.ownerIncarnationId!==stamp.ownerIncarnationId ||
       owner.proofRevision!==stamp.proofRevision)return null;
    return Object.freeze({
      source:'native_director_social',
      hostRunId:stamp.hostRunId,worldEpoch:stamp.worldEpoch,
      speakerCaptureRef:proposal.speakerCaptureRef,
      playerCaptureRef:proposal.playerCaptureRef,
      ownerIncarnationId:stamp.ownerIncarnationId,
      proofRevision:stamp.proofRevision,
      observationId:proposal.observationId,
      observationRevision:proposal.observationRevision,
      decisionKey:proposal.decisionKey,policyVersion:1,
      expiresAtMonotonicMs:proposal.expiresAtMonotonicMs,
      ageMs:Math.min(2000,Math.max(0,this.now()-(this.socialScenes.get(proposal.speakerCaptureRef)?.receivedAt??0))),
    });
  }
  // Companion-local ORIGINAL PS2 observation + PS3 ledger authorization.
  // This can establish a genuine companion entitlement; it is intentionally
  // NOT an independently authenticated native C-06/Essential grant. No ticket,
  // playback, PS3 acknowledgement or cooldown is consumed by this read.
  // Use only at pre-intake stages: after publication the original observation
  // can expire while a legitimately started Essential TTS continues.
  directorOriginalEntitlementFor(proposal,stamp) {
    if(!proposal || proposal.kind!=='speech' || !stamp ||
       !this.epoch || !this.hostContext ||
       proposal.speakerCaptureRef!==stamp.speakerCaptureRef ||
       proposal.playerCaptureRef!==stamp.playerCaptureRef ||
       proposal.policyVersion!==stamp.policyVersion ||
       stamp.policyVersion!==1 || !Number.isSafeInteger(stamp.worldEpoch) ||
       stamp.worldEpoch!==this.hostContext.worldEpoch ||
       stamp.hostRunId!==this.hostContext.hostRunId)
       return null;
    const owner=this.directorOwnerProofFor(proposal.speakerCaptureRef);
    if(!owner || owner.hostRunId!==stamp.hostRunId ||
       owner.worldEpoch!==stamp.worldEpoch ||
       owner.ownerIncarnationId!==stamp.ownerIncarnationId ||
       owner.proofRevision!==stamp.proofRevision)return null;
    const now=this.now();
    const candidates=this.directorCandidatesFor(proposal.speakerCaptureRef);
    for(const candidate of candidates) {
      const observation=candidate.observation,decision=candidate.decision;
      if(observation?.observationId!==proposal.observationId ||
         observation.revision!==proposal.observationRevision ||
         observation.observedAt?.nativeRun!==this.epoch ||
         decision?.observationId!==observation.observationId ||
         decision.revision!==observation.revision ||
         decision.decisionKey!==proposal.decisionKey ||
         decision.policyVersion!==proposal.policyVersion ||
         (decision.response==='urgent'?'urgent':'routine')!==proposal.urgency)
          continue;
      const original=this.observations.entries.get(
        proposal.speakerCaptureRef+':'+observation.episodeId);
      const grant=this.salience.ledger.get(observation.observationId);
      if(!original ||
         original.value.observationId!==observation.observationId ||
         original.value.revision!==observation.revision ||
         original.value.observedAt?.nativeRun!==observation.observedAt.nativeRun ||
         !grant || grant.revision!==observation.revision ||
         grant.decisionKey!==decision.decisionKey ||
         grant.granted!==decision.response ||
         grant.consumed || grant.consumedBy?.has('ps6_ticket') ||
         !grant.pair ||
         grant.pair.observation.observationId!==observation.observationId ||
         grant.pair.observation.revision!==observation.revision ||
         grant.pair.decision.decisionKey!==decision.decisionKey ||
         // A new native situation sample is not new decision authority.
         // Retain the originally qualified decision ONLY while current
         // source-backed P2 owner revision and all salience policy inputs
         // remain identical. Actual ownership/policy changes still retire it.
         !sameSalienceSituationPolicy(grant.pair.situation,
           this.situationFor(proposal.speakerCaptureRef,proposal.playerCaptureRef),
           observation) ||
         grant.pair.situation.ownerProofRevision!==owner.proofRevision)
          continue;
      // Independently re-evaluate the original source-clock window; PS0/PS1
      // must not import the PS6 selector or the stock turn scheduler. If
      // selection policy TTL ever changes without this validator, mismatched
      // expiry fails closed instead of silently extending entitlement.
      const ttl=decision.response==='urgent'?2000:10000;
      const observedAt=candidate.observedAtMonotonicMs;
      const age=now-observedAt;
      const sourceExpiry=Math.min(observedAt+ttl,
        observation.expiresAtMonotonicMs,decision.expiresAtMonotonicMs);
      if(!Number.isSafeInteger(observedAt) || !Number.isSafeInteger(now) ||
         age<0 || age>=ttl || sourceExpiry<=now ||
         !Array.isArray(observation.claims) ||
         !observation.claims.some(c=>c?.certainty==='supported' &&
                                     c.evidence?.channel!=='report') ||
         sourceExpiry!==proposal.expiresAtMonotonicMs)
          continue;
      // The signal ID comes from the original immutable PS2 claim's native
      // event provenance, not from the proposed Director request. Native
      // separately retains only facts *it actually sent* to this observer.
      const signalId=grant.pair.observation.claims.find(c=>
        c.certainty==='supported' && c.evidence?.channel!=='report' &&
        typeof c.details?.eventSignalId==='string')?.details?.eventSignalId??null;
      const nativeSituation=this.observerSituations.get(proposal.speakerCaptureRef);
      return Object.freeze({
        source:'original_companion_ps2_ps3',
        signalId,challenge:nativeSituation?.ps3Challenge??null,
        situationRevision:nativeSituation?.situationRevision??0,
        ageMs:Math.floor(age),
        hostRunId:owner.hostRunId,worldEpoch:owner.worldEpoch,
        speakerCaptureRef:owner.speakerCaptureRef,
        playerCaptureRef:proposal.playerCaptureRef,
        ownerIncarnationId:owner.ownerIncarnationId,
        proofRevision:owner.proofRevision,
        observationId:observation.observationId,
        observationRevision:observation.revision,
        decisionKey:decision.decisionKey,
        policyVersion:decision.policyVersion,
        expiresAtMonotonicMs:sourceExpiry,
      });
    }
    return null;
  }
  // PS6 candidates are restricted to original PS2/PS3 observer-qualified
  // evidence. This read does not reserve tickets or consume response grants.
  directorCandidatesFor(observerRef) {
    if(!this.salience||!this.observations)return Object.freeze([]);
    if(!this.epoch || !this.current(observerRef))return Object.freeze([]);
    const index=this.observerIndex.get(observerRef);
    if(!index?.owned || index.kind!=='ped' || !this.current(observerRef))
      return Object.freeze([]);
    const players=[...this.anchors.values()].filter(a=>a.kind==='player' && this.current(a.captureRef));
    if(players.length!==1)return Object.freeze([]);
    const player=players[0].captureRef,now=this.now(),candidates=[];
    for(const pair of this.salience.snapshotForObserver(observerRef,this.observations,now)){
      const observation=pair.observation,decision=pair.decision;
      if(decision?.response!=='urgent' && decision?.response!=='eligible')continue;
      const stored=this.observations.entries.get(observerRef+':'+observation.episodeId);
      const grant=this.salience.ledger.get(observation.observationId);
      if(!stored || stored.value.observationId!==observation.observationId ||
         stored.value.revision!==observation.revision ||
         !Number.isSafeInteger(stored.observedAtMonotonicMs) ||
         stored.observedAtMonotonicMs>now ||
         !grant || grant.decisionKey!==decision.decisionKey ||
         grant.consumed || grant.consumedBy?.has('ps6_ticket') ||
         grant.granted==='none' ||
         pair.situation?.playerCaptureRef!==player ||
         pair.situation?.lifetimeCurrent!==true) continue;
      candidates.push(Object.freeze({
        observation,decision,situation:pair.situation,
        observedAtMonotonicMs:stored.observedAtMonotonicMs,
        entitlementCurrent:true,
      }));
    }
    return Object.freeze(candidates);
  }
  refreshSalience(observerRef=null) {
    if(!this.epoch||!this.salience)return;
    const counts=new Map(),situations=new Map();let player=null;
    for(const anchor of this.anchors.values())if(anchor.kind==='player' && this.current(anchor.captureRef)){player=anchor.captureRef;break;}
    for(const entry of this.observations.entries.values()){
      const observation=entry.value,ref=observation.observer.captureRef;
      if(observerRef && ref!==observerRef || !this.current(ref) || observation.expiresAtMonotonicMs<=this.now())continue;
      const count=(counts.get(ref)??0)+1;counts.set(ref,count);if(count>128)continue;
      if(!situations.has(ref))situations.set(ref,this.situationFor(ref,player));
      const situation=situations.get(ref);if(this.salience.needsSituationRefresh(observation,situation))this.noteSalience(observation,situation);
    }
  }
  noteSalience(observation,suppliedSituation=null) {
    if(!this.salience)return null;
    try {
      let player=null;
      for(const anchor of this.anchors.values()) if(anchor.kind==='player') { player=anchor.captureRef; break; }
      const decision=this.salience.evaluate(observation,suppliedSituation??this.situationFor(observation.observer.captureRef,player));
      if(!decision) return;
      const stats=this.ps3Diagnostics;
      stats.decisions=Math.min(MAX_COUNTER,stats.decisions+1);
      if(decision.response==='urgent') stats.urgent=Math.min(MAX_COUNTER,stats.urgent+1);
      else if(decision.response==='eligible') stats.eligible=Math.min(MAX_COUNTER,stats.eligible+1);
      if(decision.memory==='stage') stats.staged=Math.min(MAX_COUNTER,stats.staged+1);
      if(this.owned(observation.observer.captureRef)) {
        stats.ownedDecisions=Math.min(MAX_COUNTER,stats.ownedDecisions+1);
        if(decision.response==='urgent') stats.ownedUrgent=Math.min(MAX_COUNTER,stats.ownedUrgent+1);
        else if(decision.response==='eligible') stats.ownedEligible=Math.min(MAX_COUNTER,stats.ownedEligible+1);
      }
      if(decision.reasons.some(reason=>reason==='repetition_suppressed'||reason==='revision_stale'||reason==='suppression_capacity')) stats.suppressed=Math.min(MAX_COUNTER,stats.suppressed+1);
      for(const reason of decision.reasons) {
        const key=PS3_REASON_COUNTERS[reason];
        if(key) stats.reasons[key]=Math.min(MAX_COUNTER,stats.reasons[key]+1);
      }
      return decision;
    } catch { this.ps3Diagnostics.faults=Math.min(MAX_COUNTER,this.ps3Diagnostics.faults+1); return null; }
  }
  acceptPlayerTranscript({text,receipt=null}={}) {
    return this.transcripts?.accept({capability:this.capabilities.playerSpeech===true,receipt,text})??null;
  }
}
