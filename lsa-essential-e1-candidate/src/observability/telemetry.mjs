import { randomUUID } from 'node:crypto';
import { createTelemetryRecord } from './eventContract.mjs';

export class Telemetry {
  #sink;
  #clock;
  #utc;
  #origin;
  #runId;
  #sequence = 0;
  #turns = new Map();
  #terminalTurns = new Map();
  #reportedDropped = 0;
  #closed = false;

  constructor({ sink = null, clock = () => performance.now(), utc = () => new Date().toISOString(), runId, run = {} } = {}) {
    this.#sink = sink; this.#clock = clock; this.#utc = utc; this.#origin = clock(); this.#runId = runId || sink?.runId || randomUUID();
    this.emit('run_started', null, null, run);
  }
  get runId() { return this.#runId; }
  get droppedCount() { return this.#sink?.droppedCount || 0; }
  emit(event, identity = null, source = null, data = {}, provider = 'openai') {
    if (!this.#sink) return false;
    const record = createTelemetryRecord({ sequence: ++this.#sequence, runId: this.#runId, originMs: this.#origin, event, identity, source, provider, data, now: this.#clock(), utc: this.#utc() });
    return this.#sink.emit(record);
  }
  beginTurn(identity, source, initial = {}) {
    const key = [identity.pedId, identity.turnId, identity.generationId, identity.sessionNonce].join('\0');
    if (this.#turns.has(key)) return this.#turns.get(key);
    if (this.#terminalTurns.has(key)) return this.#terminalTurns.get(key);
    const metrics = new TurnMetrics(this, identity, source, initial, this.#clock);
    this.#turns.set(key, metrics);
    return metrics;
  }
  markTerminal(metrics) {
    const identity = metrics.identity;
    const key = [identity.pedId, identity.turnId, identity.generationId, identity.sessionNonce].join('\0');
    this.#turns.delete(key);
    this.#terminalTurns.set(key, metrics);
    while (this.#terminalTurns.size > 2048) this.#terminalTurns.delete(this.#terminalTurns.keys().next().value);
  }
  async flush() {
    const dropped = this.droppedCount;
    if (dropped > this.#reportedDropped) { this.#reportedDropped = dropped; this.emit('telemetry_records_dropped', null, null, { dropped }); }
    await this.#sink?.flush?.();
  }
  async close() { if (this.#closed) return; this.emit('run_shutdown', null, null, { dropped: this.droppedCount }); this.#closed = true; await this.flush(); await this.#sink?.close?.(); }
}

export class TurnMetrics {
  #telemetry; #identity; #source; #start; #spans = new Map(); #counts = Object.create(null); #summary = false; #initial; #actionName = 'unknown';
  #inputReadyAt = null; #actionStartedAt = null; #lateEvents = 0;
  constructor(telemetry, identity, source, initial, clock = () => performance.now()) {
    this.#telemetry = telemetry; this.#identity = Object.freeze({ ...identity }); this.#source = source;
    this.#start = clock(); this.#initial = initial; this.clock = clock;
    this.event('turn_bound', { stage: 'bound', ...initial });
  }
  get identity() { return this.#identity; }
  event(name, data = {}) {
    if (this.#summary) { if (this.#lateEvents++ < 3) this.#telemetry.emit('late_event_ignored', this.#identity, this.#source, {}); return false; }
    if (name === 'input_ready') {
      this.#inputReadyAt = this.clock();
      data = { durationMs: Math.max(0, this.#inputReadyAt - this.#start), ...data };
    }
    return this.#telemetry.emit(name, this.#identity, this.#source, data);
  }
  stage(stage) { this.event('turn_stage', { stage }); }
  startSpan(name, data = {}) {
    if (this.#summary) return () => null;
    const id = `${name}:${(this.#counts[`${name}Attempts`] || 0) + 1}`;
    this.#counts[`${name}Attempts`] = (this.#counts[`${name}Attempts`] || 0) + 1;
    const start = this.clock();
    this.#spans.set(id, start);
    const providerRequest = ['stt','model','tts'].includes(name);
    this.event(providerRequest ? 'provider_request_started' : 'phase_started', { operation: name, attempts: this.#counts[`${name}Attempts`], ...data });
    let finished = false;
    return (outcome = 'finished', extra = {}) => {
      if (finished) return null;
      finished = true;
      const durationMs = Math.max(0, this.clock() - start);
      this.#spans.delete(id);
      this.event(providerRequest ? (outcome === 'finished' ? 'provider_request_finished' : 'provider_request_failed') : (outcome === 'finished' ? 'phase_finished' : 'phase_failed'), { operation: name, outcome, durationMs, ...extra });
      return durationMs;
    };
  }
  count(name, amount = 1) { if (!this.#summary) this.#counts[name] = (this.#counts[name] || 0) + amount; }
  audioRaw(bytes) { if (!this.#summary) this.#counts.rawTtsBytes = (this.#counts.rawTtsBytes || 0) + bytes; }
  audioPcm(bytes) {
    if (this.#summary) { this.event('late_pcm_ignored', {}); return; }
    this.#counts.pcmBytes = (this.#counts.pcmBytes || 0) + bytes;
    this.#counts.pcmChunks = (this.#counts.pcmChunks || 0) + 1;
    if (this.#counts.pcmChunks === 1) this.event('pcm_first_forwarded', { pcmBytes: bytes, durationMs: Math.max(0, this.clock() - (this.#inputReadyAt ?? this.#start)) });
  }
  actionValidated(actionName) { if (this.#summary) return false; this.#actionName = actionName || 'unknown'; this.#counts.actionValidatedCount = (this.#counts.actionValidatedCount || 0) + 1; this.event('action_validated', { attempts: 1, actionName: this.#actionName }); return true; }
  get hasAction() { return this.#counts.actionValidatedCount > 0; }
  actionDispatchStart() {
    if (this.#summary || !this.hasAction) return false;
    this.#actionStartedAt = this.clock();
    this.#counts.actionDispatchAttempts = (this.#counts.actionDispatchAttempts || 0) + 1;
    this.event('action_dispatch_attempted', { actionName: this.#actionName, attempts: this.#counts.actionDispatchAttempts });
    return true;
  }
  actionDispatchEnd(accepted) {
    if (this.#summary || this.#actionStartedAt === null) return false;
    this.event(accepted ? 'action_dispatch_accepted' : 'action_dispatch_rejected', { actionName: this.#actionName, outcome: accepted ? 'accepted' : 'rejected' });
    this.event('phase_finished', { operation: 'stock_action_route', durationMs: Math.max(0, this.clock() - this.#actionStartedAt), outcome: accepted ? 'accepted' : 'rejected' });
    const key = accepted ? 'actionDispatchAccepted' : 'actionDispatchRejected';
    this.#counts[key] = (this.#counts[key] || 0) + 1;
    this.#actionStartedAt = null;
    return true;
  }
  native(event, data) { this.event(event, data); }
  finish({ reason, stage, cause, ...details }) {
    if (this.#summary) return false;
    this.#summary = true;
    const data = {
      terminalReason: reason, stage, durationMs: Math.max(0, this.clock() - this.#start),
      traceComplete: this.#spans.size === 0,
      ...(cause?.code ? { code: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(cause.code) ? cause.code : 'provider_request_failed' } : {}),
      ...(cause?.nativeReason && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(cause.nativeReason) ? { nativeReason: cause.nativeReason } : {}),
      droppedTelemetryRecords: this.#telemetry.droppedCount,
      ...this.#counts, ...details,
    };
    // Keep structured summary scalar-only; individual request spans are emitted as their own records.
    this.#telemetry.emit('turn_terminal_summary', this.#identity, this.#source, data);
    this.#telemetry.markTerminal(this);
    return true;
  }
  get terminal() { return this.#summary; }
}

export function createNoopTelemetry() {
  const noop = () => false;
  return { event: noop, emit: noop, beginTurn(identity, source) { return { identity, event() {}, stage() {}, startSpan() { return () => null; }, count() {}, audioRaw() {}, audioPcm() {}, actionValidated() {}, get hasAction() { return false; }, actionDispatchStart() { return false; }, actionDispatchEnd() { return false; }, native() {}, finish() { return false; }, get terminal() { return false; } }; }, async flush() {}, async close() {} };
}
