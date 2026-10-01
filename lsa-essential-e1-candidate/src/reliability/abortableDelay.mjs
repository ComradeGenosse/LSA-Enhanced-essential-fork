export function abortableDelay(delayMs, { signal, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 0) return Promise.reject(new TypeError('Retry delay must be a nonnegative finite number.'));
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('cancelled'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason || new Error('cancelled'));
    const timer = setTimer(() => finish(), delayMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
