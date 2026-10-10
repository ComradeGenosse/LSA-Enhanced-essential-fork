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
  'turn_intake','turn_terminal','turn_cancel','session_open',
  'session_retire','mic_reset','special_dispatch','mic_capture',
]);
export class OriginalEssentialTurnTimeline {
  #revision=1;
  #invalid=false;
  #dirty=true;
  #observations=0;
  #lastSignature=null;
  #lastEvidence=null;
  constructor({maxRevision=Number.MAX_SAFE_INTEGER}={}) {
    if(!Number.isSafeInteger(maxRevision)||maxRevision<2)throw new TypeError('revision_bound');
    this.maxRevision=maxRevision;
  }
  transition(event) {
    if(!originalEntrypoints.has(event)) {
      this.#invalid=true;
      return false;
    }
    if(this.#invalid||this.#revision>=this.maxRevision) {
      this.#invalid=true;
      return false;
    }
    this.#revision++;
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
      return null;
    }
    // Signature is bounded, non-sensitive scalar evidence only. This
    // rescans the original stores to catch additional asynchronous changes
    // which do not cross a named lifecycle entrypoint. A synchronous ABA
    // cannot be dismissed by this signature: transitions cover the starts.
    const signature=JSON.stringify(projection);
    if(this.#lastSignature!==null && signature!==this.#lastSignature) {
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
      revision:this.#revision,
      observationSerial:this.#observations,
      quiet:projection.quiet,
      // Native may use this to suppress stale admission. It cannot
      // independently establish synchronization with the native owner fiber.
      grantsNativeAdmission:false,
      evidence:projection,
    });
  }
  get revision(){return this.#invalid?-1:this.#revision;}
  get current(){return !this.#invalid&&!this.#dirty?this.#lastEvidence:null;}
  invalidate(){this.#invalid=true;this.#lastEvidence=null;}
}
