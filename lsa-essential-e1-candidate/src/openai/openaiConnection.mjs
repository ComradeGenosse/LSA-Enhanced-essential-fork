import { sameIdentity } from '../integration/nativeDelivery.mjs';
import { runSequentialTurn } from './runSequentialTurn.mjs';
import { captureReferenceMap, immutableSnapshot, unknownWorld } from '../context/turnSnapshot.mjs';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
function worldSnapshot(value) { return immutableSnapshot(value) || unknownWorld(); }
function worldIsUnavailable(value) {
  if (!value || typeof value !== 'object') return true;
  const fields = ['gameTime','weather','streetName','crossingStreetName','zoneCode'];
  const known = fields.some(key => {
    const item = value[key];
    return item != null && String(item).trim() !== '' && !['unknown','unavailable','pending'].includes(String(item).trim().toLowerCase());
  });
  return !known && Object.keys(value).every(key => fields.includes(key));
}
function safeEmit(telemetry, ...args) { try { return telemetry?.emit?.(...args) ?? false; } catch { return false; } }

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
  #voicePolicyLocked = false;
  #characterSnapshot = null;

  constructor({ runtime, onEvent, options, diagnosticContext }) {
    this.#runtime = runtime;
    this.#context = Object.freeze({
      systemInstruction: String(options.systemInstruction || ''),
      actor: immutableSnapshot(options.actorContext),
      listener: immutableSnapshot(options.targetContext),
      world: worldSnapshot(hasOwn(options, 'world') ? options.world : options.actorContext?.world),
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
    const inputContext = turn.context || {};
    const actor = hasOwn(inputContext, 'actor') ? immutableSnapshot(inputContext.actor) : this.#context.actor;
    const listenerProvided = hasOwn(inputContext, 'listener') && inputContext.listener !== undefined;
    const listener = listenerProvided ? immutableSnapshot(inputContext.listener) : this.#context.listener;
    const requestedListenerState = inputContext.listenerState;
    const listenerState = ['present','explicitly_cleared','omitted'].includes(requestedListenerState)
      ? requestedListenerState
      : listenerProvided ? (inputContext.listener === null ? 'explicitly_cleared' : 'present') : 'omitted';
    const world = hasOwn(inputContext, 'world')
      ? worldSnapshot(inputContext.world)
      : hasOwn(actor, 'world') ? worldSnapshot(actor?.world) : unknownWorld();
    const references = hasOwn(inputContext, 'referenceMap')
      ? immutableSnapshot(inputContext.referenceMap)
      : captureReferenceMap(actor);
    const rawRevision = inputContext.revision ?? actor?.snapshotRevision ?? actor?.revision ?? turn.identity.generationId;
    const revision = ['string', 'number', 'boolean'].includes(typeof rawRevision) ? rawRevision : turn.identity.generationId;
    const contextSnapshot = Object.freeze({
      identity: Object.freeze({ ...turn.identity }),
      actor, listener, listenerState, world, referenceMap: references,
      capturedAt: String(inputContext.capturedAt || new Date().toISOString()),
      revision,
    });
    const worldStatus = worldIsUnavailable(world) ? 'unavailable' : 'known';
    try {
      this.#metrics?.event('snapshot_created', {
        actorStatus: actor ? 'available' : 'unknown', listenerState, worldStatus,
        personReferenceCount: Object.keys(references?.persons || {}).length,
        vehicleReferenceCount: Object.keys(references?.vehicles || {}).length,
      });
    } catch {}
    if (worldStatus === 'unavailable') safeEmit(this.#runtime.telemetry, 'world_unavailable', turn.identity, source, { reason: 'missing_or_unknown' });
    if (!this.#voiceProfile) {
      const voiceActor = actor || {};
      const encounter = this.#runtime.characterService?.session(turn.identity,voiceActor,null);
      this.#voiceProfile = encounter?.speechProfile || this.#runtime.voiceResolver?.resolve(turn.identity, voiceActor) || null;
      this.#runtime.characterService?.sessions.rememberVoice(turn.identity,voiceActor,this.#voiceProfile);
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
          selectionMode: this.#voiceProfile.selectionMode,
          gender: this.#voiceProfile.gender,
          ageBand: this.#voiceProfile.ageBand,
          matchReason: this.#voiceProfile.matchReason,
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
        systemInstruction: String(inputContext.systemInstruction || this.#context.systemInstruction),
        actor: contextSnapshot.actor, listener: contextSnapshot.listener,
        listenerState: contextSnapshot.listenerState, world: contextSnapshot.world, referenceMap: contextSnapshot.referenceMap,
        capturedAt: contextSnapshot.capturedAt, revision: contextSnapshot.revision,
        contextText, internalEvent,
      }),
      contextSnapshot,
      knowledgeInputs: this.#runtime.captureKnowledgeInputs?.({identity:turn.identity,source,p0Snapshot:contextSnapshot}) ?? null,
    });
    this.#characterSnapshot = null;
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
    const actor = hasOwn(context, 'actorContext') ? immutableSnapshot(context.actorContext) : this.#context.actor;
    const listenerProvided = hasOwn(context, 'targetContext') && context.targetContext !== undefined;
    if (listenerProvided) {
      if (context.targetContext === null) safeEmit(this.#runtime.telemetry, 'listener_cleared', null, null, { outcome: this.#context.listener === null ? 'already_unavailable' : 'cleared' });
      else safeEmit(this.#runtime.telemetry, 'listener_replaced', null, null, { outcome: 'replaced' });
    }
    this.#context = Object.freeze({
      systemInstruction: String(context.systemInstruction || this.#context.systemInstruction),
      actor,
      listener: listenerProvided ? immutableSnapshot(context.targetContext) : this.#context.listener,
      world: hasOwn(context, 'world') ? worldSnapshot(context.world)
        : hasOwn(actor, 'world') ? worldSnapshot(actor?.world) : unknownWorld(),
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
  get turnSnapshot() { return this.#turn?.contextSnapshot || null; }
  get characterSnapshot() { return this.#characterSnapshot; }
  get source() { return this.#turn?.source || 'player_text'; }

  async emitProviderEvent(event) {
    this.#ensureOpen();
    if (!sameIdentity(this.#turn?.identity, event) || event.provider !== 'openai') return false;
    if (this.#active?.controller?.signal.aborted || !this.#runtime.host.isCurrent(event)) return false;
    if (this.#runtime.identityService && !this.#runtime.identityService.current(event)) return false;
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

  retireIdentity() {
    this.close(); // Permanently discard this connection/history, even if native close reports a failure.
  }

  async prepareIdentity(turn, signal, deadlineAt) {
    const prepared = await this.#runtime.identityService?.prepare({ identity: turn.identity, actor: turn.context.actor, signal, deadlineAt,
      isCurrent: () => !this.#closed && sameIdentity(this.#turn?.identity, turn.identity) && this.#runtime.host.isCurrent(turn.identity),
      voiceResolver: this.#runtime.voiceResolver, allowVoice: !this.#voicePolicyLocked });
    if (signal.aborted || this.#closed || !sameIdentity(this.#turn?.identity, turn.identity) || !this.#runtime.host.isCurrent(turn.identity)) return;
    this.#characterSnapshot = prepared?.snapshot || null;
    if (!this.#voicePolicyLocked) {
      this.#voicePolicyLocked = true;
      if (prepared?.speechProfile) this.#voiceProfile = prepared.speechProfile;
    }
    turn.speechProfile = this.#voiceProfile;
    turn.characterSnapshot = prepared?.snapshot || null;
    if (this.#runtime.characterService) {
      try { await this.#runtime.characterService.prepareTurn(turn,prepared?.snapshot,this.#voiceProfile); }
      catch { // Optional projection failure must still strip private native proof.
        turn.context = { ...turn.context,actor:this.#runtime.modelActor(turn.context.actor),listener:this.#runtime.modelActor(turn.context.listener) };
        this.#runtime.characterService.emit('character_safe_failure',{reason:'profile_projection_failed'});
      }
      return;
    }
    turn.context = { ...turn.context, actor: this.#runtime.modelActor(turn.context.actor), listener: this.#runtime.modelActor(turn.context.listener) };
  }

  #ensureOpen() { if (this.#closed) throw new Error('OpenAI session is closed.'); }
  #ensureTurn() { this.#ensureOpen(); if (!this.#turn) throw new Error('OpenAI generation is not bound to an Essential turn.'); }
}
