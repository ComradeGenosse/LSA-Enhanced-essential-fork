import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
// Read-only projection of the *original stock backend* conversation stores.
// Does not allocate a turn, call stock kb or certify native C-06. The backend
// owns its full lifecycle; the companion may only inspect a synchronous
// moment-in-time sample. A transient idle sample is not a safe native grant.
const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000;
const asString = s => typeof s === 'string' && s.length <= 128;
export function projectOriginalTurnPriority(raw) {
  if (!raw || !asString(raw.micStatus) || !raw.micStatus ||
      !asString(raw.micActiveTurnId) ||
      typeof raw.micReleasedBeforeContextReady !== 'boolean' ||
      !['liveTurns','activeTurnMappings','pendingSessionOpens','pendingOutputOwners',
        'retiringOutputOwners','activeOutputOwners','pendingPlayerContext',
        'pendingConversationContext','playerTurnRecoveries','micBufferedChunks']
        .every(key=>count(raw[key])))return null;
  const evidence=Object.freeze({
    source:'original_essential_server_turn_stores',
    micStatus:raw.micStatus,
    micActiveTurn:raw.micActiveTurnId!=='',
    micReleasedBeforeContextReady:raw.micReleasedBeforeContextReady,
    liveTurns:raw.liveTurns,activeTurnMappings:raw.activeTurnMappings,
    pendingSessionOpens:raw.pendingSessionOpens,
    pendingOutputOwners:raw.pendingOutputOwners,
    retiringOutputOwners:raw.retiringOutputOwners,
    activeOutputOwners:raw.activeOutputOwners,
    pendingPlayerContext:raw.pendingPlayerContext,
    pendingConversationContext:raw.pendingConversationContext,
    playerTurnRecoveries:raw.playerTurnRecoveries,
    micBufferedChunks:raw.micBufferedChunks,
    // "Quiet" is only a negative signal. In particular no monotonic
    // asynchronous Core revision or native-happens-before receipt accompanies
    // this sample, so it is NEVER a positive C-06 permission.
    quiet:raw.micStatus==='idle' && raw.micActiveTurnId==='' &&
      raw.micReleasedBeforeContextReady===false &&
      ['liveTurns','activeTurnMappings','pendingSessionOpens','pendingOutputOwners',
       'retiringOutputOwners','activeOutputOwners','pendingPlayerContext',
       'pendingConversationContext','playerTurnRecoveries','micBufferedChunks']
      .every(key=>raw[key]===0),
    grantsNativeAdmission:false,
  });
  return evidence;
}


