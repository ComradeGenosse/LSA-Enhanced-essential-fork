import { isUuid, exactObject } from '../identity/identityContract.mjs';
import { validateClaim } from './contracts.mjs';

// Immutable episode storage primitive shared by the PS2 shadow correlator.
export function validateEpisode(e) {
  if(!exactObject(e,['version','episodeId','revision','nativeRun','gameTick','expiresAtMonotonicMs','status','participants','claims','producerSequences']) || e.version!==1 || !isUuid(e.episodeId) || !isUuid(e.nativeRun) || !Number.isSafeInteger(e.revision) || e.revision<1 || !Number.isSafeInteger(e.gameTick) || e.gameTick<0 || e.gameTick>0xffffffff || !Number.isSafeInteger(e.expiresAtMonotonicMs) || !['open','settling','closed','expired'].includes(e.status) || !Array.isArray(e.participants) || e.participants.length>4 || e.participants.some(r=>!exactObject(r,['captureRef','kind']) || !isUuid(r.captureRef) || !['ped','vehicle','player'].includes(r.kind)) || !Array.isArray(e.claims) || e.claims.length<1 || e.claims.length>8 || !Array.isArray(e.producerSequences) || e.producerSequences.length>7) return false;
  const producers=new Set(['ped_damage','player_damage','vehicle_damage','state','shooting','action','playback','radio']);
  if(new Set(e.producerSequences.map(s=>s.producer)).size!==e.producerSequences.length || e.producerSequences.some(s=>!exactObject(s,['producer','sequence']) || !producers.has(s.producer) || !Number.isSafeInteger(s.sequence) || s.sequence<1)) return false;
  return e.claims.every(validateClaim);
}
export class EpisodeStore {
  constructor({now=()=>Math.floor(performance.now()),current=()=>false}={}) {this.now=now;this.current=current;this.entries=new Map();}
  put(e) {
    this.expire();if(!validateEpisode(e) || e.expiresAtMonotonicMs<=this.now() || e.expiresAtMonotonicMs>this.now()+120000 || e.participants.some(r=>!this.current(r.captureRef))) return false;
    const old=this.entries.get(e.episodeId);if(old && e.revision<=old.revision) return false;
    const active=x=>['open','settling'].includes(x.status);
    if(!old && this.entries.size>=256 || active(e) && (!old || !active(old)) && [...this.entries.values()].filter(active).length>=64) return false;
    const value=JSON.parse(JSON.stringify(e));const freeze=v=>{if(v && typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};this.entries.set(e.episodeId,freeze(value));return true;
  }
  expire() {for(const [key,e] of this.entries) if(e.expiresAtMonotonicMs<=this.now() || e.status==='expired' || e.participants.some(r=>!this.current(r.captureRef))) this.entries.delete(key);}
  remove(episodeId) { return this.entries.delete(episodeId); }
  clear() {this.entries.clear();}
}
