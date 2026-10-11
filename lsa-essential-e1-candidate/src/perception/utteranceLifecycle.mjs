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
  constructor({now=()=>Math.floor(performance.now()), current=()=>false}={}) {
    this.now=now;this.current=current;this.entries=new Map();this.active=null;this.pending=null;
    this.diagnostics={started:0,ended:0,typed:0,joined:0,sttAccepted:0,
      sttRejected:0,unmatched:0,cancelled:0,rejected:0,expired:0};
  }
  clear() {this.entries.clear();this.active=null;this.pending=null;}
  trim() {
    const now=this.now();
    for(const [id,e] of this.entries) if(now-e.receivedAt>(e.ended?30000:35000)) {
      this.entries.delete(id);if(this.active===id)this.active=null;
      if(this.pending?.utteranceId===id)this.pending=null;
      this.diagnostics.expired++;
    }
    if(this.pending && now-this.pending.at>65000) {
      this.pending=null;this.diagnostics.unmatched++;
    }
  }
  // Typed speech is a local zero-duration annotation. It has no microphone
  // source, audio capture, witnesses or Native-STT eligibility.
  recordTyped(identity,host) {
    if(!host || !isUuid(host.hostRunId) || !Number.isSafeInteger(host.worldEpoch) ||
       host.worldEpoch<1 || !validTurn(identity))return false;
    this.trim();if(this.entries.size>=32)return false;
    const id=randomUUID(),stamp={hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,
      utteranceId:id,inputSource:'typed',durationMs:0,acousticObservers:0,
      identity:Object.freeze({...identity})};
    this.entries.set(id,{started:stamp,ended:stamp,receivedAt:this.now(),join:null});
    this.diagnostics.typed++;return true;
  }
  // A real Essential turn is the only origin of the tuple. The captured P0
  // observer must name exactly the same native Ped/host. No "latest NPC",
  // name/handle lookup or redirect is permitted. One pending lease at a time.
  reserveMicTurn({identity,actorRef,hostRunId,worldEpoch,utteranceId=null},host) {
    this.trim();
    if(!validTurn(identity) || !isUuid(actorRef) || !this.current(actorRef) ||
       !host || hostRunId!==host.hostRunId || worldEpoch!==host.worldEpoch ||
       !isUuid(hostRunId) || utteranceId!==null && !isUuid(utteranceId) || this.pending || this.entries.size>=32) {
      this.diagnostics.unmatched++;return false;
    }
    const candidate={identity:Object.freeze({...identity}),actorRef,hostRunId,worldEpoch,
      at:this.now(),pcmBytes:0,pcmFinished:false,utteranceId:null,
      expectedId:utteranceId,cancelled:false};
    // The native pipe may deliver its start immediately before the local
    // connection's capture callback. Use ONLY one still-open source-lifetime
    // with matching exact captureRef and a very short arrival window.
    const e=this.active && this.entries.get(this.active);
    if(e && !e.join && !e.retired &&
       (utteranceId===null || e.started.utteranceId===utteranceId) &&
       e.started.micPedRef===actorRef &&
       e.started.hostRunId===hostRunId && e.started.worldEpoch===worldEpoch &&
       (utteranceId!==null || candidate.at-e.receivedAt>=0 && candidate.at-e.receivedAt<=1500)) {
      e.join=candidate;candidate.utteranceId=e.started.utteranceId;
      this.diagnostics.joined++;
    } else if(e) {
      this.diagnostics.unmatched++;return false;
    }
    this.pending=candidate;return true;
  }
  // Callback from OpenAIConnection after the last PCM chunk was accepted.
  // Recording is not a completed native release or an accepted STT.
  finishPcm(identity,bytes) {
    if(!sameTurn(this.pending?.identity,identity) || !Number.isSafeInteger(bytes) ||
       bytes<2 || bytes>16000*2*30)return false;
    this.pending.pcmBytes=bytes;this.pending.pcmFinished=true;return true;
  }
  cancelTurn(identity) {
    if(!sameTurn(this.pending?.identity,identity))return false;
    const id=this.pending.utteranceId,e=id&&this.entries.get(id);
    if(e) {if(e.join===this.pending)e.join=null;e.retired=true;}
    this.pending=null;this.diagnostics.cancelled++;return true;
  }
  // The single STT operation calls this ONCE after the native transcript
  // event is delivered. Only a matching, fully released microphone lifecycle
  // with a fixed P0 actor can link text to source-time evidence.
  acceptStt({identity,text,host}) {
    this.trim();
    const lease=this.pending;
    const entry=lease?.utteranceId && this.entries.get(lease.utteranceId);
    const complete=lease && entry && entry.join===lease &&
      sameTurn(lease.identity,identity) && lease.pcmFinished &&
      entry.started.micPedRef===lease.actorRef &&
      entry.started.hostRunId===lease.hostRunId &&
      entry.started.worldEpoch===lease.worldEpoch &&
      host?.hostRunId===lease.hostRunId && host?.worldEpoch===lease.worldEpoch &&
      this.current(lease.actorRef) &&
      entry.ended?.terminal==='released' &&
      entry.ended.monotonicMs>=entry.started.monotonicMs &&
      entry.ended.monotonicMs-entry.started.monotonicMs<=30000 &&
      typeof text==='string' && text.trim().length>0 &&
      Buffer.byteLength(text,'utf8')<=4096 &&
      !entry.transcript && !entry.sttConsumed;
    // Whether accepted or rejected, this exact association is one-use.
    if(lease && sameTurn(lease.identity,identity))this.pending=null;
    if(!complete) {this.diagnostics.sttRejected++;return {accepted:false,reason:'c01_unverified_source'};}
    entry.sttConsumed=true;
    entry.transcript=Object.freeze({utteranceId:entry.started.utteranceId,
      turn:Object.freeze({...identity}),inputSource:'player_stt',
      nativeSource:'essential_mic',hostRunId:lease.hostRunId,
      worldEpoch:lease.worldEpoch,text,receivedAt:this.now()});
    this.diagnostics.sttAccepted++;
    // Never feed the speech store or model: acoustic coverage is not yet proven.
    return {accepted:true,utteranceId:entry.started.utteranceId};
  }
  accept(p,host) {
    if(!validateUtteranceFact(p) || !host ||
       p.hostRunId!==host.hostRunId || p.worldEpoch!==host.worldEpoch) {
      this.diagnostics.rejected++;return false;
    }
    this.trim();
    const now=this.now();
    if(p.phase==='started') {
      if(this.active!==null || this.entries.has(p.utteranceId) || this.entries.size>=32) {
        this.diagnostics.rejected++;return false;
      }
      const e={started:p,receivedAt:now,ended:null,join:null,transcript:null,sttConsumed:false};
      this.active=p.utteranceId;this.entries.set(p.utteranceId,e);
      const lease=this.pending;
      if(lease && !lease.utteranceId &&
         (lease.expectedId===null && now-lease.at>=0 && now-lease.at<=1500 ||
          lease.expectedId===p.utteranceId) &&
         p.micPedRef===lease.actorRef && p.hostRunId===lease.hostRunId &&
         p.worldEpoch===lease.worldEpoch) {
        e.join=lease;lease.utteranceId=p.utteranceId;this.diagnostics.joined++;
      }
      this.diagnostics.started++;return true;
    }
    const e=this.entries.get(p.utteranceId);
    if(!e || this.active!==p.utteranceId || e.ended!==null ||
       p.monotonicMs<e.started.monotonicMs ||
       p.monotonicMs-e.started.monotonicMs>31000 ||
       p.inputSource!==e.started.inputSource ||
       p.micPedRef!==e.started.micPedRef) {
      this.diagnostics.rejected++;return false;
    }
    e.ended=p;e.receivedAt=now;this.active=null;this.diagnostics.ended++;
    // A cancellation/timeout/target swap retires ONLY its own pending turn;
    // it cannot attach the next actor's STT to a prior mic generation.
    if(p.terminal!=='released' && this.pending?.utteranceId===p.utteranceId)
      this.cancelTurn(this.pending.identity);
    return true;
  }
}

function validTurn(i) {
  return !!i && typeof i.pedId==='string' && i.pedId.length>0 &&
    Number.isSafeInteger(i.sessionNonce) && i.sessionNonce>0 &&
    (typeof i.turnId==='string' && i.turnId.length>0 && i.turnId.length<=128 ||
     Number.isSafeInteger(i.turnId) && i.turnId>0) &&
    Number.isSafeInteger(i.generationId) && i.generationId>=0;
}
function sameTurn(a,b) {
  return !!a && !!b && a.pedId===b.pedId && a.sessionNonce===b.sessionNonce &&
    a.turnId===b.turnId && a.generationId===b.generationId;
}
