export function sameIdentity(a, b) {
  return !!a && !!b && a.pedId === b.pedId && a.turnId === b.turnId &&
    a.generationId === b.generationId && a.sessionNonce === b.sessionNonce;
}

// Observe acknowledgements, never allocate or own playback. Subscribe before output.
export function observeNative(bridge, identity, signal, onTerminal, onObserved) {
  let accepted = false;
  let terminal = null;
  const waiters = new Set();
  const wake = () => { for (const resolve of [...waiters]) resolve(); };
  const remove = bridge.onNativeEvent(event => {
    if (!sameIdentity(identity, event)) return;
    onObserved?.(event);
    if (event.type === 'audio_turn_accepted') accepted = true;
    if (['audio_turn_rejected', 'playback_ended', 'interrupt', 'cancel', 'fail'].includes(event.type) && !terminal) {
      terminal = event; onTerminal?.(event);
    }
    wake();
  });
  const aborted = () => { terminal ||= { type: 'cancel', reason: 'cancelled' }; wake(); };
  signal.addEventListener('abort', aborted, { once: true });
  if (signal.aborted) aborted();
  function wait(predicate, timeoutMs) {
    return new Promise(resolve => {
      let timer;
      const check = () => {
        const result = predicate();
        if (result === undefined) return;
        clearTimeout(timer); waiters.delete(check); resolve(result);
      };
      timer = setTimeout(() => {
        waiters.delete(check); resolve({ ok: false, reason: 'native_ack_timeout' });
      }, timeoutMs);
      waiters.add(check); check();
    });
  }
  return {
    authorization: timeoutMs => wait(() => terminal ? { ok: false, reason: terminal.reason || terminal.type } :
      accepted ? { ok: true } : undefined, timeoutMs),
    completion: timeoutMs => wait(() => terminal ? { ...terminal, ok: terminal.type === 'playback_ended' &&
      terminal.reason === 'completed' && terminal.wasInterrupted === false &&
      terminal.hadAudio === true && terminal.playbackStarted === true } : undefined, timeoutMs),
    dispose() { remove(); signal.removeEventListener('abort', aborted); terminal ||= { type: 'cancel' }; wake(); },
  };
}
