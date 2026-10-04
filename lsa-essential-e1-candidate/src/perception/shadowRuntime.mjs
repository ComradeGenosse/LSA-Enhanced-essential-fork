import { BOUNDS, CAPABILITIES, validateFrame } from './contracts.mjs';
import { ObservationStore } from './observationStore.mjs';
import { EpisodeStore } from './episodeStore.mjs';

export class ShadowRuntime {
  constructor({ mode='off', radio='off', now=()=>Math.floor(performance.now()) }={}) {
    this.mode=mode;this.radio=radio==='shadow'?'shadow':'off';this.now=now;this.anchors=new Map();this.signals=[];this.sequence=0;this.producers=new Map();this.epoch=null;this.stream=null;this.lastReceipt=0;
    this.counters=Object.fromEntries(['received','dropped','stale','malformed','duplicate','gaps','expired','resets'].map(k=>[k,0]));
    this.capabilities=Object.fromEntries(CAPABILITIES.map(k=>[k,false]));this.diagnostics=null;
    this.observations=new ObservationStore({now,current:ref=>this.current(ref)});
    this.episodes=new EpisodeStore({now,current:ref=>this.current(ref)});
  }
  count(k) { this.counters[k]=Math.min(2147483647,this.counters[k]+1); }
  reset() { this.anchors.clear();this.signals=[];this.producers.clear();this.observations.clear();this.episodes.clear();this.epoch=null;this.stream=null;this.sequence=0;this.lastReceipt=0;this.diagnostics=null;this.capabilities=Object.fromEntries(CAPABILITIES.map(k=>[k,false]));this.count('resets'); }
  current(ref) {const a=this.anchors.get(ref);return Boolean(a && a.expires>this.now() && this.epoch);}
  expire() {
    if(this.epoch && this.now()-this.lastReceipt>3000) {this.reset();return;}
    for(const [ref,a] of this.anchors) if(a.expires<=this.now()) this.retire(ref);
    this.signals=this.signals.filter(s=>{ if(s.expires<=this.now()) {this.count('expired');return false;} return true; });
    this.observations.expire();
    this.episodes.expire();
  }
  retire(ref) { this.anchors.delete(ref);this.signals=this.signals.filter(s=>s.value.target!==ref && s.value.source!==ref && s.value.facts.vehicle!==ref);this.observations.expire();this.episodes.expire(); }
  ingest(v, { authenticated=false }={}) {
    if(this.mode!=='shadow' || !authenticated) return false;
    this.expire();
    if(!validateFrame(v)) {this.count('malformed');return false;}
    if(v.type==='hello') {this.reset();this.epoch=v.adapterEpoch;this.stream=v.streamId;this.capabilities=Object.freeze({...v.capabilities});this.lastReceipt=this.now();return true;}
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
    if(v.type==='diagnostics') {const radio=v.payload.radio?Object.freeze({...v.payload.radio}):undefined;this.diagnostics=Object.freeze({...v.payload,damageCallbacks:Object.freeze({...v.payload.damageCallbacks}),...(radio?{radio}:{})});this.capabilities=Object.freeze({...v.payload.capabilities});return true;}
    const s=v.payload, cap={ped_damage:'pedDamage',player_damage:'playerDamage',vehicle_damage:'vehicleDamage',shooting:'shooting',state:'state',action:'action',playback:'playback'}[s.producer];
    // Radio remains a raw world fact. This runtime does not create observations from it.
    if(s.producer==='radio') { if(this.radio!=='shadow') {this.count('stale');return false;} }
    else if(!this.capabilities[cap]) {this.count('stale');return false;}
    if(s.producerSequence<=(this.producers.get(s.producer)||0)) {this.count('duplicate');return false;}
    // Producer gaps reflect bounded callback loss, never proof of an outcome.
    if(s.producerSequence>(this.producers.get(s.producer)||0)+1) this.count('gaps');
    this.producers.set(s.producer,s.producerSequence);
    if([s.target,s.source,s.facts.vehicle].some(ref=>ref && !this.current(ref))) {this.count('stale');return false;}
    if(s.source && this.anchors.get(s.source).kind==='vehicle' || s.kind==='vehicle_state' && s.facts.driver && (!this.current(s.facts.driver) || this.anchors.get(s.facts.driver).kind==='vehicle')) {this.count('stale');return false;}
    if(s.target && ((['vehicle_damage','vehicle_state','radio_changed','radio_stopped'].includes(s.kind)) !== (this.anchors.get(s.target).kind==='vehicle')) || s.producer==='player_damage' && s.target && this.anchors.get(s.target).kind!=='player') {this.count('stale');return false;}
    if(s.ageMs>=BOUNDS.signalTtlMs) {this.count('expired');return false;}
    const critical=s.kind==='death' || ['damage','vehicle_damage'].includes(s.kind) && Boolean(this.anchors.get(s.target)?.observer || this.anchors.get(s.target)?.kind==='player');
    if(!critical && this.signals.filter(x=>!x.critical).length>=192) {this.count('dropped');return false;}
    if(this.signals.length>=256) {const index=this.signals.findIndex(x=>!x.critical);if(index<0) {this.count('dropped');return false;}this.signals.splice(index,1);this.count('dropped');}
    const facts={...s.facts};if(facts.collision) facts.collision=Object.freeze({...facts.collision});
    const value=Object.freeze({...s,facts:Object.freeze(facts)});
    this.signals.push({value,critical,expires:this.now()+BOUNDS.signalTtlMs-s.ageMs});this.count('received');return true;
  }
}
