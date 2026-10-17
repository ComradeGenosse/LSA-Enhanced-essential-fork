// EA5 v1 wire contract. A payload is evidence only after the native intelligence
// client has authenticated the local named-pipe connection and accepted its
// monotonically ordered frame; calling this validator does NOT authenticate it.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PROTAGONIST_EVENT='protagonist_model';
export const PROTAGONIST_FRESH_MS=1500;
const known=new Set(['franklin','michael','trevor','unknown']);
const exact=(value,keys)=>value!==null && typeof value==='object' &&
  !Array.isArray(value) && Object.keys(value).length===keys.length &&
  keys.every(key=>Object.hasOwn(value,key));

export function readProtagonistPayload(value) {
  const keys=['version','source','protagonist','hostRunId','worldEpoch','revision'];
  if(!exact(value,keys) || value.version!==1 ||
      value.source!=='native_player_model' || !known.has(value.protagonist) ||
      typeof value.hostRunId!=='string' || !UUID.test(value.hostRunId) ||
      !Number.isSafeInteger(value.worldEpoch) || value.worldEpoch<1 ||
      !Number.isSafeInteger(value.revision) || value.revision<1) return null;
  // Source field remains native-only; unknown is a revocation, never
  // substituted with a guessed name or a previous known character.
  return Object.freeze({...value});
}

export function readProtagonistFrame(frame) {
  if(!frame || typeof frame!=='object' || Array.isArray(frame) ||
      frame.version!==1 || frame.type!==PROTAGONIST_EVENT ||
      typeof frame.adapterEpoch!=='string' || !UUID.test(frame.adapterEpoch) ||
      typeof frame.streamId!=='string' || !UUID.test(frame.streamId) ||
      !Number.isSafeInteger(frame.sequence) || frame.sequence<1) return null;
  return readProtagonistPayload(frame.payload);
}
