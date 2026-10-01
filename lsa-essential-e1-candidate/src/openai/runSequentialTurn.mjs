const PLAYER_SOURCES = new Set(['player_text', 'player_mic']);

function terminalForNativeEvent(event) {
  if (event.type === 'audio_turn_rejected') return 'native_auth_rejected';
  const reason = String(event.reason || '').toLowerCase();
  if (event.type === 'playback_ended') {
    if (event.wasInterrupted) return ['superseded', 'turn_superseded'].includes(reason) ? 'superseded' : 'playback_interrupted';
    return 'playback_error';
  }
  if (reason.includes('disconnect') || reason.includes('session_closed')) return 'disconnected';
  if (reason.includes('supersed')) return 'superseded';
  if (event.type === 'interrupt') return 'playback_interrupted';
  return 'cancelled';
}

function terminalForAbort(signal) {
  const reason = String(signal.reason?.message || signal.reason || '').toLowerCase();
  if (reason.includes('deadline') || reason.includes('timeout')) return 'provider_timeout';
  if (reason.includes('supersed')) return 'superseded';
  if (reason.includes('disconnect') || reason.includes('session_closed')) return 'disconnected';
  return 'cancelled';
}

function terminalForError(error, stage) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (code === 'timeout' || message.includes('deadline')) return 'provider_timeout';
  if (message.includes('refused')) return 'model_refusal';
  if (message.includes('invalid decision') || message.includes('decision must') || message.includes('decision fields') ||
      message.includes('dialogue must') || message.includes('command must') || message.includes('control command')) return 'invalid_decision';
  if (stage === 'transcribing') return 'stt_error';
  if (stage === 'model_running') return 'model_error';
  if (stage === 'decision_validation' || message.includes('decision_rejected')) return 'invalid_decision';
  if (stage === 'tts_running') return 'tts_error';
  if (stage === 'native_authorization') return 'native_auth_rejected';
  if (stage === 'playback_completion') return 'playback_error';
  if (message.includes('native_rejected') || message.includes('native_authorization')) return 'native_auth_rejected';
  return 'model_error';
}

function publicCause(error) {
  if (!error) return null;
  const cause = { name: String(error.name || 'Error').slice(0, 64) };
  if (error.code) cause.code = String(error.code).slice(0, 64);
  if (Number.isInteger(error.status) && error.status > 0) cause.httpStatus = error.status;
  return cause;
}

