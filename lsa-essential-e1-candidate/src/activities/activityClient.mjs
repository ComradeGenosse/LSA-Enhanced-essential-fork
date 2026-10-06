import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { FRAME_BYTES, validateFrame } from './contracts.mjs';
import { ACTIVITY_CAPABILITIES_SHA256 } from './capabilityRegistry.mjs';

const RECEIPTS = Object.freeze({ accepted: 'HANDLER_ACCEPTED', failed: 'FAILED', superseded: 'SUPERSEDED', timedOut: 'TIMED_OUT', detached: 'DETACHED' });

// Shadow client. It never sends step.begin or any other execution frame.
export class ActivityClient {
  constructor(config, { connect = options => net.createConnection(options), now = () => Date.now(), onEvent = () => {}, contractSha256 = ACTIVITY_CAPABILITIES_SHA256 } = {}) {
    this.config = config; this.connect = connect; this.now = now; this.onEvent = onEvent; this.contractSha256 = contractSha256;
    this.closed = false; this.socket = null; this.clientRun = null;
    this.runtime = { ready: false, expected: 1, counters: {}, events: [] };
  }
  start() {
    if (this.config.mode !== 'shadow' || this.closed || this.socket) return;
    const socket = this.connect({ path: `\\\\.\\pipe\\${this.config.pipeName}` });
    this.socket = socket; this.clientRun = randomUUID(); this.runtime.ready = false; this.runtime.expected = 1;
    let buffer = Buffer.alloc(0), frames = [], hello = false, sequence = 0;
    const fail = () => socket.destroy();
    const send = value => { const text = JSON.stringify(value); if (Buffer.byteLength(text) > FRAME_BYTES || value.type === 'step.begin') { fail(); return; } socket.write(text + '\n'); };
    const emit = (event, data) => { this.runtime.events.push(event); try { this.onEvent(event, data); } catch {} };
    const processFrames = () => {
      this.work = null;
      while (frames.length) {
        let value; try { value = JSON.parse(frames.shift()); } catch { fail(); return; }
        if (!validateFrame(value) || (value.contractSha256 && value.contractSha256 !== this.contractSha256)) { fail(); return; }
        if (!hello) {
          if (value.type !== 'hello' || value.nativeRun === undefined) { fail(); return; }
          if (this.runtime.nativeRun && this.runtime.nativeRun !== value.nativeRun) this.runtime.counters = {};
          this.runtime.nativeRun = value.nativeRun;
          this.runtime.adapterEpoch = value.adapterEpoch;
          hello = true; this.runtime.ready = true; sequence = 0; send({ version: 1, type: 'hello', contractSha256: this.contractSha256, clientRun: this.clientRun });
          continue;
        }
        if (value.type === 'hello' || value.sequence !== this.runtime.expected) { fail(); return; }
        this.runtime.expected++;
        if (value.type === 'diagnostics') {
          for (const [key, state] of Object.entries(RECEIPTS)) if ((value[key] || 0) > (this.runtime.counters[key] || 0)) emit('activity_receipt', { receiptState: state });
          if ((value.leaseExpiries || 0) > (this.runtime.counters.leaseExpiries || 0)) emit('activity_lease_lost', {});
          this.runtime.counters = Object.fromEntries(Object.entries(value).filter(([key]) => typeof value[key] === 'number'));
        }
      }
    };
    socket.on('data', chunk => {
      for (let offset = 0; offset < chunk.length;) {
        const end = chunk.indexOf(10, offset), limit = end < 0 ? chunk.length : end;
        if (buffer.length + limit - offset > FRAME_BYTES) { fail(); return; }
        buffer = Buffer.concat([buffer, chunk.subarray(offset, limit)]);
        if (end < 0) break;
        frames.push(buffer.toString('utf8')); buffer = Buffer.alloc(0); offset = end + 1;
      }
      if (!this.work) this.work = setImmediate(processFrames);
    });
    socket.on('error', () => {});
    socket.on('close', () => { if (this.work) clearImmediate(this.work); this.work = null; clearInterval(this.lease); this.socket = null; this.runtime.ready = false; this.clientRun = null; if (!this.closed) { this.retry = setTimeout(() => this.start(), 1000); this.retry.unref?.(); } });
    this.lease = setInterval(() => { if (hello && !this.closed) send({ version: 1, type: 'lease', sequence: ++sequence, leaseTtlMs: 5000 }); }, 1000);
    this.lease.unref?.();
    socket.once('close', () => clearInterval(this.lease));
  }
  stop() { this.closed = true; clearTimeout(this.retry); clearInterval(this.lease); if (this.work) clearImmediate(this.work); this.socket?.destroy(); this.socket = null; this.runtime.ready = false; this.clientRun = null; }
}
