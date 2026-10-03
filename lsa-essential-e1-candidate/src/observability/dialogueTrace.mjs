import { randomUUID } from 'node:crypto';

const MAX_CHUNK_CHARS = 8_000;
const noop = () => false;
const boundedCode = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ? value : null;
const validIdentity = value => value && ['pedId','turnId'].every(key => typeof value[key] === 'string' && value[key].length > 0 && value[key].length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(value[key])) &&
  Number.isSafeInteger(value.generationId) && value.generationId >= 0 && Number.isSafeInteger(value.sessionNonce) && value.sessionNonce >= 0;

export function normalizeDialogueLoggingConfig(value = {}, boundedInteger = (input, fallback, min, max, name) => {
  const number = Number(input ?? fallback);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new TypeError(`${name} must be an integer from ${min} to ${max}.`);
  return number;
}) {
  const allowed = ['enabled', 'maxFileBytes', 'maxTotalBytes', 'maxFiles', 'maxPayloadBytes'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || (value.enabled !== undefined && typeof value.enabled !== 'boolean')) throw new TypeError('Invalid dialogueLogging configuration.');
  const result = {
    enabled: value.enabled === true,
    maxFileBytes: boundedInteger(value.maxFileBytes, 10 * 1024 * 1024, 64 * 1024, 100 * 1024 * 1024, 'dialogueLogging.maxFileBytes'),
    maxTotalBytes: boundedInteger(value.maxTotalBytes, 50 * 1024 * 1024, 64 * 1024, 512 * 1024 * 1024, 'dialogueLogging.maxTotalBytes'),
    maxFiles: boundedInteger(value.maxFiles, 5, 1, 50, 'dialogueLogging.maxFiles'),
    maxPayloadBytes: boundedInteger(value.maxPayloadBytes, 256 * 1024, 1024, 2 * 1024 * 1024, 'dialogueLogging.maxPayloadBytes'),
  };
  if (result.maxTotalBytes < result.maxFileBytes) throw new TypeError('dialogueLogging.maxTotalBytes must be at least maxFileBytes.');
  return Object.freeze(result);
}

function redact(value, secrets, state) {
  if (typeof value === 'string') {
    let result = value;
    for (const secret of secrets) if (secret && result.includes(secret)) { result = result.split(secret).join('[REDACTED]'); state.redacted = true; }
    return result;
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets, state));
  if (value && typeof value === 'object') {
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(authorization|api[-_]?key|token|secret)$/i.test(key)) { copy[key] = '[REDACTED]'; state.redacted = true; }
      else copy[key] = redact(item, secrets, state);
    }
    return copy;
  }
  return value;
}

function boundedText(value, limit, secrets) {
  const original = String(value ?? '');
  const originalBytes = Buffer.byteLength(original, 'utf8');
  let text = original;
  let truncated = false;
  if (Buffer.byteLength(text, 'utf8') > limit) {
    let output = ''; let bytes = 0;
    for (const point of text) {
      const size = Buffer.byteLength(point, 'utf8');
      if (bytes + size > limit) { truncated = true; break; }
      output += point; bytes += size;
    }
    text = output;
  }
  const state = { redacted: false };
  text = redact(text, secrets, state);
  let redactedBytes = Buffer.byteLength(text, 'utf8');
  if (redactedBytes > limit) {
    let output = ''; let bytes = 0;
    for (const point of text) { const size = Buffer.byteLength(point, 'utf8'); if (bytes + size > limit) break; output += point; bytes += size; }
    text = output; redactedBytes = bytes; truncated = true;
  }
  return { text, originalBytes, capturedBytes: redactedBytes, truncated, redacted: state.redacted };
}

