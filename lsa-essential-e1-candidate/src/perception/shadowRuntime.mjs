import { BOUNDS, CAPABILITIES, validateFrame } from './contracts.mjs';
import { ObservationStore } from './observationStore.mjs';
import { EpisodeStore } from './episodeStore.mjs';
import { EpisodeCorrelator } from './episodeCorrelator.mjs';
import { SharedTranscriptStore } from './sharedTranscriptStore.mjs';
import { SalienceCache } from './salienceEngine.mjs';

export class ShadowRuntime {
  constructor({ mode='off', now=()=>Math.floor(performance.now()) }={}) {
    this.mode=mode;this.now=now;this.anchors=new Map();this.signals=[];this.sequence=0;this.producers=new Map();this.epoch=null;this.stream=null;this.lastReceipt=0;
    this.counters=Object.fromEntries(['received','dropped','stale','malformed','duplicate','gaps','expired','resets'].map(k=>[k,0]));
    this.capabilities=Object.fromEntries(CAPABILITIES.map(k=>[k,false]));this.diagnostics=null;
    this.observations=new ObservationStore({now,current:ref=>this.current(ref)});
    this.episodes=new EpisodeStore({now,current:ref=>this.current(ref)});
    this.correlator=new EpisodeCorrelator({episodes:this.episodes,observations:this.observations,now,current:ref=>this.current(ref),anchor:ref=>this.anchors.get(ref)});
    this.transcripts=new SharedTranscriptStore({now,current:ref=>this.current(ref)});
    this.salience=new SalienceCache({now});
    this.ps2Diagnostics={correlated:0,witnessed:0,duplicates:0,dropped:0,speechGate:'unsupported_capture_receipt'};
    this.ps3Diagnostics={decisions:0,urgent:0,eligible:0,staged:0,suppressed:0,faults:0};
  }
  count(k) { this.counters[k]=Math.min(2147483647,this.counters[k]+1); }
  reset() { this.anchors.clear();this.signals=[];this.producers.clear();this.observations.clear();this.episodes.clear();this.correlator.clear();this.salience.clear();this.transcripts.setActiveRun(null);this.epoch=null;this.stream=null;this.sequence=0;this.lastReceipt=0;this.diagnostics=null;this.capabilities=Object.fromEntries(CAPABILITIES.map(k=>[k,false]));this.ps3Diagnostics={decisions:0,urgent:0,eligible:0,staged:0,suppressed:0,faults:0};this.count('resets'); }
  current(ref) {const a=this.anchors.get(ref);return Boolean(a && a.expires>this.now() && this.epoch);}
  expire() {
    if(this.epoch && this.now()-this.lastReceipt>3000) {this.reset();return;}
    for(const [ref,a] of this.anchors) if(a.expires<=this.now()) this.retire(ref);
    this.signals=this.signals.filter(s=>{ if(s.expires<=this.now()) {this.count('expired');return false;} return true; });
    this.observations.expire();
    this.episodes.expire();
    this.salience.expire(this.now());
  }
  retire(ref) { this.anchors.delete(ref);this.signals=this.signals.filter(s=>s.value.target!==ref && s.value.source!==ref && s.value.facts.vehicle!==ref);this.observations.expire();this.episodes.expire(); }
  ingest(v, { authenticated=false }={}) {
    if(this.mode!=='shadow' || !authenticated) return false;
    this.expire();
    if(!validateFrame(v)) {this.count('malformed');return false;}
    if(v.type==='hello') {this.reset();this.epoch=v.adapterEpoch;this.stream=v.streamId;this.capabilities=Object.freeze({...v.capabilities});this.transcripts.setActiveRun(this.epoch);this.lastReceipt=this.now();return true;}
    if(v.adapterEpoch!==this.epoch || v.streamId!==this.stream) {this.count('stale');return false;}
    if(v.sequence<=this.sequence) {this.count('duplicate');return false;}
    if(v.sequence!==this.sequence+1) {this.count('gaps');this.reset();return false;}
    this.sequence=v.sequence;this.lastReceipt=this.now();
    if(v.type==='anchors') {
      const projected=new Map(this.anchors);
      for(const a of v.payload) {
        const old=projected.get(a.captureRef);
        if(old && old.kind!==a.kind || !old && projected.size>=BOUNDS.anchors) {this.count('dropped');this.reset();return false;}
        projected.set(a.captureRef,{...a,expires:this.now()+BOUNDS.anchorLeaseMs});
      }
      if([...projected.values()].filter(a=>a.observer).length>BOUNDS.observers) {this.reset();return false;}
      // Commit a validated roster frame at once, so a paired demotion/promotion
      // batch cannot expose a transient 17-observer state to companion logic.
      this.anchors=projected;return true;
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
    if(s.source && this.anchors.get(s.source).kind==='vehicle' || s.kind==='vehicle_state' && s.facts.driver && (!this.current(s.facts.driver) || this.anchors.get(s.facts.driver).kind==='vehicle')) {this.count('stale');return false;}
    if(s.target && ((['vehicle_damage','vehicle_state'].includes(s.kind)) !== (this.anchors.get(s.target).kind==='vehicle')) || s.producer==='player_damage' && s.target && this.anchors.get(s.target).kind!=='player') {this.count('stale');return false;}
    if(s.ageMs>=BOUNDS.signalTtlMs) {this.count('expired');return false;}
    const critical=s.kind==='death' || ['damage','vehicle_damage'].includes(s.kind) && Boolean(this.anchors.get(s.target)?.observer || this.anchors.get(s.target)?.kind==='player');
    if(!critical && this.signals.filter(x=>!x.critical).length>=192) {this.count('dropped');return false;}
    if(this.signals.length>=256) {const index=this.signals.findIndex(x=>!x.critical);if(index<0) {this.count('dropped');return false;}this.signals.splice(index,1);this.count('dropped');}
    const facts={...s.facts};if(facts.collision) facts.collision=Object.freeze({...facts.collision});
    const value=Object.freeze({...s,facts:Object.freeze(facts)});
    this.signals.push({value,critical,expires:this.now()+BOUNDS.signalTtlMs-s.ageMs});this.count('received');
    const selfReceipts=[];
    for(const anchor of this.anchors.values()) {
      if(!anchor.observer || anchor.kind!=='ped') continue;
      const involved=s.target===anchor.captureRef&&(s.kind==='damage'||s.kind==='death') || s.source===anchor.captureRef&&s.kind==='firing';
      if(involved) selfReceipts.push({observer:{captureRef:anchor.captureRef,kind:'ped'},sampledGameTick:s.gameTick,status:'witnessed',reason:'self_involvement',evidence:{channel:'self',basis:s.producer==='state'?'sampled_state':'native_callback',sampledGameTick:s.gameTick}});
    }
    const correlated=this.correlator.ingest({nativeRun:this.epoch,signal:s,witnessReceipts:[...(s.witnessReceipts||[]),...selfReceipts]});
    if(correlated.duplicate) this.ps2Diagnostics.duplicates=Math.min(2147483647,this.ps2Diagnostics.duplicates+1);
    else if(correlated.accepted) {this.ps2Diagnostics.correlated=Math.min(2147483647,this.ps2Diagnostics.correlated+Number(Boolean(correlated.episodeId)));this.ps2Diagnostics.witnessed=Math.min(2147483647,this.ps2Diagnostics.witnessed+correlated.observations.length);}
    if(!correlated.accepted) this.ps2Diagnostics.dropped=Math.min(2147483647,this.ps2Diagnostics.dropped+1);
    for(const observation of correlated.observations||[]) this.noteSalience(observation);
    return true;
  }
  noteSalience(observation) {
    try {
      let player=null;
      for(const anchor of this.anchors.values()) if(anchor.kind==='player') { player=anchor.captureRef; break; }
      const decision=this.salience.evaluate(observation,{nowMonotonicMs:this.now(),lifetimeCurrent:this.current(observation.observer.captureRef),channelHealthy:Boolean(this.epoch),perceptionSupported:true,playerCaptureRef:player,activity:'unknown'});
      if(!decision) return;
      const stats=this.ps3Diagnostics;
      stats.decisions=Math.min(2147483647,stats.decisions+1);
      if(decision.response==='urgent') stats.urgent=Math.min(2147483647,stats.urgent+1);
      else if(decision.response==='eligible') stats.eligible=Math.min(2147483647,stats.eligible+1);
      if(decision.memory==='stage') stats.staged=Math.min(2147483647,stats.staged+1);
      if(decision.reasons.some(reason=>reason==='repetition_suppressed'||reason==='revision_stale'||reason==='suppression_capacity')) stats.suppressed=Math.min(2147483647,stats.suppressed+1);
    } catch { this.ps3Diagnostics.faults=Math.min(2147483647,this.ps3Diagnostics.faults+1); }
  }
  acceptPlayerTranscript({text,receipt=null}={}) {
    return this.transcripts.accept({capability:this.capabilities.playerSpeech===true,receipt,text});
  }
}
