import { Phase2NativeClient } from './phase2Wire.mjs';

// Each reconnect is a completely new native world/transport session. No actor,
// turn, audio or action state is ever copied from an old connection.
export async function runSessionSupervisor({
  pipePath, timeoutMs = 3000, retryMs = 500,
  onStatus = () => {}, onConnected = null, signal
} = {}) {
  if (signal?.aborted) return;
  if (!Number.isInteger(retryMs) || retryMs < 50 || retryMs > 10000)
    throw new Error('invalid_retry_interval');
  const sleep = duration => new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, duration);
    signal?.addEventListener('abort', done, { once: true });
  });
  while (!signal?.aborted) {
    const client = new Phase2NativeClient(pipePath === undefined ? { timeoutMs } : { pipePath, timeoutMs });
    const cancel = () => client.close();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const session = await client.connect();
      if (signal?.aborted) break;
      onStatus('native_connected', { hostRunId: session.hostRunId,
        worldEpoch: session.worldEpoch, transportId: session.transportId });
      // Provider work is scoped to this exact transport; on disconnect it is
      // aborted before another host session may run. Never transfer live state.
      const transport = new AbortController();
      const stopTransport = () => transport.abort();
      signal?.addEventListener('abort', stopTransport, { once: true });
      client.closed.then(stopTransport);
      let sessionWork = null;
      if (onConnected && !signal?.aborted) {
        sessionWork = Promise.resolve().then(() =>
          onConnected(client, { ...session }, transport.signal)
        ).catch(() => {
          // Never log arbitrary provider errors or user text from callbacks.
          if (!transport.signal.aborted) {
            onStatus('session_handler_failed', { reason: 'handler_failed' });
            client.close();
          }
        });
      }
      const reason = await client.closed;
      stopTransport();
      signal?.removeEventListener('abort', stopTransport);
      // The detached promise always has a rejection handler; a provider
      // ignoring cancellation cannot block a new transport or crash Node.
      if (!signal?.aborted) onStatus('native_disconnected', { reason });
    } catch (error) {
      if (!signal?.aborted)
        onStatus('native_unavailable', { reason: error.message });
    } finally {
      signal?.removeEventListener('abort', cancel);
      client.close();
    }
    if (!signal?.aborted) await sleep(retryMs);
  }
}
