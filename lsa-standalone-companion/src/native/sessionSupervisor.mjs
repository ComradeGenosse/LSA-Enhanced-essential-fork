import { Phase2NativeClient } from './phase2Wire.mjs';

// Each reconnect is a completely new native world/transport session. No actor,
// turn, audio or action state is ever copied from an old connection.
export async function runSessionSupervisor({
  pipePath, timeoutMs = 3000, retryMs = 500,
  onStatus = () => {}, signal
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
    const client = new Phase2NativeClient({ pipePath, timeoutMs });
    const cancel = () => client.close();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const session = await client.connect();
      if (signal?.aborted) break;
      onStatus('native_connected', { hostRunId: session.hostRunId,
        worldEpoch: session.worldEpoch, transportId: session.transportId });
      const reason = await client.closed;
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
