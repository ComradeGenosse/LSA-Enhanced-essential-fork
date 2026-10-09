import {readPrimaryBehaviorOwner} from '../context/primaryBehaviorOwner.mjs';
import { BOUNDS, CAPABILITIES, validateFrame } from './contracts.mjs';
import { ObservationStore } from './observationStore.mjs';
import { EpisodeStore } from './episodeStore.mjs';
import { EpisodeCorrelator } from './episodeCorrelator.mjs';
import { SharedTranscriptStore } from './sharedTranscriptStore.mjs';
import { SalienceCache, situationFromCharacterView } from './salienceEngine.mjs';
import { readHostContext } from '../context/hostContext.mjs';

const MAX_COUNTER = 2147483647;
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
  constructor({ mode='off', now=()=>Math.floor(performance.now()), situationFor=()=>({}) }={}) {
    this.mode=mode;this.now=now;this.anchors=new Map();this.signals=[];this.sequence=0;this.producers=new Map();this.epoch=null;this.stream=null;this.lastReceipt=0;
    this.hostContext=null;this.observerIndexVersion=null;this.observerIndex=new Map();this.observerSituations=new Map();this.observerSituationVersion=null;this.primaryBehaviorOwnerVersion=null;this.directorRequestVersion=null;this.directorReceipts=[];this.situationProvider=situationFor;
    this.counters=Object.fromEntries(['received','dropped','stale','malformed','duplicate','gaps','expired','resets'].map(k=>[k,0]));
    this.historyDiagnostics={expired:0,evicted:0,skipped:0,highWater:0};
    this.dropDiagnostics={anchorCapacity:0,observerCapacity:0};
    this.resetDiagnostics={initializations:0,disconnects:0,faults:0,timeouts:0,manual:0};
    this.capabilities=Object.fromEntries(CAPABILITIES.map(k=>[k,false]));this.diagnostics=null;
    this.observations=new ObservationStore({now,current:ref=>this.current(ref)});
    this.episodes=new EpisodeStore({now,current:ref=>this.current(ref)});
    this.correlator=new EpisodeCorrelator({episodes:this.episodes,observations:this.observations,now,current:ref=>this.current(ref),anchor:ref=>this.anchors.get(ref)});
    this.transcripts=new SharedTranscriptStore({now,current:ref=>this.current(ref)});
    this.salience=new SalienceCache({now});
    this.ps2Diagnostics={correlated:0,witnessed:0,duplicates:0,dropped:0,speechGate:'unsupported_capture_receipt'};
    this.ps3Diagnostics={decisions:0,urgent:0,eligible:0,staged:0,suppressed:0,faults:0,reasons:Object.fromEntries(Object.values(PS3_REASON_COUNTERS).map(k=>[k,0]))};
  }
  bump(target,k) { target[k]=Math.min(MAX_COUNTER,(target[k]||0)+1); }
  count(k) { this.bump(this.counters,k); }
  reset(reason='manual') {
    this.hostContext=null;this.observerIndexVersion=null;this.observerIndex.clear();this.observerSituations.clear();this.observerSituationVersion=null;this.primaryBehaviorOwnerVersion=null;this.directorRequestVersion=null;this.directorReceipts=[];
    this.anchors.clear();this.signals=[];this.producers.clear();this.observations.clear();this.episodes.clear();this.correlator.clear();this.salience.clear();this.transcripts.setActiveRun(null);this.epoch=null;this.stream=null;this.sequence=0;this.lastReceipt=0;this.diagnostics=null;this.capabilities=Object.fromEntries(CAPABILITIES.map(k=>[k,false]));this.count('resets');
    const key={initialization:'initializations',disconnect:'disconnects',fault:'faults',timeout:'timeouts',manual:'manual'}[reason]||'manual';this.bump(this.resetDiagnostics,key);
  }
  current(ref) {const a=this.anchors.get(ref);return Boolean(a && a.expires>this.now() && this.epoch);}
  expire() {
    if(this.epoch && this.now()-this.lastReceipt>3000) {this.reset('timeout');return;}
    for(const [ref,a] of this.anchors) if(a.expires<=this.now()) this.retire(ref);
    this.signals=this.signals.filter(s=>{ if(s.expires<=this.now()) {this.bump(this.historyDiagnostics,'expired');return false;} return true; });
    this.observations.expire();
    this.episodes.expire();
    this.salience.expire(this.now());
  }
  retire(ref) { this.salience.releaseReference(ref);this.anchors.delete(ref);this.observerIndex.delete(ref);this.observerSituations.delete(ref);this.signals=this.signals.filter(s=>s.value.target!==ref && s.value.source!==ref && s.value.facts.vehicle!==ref);this.observations.expire();this.episodes.expire(); }
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
    if(v.type==='hello') {this.reset('initialization');this.epoch=v.adapterEpoch;this.stream=v.streamId;this.hostContext=readHostContext(v);this.observerIndexVersion=v.observerIndexVersion??null;this.observerSituationVersion=v.observerSituationVersion??null;this.primaryBehaviorOwnerVersion=v.primaryBehaviorOwnerVersion??null;this.directorRequestVersion=v.directorRequestVersion??null;this.capabilities=Object.freeze({...v.capabilities});this.transcripts.setActiveRun(this.epoch);this.lastReceipt=this.now();return true;}
    if(v.adapterEpoch!==this.epoch || v.streamId!==this.stream) {this.count('stale');return false;}
    if(v.sequence<=this.sequence) {this.count('duplicate');return false;}
    if(v.sequence!==this.sequence+1) {this.count('gaps');this.reset('fault');return false;}
    this.sequence=v.sequence;this.lastReceipt=this.now();
    if(v.type==='world_epoch') {
      if(!this.hostContext || v.payload.epoch<this.hostContext.worldEpoch || v.payload.epoch>this.hostContext.worldEpoch+1) {this.reset('fault');return false;}
      if(v.payload.epoch===this.hostContext.worldEpoch) return true;
      const context=Object.freeze({...this.hostContext,worldEpoch:v.payload.epoch});
      const epoch=this.epoch,stream=this.stream,sequence=this.sequence,capabilities=this.capabilities;
      const observerIndexVersion=this.observerIndexVersion,observerSituationVersion=this.observerSituationVersion,primaryBehaviorOwnerVersion=this.primaryBehaviorOwnerVersion,directorRequestVersion=this.directorRequestVersion;
      this.reset('manual');this.observerIndexVersion=observerIndexVersion;this.observerSituationVersion=observerSituationVersion;this.primaryBehaviorOwnerVersion=primaryBehaviorOwnerVersion;this.directorRequestVersion=directorRequestVersion;this.hostContext=context;this.epoch=epoch;this.stream=stream;this.sequence=sequence;
      this.capabilities=capabilities;this.transcripts.setActiveRun(epoch);this.lastReceipt=this.now();return true;
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
        projected.set(a.captureRef,{...a,expires:this.now()+BOUNDS.anchorLeaseMs});
      }
      if([...projected.values()].filter(a=>a.observer).length>BOUNDS.observers) {this.bump(this.dropDiagnostics,'observerCapacity');this.reset('fault');return false;}
      // Commit a validated roster frame at once, so a paired demotion/promotion
      // batch cannot expose a transient 17-observer state to companion logic.
      this.anchors=projected;return true;
    }
    if(v.type==='observer_situation') {
      if(this.observerSituationVersion!==1 || !this.hostContext) {this.reset('fault');return false;}
      for(const row of v.payload) {
        const old=this.observerSituations.get(row.captureRef);
        if(row.primaryOwner!=null && (this.primaryBehaviorOwnerVersion!==1 || !this.observerIndex.get(row.captureRef)?.incarnationId) || !this.current(row.captureRef) || !this.observerIndex.has(row.captureRef) || this.anchors.get(row.captureRef).kind!=='ped' || old && row.situationRevision<=old.situationRevision) {this.reset('fault');return false;}
      }
      for(const row of v.payload) this.observerSituations.set(row.captureRef,Object.freeze({...row,primaryOwner:readPrimaryBehaviorOwner(row.primaryOwner),expires:this.now()+BOUNDS.anchorLeaseMs}));
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
    if(v.type==='retire_batch') {for(const ref of v.payload) this.retire(ref);return true;}
    if(v.type==='diagnostics') {this.diagnostics=Object.freeze({...v.payload,damageCallbacks:Object.freeze({...v.payload.damageCallbacks})});this.capabilities=Object.freeze({...v.payload.capabilities});return true;}
    const s=v.payload, cap={ped_damage:'pedDamage',player_damage:'playerDamage',vehicle_damage:'vehicleDamage',shooting:'shooting',state:'state',action:'action',playback:'playback'}[s.producer];
    if(!this.capabilities[cap]) {this.count('stale');return false;}
    if(s.witnessReceipts?.length && !this.capabilities.witness) {this.count('stale');return false;}
    if(s.producerSequence<=(this.producers.get(s.producer)||0)) {this.count('duplicate');return false;}
    // Producer gaps reflect bounded callback loss, never proof of an outcome.
    if(s.producerSequence>(this.producers.get(s.producer)||0)+1) this.count('gaps');
    this.producers.set(s.producer,s.producerSequence);
    if([s.target,s.source,s.facts.vehicle].some(ref=>ref && !this.current(ref))) {this.count('stale');return false;}
    if(s.kind==='vehicle_transition' && s.facts.vehicle && this.anchors.get(s.facts.vehicle)?.kind!=='vehicle') {this.count('stale');return false;}
    if(s.source && this.anchors.get(s.source).kind==='vehicle' || s.kind==='vehicle_state' && s.facts.driver && (!this.current(s.facts.driver) || this.anchors.get(s.facts.driver).kind==='vehicle')) {this.count('stale');return false;}
    if(s.target && ((['vehicle_damage','vehicle_state'].includes(s.kind)) !== (this.anchors.get(s.target).kind==='vehicle')) || s.producer==='player_damage' && s.target && this.anchors.get(s.target).kind!=='player') {this.count('stale');return false;}
    if(s.ageMs>=BOUNDS.signalTtlMs) {this.count('expired');return false;}
    const critical=s.kind==='death' || ['damage','vehicle_damage'].includes(s.kind) && Boolean(this.anchors.get(s.target)?.observer || this.anchors.get(s.target)?.kind==='player');
    const facts={...s.facts};if(facts.collision) facts.collision=Object.freeze({...facts.collision});
    const value=Object.freeze({...s,facts:Object.freeze(facts)});
    this.count('received');
    const selfReceipts=[];
    for(const anchor of this.anchors.values()) {
      if(!anchor.observer || anchor.kind!=='ped') continue;
      const involved=s.target===anchor.captureRef&&(s.kind==='damage'||s.kind==='death'||s.kind==='injury_state') || s.source===anchor.captureRef&&s.kind==='firing';
      if(involved) selfReceipts.push({observer:{captureRef:anchor.captureRef,kind:'ped'},sampledGameTick:s.gameTick,status:'witnessed',reason:'self_involvement',knowsSource:s.source===anchor.captureRef,knowsTarget:s.target===anchor.captureRef,evidence:{channel:'self',basis:s.producer==='state'?'sampled_state':'native_callback',sampledGameTick:s.gameTick}});
    }
    const correlated=this.correlator.ingest({nativeRun:this.epoch,signal:s,witnessReceipts:[...(s.witnessReceipts||[]),...selfReceipts]});
    if(correlated.duplicate) this.ps2Diagnostics.duplicates=Math.min(MAX_COUNTER,this.ps2Diagnostics.duplicates+1);
    else if(correlated.accepted) {this.ps2Diagnostics.correlated=Math.min(MAX_COUNTER,this.ps2Diagnostics.correlated+Number(Boolean(correlated.episodeId)));this.ps2Diagnostics.witnessed=Math.min(MAX_COUNTER,this.ps2Diagnostics.witnessed+correlated.observations.length);}
    if(!correlated.accepted) this.ps2Diagnostics.dropped=Math.min(MAX_COUNTER,this.ps2Diagnostics.dropped+1);
    for(const observation of correlated.observations||[]) this.noteSalience(observation);
    // Raw signals are retained only for bounded diagnostics. Retention pressure
    // must never reject an otherwise valid signal before PS2/PS3 processing.
    this.retainSignal(value,critical,this.now()+BOUNDS.signalTtlMs-s.ageMs);
    return true;
  }
  situationFor(ref,playerCaptureRef=null) {
    let view={};try {view=this.situationProvider(ref)??{};} catch {}
    const sample=this.observerSituations.get(ref),live=sample && sample.expires>this.now() && this.current(ref);
    return situationFromCharacterView({...view,bindings:[],nowMonotonicMs:this.now(),lifetimeCurrent:this.current(ref),channelHealthy:Boolean(this.epoch),perceptionSupported:true,playerCaptureRef,activity:live?sample.activity:'unknown',primaryOwner:live?sample.primaryOwner:null,situationRevision:live?sample.situationRevision:0});
  }
  refreshSalience(observerRef=null) {
    if(!this.epoch)return;
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
      if(decision.reasons.some(reason=>reason==='repetition_suppressed'||reason==='revision_stale'||reason==='suppression_capacity')) stats.suppressed=Math.min(MAX_COUNTER,stats.suppressed+1);
      for(const reason of decision.reasons) {
        const key=PS3_REASON_COUNTERS[reason];
        if(key) stats.reasons[key]=Math.min(MAX_COUNTER,stats.reasons[key]+1);
      }
    } catch { this.ps3Diagnostics.faults=Math.min(MAX_COUNTER,this.ps3Diagnostics.faults+1); }
  }
  acceptPlayerTranscript({text,receipt=null}={}) {
    return this.transcripts.accept({capability:this.capabilities.playerSpeech===true,receipt,text});
  }
}
