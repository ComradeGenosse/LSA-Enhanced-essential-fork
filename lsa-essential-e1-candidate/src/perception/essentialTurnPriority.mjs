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
