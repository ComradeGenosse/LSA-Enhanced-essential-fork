import { randomUUID } from 'node:crypto';
import { DIRECTOR_SPEECH_LIMITS as LIMITS } from './sceneDirector.mjs';

// Candidate selection is not admission. This RAM-only shell does not perform
// any native dispatch, provider request, turn allocation or physical effect.
const integer = n => Number.isSafeInteger(n) && n >= 0;
const positive = n => integer(n) && n > 0;
const text = s => typeof s === 'string' && s.length > 0 && s.length <= 128;
const same = (a,b) => a && b && a.hostRunId === b.hostRunId &&
  a.worldEpoch === b.worldEpoch && a.speakerCaptureRef === b.speakerCaptureRef &&
  a.playerCaptureRef === b.playerCaptureRef &&
  a.ownerIncarnationId === b.ownerIncarnationId &&
  a.proofRevision === b.proofRevision &&
  a.playerTurnVersion === b.playerTurnVersion && a.policyVersion === b.policyVersion;

function stampValid(s, proposal) {
  return !!s && text(s.hostRunId) && positive(s.worldEpoch) &&
    text(s.ownerIncarnationId) && positive(s.proofRevision) &&
    integer(s.playerTurnVersion) && integer(s.policyVersion) &&
    s.speakerCaptureRef === proposal.speakerCaptureRef &&
    s.playerCaptureRef === proposal.playerCaptureRef &&
    s.policyVersion === proposal.policyVersion;
}
const validTuple = t => !!t && text(String(t.pedId ?? '')) &&
  text(t.turnId) && positive(t.sessionNonce) && integer(t.generationId);
const tupleMatches = (a,b) => validTuple(a) && validTuple(b) &&
  a.pedId === b.pedId && a.sessionNonce === b.sessionNonce &&
  a.turnId === b.turnId && a.generationId === b.generationId;
const validProposal = p => !!p && p.kind === 'speech' &&
  p.activity === undefined && p.command === undefined &&
  text(p.decisionKey) && text(p.observationId) &&
  positive(p.observationRevision) && integer(p.policyVersion) &&
  text(p.speakerCaptureRef) && text(p.playerCaptureRef) &&
  ['urgent','routine'].includes(p.urgency) &&
  integer(p.expiresAtMonotonicMs);

/**
 * An invariant admission shell, *not* a native Director implementation.
 * checkCurrent is required at every boundary and must ultimately combine
 * live PS3 entitlement and trusted native C-06/Essential admission. Unknown
 * is always a veto. An independent native one-shot check remains mandatory.
 */
