import { isUuid } from '../identity/identityContract.mjs';
import { randomUUID } from 'node:crypto';

const u32 = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
const monotonic = n => Number.isSafeInteger(n) && n >= 0;
const closed = (v, required) => !!v && typeof v === 'object' && !Array.isArray(v) &&
  required.every(k => Object.hasOwn(v,k)) && Object.keys(v).every(k => required.includes(k));
const terminal = new Set(['released','replaced','world_reset','timeout','unknown_mic_state','ownership_lost']);

export function validateUtteranceFact(p) {
  if (!closed(p,['utteranceVersion','utteranceId','phase','terminal','hostRunId','worldEpoch',
    'gameTick','monotonicMs','inputSource','micPedRef'])) return false;
  return p.utteranceVersion===1 && isUuid(p.utteranceId) && isUuid(p.hostRunId) &&
    Number.isSafeInteger(p.worldEpoch) && p.worldEpoch>0 && p.worldEpoch<=2147483647 &&
    u32(p.gameTick) && monotonic(p.monotonicMs) && p.inputSource==='essential_mic' &&
    (p.micPedRef===null || isUuid(p.micPedRef)) &&
    (p.phase==='started' && p.terminal===null ||
     p.phase==='ended' && terminal.has(p.terminal));
}

// Source-time telemetry is intentionally not an acoustic receipt.
// A matching STT/Essential turn join has NOT been proven by these frames.
// No transcript, NPC observer or PS4 knowledge is ever exposed by this ledger.
export class UtteranceLifecycle {
  constructor({now=()=>Math.floor(performance.now())}={}) {
    this.now=now;this.entries=new Map();this.active=null;
    this.diagnostics={started:0,ended:0,typed:0,rejected:0,expired:0};
  }
  // One typed turn is a zero-duration non-acoustic annotation. The exact
  // identity is supplied by Essential; it never creates native mic evidence.
  recordTyped(identity,host) {
    if(!host || !isUuid(host.hostRunId) || !Number.isSafeInteger(host.worldEpoch) ||
       host.worldEpoch<1 || typeof identity?.pedId!=='string' ||
       !Number.isSafeInteger(identity?.sessionNonce) || identity.sessionNonce<1 ||
       !(Number.isSafeInteger(identity?.turnId) && identity.turnId>=1 ||
         typeof identity?.turnId==='string' && identity.turnId.length>0 && identity.turnId.length<=128) ||
       !Number.isSafeInteger(identity?.generationId) || identity.generationId<0) return false;
    const now=this.now();
    for(const [id,e] of this.entries) if(now-e.receivedAt>30000)
      this.entries.delete(id);
    if(this.entries.size>=32)return false;
    const id=randomUUID(),stamp={hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,
      utteranceId:id,inputSource:'typed',durationMs:0,acousticObservers:0,
      identity:Object.freeze({...identity})};
    this.entries.set(id,{started:stamp,ended:stamp,receivedAt:now});
    this.diagnostics.typed++;return true;
  }
  clear() {this.entries.clear();this.active=null;}
  accept(p,host) {
    if(!validateUtteranceFact(p) || !host || p.hostRunId!==host.hostRunId || p.worldEpoch!==host.worldEpoch) {
      this.diagnostics.rejected++;return false;
    }
    const now=this.now();
    for(const [id,e] of this.entries) if(now-e.receivedAt>30000) {
      this.entries.delete(id);if(this.active===id)this.active=null;this.diagnostics.expired++;
    }
    if(p.phase==='started') {
      if(this.active!==null || this.entries.has(p.utteranceId) || this.entries.size>=32) {
        this.diagnostics.rejected++;return false;
      }
      this.active=p.utteranceId;
      this.entries.set(p.utteranceId,{started:p,receivedAt:now,ended:null});
      this.diagnostics.started++;return true;
    }
    const old=this.entries.get(p.utteranceId);
    if(!old || this.active!==p.utteranceId || old.ended!==null ||
       p.monotonicMs<old.started.monotonicMs ||
       p.monotonicMs-old.started.monotonicMs>31000 ||
       p.inputSource!==old.started.inputSource) {
      this.diagnostics.rejected++;return false;
    }
    old.ended=p;old.receivedAt=now;this.active=null;this.diagnostics.ended++;
    return true;
  }
}
