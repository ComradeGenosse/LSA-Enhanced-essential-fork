import { PendingDialogue, handleNextTypedTurn } from './typedTurn.js.mjs';

// One model request at a time, from exactly one native connection. This is
// intentionally more restrictive than the eventual multi-NPC arbiter.
export async function runTypedTurnSession({
  client, provider, signal, pollMs = 250, onStatus = () => {}
} = {}) {
  if (!client || !provider || !Number.isInteger(pollMs) ||
      pollMs < 50 || pollMs > 5000 || typeof onStatus !== 'function')
    throw new Error('invalid_typed_runtime');
  const staged = new PendingDialogue();
  const retired = new AbortController();
  const stop = () => retired.abort();
  signal?.addEventListener('abort', stop, { once: true });
  client.closed?.then(stop, stop);
  if (signal?.aborted) stop();

  const pause = () => new Promise(resolve => {
    if (retired.signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      retired.signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, pollMs);
    retired.signal.addEventListener('abort', finish, { once: true });
  });

  try {
    while (!retired.signal.aborted) {
      try {
        const result = await handleNextTypedTurn(client, provider, {
          signal: retired.signal, pending: staged,
          onStage: () => onStatus('typed_reply_staged')
        });
        if (result.state !== 'none' && result.state !== 'staged_not_played')
          throw new Error('unknown_typed_outcome');
      } catch (error) {
        if (retired.signal.aborted) break;
        const permitted = new Set([
          'native_typed_text_missing', 'invalid_player_text',
          'provider_transport_failure', 'provider_http_failure',
          'provider_invalid_json', 'provider_incomplete', 'provider_invalid_answer',
          'typed_turn_cancelled', 'native_request_timeout',
          'native_disconnected', 'unknown_typed_outcome'
        ]);
        const code = permitted.has(error?.message) ? error.message : 'typed_turn_rejected';
        onStatus('typed_turn_failed', { reason: code });
      }
      await pause();
    }
  } finally {
    stop();
    staged.retireAll(); // never carry unplayed conversation into a new transport
    signal?.removeEventListener('abort', stop);
  }
}
