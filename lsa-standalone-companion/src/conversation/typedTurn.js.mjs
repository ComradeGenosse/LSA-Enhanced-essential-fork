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
    // Each new unplayed reply supersedes any earlier unplayed reply from
    // the same native conversation. None becomes durable model history.
    const conversationId = offer.conversationId ?? offer.actorIncarnationId;
    for (const [oldKey, record] of this.#pending)
      if (record.run === nativeRun && record.conversationId === conversationId)
        this.#pending.delete(oldKey);
    if (this.#pending.size >= 16) throw new Error('staged_history_capacity');
    this.#pending.set(key, {
      run: nativeRun, conversationId, actorIncarnationId: offer.actorIncarnationId,
      turnOrdinal: offer.turnOrdinal ?? null, reply
    });
  }
  retireAll() { this.#pending.clear(); }
  // Intentionally no commit method until a verified Phase 4 playback receipt.
}

// Source-time user statements only. This never treats a staged assistant
// response as audible, completed or suitable for model conversation history.
// Exactly one instance is owned by each live native transport supervisor.
export class NativePlayerContext {
  #sessions = new Map();

  record(offer) {
    if (!ID.test(offer.hostRunId) || !ID.test(offer.conversationId) ||
        !ID.test(offer.actorIncarnationId) ||
        !Number.isSafeInteger(offer.turnOrdinal) || offer.turnOrdinal < 1 ||
        typeof offer.playerText !== 'string' || !offer.playerText.trim())
      throw new Error('invalid_native_conversation');
    const key = offer.hostRunId + ':' + offer.conversationId;
    let slot = this.#sessions.get(key);
    if (!slot) {
      if (this.#sessions.size >= 16) throw new Error('conversation_capacity');
      slot = { actorIncarnationId: offer.actorIncarnationId, ordinal: 0, inputs: [] };
      this.#sessions.set(key, slot);
    }
    if (slot.actorIncarnationId !== offer.actorIncarnationId ||
        offer.turnOrdinal <= slot.ordinal)
      throw new Error('stale_native_conversation');
    const previous = slot.inputs.slice();
    slot.ordinal = offer.turnOrdinal;
    slot.inputs.push(offer.playerText);
    if (slot.inputs.length > 6) slot.inputs.shift();
    return previous;
  }

  retireAll() { this.#sessions.clear(); }
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
  signal, pending = new PendingDialogue(),
  playerContext = new NativePlayerContext(), onStage = () => {}
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
    const previousPlayerInputs = offer.conversationId
      ? playerContext.record(offer) : [];
    const perTurn = new AbortController();
    const onAbort = () => perTurn.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    client.closed?.then(onAbort);
    try {
      const replyText = await provider.complete({
        text: offer.playerText,
        previousPlayerInputs,
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
