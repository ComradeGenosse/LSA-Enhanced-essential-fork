import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { UUID, OWNER_NAMESPACE, validateClaim, boundedKey, positive, exactObject } from './identityContract.mjs';
import { validateHostEnvelope, readHostContext } from '../context/hostContext.mjs';

// The server is the configured addon pipe, ACL'd to the current Windows user.
// Claims from mutable actor JSON only reference this independent owner ledger.
export class OwnerEvidence {
  #socket = null;
  #opening = null;
  #epoch = null;
  #hostContext = null;
  #pending = new Map();
  #listeners = new Set();
  #revoked = new Set();
  #lease = null;
  #closed = false;
  constructor(config, { connect = options => net.createConnection(options), platform = process.platform } = {}) {
    this.config = config; this.connect = connect; this.platform = platform;
  }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  get hostContext() { return this.#hostContext; }
  #notify(fact) { for (const listener of this.#listeners) { try { listener(fact); } catch {} } }
  #token(claim) { return JSON.stringify([claim.adapterEpoch,claim.incarnationId,claim.claimRevision]); }
  #renew() {
    clearTimeout(this.#lease);
    this.#lease = setTimeout(() => this.#drop(), 1500);
    this.#lease.unref?.();
  }
  #drop() {
    const socket = this.#socket; this.#socket = null;
    clearTimeout(this.#lease);
    socket?.destroy();
    for (const request of this.#pending.values()) request.finish({ kind: 'unavailable', reason: 'evidence_unavailable' });
    this.#pending.clear();
    if (this.#epoch) this.#notify({ type: 'lost', adapterEpoch: this.#epoch });
    this.#epoch = null; this.#revoked.clear();
    this.#hostContext = null;
  }
  async #open(signal) {
    if (this.#socket && this.#epoch) return true;
    if (this.platform !== 'win32' || this.#closed || signal.aborted) return false;
    if (this.#opening) return await this.#opening;
    this.#opening = new Promise(resolve => {
      const socket = this.connect({ path: '\\\\.\\pipe\\' + this.config.pipeName });
      this.#socket = socket;
      socket.unref?.();
      let bytes = Buffer.alloc(0), greeted = false, settled = false;
      const finish = ok => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); resolve(ok); };
      const cancel = () => { this.#drop(); finish(false); };
      const timer = setTimeout(cancel, this.config.prepareTimeoutMs);
      signal.addEventListener('abort', cancel, { once: true });
      socket.on('error', cancel);
      socket.on('close', () => { if (this.#socket === socket) this.#drop(); finish(false); });
      socket.on('data', chunk => {
        if (this.#socket !== socket) return;
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 16_384) return cancel();
        while (bytes.includes(10)) {
          const end = bytes.indexOf(10);
          if (end > 4096) return cancel();
          const line = bytes.subarray(0, end); bytes = bytes.subarray(end + 1);
          let message;
          try { message = JSON.parse(line.toString('utf8')); } catch { return cancel(); }
          if (!greeted) {
            if (!validateHostEnvelope(message, ['schemaVersion','type','adapterEpoch','sourceNamespace']) || message.schemaVersion !== 1 ||
                message.type !== 'hello' || !UUID.test(message.adapterEpoch) || message.sourceNamespace !== OWNER_NAMESPACE) return cancel();
            this.#epoch = message.adapterEpoch; this.#hostContext=readHostContext(message); greeted = true; this.#renew(); finish(true);
          } else if (!this.#receive(message)) return cancel();
        }
      });
    });
    try { return await this.#opening; } finally { this.#opening = null; }
  }
  #receive(message) {
    if (message?.schemaVersion !== 1 || !UUID.test(message.adapterEpoch)) return false;
    if (message.adapterEpoch !== this.#epoch) return true; // Old facts cannot revoke a newer epoch or renew its lease.
    if (message.type === 'heartbeat') {
      if (!exactObject(message, ['schemaVersion','type','adapterEpoch'])) return false;
      this.#renew(); return true;
    }
    if (message.type === 'revoke') {
      if (!exactObject(message, ['schemaVersion','type','adapterEpoch','pedId','incarnationId','claimRevision']) ||
          !boundedKey(message.pedId) || !UUID.test(message.incarnationId) || !positive(message.claimRevision)) return false;
      if (this.#revoked.size >= 2000) return false;
      this.#revoked.add(this.#token(message)); this.#notify(message); return true;
    }
    if (message.type !== 'proof' || !exactObject(message, ['schemaVersion','type','adapterEpoch','requestId','pedId','status','claim']) ||
        !UUID.test(message.requestId) || !boundedKey(message.pedId) || !['active','absent','conflict'].includes(message.status)) return false;
    const pending = this.#pending.get(message.requestId);
    if (!pending) return true; // A timed-out response can never publish.
    if (message.pedId !== pending.pedId) return false;
    let outcome;
    if (message.status === 'active') {
      const claim = validateClaim(message.claim, this.config);
      if (!claim || claim.adapterEpoch !== this.#epoch) return false;
      outcome = { kind: 'verified', claim };
    } else {
      if (message.claim !== null) return false;
      outcome = { kind: message.status === 'conflict' ? 'conflict' : 'retired', reason: message.status === 'conflict' ? 'contradictory_claim' : 'owner_retired' };
    }
    pending.finish(outcome); return true;
  }
  async verify(pedId, claim, signal) {
    if (!await this.#open(signal) || signal.aborted || !this.#socket) return { kind: 'unavailable', reason: 'evidence_unavailable' };
    return await new Promise(resolve => {
      const requestId = randomUUID();
      const finish = outcome => {
        if (!this.#pending.has(requestId)) return;
        this.#pending.delete(requestId); clearTimeout(timer); signal.removeEventListener('abort', cancel); resolve(outcome);
      };
      const cancel = () => finish({ kind: 'unavailable', reason: 'evidence_unavailable' });
      const timer = setTimeout(cancel, this.config.prepareTimeoutMs);
      this.#pending.set(requestId, { pedId, finish });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) return cancel();
      this.#socket.write(JSON.stringify({ schemaVersion: 1, type: 'verify', requestId, pedId }) + '\n');
    });
  }
  isCurrent(claim) { return !!this.#socket && this.#epoch === claim.adapterEpoch && !this.#revoked.has(this.#token(claim)); }
  close() { this.#closed = true; this.#drop(); this.#listeners.clear(); }
}