export class DirectorSpeechReservations {
  constructor({now,checkCurrent,acknowledge,enabled=false,uuid=randomUUID} = {}) {
    if (typeof now !== 'function' || typeof checkCurrent !== 'function' ||
        typeof acknowledge !== 'function' || typeof uuid !== 'function')
      throw new TypeError('director_dependencies_required');
    this.now=now;this.checkCurrent=checkCurrent;this.acknowledge=acknowledge;
    this.uuid=uuid;this.enabled=enabled === true;
    this.active=null;this.attempts=[];this.speakerAt=new Map();
    this.sceneAt=-Infinity;this.attemptedKeys=new Map();
  }
  // A mode transition or host/world reset retires reservations without a retry.
  setEnabled(value) {if(value!==true)this.reset();this.enabled=value===true;}
  reset() {
    this.active=null;this.attempts=[];this.speakerAt.clear();
    this.sceneAt=-Infinity;this.attemptedKeys.clear();
  }
  safe(proposal,stamp,stage,record=null) {
    if(!this.enabled || !validProposal(proposal) ||
        !stampValid(stamp,proposal) || !same(stamp,record?.stamp ?? stamp) ||
        proposal.expiresAtMonotonicMs<=this.now())return false;
    // Optional subsystem failures and missing evidence cannot grant admission.
    try {return this.checkCurrent(Object.freeze({proposal,stamp,stage,ticketId:record?.id??null}))===true;}
    catch {return false;}
  }
  // Counts attempts even if the final safety check rejects. Selection alone
  // does not count; no implicit fallback speaker is ever selected.
  reserve(proposal,stamp) {
    if(!this.enabled || !validProposal(proposal))return null;
    const at=this.now();
    if(!integer(at) || this.active || this.attemptedKeys.has(proposal.decisionKey))return null;
    this.attempts=this.attempts.filter(t=>t>at-LIMITS.attemptWindowMs);
    if(this.attempts.length>=LIMITS.attemptsPerMinute)return null;
    const cooldown=proposal.urgency==='urgent' ? LIMITS.urgentSpeakerCooldownMs : LIMITS.routineSpeakerCooldownMs;
    if(at-this.sceneAt<LIMITS.sceneGapMs ||
        at-(this.speakerAt.get(proposal.speakerCaptureRef)??-Infinity)<cooldown)return null;
    this.attempts.push(at);
    if(!this.safe(proposal,stamp,'reserve'))return null;
    const id=this.uuid();
    if(!text(id))return null;
    const record={
      id,proposal:Object.freeze({...proposal}),stamp:Object.freeze({...stamp}),
      expiresAt:Math.min(at+LIMITS.ticketTtlMs,proposal.expiresAtMonotonicMs),
      state:'reserved',tuple:null,
    };
    this.active=record;this.sceneAt=at;this.speakerAt.set(proposal.speakerCaptureRef,at);
    this.attemptedKeys.set(proposal.decisionKey,at);
    return Object.freeze({
      schemaVersion:1,ticketId:id,dedupeKey:`ps:${id}`,
      speakerCaptureRef:proposal.speakerCaptureRef,
      playerCaptureRef:proposal.playerCaptureRef,
      decisionKey:proposal.decisionKey,
      priority:proposal.urgency==='urgent'?'director_urgent':'director_routine',
      expiresAtMonotonicMs:record.expiresAt,
    });
  }
  // Native must independently consume UUID exactly once and validate the same
  // original owner/world/player version before allocating an Essential tuple.
  consume(ticketId,stamp) {
    const r=this.active;
    if(!r || r.id!==ticketId || r.state!=='reserved')return false;
    if(this.now()>=r.expiresAt || !this.safe(r.proposal,stamp,'consume',r)) {
      this.cancel(ticketId);return false;
    }
    r.state='consumed';return true;
  }
  afterHydration(ticketId,stamp) {return this.recheck(ticketId,stamp,'hydrated');}
  beforePublication(ticketId,stamp) {return this.recheck(ticketId,stamp,'publication');}
  recheck(ticketId,stamp,stage) {
    const r=this.active;
    if(!r || r.id!==ticketId || !['consumed','bound'].includes(r.state))return false;
    if(!this.safe(r.proposal,stamp,stage,r)) {this.cancel(ticketId);return false;}
    return true;
  }
  bindNativeTuple(ticketId,stamp,tuple) {
    const r=this.active;
    if(!r || r.id!==ticketId || r.state!=='consumed' || !validTuple(tuple))return false;
    if(!this.recheck(ticketId,stamp,'bind'))return false;
    r.tuple=Object.freeze({...tuple});r.state='bound';return true;
  }
  // An earlier reasoning success, partial PCM, wrong generation, audio-less
  // playback or interruption must never consume the PS6 grant.
  finish(ticketId,tuple,receipt) {
    const r=this.active;
    if(!r || r.id!==ticketId || r.state!=='bound' || !tupleMatches(r.tuple,tuple))
      return false;
    const success=receipt?.type==='playback_ended' &&
      receipt.reason==='completed' && receipt.wasInterrupted===false &&
      receipt.hadAudio===true && receipt.playbackStarted===true;
    if(!success) {this.cancel(ticketId);return false;}
    // Final gate still applies: a retired/changed actor must not speak using
    // a late receipt. Use recorded stamp, never 'latest target' reconstruction.
    if(!this.safe(r.proposal,r.stamp,'complete',r)) {this.cancel(ticketId);return false;}
    let delivered=false;
    try {delivered=this.acknowledge(r.proposal.decisionKey,'ps6_ticket','delivered')===true;}
    catch {delivered=false;}
    this.active=null;return delivered;
  }
  cancel(ticketId) {
    if(!this.active || this.active.id!==ticketId)return false;
    this.active=null;return true;
  }
}
