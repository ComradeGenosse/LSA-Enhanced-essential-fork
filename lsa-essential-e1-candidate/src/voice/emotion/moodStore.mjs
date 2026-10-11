// EA4 — bounded, strictly ephemeral emotional *delivery* continuity.
// The caller must supply trusted P1 resolver/binding, native host and M1 timeline
// context, not raw actor JSON. This never owns facts, events, memory or playback.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUuid = value => typeof value === 'string' && UUID.test(value);
const validInteger = value => Number.isSafeInteger(value) && value > 0;
const PROTAGONISTS = new Set(['franklin', 'michael', 'trevor']); // M1 durableSubjectRef
const CARRY_VALUES = new Set(['amused', 'sad', 'concerned', 'fearful', 'whisper']);
const FRESH_SOURCES = new Set(['verified_scene', 'dialogue_cue', 'luna_hint']);
const MAX_ENTRIES = 128;

/**
 * Context contract (EA2):
 * {
 *   characterSnapshot: TurnCharacterSnapshot from IdentityResolver.prepare,
 *   binding: RuntimeBindings.get(turn.identity), // authenticated and CURRENT
 *   hostContext: OwnerEvidence.hostContext,        // trusted native hello
 *   timelineId: TimelineGuard.activeTimelineId,   // approved current save
 *   protagonist: 'franklin'|'michael'|'trevor',    // verified game protagonist
 *   identity: turn.identity,                       // native routing tuple
 *   isCurrent: () => boolean                      // recheck owner AND epoch
 * }
 * isCurrent must check current P1 binding, fresh owner proof and authoritative
 * host/timeline/protagonist at CALL time; a JSON claim or mere UUID is not proof.
 * Missing one component disables continuity, not ordinary voice synthesis.
 */
