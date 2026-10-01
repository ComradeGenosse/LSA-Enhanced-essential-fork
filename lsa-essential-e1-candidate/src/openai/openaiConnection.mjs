import { sameIdentity } from '../integration/nativeDelivery.mjs';
import { runSequentialTurn } from './runSequentialTurn.mjs';

function copySnapshot(value) {
  if (value == null) return null;
  try { return structuredClone(value); }
  catch { return JSON.parse(JSON.stringify(value)); }
}

function normalizeContextForComparison(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export class OpenAIConnection {
  #runtime;
  #context;
  #turn = null;
  #closed = false;
  #inputStarted = false;
  #mic = [];
  #micBytes = 0;
  #micOverflow = false;
  #realtimeContext = '';
  #launched = false;
  #retired = false;
  #active = null;
  #metrics = null;
  #captureStartedAt = 0;
  #voiceProfile = null;

  constructor({ runtime, onEvent, options, diagnosticContext }) {
    this.#runtime = runtime;
    this.#context = Object.freeze({
      systemInstruction: String(options.systemInstruction || ''),
      actor: copySnapshot(options.actorContext),
      listener: copySnapshot(options.targetContext),
      world: copySnapshot(options.actorContext?.world),
      contextText: '',
      inputText: '',
    });
    this.provider = 'openai';
    this.closed = false;
    this.sessionIdentity = Object.freeze({ pedId: diagnosticContext?.pedId || '', sessionNonce: diagnosticContext?.sessionNonce ?? -1 });
  }

  beginTurn(turn) {
    this.#ensureOpen();
    if (!turn?.identity?.pedId || !turn.identity.turnId || !Number.isSafeInteger(turn.identity.generationId) || !Number.isSafeInteger(turn.identity.sessionNonce) || turn.identity.generationId < 0 || turn.identity.sessionNonce < 1 || turn.identity.pedId !== this.sessionIdentity.pedId || turn.identity.sessionNonce !== this.sessionIdentity.sessionNonce) {
      throw new TypeError('OpenAI generation requires a complete native identity.');
    }
    if (sameIdentity(this.#turn?.identity, turn.identity)) return Promise.resolve(false);
    if (this.#active && !sameIdentity(this.#active.identity, turn.identity)) this.abortTurn(this.#active.identity, 'superseded');
    const source = String(turn.source || 'player_text').toLowerCase();
    this.#metrics = this.#runtime.telemetry?.beginTurn(turn.identity, source, { inputChars: String(turn.context?.inputText || '').length }) || null;
    if (!this.#voiceProfile) {
      this.#voiceProfile = this.#runtime.voiceResolver?.resolve(turn.identity) || null;
      if (this.#voiceProfile) {
        this.#metrics?.event('speech_provider_selected', {
          speechProvider: this.#voiceProfile.provider,
          model: this.#voiceProfile.model,
          voice: this.#voiceProfile.voice,
        });
        this.#metrics?.event('voice_profile_assigned', {
          profileId: this.#voiceProfile.profileId,
          speechProvider: this.#voiceProfile.provider,
          model: this.#voiceProfile.model,
          voice: this.#voiceProfile.voice,
          speed: this.#voiceProfile.speed,
          assignmentVersion: this.#voiceProfile.assignmentVersion,
        });
      }
    }
    const internalSource = !['player_text','player_mic'].includes(source);
    const rawInput = String(turn.context?.inputText || '');
    const internalEvent = internalSource ? String(turn.context?.internalEvent || rawInput || '').trim().slice(0,12_000) : '';
    let contextText = String(turn.context?.contextText || '');
    if (internalEvent && contextText && normalizeContextForComparison(contextText) === normalizeContextForComparison(internalEvent)) contextText = '';
    this.#turn = Object.freeze({
      identity: Object.freeze({ ...turn.identity }), source,
      inputText: internalSource ? '' : rawInput,
      contextText,
      context: Object.freeze({
        systemInstruction: String(turn.context?.systemInstruction || this.#context.systemInstruction),
        actor: copySnapshot(turn.context?.actor || this.#context.actor),
        listener: copySnapshot(turn.context?.listener || this.#context.listener),
        world: copySnapshot(turn.context?.actor?.world || this.#context.world),
        contextText, internalEvent,
      }),
    });
    this.#launched = false;
    this.#retired = false;
    this.#inputStarted = false;
    this.#mic = [];
    this.#micBytes = 0;
    this.#micOverflow = false;
    this.#realtimeContext = '';
    return Promise.resolve();
  }

  sendText(text) {
    this.#ensureTurn();
    this.#metrics?.event('input_ready', { inputChars: String(this.#turn.inputText || text || '').trim().length, role: 'typed' });
    return Promise.resolve(this.#launch({ input: this.#turn.inputText || String(text || '').trim() }));
  }

  startRealtimeInput() {
    this.#ensureTurn();
    if (this.#inputStarted || this.#launched || this.#retired) return Promise.resolve(false);
    this.#inputStarted = true;
    this.#captureStartedAt = performance.now();
    this.#metrics?.event('capture_started', { sampleRate: 16_000, channels: 1 });
    this.#mic = [];
    this.#micBytes = 0;
    this.#micOverflow = false;
    return Promise.resolve(true);
  }

  sendRealtimeAudio(pcm16Mono, sampleRate = 16_000) {
    this.#ensureTurn();
    if (!this.#inputStarted) throw new Error('OpenAI PTT input was not started.');
    if (sampleRate !== 16_000) throw new Error('Essential PTT input must be 16 kHz mono PCM16.');
    if (this.#micOverflow) throw new Error('PTT input exceeded the configured limit.');
    const chunk = Buffer.from(pcm16Mono || []);
    if (chunk.length % 2) throw new Error('Essential PTT chunk ended on a partial PCM16 sample.');
    if (this.#micBytes + chunk.length > this.#runtime.config.maxMicPcmBytes) {
      this.#micOverflow = true;
      this.#metrics?.event('input_overflow', { bytes: this.#micBytes + chunk.length });
      this.#mic = [];
      this.#micBytes = 0;
      throw new Error('PTT input exceeded the configured 30-second limit.');
    }
    this.#mic.push(chunk);
    this.#micBytes += chunk.length;
    this.#metrics?.count('micChunks');
    return Promise.resolve(true);
  }

  sendRealtimeText(text) {
    this.#ensureTurn();
    const value = String(text || '').trim();
    if (!value) return Promise.resolve(false);
    if (this.#turn.contextText.includes(value)) return Promise.resolve(true);
    this.#realtimeContext = [this.#realtimeContext, value].filter(Boolean).join('\n\n').slice(0, 12_000);
    return Promise.resolve(true);
  }

  endRealtimeInput() {
    this.#ensureTurn();
    if (!this.#inputStarted) return Promise.resolve(false);
    this.#inputStarted = false;
    this.#metrics?.event('capture_stopped', { bytes: this.#micBytes, sampleRate: 16_000, durationMs: Math.max(0, performance.now() - this.#captureStartedAt) });
    if (this.#micOverflow) throw new Error('PTT input exceeded the configured limit; no truncated audio was submitted.');
    const pcm = Buffer.concat(this.#mic, this.#micBytes);
    this.#mic = [];
    this.#micBytes = 0;
    this.#metrics?.event('input_ready', { bytes: pcm.length, sampleRate: 16_000, channels: 1, role: 'microphone' });
    if (!pcm.length) throw new Error('PTT input did not contain microphone audio.');
    this.#launch({ pcm: new Uint8Array(pcm), sampleRate: 16_000 });
    return Promise.resolve(true);
  }

  refreshContext(context) {
    this.#ensureOpen();
    this.#context = Object.freeze({
      systemInstruction: String(context.systemInstruction || this.#context.systemInstruction),
      actor: copySnapshot(context.actorContext),
      listener: copySnapshot(context.targetContext),
      world: copySnapshot(context.actorContext?.world),
      contextText: '', inputText: '',
    });
  }

  detachAbort(identity, controller) {
    if (this.#active && sameIdentity(this.#active.identity, identity) && this.#active.controller === controller) this.#active.controller = null;
  }

  abortTurn(identity, reason = 'cancelled') {
    if (!sameIdentity(this.#turn?.identity, identity)) return false;
    this.#retired = true;
    this.#metrics?.event(String(reason).includes('supersed') ? 'supersession_requested' : 'cancellation_requested', { reason });
    this.#inputStarted = false;
    this.#mic = [];
    this.#micBytes = 0;
    if (!this.#active || !sameIdentity(this.#active.identity, identity)) return true;
    this.#active.cancelReason = String(reason || 'cancelled');
    this.#active.controller?.abort(new Error(this.#active.cancelReason));
    return true;
  }

  whenSettled(identity) {
    if (!this.#active || !sameIdentity(this.#active.identity, identity)) return Promise.resolve();
    return this.#active.done;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.closed = true;
    if (this.#turn) this.abortTurn(this.#turn.identity, 'session_closed');
    this.#runtime.detach(this);
  }

  matches(identity) { return sameIdentity(this.#turn?.identity, identity); }
  get source() { return this.#turn?.source || 'player_text'; }

  async emitProviderEvent(event) {
    this.#ensureOpen();
    if (!sameIdentity(this.#turn?.identity, event) || event.provider !== 'openai') return false;
    if (this.#active?.controller?.signal.aborted || !this.#runtime.host.isCurrent(event)) return false;
    return await this.#runtime.host.routePinnedEvent(Object.freeze({ ...event }));
  }

  #launch(input) {
    const turn = this.#turn;
    if (!turn) throw new Error('OpenAI generation is not bound to an Essential turn.');
    if (this.#launched || this.#retired) return false;
    this.#launched = true;
    const controller = new AbortController();
    const snapshot = {
      identity: turn.identity, source: turn.source,
      context: {
        ...turn.context,
        contextText: [turn.contextText, this.#realtimeContext].filter(Boolean).join('\n\n'),
      },
      input: turn.source === 'special_event' || !['player_text','player_mic'].includes(turn.source) ? '' : (input.input || ''),
      pcm: input.pcm || null,
      sampleRate: input.sampleRate || 16_000,
      speechProfile: this.#voiceProfile,
    };
    const state = { identity: turn.identity, controller, done: null, cancelReason: '' };
    this.#active = state;
    const run = Promise.resolve().then(async () => {
      if (controller.signal.aborted || this.#closed) {
        const reason = this.#closed ? 'disconnected' : this.#active?.cancelReason || 'cancelled';
        this.#metrics?.finish({ reason, stage: 'input', assistantCommitted: false });
        return { status: 'cancelled', terminalReason: reason };
      }
      return runSequentialTurn({
        connection: this,
        turn: { ...snapshot, controller },
        controller,
        services: this.#runtime.services,
        history: this.#runtime.history,
        host: this.#runtime.hostFor(this),
      });
    });
    state.done = run;
    // Retain only the latest job's settled promise until its successor replaces
    // it, so controller callers can still observe a very fast terminal result.
    run.then(() => {}, () => {});
    return true;
  }

  #ensureOpen() { if (this.#closed) throw new Error('OpenAI session is closed.'); }
  #ensureTurn() { this.#ensureOpen(); if (!this.#turn) throw new Error('OpenAI generation is not bound to an Essential turn.'); }
}