function chunkText(text) {
  const chunks = [];
  let current = '';
  for (const point of text) {
    if (current.length + point.length > MAX_CHUNK_CHARS) { chunks.push(current); current = ''; }
    current += point;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

export function createDialogueTrace({ sink = null, telemetryRunId = null, config = {}, secrets = [], clock = () => performance.now(), utc = () => new Date().toISOString() } = {}) {
  if (!sink) return createNoopDialogueTrace();
  const maxPayloadBytes = config.maxPayloadBytes ?? 256 * 1024;
  const safeSecrets = secrets.filter(value => typeof value === 'string' && value.length > 0);
  const started = clock();
  let closed = false;
  let sequence = 0;
  const emit = (event, identity = null, source = null, data = {}, { terminal = false } = {}) => {
    if (!sink || closed && !terminal) return false;
    try {
      const record = {
        schemaVersion: 1, timestamp: utc(), elapsedMs: Math.max(0, clock() - started),
        event, telemetryRunId, source,
        ...(identity ? { identity: { pedId: identity.pedId, sessionNonce: identity.sessionNonce, turnId: identity.turnId, generationId: identity.generationId } } : {}),
        data, localSequence: ++sequence,
      };
      const result = sink.emit(record);
      return result !== false;
    } catch { return false; }
  };
  const payload = (identity, source, event, payloadKind, value, extra = {}) => {
    let serialized;
    try { serialized = typeof value === 'string' ? value : JSON.stringify(value); }
    catch { serialized = '[UNSERIALIZABLE]'; }
    const bounded = boundedText(serialized, maxPayloadBytes, safeSecrets);
    const chunks = chunkText(bounded.text);
    const payloadId = randomUUID();
    let accepted = true;
    chunks.forEach((text, chunkIndex) => {
      if (!emit(event, identity, source, {
        ...extra, payloadId, payloadKind, chunkIndex, chunkCount: chunks.length,
        originalBytes: bounded.originalBytes, capturedBytes: bounded.capturedBytes,
        truncated: bounded.truncated || extra.truncated === true, redacted: bounded.redacted, text,
      })) accepted = false;
    });
    return accepted;
  };
  return {
    beginTurn(identity, source) {
      if (!validIdentity(identity)) return createNoopDialogueTrace().beginTurn(identity, source);
      const turnIdentity = Object.freeze({ pedId: identity.pedId, sessionNonce: identity.sessionNonce, turnId: identity.turnId, generationId: identity.generationId });
      const safeSource = ['player_text','player_mic','special_event','system','internal'].includes(source) ? source : 'internal';
      let finished = false;
      return {
        input(text) { return payload(turnIdentity, safeSource, 'player_input', 'player_text', text); },
        beginAttempt({ operation, attemptId, isActive = () => true } = {}) {
          let attemptFinished = false;
          const deltas = [];
          let deltaBytes = 0;
          let deltaTruncated = false;
          const safeOperation = ['model','stt','tts'].includes(operation) ? operation : 'model';
          const safeAttemptId = typeof attemptId === 'string' && /^(model|stt|tts):\d{1,3}$/.test(attemptId) ? attemptId : `${safeOperation}:1`;
          const active = () => !finished && !attemptFinished && isActive();
          const addPayload = (event, kind, value, extra = {}) => active() ? payload(turnIdentity, safeSource, event, kind, value, { operation: safeOperation, attemptId: safeAttemptId, ...extra }) : false;
          return {
            request(body) { return addPayload('model_request_started', 'request_json', body); },
            outputText(text, extra) { return addPayload('model_reply', 'assistant_text', text, extra); },
            appendDelta(text) {
              if (!active()) return false;
              const addition = String(text ?? ''); let captured = '';
              for (const point of addition) {
                const size = Buffer.byteLength(point, 'utf8');
                if (deltaBytes + size > maxPayloadBytes) { deltaTruncated = true; break; }
                captured += point; deltaBytes += size;
              }
              if (captured) deltas.push(captured);
              return !deltaTruncated;
            },
            segment({ sequence: segmentSequence, text, mode }) { return addPayload('validated_segment', 'dialogue_segment', text, { segmentSequence, mode }); },
            finish({ outcome = 'failed', code = null, httpStatus = null, complete = false } = {}) {
              if (attemptFinished) return false;
              attemptFinished = true;
              let accepted = true;
              const safeOutcome = ['completed','failed','timeout','cancelled'].includes(outcome) ? outcome : 'failed';
              if (deltas.length) accepted = payload(turnIdentity, safeSource, 'model_reply', 'assistant_stream', deltas.join(''), { operation: safeOperation, attemptId: safeAttemptId, partial: !complete, truncated: deltaTruncated }) && accepted;
              accepted = emit('model_attempt_finished', turnIdentity, safeSource, { operation: safeOperation, attemptId: safeAttemptId, outcome: safeOutcome, code: boundedCode(code), httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null, partial: !complete && deltas.length > 0 }) && accepted;
              return accepted;
            },
          };
        },
        decision({ dialogue, command, internalTranscript }) {
          return payload(turnIdentity, safeSource, 'decision_validated', 'validated_decision', { dialogue, command, internalTranscript });
        },
        native({ type, reason, wasInterrupted, hadAudio, playbackStarted }) {
          const safeType = ['audio_turn_accepted','audio_turn_rejected','playback_started','playback_ended'].includes(type) ? type : 'other';
          return emit('native_playback_event', turnIdentity, safeSource, { type: safeType, reason: boundedCode(reason) || 'other', wasInterrupted: typeof wasInterrupted === 'boolean' ? wasInterrupted : null, hadAudio: typeof hadAudio === 'boolean' ? hadAudio : null, playbackStarted: typeof playbackStarted === 'boolean' ? playbackStarted : null });
        },
        finish({ reason, stage, assistantCommitted = false, assistantDiscarded = false } = {}) {
          if (finished) return false;
          finished = true;
          return emit('turn_terminal_summary', turnIdentity, safeSource, { reason: boundedCode(reason) || 'unknown', stage: boundedCode(stage) || 'unknown', assistantCommitted, assistantDiscarded }, { terminal: true });
        },
      };
    },
    async flush() { try { await sink?.flush?.(); } catch {} },
    async close() { if (closed) return; emit('run_shutdown', null, null, {}, { terminal: true }); closed = true; await this.flush(); try { await sink?.close?.(); } catch {} },
  };
}

export function createNoopDialogueTrace() {
  return {
    beginTurn() { return { input: noop, beginAttempt() { return { request: noop, outputText: noop, appendDelta: noop, segment: noop, finish: noop }; }, decision: noop, native: noop, finish: noop }; },
    async flush() {}, async close() {},
  };
}
