export class DialogueHistory {
  #sessions = new Map();
  #maxMessages;
  #onMetric;

  constructor({ maxMessages = 12, onMetric = () => {} } = {}) {
    if (!Number.isSafeInteger(maxMessages) || maxMessages < 2) throw new TypeError('maxMessages must be at least 2.');
    this.#maxMessages = maxMessages;
    this.#onMetric = onMetric;
  }

  #key(pedId, sessionNonce) { return `${pedId}:${sessionNonce}`; }
  #get(pedId, sessionNonce) {
    const key = this.#key(pedId, sessionNonce);
    let session = this.#sessions.get(key);
    if (!session) { session = { messages: [], committedPlayerTurns: new Set(), pending: new Map() }; this.#sessions.set(key, session); }
    return session;
  }
  #identityKey(identity) { return [identity.pedId,identity.turnId,identity.generationId,identity.sessionNonce].join('\\0'); }
  #trim(session) {
    while (session.messages.length > this.#maxMessages) {
      const removed = session.messages.shift();
      if (removed.identityKey) session.committedPlayerTurns.delete(removed.identityKey);
      this.#onMetric('history_trimmed', { historySize: session.messages.length + 1, trimmed: 1 });
    }
  }

  readForSession(pedId, sessionNonce) {
    return (this.#sessions.get(this.#key(pedId, sessionNonce))?.messages || []).map(({ role, content }) => ({ role, content }));
  }

  commitPlayerInput({ identity, input }) {
    const text = String(input || '').trim().slice(0, 12_000);
    if (!text || !identity?.pedId || !identity?.turnId) return false;
    const session = this.#get(identity.pedId,identity.sessionNonce);
    const identityKey = this.#identityKey(identity);
    if (session.committedPlayerTurns.has(identityKey)) return false;
    session.messages.push({ role:'user',content:text,identityKey });
    session.committedPlayerTurns.add(identityKey);
    this.#trim(session);
    return true;
  }

  stage({ identity, spokenReply }) {
    const session = this.#get(identity.pedId,identity.sessionNonce);
    session.pending.set(identity.turnId, {
      identity: { ...identity },
      spokenReply: String(spokenReply || '').slice(0, 1200), ttsSucceeded:false,
    });
  }

  markModelAndTtsSucceeded(identity) {
    const item = this.#sessions.get(this.#key(identity.pedId, identity.sessionNonce))?.pending.get(identity.turnId);
    if (item && sameIdentity(item.identity, identity)) item.ttsSucceeded = true;
  }

  acceptPlaybackResult(result) {
    const session = this.#sessions.get(this.#key(result.pedId, result.sessionNonce));
    const item = session?.pending.get(result.turnId);
    if (!item || !sameIdentity(item.identity, result)) return false;
    if (!item.ttsSucceeded || result.playbackSucceeded !== true || result.wasInterrupted || !result.hadAudio || !result.playbackStarted) {
      session.pending.delete(result.turnId);
      return false;
    }
    session.pending.delete(result.turnId);
    session.messages.push({ role:'assistant', content:item.spokenReply });
    this.#trim(session);
    return true;
  }

  discard(identity) {
    const pending = this.#sessions.get(this.#key(identity.pedId, identity.sessionNonce))?.pending;
    return sameIdentity(pending?.get(identity.turnId)?.identity, identity) ? pending.delete(identity.turnId) : false;
  }

  clearSession(pedId, sessionNonce) { return this.#sessions.delete(this.#key(pedId, sessionNonce)); }
  clearAll() { this.#sessions.clear(); }
}

function sameIdentity(a, b) {
  return !!a && !!b && a.pedId === b.pedId && a.turnId === b.turnId && a.generationId === b.generationId && a.sessionNonce === b.sessionNonce;
}