function contextKey(context) {
  if (!context || typeof context !== 'object' || typeof context.isCurrent !== 'function') return null;
  let current = false;
  try { current = context.isCurrent() === true; } catch { return null; }
  if (!current) return null;
  const { identity, characterSnapshot: snap, binding: b, hostContext: h, timelineId, protagonist } = context;
  if (!identity || !snap || !b || !h || snap.resolution?.kind !== 'persistent' ||
      !isUuid(snap.resolution.characterId) || snap.resolution.characterId !== b.characterId ||
      !isUuid(snap.bindingId) || b.bindingId !== snap.bindingId ||
      !validInteger(snap.bindingRevision) || b.bindingRevision !== snap.bindingRevision ||
      !isUuid(b.serverRunId) || !isUuid(b.claim?.worldProfileId) ||
      b.claim.sourceNamespace !== 'comrade.authored' ||
      typeof b.claim.sourceKey !== 'string' || !b.claim.sourceKey ||
      !isUuid(b.claim.adapterEpoch) || !isUuid(b.claim.incarnationId) ||
      !validInteger(b.claim.claimRevision) ||
      !isUuid(h.hostRunId) || h.hostContextVersion !== 1 ||
      !validInteger(h.worldEpoch) || h.worldEpoch > 0x7fffffff ||
      !isUuid(timelineId) || !PROTAGONISTS.has(protagonist) ||
      typeof identity.pedId !== 'string' || !identity.pedId ||
      identity.pedId !== b.pedId || identity.sessionNonce !== b.sessionNonce ||
      snap.nativeIdentity?.pedId !== identity.pedId ||
      snap.nativeIdentity.sessionNonce !== identity.sessionNonce ||
      snap.nativeIdentity.generationId !== identity.generationId ||
      snap.nativeIdentity.turnId !== identity.turnId ||
      !validInteger(identity.generationId) ||
      typeof identity.turnId !== 'string' || !identity.turnId || identity.turnId.length > 128) return null;
  // P1 binding provenance is intentionally part of the key: neither a recycled
  // ped nor a newly summoned incarnation can inherit a previous mood.
  const owner = JSON.stringify([b.serverRunId,b.bindingId,b.bindingRevision,b.claim.adapterEpoch,
    b.claim.incarnationId,b.claim.claimRevision,b.claim.sourceKey,identity.pedId,identity.sessionNonce]);
  const lineage = JSON.stringify([b.claim.worldProfileId,h.hostRunId,h.worldEpoch,timelineId,protagonist]);
  return { key: JSON.stringify([snap.resolution.characterId,owner,lineage]), characterId: snap.resolution.characterId, owner, lineage,
    turn: JSON.stringify([identity.turnId,identity.generationId]), generation: identity.generationId };
}
function prior(value) {
  // Deliberately no evidenceRef/source from a previous turn. EA1 must rank this
  // below *new* verified danger and cannot treat it as witnessed evidence.
  return Object.freeze({ value, confidence: 'soft', intensity: 'subtle' });
}
export class MoodStore {
  #entries = new Map();
  #lastNow = -1;
  constructor({ ttlMs = 22000, maxEntries = MAX_ENTRIES } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 15000 || ttlMs > 30000) throw new RangeError('mood_ttl_out_of_range');
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES) throw new RangeError('mood_capacity_out_of_range');
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }
  #tick(nowMs) {
    if (!Number.isFinite(nowMs) || nowMs < 0) return false;
    if (nowMs < this.#lastNow) this.clear(); // clock/reload ambiguity: fail closed
    this.#lastNow = nowMs;
    // Expiration removes the SOFT VALUE but retains a bounded high-water mark
    // for the completed native generation. Otherwise a replayed old callback
    // arriving AFTER 22 seconds can revive expired mood indefinitely.
    // Tombstones share the SAME max-128 map; there is no second unbounded cache.
    for (const entry of this.#entries.values()) {
      if (entry.expiresAt <= nowMs) {
        entry.value = null;
        entry.usedBy = 'expired';
      }
    }
    return true;
  }
  #isolate(key) {
    // A change in world, timeline, protagonist or owner within a live owner
    // removes its previous emotional state, even if the user later switches back.
    for (const [id, entry] of this.#entries) {
      if (entry.characterId === key.characterId && (entry.owner !== key.owner || entry.lineage !== key.lineage)) this.#entries.delete(id);
    }
  }
  /** Return a one-follow-up soft tendency, or null. May be called repeatedly
   * for segments of that SAME follow-up turn. Never returns stored evidence. */
  take({ context, nowMs } = {}) {
    if (!this.#tick(nowMs)) return null;
    const key = contextKey(context);
    if (!key) return null;
    this.#isolate(key);
    const entry = this.#entries.get(key.key);
    if (!entry || entry.value === null) return null;
    if (entry.usedBy === key.turn) return prior(entry.value);
    if (entry.usedBy !== null || key.generation <= entry.generation || key.turn === entry.turn) return null;
    entry.usedBy = key.turn; // another turn cannot consume the same prior
    return prior(entry.value);
  }
  /** Record only after an accepted native playback receipt for THIS turn.
   * No effect while PCM is being generated or if playback was interrupted.
   * Caller is responsible for verifying the receipt with the native host. */
  commitPlayed({ context, nowMs, delivery, receipt } = {}) {
    if (!this.#tick(nowMs)) return false;
    const key = contextKey(context);
    if (!key) return false;
    this.#isolate(key);
    const value = delivery?.value;
    if (!CARRY_VALUES.has(value) || !FRESH_SOURCES.has(delivery?.source) ||
        delivery.version !== 1 || !['soft','supported'].includes(delivery.confidence) ||
        !receipt || receipt.verified !== true || receipt.playbackSucceeded !== true ||
        receipt.playbackStarted !== true || receipt.hadAudio !== true ||
        receipt.wasInterrupted !== false || receipt.turnId !== context.identity.turnId ||
        receipt.generationId !== context.identity.generationId ||
        receipt.pedId !== context.identity.pedId || receipt.sessionNonce !== context.identity.sessionNonce) return false;
    const existing = this.#entries.get(key.key);
    // At most one accepted playback_ended per native generation. A duplicate
    // receipt must not change the selected mood or refresh its expiry, and
    // a late older-generation receipt cannot overwrite a newer completion.
    if (existing && key.generation <= existing.generation) return false;
    this.#entries.delete(key.key);
    while (this.#entries.size >= this.maxEntries) this.#entries.delete(this.#entries.keys().next().value);
    this.#entries.set(key.key, { ...key, value, expiresAt: nowMs + this.ttlMs, usedBy: null });
    return true;
  }
  /** Caller MUST invoke for cancelled/interrupted/failed turns and on owner
   * retirement. A stale old-turn failure cannot erase a newer successful turn. */
  invalidate({ context, scope = 'turn' } = {}) {
    if (!['turn', 'binding'].includes(scope)) throw new TypeError('invalid_mood_invalidation_scope');
    const key = contextKey(context);
    if (!key) { this.clear(); return; } // proof revoked/unknown: safest to flush
    for (const [id, entry] of this.#entries) {
      if (scope === 'binding' && entry.owner === key.owner ||
          scope === 'turn' && id === key.key && (entry.turn === key.turn || entry.usedBy === key.turn)) this.#entries.delete(id);
    }
  }
  /** Call on world-epoch, game reload, save timeline, protagonist or host
   * changes; also on companion shutdown. There is deliberately NO disk API. */
  clear() { this.#entries.clear(); this.#lastNow = -1; }
  get size() {
    let count = 0;
    for (const entry of this.#entries.values()) if (entry.value !== null) count++;
    return count;
  }
}
export function createMoodStore(options) { return new MoodStore(options); }
