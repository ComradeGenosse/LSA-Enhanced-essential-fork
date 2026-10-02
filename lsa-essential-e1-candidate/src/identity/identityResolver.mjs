import { CharacterStore } from './characterStore.mjs';
import { CharacterRegistry } from './characterRegistry.mjs';
import { RuntimeBindings } from './runtimeBindings.mjs';
import { OwnerEvidence } from './ownerEvidence.mjs';
import { actorClaim, validateClaim, sameAssociation, resolution, characterSnapshot, sessionKey, MAX_CHARACTERS } from './identityContract.mjs';

function emit(telemetry, event, identity, data) { try { telemetry?.emit(event, identity, null, data); } catch {} }

export class IdentityResolver {
  #anchors = new Map();
  constructor(config, { evidence = new OwnerEvidence(config), store = new CharacterStore({ filePath: config.storePath, worldProfileId: config.worldProfileId }),
    registry = new CharacterRegistry(store), telemetry = null, retireSession = () => {} } = {}) {
    this.config = config; this.evidence = evidence; this.registry = registry; this.telemetry = telemetry;
    this.bindings = new RuntimeBindings(); this.retireSession = retireSession;
    this.unsubscribe = evidence.subscribe?.(fact => this.#fact(fact));
  }
  #retire(anchor, reason) {
    if (this.#anchors.get(sessionKey(anchor)) !== anchor) return;
    this.#anchors.delete(sessionKey(anchor));
    const binding = this.bindings.get(anchor);
    if (binding) this.bindings.retire(binding);
    emit(this.telemetry, 'identity_binding_retired', null, { reason, bindingRevision: binding?.bindingRevision ?? null });
    try { Promise.resolve(this.retireSession(anchor, reason)).catch(() => {}); } catch {}
  }
  #fact(fact) {
    for (const anchor of [...this.#anchors.values()]) {
      const matches = anchor.claim.adapterEpoch === fact.adapterEpoch &&
        (fact.type === 'lost' || fact.type === 'revoke' && anchor.pedId === fact.pedId &&
          anchor.claim.incarnationId === fact.incarnationId && anchor.claim.claimRevision === fact.claimRevision);
      if (matches) this.#retire(anchor, fact.type === 'lost' ? 'evidence_unavailable' : 'owner_retired');
    }
  }
  detach(session) {
    this.#anchors.delete(sessionKey(session));
    const binding = this.bindings.get(session);
    if (binding && this.bindings.retire(binding)) emit(this.telemetry, 'identity_binding_retired', null, { reason: 'session_closed', bindingRevision: binding.bindingRevision });
  }
  current(session) {
    const anchor = this.#anchors.get(sessionKey(session));
    if (!anchor || this.evidence.isCurrent(anchor.claim)) return true;
    this.#retire(anchor, 'evidence_unavailable');
    return false;
  }
  async prepare({ identity, actor, signal, deadlineAt, isCurrent, voiceResolver, allowVoice }) {
    let timer;
    const abort = new AbortController();
    const combined = AbortSignal.any([signal, abort.signal]);
    const live = () => !combined.aborted && isCurrent();
    const fallback = reason => ({ snapshot: characterSnapshot(identity, resolution('ephemeral', reason)), speechProfile: null });
    const conflict = reason => {
      emit(this.telemetry, 'identity_conflict', identity, { reason, identityKind: 'conflict' });
      const anchor = this.#anchors.get(sessionKey(identity));
      if (anchor) this.#retire(anchor, reason);
      return { snapshot: characterSnapshot(identity, resolution('conflict', reason)), speechProfile: null };
    };
    const operation = async () => {
      if (!live()) return fallback('native_stale');
      if (actor?.pedId !== identity.pedId) return fallback('actor_mismatch');
      const extracted = actorClaim(actor, this.config);
      if (extracted.conflict) return conflict(extracted.reason);
      if (!extracted.claim) {
        const anchor = this.#anchors.get(sessionKey(identity));
        if (anchor && extracted.reason === 'no_evidence') this.#retire(anchor, 'evidence_unavailable');
        return fallback(extracted.reason);
      }
      const proof = await this.evidence.verify(identity.pedId, extracted.claim, combined);
      if (!live()) return fallback('native_stale');
      if (proof?.kind === 'conflict') return conflict('contradictory_claim');
      if (proof?.kind === 'retired') {
        const anchor = this.#anchors.get(sessionKey(identity));
        if (anchor) this.#retire(anchor, 'owner_retired');
        return fallback('owner_retired');
      }
      if (proof?.kind !== 'verified') return fallback('evidence_unavailable');
      const claim = validateClaim(proof.claim, this.config);
      const anchor = this.#anchors.get(sessionKey(identity));
      if (!claim) return fallback('invalid_evidence');
      if (anchor && !sameAssociation(anchor.claim, claim)) return conflict('incarnation_mismatch');
      if (!sameAssociation(extracted.claim, claim) || claim.observationSequence <= extracted.claim.observationSequence ||
          claim.observedGameTime < extracted.claim.observedGameTime || !this.evidence.isCurrent(claim)) {
        emit(this.telemetry, 'identity_evidence_stale', identity, { reason: 'stale_evidence' });
        if (anchor) this.#retire(anchor, 'stale_evidence');
        return fallback('stale_evidence');
      }
      if (!anchor && this.#anchors.size >= MAX_CHARACTERS) return fallback('binding_limit');
      const captured = anchor || Object.freeze({ pedId: identity.pedId, sessionNonce: identity.sessionNonce, claim });
      this.#anchors.set(sessionKey(identity), captured);
      const authority = () => live() && this.#anchors.get(sessionKey(identity)) === captured && this.evidence.isCurrent(claim);
      let record;
      try {
        record = await this.registry.resolveOrCreate(claim,
          this.config.mode === 'voices' && allowVoice ? characterId => voiceResolver.createPersistentAssignment(characterId, this.config.worldProfileId, actor) : null, authority);
      } catch {
        if (!live()) return fallback('native_stale');
        emit(this.telemetry, 'identity_store_unavailable', identity, { reason: 'store_unavailable' });
        return fallback('store_unavailable');
      }
      if (!authority()) return fallback('native_stale');
      const result = this.bindings.bind(identity, claim, record, authority);
      if (!result.binding) return result.reason === 'native_stale' || result.reason === 'binding_limit'
        ? fallback(result.reason) : conflict(result.reason);
      if (result.created) emit(this.telemetry, 'identity_binding_created', identity, { bindingRevision: result.binding.bindingRevision, identityKind: 'persistent' });
      let speechProfile = null;
      if (allowVoice && this.config.mode === 'voices' && record.voiceAssignment) {
        try { speechProfile = voiceResolver.resolvePersistent(record, this.config.worldProfileId, actor); }
        catch { emit(this.telemetry, 'persistent_voice_loaded', identity, { outcome: 'unavailable', reason: 'voice_incompatible' }); }
        if (speechProfile) emit(this.telemetry, 'persistent_voice_loaded', identity, { outcome: 'accepted', profileId: speechProfile.profileId });
      }
      const snapshot = characterSnapshot(identity, resolution('persistent', 'owner_verified', record.characterId), result.binding, record);
      emit(this.telemetry, 'identity_resolved', identity, { identityKind: 'persistent', reason: 'owner_verified', bindingRevision: result.binding.bindingRevision, characterRecordRevision: record.recordRevision });
      return { snapshot, speechProfile };
    };
    const timeoutMs = Math.max(0, Math.min(this.config.prepareTimeoutMs, deadlineAt - performance.now()));
    try {
      const result = await Promise.race([operation(), new Promise(resolve => {
        timer = setTimeout(() => { abort.abort(new Error('identity_prepare_timeout')); resolve(fallback('evidence_unavailable')); }, timeoutMs);
      })]);
      if (result.snapshot.resolution.kind !== 'persistent') emit(this.telemetry, 'identity_resolved', identity, {
        identityKind: result.snapshot.resolution.kind, reason: result.snapshot.resolution.reason });
      return result;
    } catch { return fallback('evidence_unavailable'); }
    finally { clearTimeout(timer); abort.abort(); }
  }
  close() { this.evidence.close?.(); this.unsubscribe?.(); for (const anchor of [...this.#anchors.values()]) this.#retire(anchor, 'evidence_unavailable'); }
}
