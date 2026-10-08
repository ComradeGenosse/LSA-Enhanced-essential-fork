import { exactObject, isUuid } from '../identity/identityContract.mjs';

export const HOST_FIELDS = Object.freeze(['hostContextVersion', 'hostRunId', 'worldEpoch']);
export function readHostContext(value) {
  if (!value || value.hostContextVersion !== 1 || !isUuid(value.hostRunId) ||
      !Number.isSafeInteger(value.worldEpoch) || value.worldEpoch < 1 || value.worldEpoch > 0x7fffffff) return null;
  return Object.freeze({ hostContextVersion: 1, hostRunId: value.hostRunId, worldEpoch: value.worldEpoch });
}
// The extension is all-or-nothing. Legacy peers retain their original closed
// schemas; a partial/unknown extension cannot establish cross-system authority.
export function validateHostEnvelope(value, baseKeys) {
  const extended = HOST_FIELDS.some(key => value && Object.hasOwn(value, key));
  return exactObject(value, extended ? [...baseKeys, ...HOST_FIELDS] : baseKeys) &&
    (!extended || readHostContext(value) !== null);
}
export function sameHostContext(a, b) {
  return Boolean(readHostContext(a) && readHostContext(b) && a.hostRunId === b.hostRunId && a.worldEpoch === b.worldEpoch);
}
export function validateWorldEpoch(value) {
  return exactObject(value, ['epoch', 'reason']) && Number.isSafeInteger(value.epoch) &&
    value.epoch >= 1 && value.epoch <= 0x7fffffff &&
    ['clock_regression', 'host_reload', 'timeline_change'].includes(value.reason);
}
