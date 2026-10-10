import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { FRAME_BYTES, validateFrame } from './contracts.mjs';
import { ACTIVITY_CAPABILITIES_SHA256 } from './capabilityRegistry.mjs';
import { readHostContext } from '../context/hostContext.mjs';
import {validateDialogueActionAnnotation,validateDialogueActionReceipt} from './dialogueActionContract.mjs';

const RECEIPTS = Object.freeze({ accepted: 'HANDLER_ACCEPTED', failed: 'FAILED', superseded: 'SUPERSEDED', timedOut: 'TIMED_OUT', detached: 'DETACHED' });

const EXECUTION = new Set(['actor.acquire', 'actor.release', 'anchor.resolve', 'step.preflight', 'step.begin', 'step.cancel', 'step.query']);

// Shadow observes. Mode "on" may also send the closed ACT2 execution frames.
export class ActivityClient {
  constructor(config, options = {}) {
    const { connect = value => net.createConnection(value), now = () => Date.now(), onEvent = () => {}, onFrame = () => {}, contractSha256 = ACTIVITY_CAPABILITIES_SHA256 } = options;
    this.config = config; this.connect = connect; this.now = now; this.onEvent = onEvent; this.contractSha256 = contractSha256;
    this.closed = false; this.socket = null; this.clientRun = null; this.onFrame = onFrame;
    this.outSequence = 0;
    this.runtime = { ready: false, expected: 1, counters: {}, events: [] };
  }
  start() {
    if ((this.config.mode !== 'shadow' && this.config.mode !== 'on') || this.closed || this.socket) return;
    const socket = this.connect({ path: `\\\\.\\pipe\\${this.config.pipeName}` });
    this.socket = socket; this.clientRun = randomUUID(); this.runtime.ready = false; this.runtime.hostContext = null; this.runtime.dialogueActionVersion=null; this.runtime.expected = 1; this.outSequence = 0;
    let buffer = Buffer.alloc(0), frames = [], hello = false;
    const fail = () => socket.destroy();
    const send = value => { const text = JSON.stringify(value); if (Buffer.byteLength(text) > FRAME_BYTES || (this.config.mode !== 'on' && EXECUTION.has(value.type))) { fail(); return; } socket.write(text + '\n'); };
    this.deliver = send;
    const emit = (event, data) => { this.runtime.events.push(event); try { this.onEvent(event, data); } catch {} };
    const processFrames = () => {
      this.work = null;
      while (frames.length) {
        let value; try { value = JSON.parse(frames.shift()); } catch { fail(); return; }
        const dialogueReceipt=value?.type==='dialogue.action.receipt';
        if (!(dialogueReceipt?validateDialogueActionReceipt(value):validateFrame(value)) || (value.contractSha256 && value.contractSha256 !== this.contractSha256)) { fail(); return; }
        if(dialogueReceipt && (!hello || this.runtime.dialogueActionVersion!==1 || value.nativeRun!==this.runtime.nativeRun || value.adapterEpoch!==this.runtime.adapterEpoch || value.binding.hostContext.hostRunId!==this.runtime.hostContext?.hostRunId || value.binding.hostContext.worldEpoch!==this.runtime.hostContext?.worldEpoch)){fail();return;}
        if (!hello) {
          if (value.type !== 'hello' || value.nativeRun === undefined) { fail(); return; }
          if (this.runtime.nativeRun && this.runtime.nativeRun !== value.nativeRun) this.runtime.counters = {};
          this.runtime.nativeRun = value.nativeRun;
          this.runtime.adapterEpoch = value.adapterEpoch;
          this.runtime.capabilities = value.capabilities;
          this.runtime.hostContext = readHostContext(value);
          this.runtime.dialogueActionVersion=value.dialogueActionVersion===1?1:null;
          hello = true; this.runtime.ready = true; this.outSequence = 0;
          send({ version: 1, type: 'hello', contractSha256: this.contractSha256, clientRun: this.clientRun,...this.runtime.hostContext,...(this.runtime.dialogueActionVersion===1?{dialogueActionVersion:1}:{}) });
          // Establish the execution lease immediately. Heartbeats and execution
          // frames share this one monotonically increasing client sequence.
          send({ version: 1, type: 'lease', sequence: ++this.outSequence, leaseTtlMs: 5000 });
          try { this.onFrame(value); } catch {}
          continue;
        }
        if (value.type === 'hello' || value.sequence !== this.runtime.expected) { fail(); return; }
        this.runtime.expected++;
        if(value.type==='world_epoch') {
          if(!this.runtime.hostContext || value.epoch!==this.runtime.hostContext.worldEpoch+1) {fail();return;}
          this.runtime.ready=false;
          try {this.onFrame(value);} catch {}
          fail();return;
        }
        if (value.type !== 'diagnostics') { try { this.onFrame(value); } catch {} }
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
    socket.on('close', () => { if (this.work) clearImmediate(this.work); this.work = null; clearInterval(this.lease); this.socket = null; this.deliver = null; this.runtime.ready = false; this.runtime.hostContext = null; this.runtime.dialogueActionVersion=null; const restart = this.clientRun != null; this.clientRun = null; if (restart) { try { this.onFrame({ type: 'hello', nativeRun: this.runtime.nativeRun, adapterEpoch: this.runtime.adapterEpoch, capabilities: this.runtime.capabilities, clientRestart: true }); } catch {} } if (!this.closed) { this.retry = setTimeout(() => this.start(), 1000); this.retry.unref?.(); } });
    this.lease = setInterval(() => { if (hello && !this.closed) send({ version: 1, type: 'lease', sequence: ++this.outSequence, leaseTtlMs: 5000 }); }, 1000);
    this.lease.unref?.();
    socket.once('close', () => clearInterval(this.lease));
  }
  send(frame) {
    if (this.config.mode !== 'on' || !this.deliver || !this.runtime.ready || !EXECUTION.has(frame?.type)) return false;
    const sequenced = { ...frame, version: 1, sequence: ++this.outSequence };
    this.deliver(sequenced);
    return sequenced;
  }
  sendDialogueAnnotation(frame){
    if(!['shadow','on'].includes(this.config.mode) || !this.deliver || !this.runtime.ready || this.runtime.dialogueActionVersion!==1)return false;
    const sequenced={...frame,version:1,type:'dialogue.action.pending',sequence:this.outSequence+1,dialogueActionVersion:1};
    if(!validateDialogueActionAnnotation(sequenced) || !this.runtime.hostContext || frame.binding.hostContext.hostRunId!==this.runtime.hostContext.hostRunId || frame.binding.hostContext.worldEpoch!==this.runtime.hostContext.worldEpoch)return false;
    this.outSequence++;this.deliver(sequenced);return sequenced;
  }
  stop() { this.closed = true; clearTimeout(this.retry); clearInterval(this.lease); if (this.work) clearImmediate(this.work); this.socket?.destroy(); this.socket = null; this.deliver = null; this.runtime.ready = false; this.runtime.hostContext = null; this.runtime.dialogueActionVersion=null; this.clientRun = null; }
}
