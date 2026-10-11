import net from 'node:net';
import { randomUUID } from 'node:crypto';

const MAX_FRAME = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const exact = (object, keys) =>
  object && typeof object === 'object' && !Array.isArray(object) &&
  Object.keys(object).length === keys.length &&
  keys.every(key => Object.prototype.hasOwnProperty.call(object, key));
const identity = ['v', 'type', 'hostRunId', 'worldEpoch', 'transportId', 'seq'];

export function encodeWireFrame(value) {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (!payload.length || payload.length > MAX_FRAME) throw new Error('invalid_frame_length');
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

// The length prefix, UTF-8 decoder and JSON document are all bounded.
// No partial frame is ever treated as a complete command.
export class Phase2FrameDecoder {
  #bytes = Buffer.alloc(0);
  push(chunk) {
    if (!Buffer.isBuffer(chunk) || this.#bytes.length + chunk.length > 2 * (MAX_FRAME + 4))
      throw new Error('wire_buffer_limit');
    this.#bytes = Buffer.concat([this.#bytes, chunk]);
    const result = [];
    while (this.#bytes.length >= 4) {
      const length = this.#bytes.readUInt32LE(0);
      if (length < 1 || length > MAX_FRAME) throw new Error('invalid_frame_length');
      if (this.#bytes.length < length + 4) break;
      const bytes = this.#bytes.subarray(4, length + 4);
      // Fatal invalid UTF-8, not Node's replacement-character default.
      const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      let parsed;
      try { parsed = JSON.parse(json); } catch { throw new Error('invalid_json'); }
      result.push(parsed);
      this.#bytes = this.#bytes.subarray(length + 4);
    }
    return result;
  }
}

function verify(value, type, binding, seq, extra = []) {
  if (!exact(value, [...identity, ...extra]) || value.v !== 1 || value.type !== type ||
      value.hostRunId !== binding.hostRunId || value.worldEpoch !== binding.worldEpoch ||
      value.transportId !== binding.transportId || value.seq !== seq)
    throw new Error('wire_identity_or_order_mismatch');
}

export class Phase2NativeClient {
  #socket;
  #decoder = new Phase2FrameDecoder();
  #binding;
  #state = 'new';
  #incoming = 0;
  #outgoing = 0;
  #pending = new Map();
  #connectResolve;
  #connectReject;
  #deadline;
  #heartbeat;
  #closedResolve;
  #closed = new Promise(resolve => { this.#closedResolve = resolve; });

  get closed() { return this.#closed; }

  constructor({ pipePath = '\\\\.\\pipe\\LSA.Standalone.Phase2.v1', timeoutMs = 3000 } = {}) {
    if (typeof pipePath !== 'string' || pipePath.length < 1 ||
        !Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 60_000)
      throw new Error('invalid_transport_options');
    this.pipePath = pipePath;
    this.timeoutMs = timeoutMs;
  }

  connect() {
    if (this.#state !== 'new') return Promise.reject(new Error('client_not_reusable'));
    this.#state = 'hello';
    return new Promise((resolve, reject) => {
      this.#connectResolve = resolve; this.#connectReject = reject;
      this.#socket = net.createConnection(this.pipePath);
      this.#socket.on('data', bytes => {
        try { for (const frame of this.#decoder.push(bytes)) this.#accept(frame); }
        catch (error) { this.#abort(error); }
      });
      this.#socket.on('error', () => this.#abort(new Error('native_disconnected')));
      this.#socket.on('close', () => this.#abort(new Error('native_disconnected')));
      this.#deadline = setTimeout(() => this.#abort(new Error('native_handshake_timeout')), this.timeoutMs);
    });
  }

  #send(value) {
    if (this.#state === 'closed') throw new Error('native_disconnected');
    this.#socket.write(encodeWireFrame(value));
  }

  #accept(value) {
    if (this.#state === 'hello') {
      if (!exact(value, identity) || value.v !== 1 || value.type !== 'host.hello' ||
          !UUID.test(value.hostRunId) || !UUID.test(value.transportId) ||
          !Number.isSafeInteger(value.worldEpoch) || value.worldEpoch < 1 ||
          value.seq !== 0) throw new Error('invalid_native_hello');
      this.#binding = { hostRunId: value.hostRunId, worldEpoch: value.worldEpoch,
        transportId: value.transportId };
      this.#send({ v: 1, type: 'client.hello', ...this.#binding, seq: ++this.#outgoing });
      this.#state = 'ready_wait';
      return;
    }
    if (this.#state === 'ready_wait') {
      verify(value, 'host.ready', this.#binding, ++this.#incoming);
      this.#state = 'ready';
      clearTimeout(this.#deadline);
      const resolve = this.#connectResolve;
      this.#connectResolve = null; this.#connectReject = null;
      // The native watchdog is intentionally short. Keep the current
      // connection alive, but never auto-replay a failed turn or effect.
      this.#heartbeat = setInterval(() => {
        if (this.#state === 'ready')
          this.request('health.ping').catch(() => {});
      }, 2000);
      this.#heartbeat.unref?.();
      resolve({ ...this.#binding });
      return;
    }
    if (this.#state !== 'ready') throw new Error('unexpected_native_frame');
    if (!value || typeof value !== 'object' || !UUID.test(value.requestId))
      throw new Error('invalid_native_reply');
    const reply = this.#pending.get(value.requestId);
    if (!reply) throw new Error('unknown_or_replayed_reply');
    const expected = ({
      'health.ping': 'health.pong',
      'host.snapshot': 'host.snapshot.result',
      'turn.next': 'turn.next.result',
      'turn.confirm': 'turn.confirm.result',
      'turn.cancel': 'turn.cancel.result',
      'turn.reply': 'turn.reply.result'
    })[reply.type];
    if (!expected) throw new Error('unsupported_native_reply');
    const isOffer = expected === 'turn.next.result' && value.status === 'ok';
    const fields = isOffer
      ? ['requestId', 'status', 'turnId', 'sessionNonce', 'actorIncarnationId',
          'leaseId', 'generation', 'source', ...(Object.hasOwn(value, 'playerText') ? ['playerText'] : [])]
      : expected === 'host.snapshot.result'
        ? ['requestId', 'status', 'trackedActors']
        : ['requestId', 'status'];
    verify(value, expected, this.#binding, ++this.#incoming, fields);
    if (typeof value.status !== 'string' ||
        (value.type === 'host.snapshot.result' &&
          (!Number.isSafeInteger(value.trackedActors) || value.trackedActors < 0)))
      throw new Error('invalid_native_reply');
    if (isOffer && Object.hasOwn(value, 'playerText') &&
        (value.source !== 'player_text' || typeof value.playerText !== 'string' ||
         !value.playerText.trim() || value.playerText.length > 1024 ||
         /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value.playerText)))
      throw new Error('invalid_native_text');
    if (isOffer && (!UUID.test(value.turnId) || !UUID.test(value.sessionNonce) ||
        !UUID.test(value.actorIncarnationId) || !UUID.test(value.leaseId) ||
        !/^[1-9][0-9]{0,18}$/.test(value.generation) ||
        !['player_text', 'player_mic', 'special_event'].includes(value.source)))
      throw new Error('invalid_native_permit');
    this.#pending.delete(value.requestId);
    clearTimeout(reply.timer);
    if (value.status === 'ok' || (reply.type === 'turn.next' && value.status === 'none') ||
        (reply.type === 'turn.reply' && value.status === 'staged_not_played'))
      reply.resolve(value);
    else reply.reject(new Error('native_rejected_' + value.status));
  }

  request(type, claims = {}) {
    if (this.#state !== 'ready') return Promise.reject(new Error('native_not_ready'));
    if (!['health.ping', 'host.snapshot', 'turn.next', 'turn.confirm', 'turn.cancel', 'turn.reply'].includes(type))
      return Promise.reject(new Error('unsupported_request'));
    if (this.#pending.size >= 8 || this.#outgoing >= 0x7fffffff)
      return Promise.reject(new Error('native_backpressure'));
    const required = type === 'turn.confirm'
      ? ['turnId', 'sessionNonce', 'actorIncarnationId', 'leaseId', 'generation', 'source']
      : type === 'turn.cancel'
        ? ['turnId', 'actorIncarnationId', 'leaseId', 'generation']
        : type === 'turn.reply'
          ? ['turnId', 'actorIncarnationId', 'leaseId', 'generation', 'replyText'] : [];
    if (!exact(claims, required) ||
        required.some(key => typeof claims[key] !== 'string') ||
        required.filter(key => !['generation', 'source', 'replyText'].includes(key))
          .some(key => !UUID.test(claims[key])) ||
        (required.includes('generation') && !/^[1-9][0-9]{0,18}$/.test(claims.generation)) ||
        (required.includes('source') &&
          !['player_text', 'player_mic', 'special_event'].includes(claims.source)) ||
        (required.includes('replyText') &&
          (!claims.replyText.trim() || claims.replyText.length > 2048 ||
           /[\u0000-\u0008\u000b-\u001f\u007f]/.test(claims.replyText))))
      return Promise.reject(new Error('invalid_wire_claim'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#abort(new Error('native_request_timeout'));
      }, this.timeoutMs);
      this.#pending.set(requestId, { type, resolve, reject, timer });
      try {
        this.#send({ v: 1, type, ...this.#binding, seq: ++this.#outgoing,
          requestId, ...claims });
      } catch (error) { this.#abort(error); }
    });
  }

  #abort(error) {
    if (this.#state === 'closed') return;
    this.#state = 'closed';
    clearTimeout(this.#deadline);
    clearInterval(this.#heartbeat);
    this.#socket?.destroy();
    this.#connectReject?.(error);
    this.#connectResolve = null; this.#connectReject = null;
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    this.#closedResolve?.(error.message);
  }

  close() { this.#abort(new Error('native_disconnected')); }
}
