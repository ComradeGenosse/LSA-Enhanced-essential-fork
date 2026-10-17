// Native actor IDs are exact transport keys, never durable character IDs.
// RAGE PoolHandle.ToString() emits zero-padded lowercase hexadecimal. Older
// fixtures/transports use decimal; preserve either spelling without conversion.
// Ownership, incarnation, encounter, world and turn equality remain separate gates.
export function isNativeActorId(value) {
  if (typeof value !== 'string') return false;
  if (/^[0-9a-f]{8}$/.test(value)) return value !== '00000000';
  return /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 2147483647;
}