// A single event-loop-owned revision that advances at the original *stock*
// intake/terminal/session functions, not merely when a polling client happens
// to notice a different map size. This closes the otherwise invisible
// busy->idle->busy ABA at the backend sampler. This is NOT an interprocess
// admission lock: native still needs an ordered ownership handoff.
const originalEntrypoints = new Set([
  'turn_intake','turn_allocate','turn_terminal','turn_cancel','session_open',
  'session_retire','mic_reset','special_dispatch','mic_capture',
]);
export class OriginalEssentialTurnTimeline {
  sourceRun=randomUUID();
  #revision=1;
  #invalid=false;
  #dirty=true;
  #observations=0;
  #lastSignature=null;
  #lastEvidence=null;
  #lease=null;
  #director=null;
  #retiredTickets=new Set();
  constructor({maxRevision=Number.MAX_SAFE_INTEGER,now=()=>performance.now()}={}) {
    if(typeof now!=='function')throw new TypeError('original_owner_clock');
    this.now=now;
    if(!Number.isSafeInteger(maxRevision)||maxRevision<2)throw new TypeError('revision_bound');
    this.maxRevision=maxRevision;
  }
  #retireLease() {
    if(this.#lease)this.#retiredTickets.add(this.#lease.ticketId);
    this.#lease=null;
    this.#director=null;
  }
  // Source-only: the original backend's exclusive pre-intake lease can be
  // promoted to a single pending stock kb call. Neither a DTO ticket string
  // nor a renewed quiet snapshot can create this phase.
  beginDirector(ticketId,snapshot) {
    if(this.#director || !this.check(ticketId,snapshot))return false;
    this.#director=Object.freeze({
      ticketId,stage:'reserved',sourceRun:this.sourceRun,
      expiresAt:this.#lease.expiresAt,
    });
    return true;
  }
  directorPhase(ticketId) {
    const d=this.#director,now=this.now();
    return d && d.ticketId===ticketId && Number.isFinite(now) &&
      now<d.expiresAt && !this.#invalid ? d.stage : null;
  }
  transition(event,ownedTicket=null) {
    const d=this.#director,now=this.now();
    // Expected transitions must occur on the original stock source path,
    // in sequence, while the exact pre-intake owner lease is still live.
    // Any foreign player/Essential/session event revokes the entire claim.
    let next=null;
    if(d && this.#lease && ownedTicket===d.ticketId &&
       Number.isFinite(now) && now<d.expiresAt) {
      if(event==='special_dispatch' && d.stage==='reserved')next='dispatch';
      // Original kb hydrates, then Zi can open WP *before* Xi allocates the
      // special turn. A previously open session skips WP. Both exact source
      // orders are legitimate; a foreign ticket or repeated transition still
      // retires the original lease.
      else if(event==='session_open' &&
        (d.stage==='dispatch'||d.stage==='allocation'))next='session';
      else if(event==='turn_allocate' &&
        (d.stage==='dispatch'||d.stage==='session'))next='allocation';
      else if(event==='turn_intake' &&
        (d.stage==='allocation'||d.stage==='session'))next='generation';
    }
    if(!next)this.#retireLease();
    if(!originalEntrypoints.has(event)) {
      this.#invalid=true;
      return false;
    }
    if(this.#invalid||this.#revision>=this.maxRevision) {
      this.#invalid=true;
      return false;
    }
    this.#revision++;
    if(next) {
      this.#director=Object.freeze({...d,stage:next});
      this.#lease=Object.freeze({...this.#lease,revision:this.#revision});
    }
    this.#dirty=true;
    return true;
  }
  sample(raw) {
    if(this.#invalid)return null;
    const projection=projectOriginalTurnPriority(raw);
    if(!projection) {
      // Missing original maps or a backend read error must permanently
      // retire this incarnation, rather than resetting a revision.
      this.#invalid=true;
      this.#retireLease();
      return null;
    }
    // Signature is bounded, non-sensitive scalar evidence only. This
    // rescans the original stores to catch additional asynchronous changes
    // which do not cross a named lifecycle entrypoint. A synchronous ABA
    // cannot be dismissed by this signature: transitions cover the starts.
    const signature=JSON.stringify(projection);
    if(this.#lastSignature!==null && signature!==this.#lastSignature) {
      this.#retireLease();
      if(this.#revision>=this.maxRevision) {
        this.#invalid=true;
        return null;
      }
      this.#revision++;
    }
    this.#lastSignature=signature;
    this.#lastEvidence=projection;
    this.#dirty=false;
    this.#observations++;
    return Object.freeze({
      schemaVersion:1,
      source:'original_essential_backend_lifecycle',
      sourceRun:this.sourceRun,
      revision:this.#revision,
      observationSerial:this.#observations,
      quiet:projection.quiet,
      // Native may use this to suppress stale admission. It cannot
      // independently establish synchronization with the native owner fiber.
      grantsNativeAdmission:false,
      evidence:projection,
    });
  }
  // Source-side serial admission on the ORIGINAL backend's JS event loop.
  // An already acquired foreign lease, source change, terminal callback,
  // player mic/text entry or unexpected stock state permanently revokes the
  // ticket. No user input is delayed or blocked by this lease.
  acquire(ticketId,snapshot,leaseMs=2000) {
    const now=this.now();
    if(typeof ticketId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ticketId) ||
       !Number.isFinite(now) || leaseMs<1 || leaseMs>2000 ||
       !Number.isSafeInteger(leaseMs) || this.#invalid ||
       this.#retiredTickets.has(ticketId) || this.#retiredTickets.size>=512 ||
       !snapshot || snapshot.sourceRun!==this.sourceRun ||
       snapshot.revision!==this.#revision || !snapshot.quiet ||
       snapshot.grantsNativeAdmission!==false || this.#dirty ||
       this.#lease!==null)return null;
    this.#lease=Object.freeze({ticketId,revision:this.#revision,
      sourceRun:this.sourceRun,expiresAt:now+leaseMs});
    return snapshot;
  }
  check(ticketId,snapshot) {
    const lease=this.#lease,now=this.now();
    if(this.#invalid||!lease||lease.ticketId!==ticketId ||
       !Number.isFinite(now) || now>=lease.expiresAt ||
       !snapshot || snapshot.quiet!==true ||
       snapshot.sourceRun!==lease.sourceRun ||
       snapshot.revision!==lease.revision || this.#dirty) {
      if(lease?.ticketId===ticketId)this.#retireLease();
      return null;
    }
    return snapshot;
  }
  release(ticketId) {
    if(this.#lease?.ticketId!==ticketId)return false;
    this.#retireLease();return true;
  }
  get leaseCount(){return this.#lease?1:0;}
  get revision(){return this.#invalid?-1:this.#revision;}
  get current(){return !this.#invalid&&!this.#dirty?this.#lastEvidence:null;}
  invalidate(){this.#retireLease();this.#invalid=true;this.#lastEvidence=null;}
}
