import { BOUNDS, validateObservation } from './contracts.mjs';
export class ObservationStore {
  constructor({ now = ()=>Math.floor(performance.now()), current = ()=>false } = {}) { this.now=now; this.current=current; this.entries=new Map(); this.bytes=0; }
  put(input) {
    this.expire();
    if (!validateObservation(input) || !this.current(input.observer.captureRef) || input.claims.some(c=>[c.source,c.target].some(r=>r&&!this.current(r.captureRef))) || input.expiresAtMonotonicMs<=this.now() || input.expiresAtMonotonicMs>this.now()+120000) return false;
    const key = `${input.observer.captureRef}:${input.episodeId}`, old=this.entries.get(key);
    if (old && (input.revision<=old.value.revision || input.observationId!==old.value.observationId)) return false;
    const value=JSON.parse(JSON.stringify(input)), bytes=Buffer.byteLength(JSON.stringify(value));
    const count=[...this.entries.values()].filter(e=>e.value.observer.captureRef===value.observer.captureRef).length;
    if (!old && (this.entries.size>=BOUNDS.observations || count>=BOUNDS.observationsPerObserver) || this.bytes-(old?.bytes||0)+bytes>BOUNDS.observationBytes) return false;
    const freeze = v=>{ if(v && typeof v==='object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
    this.bytes-=old?.bytes||0; this.bytes+=bytes; this.entries.set(key,{value:freeze(value),bytes}); return true;
  }
  expire() { for(const [key,e] of this.entries) if(e.value.expiresAtMonotonicMs<=this.now() || !this.current(e.value.observer.captureRef) || e.value.claims.some(c=>[c.source,c.target].some(r=>r && !this.current(r.captureRef)))) {this.entries.delete(key);this.bytes-=e.bytes;} }
  clear() {this.entries.clear();this.bytes=0;}
}
