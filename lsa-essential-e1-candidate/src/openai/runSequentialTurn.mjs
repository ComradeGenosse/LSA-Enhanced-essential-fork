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
  if (['invalid_response','incomplete_response','response_too_large'].includes(code)) return 'invalid_decision';
  if (['timeout','attempt_timeout','deadline_exceeded'].includes(code) || message.includes('deadline')) return 'provider_timeout';
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
  const { identity, input, pcm, sampleRate } = turn;
  let context = turn.context;
  const source = String(turn.source || 'player_text').toLowerCase();
  const isPlayer = PLAYER_SOURCES.has(source);
  const dialogueTurn = services.dialogueTrace?.beginTurn(identity, source);
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
  const deadlineAt = performance.now() + workDeadlineMs;
  const providerWorkDone = metrics?.startSpan('provider_work', { watchdogMs: workDeadlineMs });
  providerTimer = setTimeout(() => {
    chooseTerminal('provider_timeout');
    metrics?.event('provider_deadline_fired', { stage: state, reason: 'provider_timeout' });
    controller.abort(new Error('provider_work_deadline'));
  }, workDeadlineMs);
  const abortListener = () => chooseTerminal(terminalForAbort(controller.signal));
  controller.signal.addEventListener('abort', abortListener, { once: true });
  const performProvider = (operation, provider, run, canRetry = () => true) => {
    if (!services.executeProvider) {
      const attemptId = `${operation}:1`;
      const dialogueAttempt = dialogueTurn?.beginAttempt({ operation, attemptId, isActive: valid });
      return Promise.resolve().then(() => run({ signal: controller.signal, timeoutMs: workDeadlineMs, telemetry: metrics, isActive: valid, attemptId, dialogueAttempt }))
        .then(result => { dialogueAttempt?.finish({ outcome: 'completed', complete: true }); return result; }, error => { dialogueAttempt?.finish({ outcome: controller.signal.aborted ? 'cancelled' : 'failed', code: error?.code || null, httpStatus: error?.status || null }); throw error; });
    }
    return services.executeProvider({
      operation, provider, identity, signal: controller.signal, deadlineAt,
      isCurrent: () => !retired && host.isCurrent(identity), canRetry, telemetry: metrics,
      dialogueTrace: dialogueTurn,
      run: ({ signal, timeoutMs, telemetry, isActive, attemptId, dialogueAttempt }) => {
        if (!isActive()) throw new Error('provider_attempt_inactive');
        return run({ signal, timeoutMs, telemetry, isActive, attemptId, dialogueAttempt });
      },
    });
  };
  let nativeHandoffStarted = false;
  let pcmBytesTotal = 0;
  let pcmChunksTotal = 0;
  const forwardPcm = async (chunk, isActive = () => true) => {
    if (!isActive()) throw new Error('provider_attempt_inactive');
    check();
    if (endSent) throw new Error('chunk_after_end');
    if (services.config.structuredStreamingEnabled === true && services.config.earlyTtsEnabled === true &&
        pcmBytesTotal + chunk.byteLength > services.config.streamingMaxPcmBytes) {
      throw Object.assign(new Error('streaming_pcm_limit'), { code: 'streaming_pcm_limit' });
    }
    if (!nativeHandoffStarted) nativeHandoffStarted = true;
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
    pcmBytesTotal += chunk.byteLength;
    pcmChunksTotal += 1;
    metrics?.audioPcm(chunk.byteLength);
    check();
  };
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
      dialogueTurn?.native({ type: event.type, reason: event.reason || null, wasInterrupted: event.wasInterrupted ?? null, hadAudio: event.hadAudio ?? null, playbackStarted: event.playbackStarted ?? null });
      const key = type === 'native_playback_started' ? 'playbackStartedCount' : type === 'native_playback_ended' ? 'playbackEndedCount' : type === 'native_authorization_accepted' ? 'authorizationAcceptedCount' : 'authorizationRejectedCount';
      metrics?.count(key);
      metrics?.native(type, { eventType: event.type, nativeReason: event.reason || event.type, outcome: event.wasInterrupted ? 'interrupted' : event.reason || 'accepted' });
    });

    // Identity consumes this original work deadline; no provider deadline is reset.
    if (host.prepareTurn) {
      await host.prepareTurn(turn, controller.signal, deadlineAt);
      check();
      context = turn.context;
    }

    let finalInput = input;
    if (pcm) {
      transition('transcribing');
      finalInput = await performProvider('stt', services.providerStack?.transcription.id || 'openai.transcription',
        ({ signal, timeoutMs, telemetry }) => services.transcribe({ identity, pcm, sampleRate, signal, timeoutMs, telemetry }));
      check();
      await emit({ type: 'input_transcript', text: finalInput });
      check();
      if (source === 'player_mic') {
        // One observer-independent callback after accepted STT. No current
        // Essential/native hook supplies a matched source-time capture receipt.
        try { services.acceptPlayerTranscript?.({ text: finalInput, receipt: null }); } catch { /* Optional shadow perception cannot affect the turn. */ }
      }
    }
    if (isPlayer && !String(finalInput || '').trim()) throw new Error('player_input_empty');
    if (isPlayer) dialogueTurn?.input(finalInput);

    // Snapshot the old history first so the current utterance is not duplicated in
    // both the history and the current user message sent to Luna.
    const priorHistory = turn.priorHistory ?? history.readForSession(identity.pedId, identity.sessionNonce);
    if (isPlayer) {
      const committed = history.commitPlayerInput({ identity, input: finalInput });
      metrics?.count(committed ? 'playerCommitted' : 'playerDuplicateCount');
      metrics?.event(committed ? 'player_history_committed' : 'history_duplicate_prevented', { role: 'user', inputChars: String(finalInput).length });
    }
    transition('model_running');
    if(services.finalizeKnowledgeFrame)turn.knowledgeProjection=services.finalizeKnowledgeFrame(turn,{input:finalInput,history:priorHistory,source});
    turn.knowledgeDelivery?.watch(listener=>services.subscribeKnowledgeInvalidation?.(listener) ?? (()=>{}),error=>controller.abort(error));
    const recordReasoningSuccess=decision=>{check();turn.knowledgeDelivery?.success(decision);};
    let decision;
    let streamedSegments = [];
    let streamMode = null;
    let earlyAudio = null;
    if (services.config.structuredStreamingEnabled === true) {
      const allowEarlyTts = services.config.earlyTtsEnabled === true;
      const modelOptions = ({ signal, timeoutMs, telemetry, dialogueAttempt }) => services.providerStack.decideStreaming({
        identity, context: { ...context, source }, source,knowledgeProjection:turn.knowledgeProjection,knowledgeDelivery:turn.knowledgeDelivery,
        input: isPlayer ? finalInput : '', history: priorHistory, signal, timeoutMs, telemetry, dialogueAttempt,
      });
      if (!allowEarlyTts) {
        const result = await performProvider('model', services.providerStack.reasoning.id, modelOptions);
        decision = result.decision;
        streamMode = result.mode;
      } else {
        let queueClosed = false;
        let queueFailure = null;
        let modelFailed = false;
        const pending = [];
        let wake = null;
        const signalQueue = () => { const resume = wake; wake = null; resume?.(); };
        const enqueue = segment => {
          check();
          if (queueClosed || pending.length >= services.config.streamingMaxSegments) throw new Error('stream_segment_queue_limit');
          pending.push(segment);
          signalQueue();
        };
        const closeQueue = () => { queueClosed = true; signalQueue(); };
        const cancelQueue = error => { queueFailure = error; pending.length = 0; closeQueue(); };
        const speechTask = (async () => {
          let bytes = 0;
          let chunks = 0;
          while (true) {
            check();
            if (queueFailure) throw queueFailure;
            const segment = pending.shift();
            if (!segment) {
              if (queueClosed) break;
              await new Promise(resolve => { wake = resolve; });
              continue;
            }
            transition('tts_running');
            metrics?.event('stream_tts_segment_started', { segmentSequence: segment.sequence });
            const audio = await performProvider('tts', services.providerStack.speech.id,
              ({ signal, timeoutMs, telemetry, isActive: active }) => services.speak({
                identity, dialogue: segment.text, speechProfile: turn.speechProfile, signal, timeoutMs, telemetry,
                onPcm: chunk => forwardPcm(chunk, active),
              }), () => !nativeHandoffStarted);
            if (!audio?.bytes) throw new Error('empty_segment_audio');
            if (audio.discardedTrailingByte) throw Object.assign(new Error('partial_pcm16_sample'), { code: 'partial_pcm16_sample' });
            bytes += audio.bytes;
            chunks += audio.chunks || 0;
            metrics?.event('stream_tts_segment_finished', { segmentSequence: segment.sequence, bytes: audio.bytes, chunks: audio.chunks || 0 });
          }
          return { bytes, chunks, discardedTrailingByte: false };
        })();
        speechTask.catch(error => {
          if (!modelFailed && !controller.signal.aborted && !retired && host.isCurrent(identity)) {
            chooseTerminal('tts_error');
            controller.abort(error);
          }
        });
        const modelTask = performProvider('model', services.providerStack.reasoning.id,
          ({ signal, timeoutMs, telemetry, isActive, dialogueAttempt }) => services.providerStack.decideStreaming({
            identity, context: { ...context, source }, source,knowledgeProjection:turn.knowledgeProjection,knowledgeDelivery:turn.knowledgeDelivery,
            input: isPlayer ? finalInput : '', history: priorHistory, signal, timeoutMs, telemetry, dialogueAttempt,
            onSegment: async (segment, mode) => {
              if (!isActive()) throw new Error('provider_attempt_inactive');
              check();
              if (!mode) throw new Error('stream_mode_missing_before_segment');
              if (streamMode && streamMode !== mode) throw new Error('stream_mode_changed');
              streamMode = mode;
              if (mode === 'dialogue_only') {
                streamedSegments.push(segment);
                metrics?.count('segmentCount');
                enqueue(segment);
              }
            },
          }), () => streamedSegments.length === 0 && !nativeHandoffStarted);
        try {
          const result = await modelTask;
          decision = result.decision;
          streamMode = result.mode;
          recordReasoningSuccess(decision);
          closeQueue();
          // A final command is invalid in dialogue_only mode (also checked by the
          // strict decoder); the normal stock validator remains the action gate.
          earlyAudio = await speechTask;
        } catch (error) {
          modelFailed = true;
          chooseTerminal(terminalForError(error, 'model_running'));
          if (!controller.signal.aborted) controller.abort(error);
          cancelQueue(error);
          await Promise.allSettled([speechTask]);
          throw error;
        }
      }
    } else {
      decision = await performProvider('model', services.providerStack?.reasoning.id || 'openai.reasoning',
        ({ signal, timeoutMs, telemetry, dialogueAttempt }) => services.decide({ identity, context: { ...context, source }, source,knowledgeProjection:turn.knowledgeProjection,knowledgeDelivery:turn.knowledgeDelivery,
          input: isPlayer ? finalInput : '', history: priorHistory, signal, timeoutMs, telemetry, dialogueAttempt }));
    }
    recordReasoningSuccess(decision);
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
    dialogueTurn?.decision({ dialogue: decision.dialogue, command: decision.command, internalTranscript: validated.internalTranscript });
    history.stage({ identity, spokenReply: decision.dialogue });
    metrics?.count('assistantStageCount');
    metrics?.event('assistant_history_staged', { outputChars: String(decision.dialogue || '').length });
    // Stock action listener preserves timing, including final-only actions.
    // Stock action listeners may dispatch synchronously on this transcript event.
    const hasAction = validated.actionCount > 0;
    // Passive C-05 observation runs synchronously before the stock listener.
    // It may capture already-validated data, never await, dispatch or veto.
    if(hasAction && services.recordDialogueActionPublication){
      try {const result=services.recordDialogueActionPublication({turn,validated,publishedAtMs:Date.now()});result?.catch?.(()=>{});}catch{}
    }
    await emit({ type: 'output_transcript', text: validated.internalTranscript });
    check();
    transition('tts_running');
    let audio = earlyAudio?.bytes > 0 ? earlyAudio : null;
    if (!audio) {
      audio = await performProvider('tts', services.providerStack?.speech.id || 'openai.speech',
        ({ signal, timeoutMs, telemetry, isActive }) => services.speak({
          identity, dialogue: decision.dialogue, speechProfile: turn.speechProfile, signal, timeoutMs, telemetry,
          onPcm: chunk => forwardPcm(chunk, isActive),
        }), () => !hasAction && !nativeHandoffStarted);
    }
    check();
    if (!authorizationRequested || !audio?.bytes || !pcmBytesTotal) throw new Error('empty_audio');
    history.markModelAndTtsSucceeded(identity);
    await emit({ type: 'generation_complete' });
    check();
    endSent = true;
    transition('stream_end');
    metrics?.count('streamEndCount');
    await emit({ type: 'turn_complete' });
    metrics?.event('native_stream_end_handoff', { accepted: true, bytes: pcmBytesTotal, chunks: pcmChunksTotal });
    providerWorkDone?.('finished');

    // The provider deadline ends once native stream completion has been sent. From
    // this point only a bounded failure watchdog remains; it never implies success.
    clearTimeout(providerTimer);
    providerTimer = null;
    transition('playback_completion');
    const expectedDurationMs = pcmBytesTotal / (24_000 * 2) * 1_000;
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
    dialogueTurn?.finish({ reason: 'completed', stage: 'completed', assistantCommitted: true, assistantDiscarded: false });
    transition('completed');
    host.log?.(identity, 'terminal', { source, reason: 'completed', stage: state, cause: null });
    metrics?.finish({ reason: 'completed', stage: state, pcmBytes: pcmBytesTotal, audioDurationMs: expectedDurationMs, traceComplete: true, assistantCommitted: true });
    return { status: 'completed', terminalReason: 'completed', audioBytes: pcmBytesTotal, discardedTrailingByte: audio.discardedTrailingByte };
  } catch (error) {
    turn.knowledgeDelivery?.finish();
    const stageAtFailure = state;
    providerWorkDone?.('failed', { code: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'provider_work_failed' });
    if (!terminalReason) chooseTerminal(controller.signal.aborted ? terminalForAbort(controller.signal) : terminalForError(error, state));
    retired = true;
    const assistantDiscarded = history.discard(identity);
    if (assistantDiscarded) {
      metrics?.count('assistantDiscardCount');
      metrics?.event('assistant_history_discarded', { reason: terminalReason });
    }
    dialogueTurn?.finish({ reason: terminalReason, stage: stageAtFailure, assistantCommitted: false, assistantDiscarded });
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
    turn.knowledgeDelivery?.dispose();
    clearTimeout(providerTimer);
    controller.signal.removeEventListener('abort', abortListener);
    connection.detachAbort(identity, controller);
  }
}
