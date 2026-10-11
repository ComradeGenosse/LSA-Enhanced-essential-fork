// Phase 3a: native-only player_text -> provider -> exact native staged reply.
// No acoustic playback occurs, and no durable dialogue history is committed.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class PendingDialogue {
  #pending = new Map();
  get pendingCount() { return this.#pending.size; }
  stage(nativeRun, offer, reply) {
    if (!ID.test(nativeRun) || !ID.test(offer.turnId) ||
        typeof reply !== 'string' || !reply.trim()) throw new Error('invalid_staged_reply');
    const key = nativeRun + ':' + offer.turnId;
    if (this.#pending.has(key)) throw new Error('duplicate_staged_history');
    this.#pending.set(key, { actorIncarnationId: offer.actorIncarnationId, reply });
  }
  retireAll() { this.#pending.clear(); }
  // Intentionally no commit method until a verified Phase 4 playback receipt.
}

function nativeClaims(offer) {
  return {
    turnId: offer.turnId,
    actorIncarnationId: offer.actorIncarnationId,
    leaseId: offer.leaseId,
    generation: offer.generation
  };
}

export async function handleNextTypedTurn(client, provider, {
  signal, pending = new PendingDialogue(), onStage = () => {}
} = {}) {
  if (!client || typeof client.request !== 'function' || !provider ||
      typeof provider.complete !== 'function') throw new Error('invalid_pipeline');
  const offer = await client.request('turn.next');
  if (offer.status === 'none') return { state: 'none' };
  if (offer.status !== 'ok') throw new Error('native_offer_rejected');
  const claims = nativeClaims(offer);
  try {
    if (offer.source !== 'player_text' || typeof offer.playerText !== 'string' ||
        !offer.playerText.trim() || offer.playerText.length > 1024)
      throw new Error('native_typed_text_missing');
    if (signal?.aborted) throw new Error('typed_turn_cancelled');
    await client.request('turn.confirm', {
      ...claims,
      sessionNonce: offer.sessionNonce,
      source: 'player_text'
    });
    const perTurn = new AbortController();
    const onAbort = () => perTurn.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    client.closed?.then(onAbort);
    try {
      const replyText = await provider.complete({
        text: offer.playerText,
        signal: perTurn.signal
      });
      if (perTurn.signal.aborted || signal?.aborted) throw new Error('typed_turn_cancelled');
      if (typeof replyText !== 'string' || !replyText.trim() ||
          replyText.length > 2048 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(replyText))
        throw new Error('invalid_provider_output');
      const ack = await client.request('turn.reply', { ...claims, replyText });
      if (ack.status !== 'staged_not_played') throw new Error('native_reply_not_staged');
      // RAM only. Never claim playback or promote to durable history.
      pending.stage(offer.hostRunId, offer, replyText);
      onStage({ status: 'staged_not_played', turnId: offer.turnId });
      return { state: 'staged_not_played', turnId: offer.turnId };
    } finally {
      signal?.removeEventListener('abort', onAbort);
      perTurn.abort();
    }
  } catch (error) {
    try { await client.request('turn.cancel', claims); } catch {}
    throw error;
  }
}
