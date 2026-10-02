import { immutableSnapshot } from '../context/turnSnapshot.mjs';

export const OWNER_NAMESPACE = 'comrade.authored';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isUuid(value) { return typeof value === 'string' && UUID.test(value); }
export const MAX_CHARACTERS = 1000;
export const MAX_STORE_BYTES = 1_048_576;
const CLAIM_KEYS = ['schemaVersion','sourceContractVersion','worldProfileId','sourceNamespace','sourceKey','adapterEpoch','incarnationId','claimRevision','observationSequence','observedGameTime'];
export function exactObject(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function boundedKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value) && Buffer.byteLength(value) <= 256;
}
export function positive(value) { return Number.isSafeInteger(value) && value > 0; }
export function aliasKey(alias) { return JSON.stringify([alias.worldProfileId, alias.sourceNamespace, alias.sourceKey]); }
export function sessionKey(session) { return JSON.stringify([session.pedId, session.sessionNonce]); }
export function sourceAlias(claim) {
  return Object.freeze({ worldProfileId: claim.worldProfileId, sourceNamespace: claim.sourceNamespace, sourceKey: claim.sourceKey });
}
export function sameAssociation(a, b) {
  return !!a && !!b && aliasKey(a) === aliasKey(b) && a.adapterEpoch === b.adapterEpoch &&
    a.incarnationId === b.incarnationId && a.claimRevision === b.claimRevision;
}
export function validateClaim(value, { worldProfileId, trustedNamespaces = [OWNER_NAMESPACE] } = {}) {
  if (!exactObject(value, CLAIM_KEYS) || value.schemaVersion !== 1 || value.sourceContractVersion !== 1 ||
      !isUuid(value.worldProfileId) || (worldProfileId && value.worldProfileId !== worldProfileId) ||
      !trustedNamespaces.includes(value.sourceNamespace) || value.sourceNamespace !== OWNER_NAMESPACE ||
      !boundedKey(value.sourceKey) || !isUuid(value.adapterEpoch) || !isUuid(value.incarnationId) ||
      !positive(value.claimRevision) || !positive(value.observationSequence) ||
      !Number.isSafeInteger(value.observedGameTime) || value.observedGameTime < 0 || value.observedGameTime > 0xffffffff) return null;
  return immutableSnapshot(value);
}
export function actorClaim(actor, config) {
  // Essential's normalizer makes a raw copy as well as preserving the namespace.
  const block = actor?.integrations?.sessionIdentity;
  if (block == null) return { claim: null, reason: 'no_evidence' };
  const claim = validateClaim(block, config);
  if (!claim) return { claim: null, reason: 'invalid_evidence' };
  const raw = actor?.integrations?.raw?.sessionIdentity;
  if (raw !== undefined) {
    const rawClaim = validateClaim(raw, config);
    if (!rawClaim || JSON.stringify(rawClaim) !== JSON.stringify(claim)) return { claim: null, reason: 'contradictory_claim', conflict: true };
  }
  return { claim, reason: 'owner_verified' };
}
export function characterSnapshot(identity, resolution, binding = null, record = null) {
  return immutableSnapshot({ nativeIdentity: identity, resolution,
    bindingId: binding?.bindingId ?? null, bindingRevision: binding?.bindingRevision ?? null,
    characterRecordRevision: record?.recordRevision ?? null });
}
export function resolution(kind, reason, characterId = null) { return Object.freeze({ kind, reason, characterId }); }

export function normalizeIdentityConfig(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('persistentIdentity must be an object.');
  const allowed = ['enabled','mode','worldProfileId','storePath','pipeName','prepareTimeoutMs'];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError('Unknown persistentIdentity option.');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new TypeError('persistentIdentity.enabled must be boolean.');
  const enabled = value.enabled === true;
  const mode = value.mode ?? 'shadow';
  if (!['shadow','voices'].includes(mode)) throw new TypeError('persistentIdentity.mode must be shadow or voices.');
  const worldProfileId = value.worldProfileId ?? '';
  if ((enabled || worldProfileId) && !isUuid(worldProfileId)) throw new TypeError('persistentIdentity needs an explicit worldProfileId UUID.');
  const storePath = value.storePath ?? 'identity/characters.v1.json';
  if (typeof storePath !== 'string' || !storePath.trim() || storePath.length > 512) throw new TypeError('Invalid identity store path.');
  const pipeName = value.pipeName ?? 'LSA.SessionIdentity.v1';
  if (typeof pipeName !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(pipeName)) throw new TypeError('Invalid identity pipe name.');
  const prepareTimeoutMs = value.prepareTimeoutMs ?? 400;
  if (!Number.isSafeInteger(prepareTimeoutMs) || prepareTimeoutMs < 25 || prepareTimeoutMs > 1000) throw new TypeError('Identity preparation must be bounded to 25–1000 ms.');
  return Object.freeze({ enabled, mode, worldProfileId, storePath, pipeName, prepareTimeoutMs, trustedNamespaces: Object.freeze([OWNER_NAMESPACE]) });
}