export async function runSequentialTurn({ connection, turn, controller = new AbortController(), services, history, host }) {
  const { identity, context, input, pcm, sampleRate } = turn;
  const source = String(turn.source || 'player_text').toLowerCase();
  const isPlayer = PLAYER_SOURCES.has(source);
  let observation;
  let state = 'bound';
  let terminalReason = '';
  let underlyingNativeCause = null;
  let authorizationRequested = false;
  let authorization;
  let retired = false;
  let endSent = false;
  let providerTimer = null;
  const metrics = host.telemetry?.beginTurn(identity, source, { inputChars: String(input || '').length, bytes: pcm?.byteLength || 0, sampleRate: sampleRate || 0 }) || null;

  const transition = next => { state = next; metrics?.stage(next); host.log?.(identity, next, { source }); };
  const chooseTerminal = reason => { if (!terminalReason) terminalReason = reason; return terminalReason; };
  const valid = () => !retired && !controller.signal.aborted && host.isCurrent(identity);
  const check = () => {
    if (valid()) return;
    if (!controller.signal.aborted && !host.isCurrent(identity)) chooseTerminal('superseded');
    throw controller.signal.reason || new Error('stale_or_cancelled');
  };
  const emit = async event => {
    check();
    if (await host.emit({ ...identity, provider: 'openai', ...event }) === false) throw new Error('native_rejected');
  };

  const workDeadlineMs = services.config.providerWorkDeadlineMs ?? services.config.turnDeadlineMs;
  const providerWorkDone = metrics?.startSpan('provider_work', { watchdogMs: workDeadlineMs });
  providerTimer = setTimeout(() => {
    chooseTerminal('provider_timeout');
    metrics?.event('provider_deadline_fired', { stage: state, reason: 'provider_timeout' });
    controller.abort(new Error('provider_work_deadline'));
  }, workDeadlineMs);
  const abortListener = () => chooseTerminal(terminalForAbort(controller.signal));
  controller.signal.addEventListener('abort', abortListener, { once: true });
  try {
    check();
    host.assertCapabilities();
    observation = host.observe(identity, controller.signal, event => {
      const reason = terminalForNativeEvent(event);
      if (event.type === 'playback_ended' && endSent && event.reason === 'completed' &&
          event.wasInterrupted === false && event.hadAudio === true && event.playbackStarted === true) {
        chooseTerminal('completed');
        return;
      }
      underlyingNativeCause = { nativeType: String(event.type || '').slice(0, 64), nativeReason: String(event.reason || event.type || '').slice(0, 80) };
      chooseTerminal(reason);
      if (!controller.signal.aborted) controller.abort(new Error(reason));
    }, event => {
      const map = {
        audio_turn_accepted: 'native_authorization_accepted',
        audio_turn_rejected: 'native_authorization_rejected',
        playback_started: 'native_playback_started',
        playback_ended: 'native_playback_ended',
      };
      const type = map[event.type];
      if (!type) return;
      const key = type === 'native_playback_started' ? 'playbackStartedCount' : type === 'native_playback_ended' ? 'playbackEndedCount' : type === 'native_authorization_accepted' ? 'authorizationAcceptedCount' : 'authorizationRejectedCount';
      metrics?.count(key);
      metrics?.native(type, { eventType: event.type, nativeReason: event.reason || event.type, outcome: event.wasInterrupted ? 'interrupted' : event.reason || 'accepted' });
    });

    let finalInput = input;
    if (pcm) {
      transition('transcribing');
      finalInput = await services.transcribe({ pcm, sampleRate, signal: controller.signal, telemetry: metrics });
      check();
      await emit({ type: 'input_transcript', text: finalInput });
      check();
    }
    if (isPlayer && !String(finalInput || '').trim()) throw new Error('player_input_empty');

    // Snapshot the old history first so the current utterance is not duplicated in
    // both the history and the current user message sent to Luna.
    const priorHistory = history.readForSession(identity.pedId, identity.sessionNonce);
    if (isPlayer) {
      const committed = history.commitPlayerInput({ identity, input: finalInput });
      metrics?.count(committed ? 'playerCommitted' : 'playerDuplicateCount');
      metrics?.event(committed ? 'player_history_committed' : 'history_duplicate_prevented', { role: 'user', inputChars: String(finalInput).length });
    }
    transition('model_running');
    const decision = await services.decide({ context: { ...context, source }, source,
      input: isPlayer ? finalInput : '', history: priorHistory, signal: controller.signal, telemetry: metrics });
    check();
    transition('decision_validation');
    const validateSpan = metrics?.startSpan('decision_validation');
    let validated;
    try {
      validated = await host.validateDecision(decision, context, identity);
      validateSpan?.('finished');
    } catch (error) {
      validateSpan?.('failed', { code: 'invalid_decision' });
      metrics?.event('decision_rejected', { reason: 'invalid_decision' });
      throw error;
    }
    check();
    if (validated.identityValid !== true || !validated.internalTranscript) throw new Error('decision_rejected');
    transition('decision_validated');
    metrics?.event('decision_validated', { inputChars: String(decision.dialogue || '').length, attempts: validated.actionCount || 0, outcome: validated.actionCount ? 'accepted' : 'normal' });
    history.stage({ identity, spokenReply: decision.dialogue });
    metrics?.count('assistantStageCount');
    metrics?.event('assistant_history_staged', { outputChars: String(decision.dialogue || '').length });
    // Stock action listener preserves timing, including final-only actions.
    await emit({ type: 'output_transcript', text: validated.internalTranscript });
    check();
    transition('tts_running');
    const audio = await services.speak({ dialogue: decision.dialogue, signal: controller.signal, telemetry: metrics,
      onPcm: async chunk => {
        check();
        if (endSent) throw new Error('chunk_after_end');
        if (!authorizationRequested) {
          authorizationRequested = true;
          transition('native_authorization');
          metrics?.count('authorizationAttempts');
          metrics?.event('native_authorization_requested', { attempts: metrics ? 1 : 0 });
          authorization = (async () => {
            if (await host.authorize(identity) !== true) throw new Error('native_authorization_rejected');
            check();
            const result = await observation.authorization(workDeadlineMs);
            check();
            if (!result.ok) throw new Error('native_authorization_rejected');
            transition('playback_streaming');
          })();
        }
        await authorization;
        check();
        await emit({ type: 'audio', chunk });
        metrics?.audioPcm(chunk.byteLength);
        check();
      },
    });
    check();
    if (!authorizationRequested || !audio?.bytes) throw new Error('empty_audio');
    history.markModelAndTtsSucceeded(identity);
    await emit({ type: 'generation_complete' });
    check();
    endSent = true;
    transition('stream_end');
    metrics?.count('streamEndCount');
    await emit({ type: 'turn_complete' });
    metrics?.event('native_stream_end_handoff', { accepted: true, bytes: audio.bytes, chunks: audio.chunks });
    providerWorkDone?.('finished');

    // The provider deadline ends once native stream completion has been sent. From
    // this point only a bounded failure watchdog remains; it never implies success.
    clearTimeout(providerTimer);
    providerTimer = null;
    transition('playback_completion');
    const expectedDurationMs = audio.bytes / (24_000 * 2) * 1_000;
    const watchdogMs = Math.max(services.config.playbackCompletionMinMs ?? 60_000,
      Math.min(services.config.playbackCompletionMaxMs ?? 600_000,
        expectedDurationMs + (services.config.playbackCompletionGraceMs ?? 30_000)));
    metrics?.event('playback_watchdog_armed', { expectedDurationMs, watchdogMs });
    const result = await observation.completion(watchdogMs);
    if (!result.ok || (controller.signal.aborted && terminalReason !== 'completed')) {
      if (result.reason === 'native_ack_timeout' || !result.type) metrics?.event('playback_watchdog_fired', { watchdogMs, reason: 'native_ack_timeout' });
      if (result.reason === 'native_ack_timeout' || !result.type) chooseTerminal('playback_ack_timeout');
      else chooseTerminal(terminalForNativeEvent(result));
      throw new Error(terminalReason || 'playback_error');
    }
    chooseTerminal('completed');
    if (!history.acceptPlaybackResult({ ...result, playbackSucceeded: true })) throw new Error('history_commit_rejected');
    metrics?.count('assistantCommitCount');
    metrics?.event('assistant_history_committed', { outputChars: String(decision.dialogue || '').length, playbackEndedCount: 1 });
    transition('completed');
    host.log?.(identity, 'terminal', { source, reason: 'completed', stage: state, cause: null });
    metrics?.finish({ reason: 'completed', stage: state, pcmBytes: audio.bytes, audioDurationMs: expectedDurationMs, traceComplete: true, assistantCommitted: true });
    return { status: 'completed', terminalReason: 'completed', audioBytes: audio.bytes, discardedTrailingByte: audio.discardedTrailingByte };
  } catch (error) {
    const stageAtFailure = state;
    providerWorkDone?.('failed', { code: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'provider_work_failed' });
    if (!terminalReason) chooseTerminal(controller.signal.aborted ? terminalForAbort(controller.signal) : terminalForError(error, state));
    retired = true;
    const assistantDiscarded = history.discard(identity);
    if (assistantDiscarded) {
      metrics?.count('assistantDiscardCount');
      metrics?.event('assistant_history_discarded', { reason: terminalReason });
    }
    const cause = { ...(underlyingNativeCause || {}), ...(publicCause(error) || {}) };
    if (controller.signal.aborted && controller.signal.reason) cause.abortReason = String(controller.signal.reason.message || controller.signal.reason).slice(0, 80);
    host.log?.(identity, 'terminal', { source, reason: terminalReason, stage: state, cause });
    try { await host.failTurn(identity, Object.assign(new Error(terminalReason), { code: cause?.code || terminalReason }), { source, reason: terminalReason, stage: state, cause }); }
    catch { /* Keep the original terminal cause if native cleanup itself fails. */ }
    if (terminalReason === 'provider_timeout') state = 'deadline';
    else if (terminalReason === 'cancelled' || terminalReason === 'superseded' || terminalReason === 'disconnected' || terminalReason === 'playback_interrupted') state = 'cancelled';
    else if (terminalReason === 'playback_ack_timeout') state = 'ack_timeout';
    else state = 'failed';
    transition(state);
    metrics?.finish({ reason: terminalReason, stage: stageAtFailure, cause, assistantCommitted: false });
    return { status: state, terminalReason, stage: state, cause };
  } finally {
    retired = true;
    history.discard(identity);
    observation?.dispose();
    clearTimeout(providerTimer);
    controller.signal.removeEventListener('abort', abortListener);
    connection.detachAbort(identity, controller);
  }
}
