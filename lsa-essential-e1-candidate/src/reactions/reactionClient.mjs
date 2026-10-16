import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { isReactionName } from './reactionCatalog.mjs';

// One-way, best-effort local pipe client for cosmetic reactions. It is a
// separate failure domain: it never shares a connection, lease or sequence
// space with ACT, the intelligence stream or the P2 control pipe, so a bad or
// dropped reaction frame cannot disturb any of them.
//
// Native speaks first (hello) and states its host run and world epoch. Every
// frame echoes both, so a frame cannot outlive a native host reload or world
// reset. When not ready, send() drops the frame and returns false: reactions
// are never queued, retried or replayed.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MAX_FRAME_BYTES = 1024;
export const MAX_NATIVE_LINE_BYTES = 2048;
const MAX_WRITE_BACKLOG_BYTES = 4096;

export function defaultPipePath(pipeName) {
  return `\\\\.\\pipe\\${pipeName}`;
}

export function validateHello(value) {
  return !!value && typeof value === 'object' && value.version === 1 && value.type === 'hello' &&
    value.reactionVersion === 1 && typeof value.hostRunId === 'string' && UUID.test(value.hostRunId) &&
    Number.isSafeInteger(value.worldEpoch) && value.worldEpoch >= 1 &&
    (value.mode === 'shadow' || value.mode === 'on');
}

export class ReactionClient {
  #config; #connect; #pathFor; #onEvent; #retryMs; #maxRetryMs;
  #socket = null; #timer = null; #stopped = true; #attempt = 0; #buffer = '';
  #hello = null;

  constructor(config, { connect = net.connect, pathFor = defaultPipePath, onEvent = null, retryMs = 1000, maxRetryMs = 15000 } = {}) {
    this.#config = config; this.#connect = connect; this.#pathFor = pathFor;
    this.#onEvent = onEvent; this.#retryMs = retryMs; this.#maxRetryMs = maxRetryMs;
  }

  get ready() { return !this.#stopped && this.#socket !== null && this.#hello !== null; }
  get hostContext() { return this.#hello ? { hostRunId: this.#hello.hostRunId, worldEpoch: this.#hello.worldEpoch } : null; }
  get nativeMode() { return this.#hello ? this.#hello.mode : null; }

  start() {
    if (!this.#stopped) return;
    this.#stopped = false; this.#attempt = 0;
    this.#open();
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#timer); this.#timer = null;
    const socket = this.#socket; this.#socket = null; this.#hello = null; this.#buffer = '';
    try { socket?.destroy(); } catch { /* already closed */ }
  }

  // Returns true only when the frame was handed to a ready connection.
  send(frame) {
    if (!this.ready || this.nativeMode !== this.#config.mode || !frame || !isReactionName(frame.reaction)) return false;
    const ctx = this.hostContext;
    const wire = {
      version: 1, type: 'reaction', frameId: randomUUID(), hostRunId: ctx.hostRunId, worldEpoch: ctx.worldEpoch,
      tuple: { pedId: String(frame.tuple.pedId), turnId: String(frame.tuple.turnId), generationId: frame.tuple.generationId },
      reaction: frame.reaction,
    };
    const line = JSON.stringify(wire) + '\n';
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES) return false;
    const socket = this.#socket;
    if (!socket || socket.destroyed || socket.writableLength > MAX_WRITE_BACKLOG_BYTES) return false;
    try { socket.write(line); } catch { return false; }
    return true;
  }

  #emit(type, data) { try { this.#onEvent?.(type, data); } catch { /* telemetry only */ } }

  #open() {
    if (this.#stopped) return;
    let socket;
    try { socket = this.#connect(this.#pathFor(this.#config.pipeName)); }
    catch { this.#schedule(); return; }
    this.#socket = socket; this.#hello = null; this.#buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => this.#onData(socket, chunk));
    socket.on('error', () => { /* close follows */ });
    socket.on('close', () => {
      if (this.#socket === socket) { this.#socket = null; this.#hello = null; this.#buffer = ''; }
      this.#emit('reaction_channel_closed', {});
      this.#schedule();
    });
  }

  #schedule() {
    if (this.#stopped || this.#timer) return;
    const delay = Math.min(this.#maxRetryMs, this.#retryMs * 2 ** Math.min(this.#attempt++, 5));
    this.#timer = setTimeout(() => { this.#timer = null; this.#open(); }, delay);
    this.#timer.unref?.();
  }

  #onData(socket, chunk) {
    if (this.#socket !== socket) return;
    this.#buffer += chunk;
    if (this.#buffer.length > MAX_NATIVE_LINE_BYTES * 2) { socket.destroy(); return; }
    let index;
    while ((index = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, index).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(index + 1);
      if (line.length === 0) continue;
      if (line.length > MAX_NATIVE_LINE_BYTES) { socket.destroy(); return; }
      let value;
      try { value = JSON.parse(line); } catch { socket.destroy(); return; }
      if (!this.#hello) {
        if (!validateHello(value)) { socket.destroy(); return; }
        // Both sides must agree on the mode. A companion dry-run must never
        // activate native on-mode gestures, and an on-mode companion cannot
        // silently fall back to shadow receipts. Mismatch stays disconnected.
        if (value.mode !== this.#config.mode) {
          this.#emit('reaction_channel_mode_mismatch', { companionMode: this.#config.mode, nativeMode: value.mode });
          socket.destroy(); return;
        }
        this.#hello = value; this.#attempt = 0;
        this.#emit('reaction_channel_ready', { nativeMode: value.mode });
        continue;
      }
      if (value && value.type === 'reaction.ack' && typeof value.status === 'string' && isReactionName(value.reaction)) {
        this.#emit('reaction_ack', {
          reaction: value.reaction,
          status: String(value.status).slice(0, 16),
          reason: typeof value.reason === 'string' && /^[a-z0-9_:]{1,48}$/.test(value.reason) ? value.reason : null,
        });
      }
    }
  }
}
