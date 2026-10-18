import {combineDirectorSocialMemory} from '../memory/h1ConversationHistory.mjs';
import { drivingIntentKind, activeAct6Driving, liveAct6Driving, drivingModelGuidance, reconcileDrivingDecision, stockDrivingCommand } from '../activities/vehicleDrivingIntent.mjs';
import { parseVehicleSeatPlayerRequest, reconcileVehicleSeatDecision, vehicleSeatModelCommandKind, navigationRequestKind, isAct6StopRequest, reconcileAct6Decision } from '../activities/act5Dialogue.mjs';
import {assertDirectorSpeechDecision} from '../perception/directorDecisionGuard.mjs';
import {scalePcm16} from '../voice/pcmVolume.mjs';
import {selectLocalFallback,fallbackCategory} from '../voice/localFallback.mjs';
import {playbackCompletionPolicy} from './playbackCompletionPolicy.mjs';
import {createSpeechDeliveryResolver} from '../voice/emotion/resolveSpeechDelivery.mjs';
const ELEVENLABS_MAX_NATIVE_LEAD_MS=900;
const ELEVENLABS_PACE_POLL_MS=50;
const PCM_BYTES_PER_MS=24_000*2/1_000;
const PLAYER_SOURCES = new Set(['player_text', 'player_mic']);
// Closed vocabulary for the single, content-free PCM forward-failure event.
const SAFE_PCM_FAILURES = new Set([
  'native_rejected', 'native_authorization_rejected', 'chunk_after_end',
  'stale_or_cancelled', 'provider_attempt_inactive', 'streaming_pcm_limit',
  'cancelled', 'superseded', 'disconnected',
]);
const RECOVERABLE_PRE_SEND = new Set(['memory_stale','recall_stale','opinion_stale']);
// Only optional context invalidation may cause a rebuilt request. Identity,
// provider, native and post-send privacy failures are never replayed.
const recoverablePreSend = error => error?.code==='knowledge_request_stale' &&
  RECOVERABLE_PRE_SEND.has(error?.reason);

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
  if (['invalid_response','incomplete_response','response_too_large'].includes(code) || code.startsWith('segment_')) return 'invalid_decision';
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

// `acceptance` is the one-shot accepted-input capability that OpenAIConnection
// opens privately for this launch (see memory/openaiRuntimeAcceptedInput.mjs).
// It is not a service and never reaches model, provider or native code.
// `speech` is the matching one-shot NPC speech-delivery recorder (WS-5a): it is
// fed only from actions this function really performs (PCM chunks accepted by
// host.emit, TTS completion, stream end, RAM-history acceptance) and from the
// native events the bridge delivered for this exact turn tuple. Every call is
// best effort: memory evidence can never delay, fail or alter a turn.
export async function runSequentialTurn({ connection, turn, controller = new AbortController(), services, history, host, acceptance = null, speech = null, voice = null }) {
  const { identity, input, pcm, sampleRate } = turn;
  let context = turn.context;
  const source = String(turn.source || 'player_text').toLowerCase();
  const isPlayer = PLAYER_SOURCES.has(source);
  const dialogueTurn = services.dialogueTrace?.beginTurn(identity, source);
  let observation;
  let reaction = null;
  let state = 'bound';
  let terminalReason = '';
  let underlyingNativeCause = null;
  let authorizationRequested = false;
  let authorization;
  let retired = false;
  let endSent = false;
  let nativePlaybackStartedAt = null;
  let playbackCommitted = false;
  let outputTranscriptPublished = false;
  let outputTranscriptAttempted = false;
  let fallbackPlayback = null;
  let stockActionPublished = false;
  let providerTimer = null;
  const metrics = host.telemetry?.beginTurn(identity, source, { inputChars: String(input || '').length, bytes: pcm?.byteLength || 0, sampleRate: sampleRate || 0 }) || null;

  // UX4 meter hook: best effort and never able to fail or delay the turn.
  const notifyVoice = (method, ...args) => { try { voice?.[method](...args); } catch { /* meter only */ } };
  const transition = next => { state = next; metrics?.stage(next); notifyVoice('stage', identity, next); host.log?.(identity, next, { source }); };
  const chooseTerminal = reason => { if (!terminalReason) terminalReason = reason; return terminalReason; };
  const valid = () => !retired && !controller.signal.aborted && host.isCurrent(identity);
  const expressiveDelivery = createSpeechDeliveryResolver({
    config: services.config, identity, source, turn,
    adapter: services.emotionalActing, telemetry: metrics, isActive: valid,
  });
  const renderedDeliveries = [];
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
  let recoverPreRequest = null;
  const safeToRebuild = error => {
    if(!recoverablePreSend(error) || turn.memoryFallbackUsed ||
       services.shouldWaitForMemoryCommand?.(turn.acceptedPlayerInput ?? ''))return false;
    // A strict pre-send SQLite fence can change for harmless local writes;
    // that lane may be discarded before HTTP. Actual forget/correct, source,
    // profile or identity revocations are NOT fallback candidates.
    let cause=null;
    try{cause=turn.memoryPrepared?.invalidationReason?.()??null;}
    catch{return false;}
    return cause===null || cause==='source_changed';
  };
  const performProvider = (operation, provider, run, canRetry = () => true) => {
    const attempt=async options=>{
      if(operation==='model'&&turn.knowledgeDelivery?.prepareAsync){
        try{turn.knowledgeProjection=await turn.knowledgeDelivery.prepareAsync();check();}
        catch(error){
          if(!recoverPreRequest||!safeToRebuild(error)||
             turn.knowledgeDelivery?.wasSent?.()||!valid())throw error;
          await recoverPreRequest('pre_request_stale','attempt_preparation');
        }
      }
      try{return await run(options);}
      catch(error){
        if(operation!=='model'||!recoverPreRequest||!safeToRebuild(error)||
           turn.knowledgeDelivery?.wasSent?.()||!valid())throw error;
        // The old HTTP body has NOT been submitted. Run again from the
        // completely re-rendered, reverified clean projection exactly once.
        await recoverPreRequest('pre_request_stale','verify_before_request');
        return run(options);
      }
    };
    if (!services.executeProvider) {
      const attemptId = `${operation}:1`;
      const dialogueAttempt = dialogueTurn?.beginAttempt({ operation, attemptId, isActive: valid });
      return Promise.resolve().then(() => attempt({ signal: controller.signal, timeoutMs: workDeadlineMs, telemetry: metrics, isActive: valid, attemptId, dialogueAttempt }))
        .then(result => { dialogueAttempt?.finish({ outcome: 'completed', complete: true }); return result; }, error => { dialogueAttempt?.finish({ outcome: controller.signal.aborted ? 'cancelled' : 'failed', code: error?.code || null, httpStatus: error?.status || null }); throw error; });
    }
    return services.executeProvider({
      operation, provider, identity, signal: controller.signal,
      deadlineAt: deadlineAt - (services.config.localVoiceFallback?.enabled === true ? services.config.localVoiceFallback.maxRecoveryDelayMs : 0),
      isCurrent: () => !retired && host.isCurrent(identity), canRetry, telemetry: metrics,
      dialogueTrace: dialogueTurn,
      run: ({ signal, timeoutMs, telemetry, isActive, attemptId, dialogueAttempt }) => {
        if (!isActive()) throw new Error('provider_attempt_inactive');
        return attempt({ signal, timeoutMs, telemetry, isActive, attemptId, dialogueAttempt });
      },
    });
  };
  // NPC side of the exchange (WS-5a). Runs for completed, interrupted and failed
  // speech alike; D03 decides from the ledger, and a missing outcome is silent.
  const recordNpcOutcome = async () => {
    if (!services.recordM2Npc || !speech) return;
    try {
      const receipt = await services.recordM2Npc({ turn });
      if (!receipt) return;
      if (['stored', 'duplicate'].includes(receipt.status) && receipt.durable === true) {
        metrics?.event('memory_journal_committed', { role: 'npc', delivery: receipt.delivery });
      } else if (receipt.reason !== 'd03_npc_no_outcome') {
        metrics?.event('memory_journal_not_committed', { role: 'npc', reason: receipt.reason });
      }
    } catch { try { metrics?.event('memory_journal_not_committed', { role: 'npc' }); } catch {} }
  };
  let nativeHandoffStarted = false;
  // ElevenLabs text submission can bill before PCM. No automatic retry.
  const canRetryTts=()=>!nativeHandoffStarted && services.config.speechProvider!=='elevenlabs';
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
    if(services.config.speechProvider==='elevenlabs') {
      while(true) {
        if(!isActive())throw new Error('provider_attempt_inactive');
        check();
        const playedMs=nativePlaybackStartedAt===null?0:Math.max(0,performance.now()-nativePlaybackStartedAt);
        const aheadMs=pcmBytesTotal/PCM_BYTES_PER_MS-playedMs;
        if(aheadMs<=ELEVENLABS_MAX_NATIVE_LEAD_MS)break;
        await new Promise(resolve=>setTimeout(resolve,
          Math.max(1,Math.min(ELEVENLABS_PACE_POLL_MS,aheadMs-ELEVENLABS_MAX_NATIVE_LEAD_MS))));
      }
    }
    if (!nativeHandoffStarted) {
      nativeHandoffStarted = true;
      metrics?.event('audio_handoff_started', {stage:'native_authorization'});
    }
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
    // One gain stage after either TTS provider, before native playback.
    try {
      await emit({ type: 'audio', chunk:scalePcm16(chunk,services.config.ttsVolume??1) });
      pcmBytesTotal += chunk.byteLength;
      pcmChunksTotal += 1;
      metrics?.audioPcm(chunk.byteLength);
      check();
    } catch (error) {
      // Record the callback/native failure category once, without exposing
      // dialogue, vendor responses, API credentials or arbitrary error text.
      const cause = String(error?.code || error?.message || '');
      const reason = SAFE_PCM_FAILURES.has(cause) ? cause : 'unclassified_pcm_forward_error';
      metrics?.event('native_pcm_forward_failed', {
        reason, chunkBytes: chunk.byteLength,
        forwardedBytes: pcmBytesTotal, forwardedChunks: pcmChunksTotal,
        playbackStarted: nativePlaybackStartedAt !== null,
      });
      throw error;
    }
  };
  // One-shot rescue on the SAME current native turn, strictly before first PCM.
  // After any PCM was handed off, the native v3 contract has no safe replay or
  // queue-drain proof; the ordinary failTurn retirement is mandatory instead.
  const tryLocalFallback = async (error, failedStage) => {
    const failureReason = terminalForError(error,failedStage);
    const eligible = ['stt_error','model_error','invalid_decision','model_refusal','tts_error','provider_timeout'].includes(failureReason) &&
      !controller.signal.aborted && !retired && !endSent &&
      !authorizationRequested && !nativeHandoffStarted &&
      (!outputTranscriptAttempted || outputTranscriptPublished) && host.isCurrent(identity);
    if(!eligible)return null;
    const actionState=stockActionPublished||turn.act5Reply?.kind==='approval_pending'
      ?'unverified':turn.act5Reply?.kind==='unavailable'?'failed':null;
    const category=fallbackCategory({terminalReason:failedStage==='transcribing'?'stt_error':failureReason,actionState});
    metrics?.event('voice_fallback_requested',{stage:failedStage,failureReason,category,turnId:identity.turnId});
    // Release the original provider watchdog; local selection has its own
    // deadline and native receipt completion owns the later watchdog.
    clearTimeout(providerTimer);providerTimer=null;
    const asset=await selectLocalFallback({config:services.config,turn,category,signal:controller.signal});
    if(asset.status!=='selected'){
      metrics?.event('voice_fallback_playback_failed',{reason:asset.status,category});
      return null;
    }
    if(controller.signal.aborted||retired||!host.isCurrent(identity))return null;
    metrics?.event('voice_fallback_selected',{category,assetId:asset.assetId,characterId:asset.characterId,audioPath:'native_pcm'});
    fallbackPlayback={category,assetId:asset.assetId,started:false};
    // If Luna never published a transcript, publish one validated speech-only
    // transcript. After stock action publication NEVER publish it again.
    if(!outputTranscriptPublished){
      const validated=await host.validateDecision({dialogue:asset.text,command:''},context,identity);
      if(validated.identityValid!==true||!validated.internalTranscript)throw new Error('fallback_decision_rejected');
      outputTranscriptAttempted=true;
      await emit({type:'output_transcript',text:validated.internalTranscript});
      outputTranscriptPublished=true;
    }
    check();
    history.discard(identity); // Remove the failed original, not the accepted user input.
    history.stage({identity,spokenReply:asset.text});
    const ledgerReady=!!speech?.replaceUndeliveredWithFallback?.(asset.text);
    const ledgerSegment=ledgerReady?speech.beginSegment({sequence:0,text:asset.text}):null;
    let copied=0;
    try {
      for(let offset=0;offset<asset.pcm.length;offset+=4096){
        check();
        const chunk=asset.pcm.subarray(offset,Math.min(offset+4096,asset.pcm.length));
        await forwardPcm(chunk);
        copied+=chunk.length;
        try{ledgerSegment?.forwarded(chunk.byteLength);}catch{}
      }
      try{ledgerSegment?.completed(copied);}catch{}
      history.markFallbackAudioReady(identity);
      await emit({type:'generation_complete'});
      endSent=true;
      await emit({type:'turn_complete'});
      try{speech?.finalized();}catch{}
      clearTimeout(providerTimer);providerTimer=null;
      providerWorkDone?.('failed',{code:failureReason});
      transition('playback_completion');
      const policy=playbackCompletionPolicy({
        pcmBytes:copied,nativeStartedAt:nativePlaybackStartedAt,sealedAt:performance.now(),
        minimumMs:services.config.playbackCompletionMinMs??10000,
        maximumMs:services.config.playbackCompletionMaxMs??600000,
        graceMs:services.config.playbackCompletionGraceMs??12000,
      });
      const receipt=await observation.completion(policy.watchdogMs);
      if(!receipt.ok||controller.signal.aborted)throw new Error('fallback_native_completion_failed');
      if(!history.acceptPlaybackResult({...receipt,playbackSucceeded:true}))
        throw new Error('fallback_history_commit_rejected');
      playbackCommitted=true;
      try{speech?.historyAccepted(receipt);}catch{}
      await recordNpcOutcome();
      metrics?.event('voice_fallback_playback_completed',{category,assetId:asset.assetId,pcmBytes:copied});
      metrics?.event('voice_fallback_recovery_completed',{category,outcome:'completed',originalFailure:failureReason});
      metrics?.finish({reason:'completed',stage:'fallback_playback',pcmBytes:copied,assistantCommitted:true,originalFailure:failureReason});
      dialogueTurn?.finish({reason:'completed',stage:'fallback_playback',assistantCommitted:true,assistantDiscarded:false});
      notifyVoice('terminal',identity,'completed');
      host.log?.(identity,'terminal',{source,reason:'completed',stage:'fallback_playback',cause:{code:failureReason}});
      return {status:'completed',terminalReason:'completed',fallback:true,originalFailure:failureReason,audioBytes:copied};
    }catch(fallbackError){
      try{ledgerSegment?.failed();}catch{}
      metrics?.event('voice_fallback_playback_failed',{category,assetId:asset.assetId,reason:'native_or_delivery_failure'});
      throw fallbackError;
    }
  };
  try {
    check();
    host.assertCapabilities();
    try { reaction = services.reactions?.openTurn({ identity, source, signal: controller.signal, isCurrent: valid }) ?? null; }
    catch { reaction = null; }
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
      try { speech?.native(event); } catch { /* evidence only */ }
      try { reaction?.native(event); } catch { /* cosmetic only */ }
      notifyVoice('nativePlayback', identity, event.type);
      const map = {
        audio_turn_accepted: 'native_authorization_accepted',
        audio_turn_rejected: 'native_authorization_rejected',
        playback_started: 'native_playback_started',
        playback_ended: 'native_playback_ended',
      };
      const type = map[event.type];
      if (!type) return;
      if(event.type==='playback_started'){
        nativePlaybackStartedAt=performance.now();
        if(fallbackPlayback && !fallbackPlayback.started){
          fallbackPlayback.started=true;
          metrics?.event('voice_fallback_playback_started',{category:fallbackPlayback.category,assetId:fallbackPlayback.assetId});
        }
      }
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
    if(turn.memoryDisabledForTurn)
      metrics?.event('memory_bypass',{stage:'pre_stt',reason:'native_memory_source_timeout',requestGatePassed:false});
    // Freeze M2 source identity after P2 turn hydration, before STT/provider work.
    // The optional native binder returns null unless exact lifetime and host
    // evidence exist. A later reconnect cannot re-authorize this old turn.
    if(services.bindM2Turn){
      try{turn.m2Capture=services.bindM2Turn({turn,isCurrent:valid})??null;}
      catch{turn.m2Capture=null;}
    }
    if(isPlayer&&services.memoryCaptureEnabled&&!turn.m2Capture)
      turn.memoryDisabledForTurn ||= 'memory_capture_unavailable';

    let finalInput = input;
    if (pcm) {
      metrics?.event('mic_input_captured',{hasPcm:true,bytes:pcm.byteLength});
      transition('transcribing');
      finalInput = await performProvider('stt', services.providerStack?.transcription.id || 'openai.transcription',
        ({ signal, timeoutMs, telemetry }) => services.transcribe({ identity, pcm, sampleRate, signal, timeoutMs, telemetry }));
      check();
      metrics?.event('stt_completed',{hasTranscript:!!String(finalInput||'').trim()});
      await emit({ type: 'input_transcript', text: finalInput });
      check();
      if (source === 'player_mic') {
        // One observer-independent callback after accepted STT. No current
        // Essential/native hook supplies a matched source-time capture receipt.
        try { services.acceptPlayerTranscript?.({ text: finalInput, receipt: null }); } catch { /* Optional shadow perception cannot affect the turn. */ }
      }
    }
    if (isPlayer && !String(finalInput || '').trim()) throw new Error('player_input_empty');
    if (isPlayer) {
      turn.acceptedPlayerInput = finalInput;
      metrics?.event('input_ready',{inputMode:source==='player_mic'?'stt':'typed'});
      dialogueTurn?.input(finalInput);
    }

    // Snapshot the old history first so the current utterance is not duplicated in
    // both the history and the current user message sent to Luna.
    const priorHistory = turn.priorHistory ?? history.readForSession(identity.pedId, identity.sessionNonce);
    // Bounded optional waits may leave a pending append running: do not abort a
    // privileged operation or treat an unobserved receipt as a durable commit.
    const boundedMemory = async work => {
      const ms=Math.max(0,Math.min(900,Math.floor((deadlineAt-performance.now()-2500)/4)));
      if(!ms)return {timedOut:true};
      let timer;
      try{return await Promise.race([
        Promise.resolve().then(work).then(value=>({value})),
        new Promise(resolve=>{timer=setTimeout(()=>resolve({timedOut:true}),ms);})
      ]);}
      finally{clearTimeout(timer);}
    };
    // Bare "Faster"/"Slower" is a follow-up only when this turn's verified
    // Essential actor state says the NPC is currently the vehicle driver.
    // Previous dialogue, free-drive loops and inferred ACT6 state cannot grant it.
    const drivingCapabilities = context?.actor?.actionCapabilities;
    const verifiedDriver = drivingCapabilities?.isDriver === true &&
      drivingCapabilities?.inVehicle === true;
    const vehicleIntent = isPlayer ? drivingIntentKind(finalInput,{verifiedDriver}) : null;
    const seatRequest = isPlayer ? parseVehicleSeatPlayerRequest(finalInput) : null;
    if(seatRequest)metrics?.event('vehicle_seat_requested',{seat:seatRequest.slots.seat,stage:'classified'});
    // ACT4 state is source-qualified by the same P2 owner/host knowledge boundary.
    // This advisory cannot authorize driving; it only prevents stock takeover.
    const vehicleActivityEvidence = turn.knowledgeInputs?.activityInputs;
    let act6OwnsDrive = isPlayer && !turn.knowledgeInputs?.reason &&
      !turn.knowledgeInputs?.ownerPendingProof && !vehicleActivityEvidence?.reason &&
      !vehicleActivityEvidence?.ownerPendingProof &&
      activeAct6Driving(vehicleActivityEvidence?.state,vehicleActivityEvidence?.binding);
    if (vehicleIntent) metrics?.event('vehicle_request_classified',{vehicleKind:vehicleIntent});
    const reasoningContext=()=>{
      const activity=turn.act5Reply;
      const navigation=['go_to_place','vehicle_trip','move_to_and_hold'].includes(activity?.intent);
      const seatInstruction=seatRequest && activity?.intent==='board_vehicle'
        ? activity.kind==='approval_pending'
          ? '\n[PLAYER SEAT COMMAND] The player directly ordered a seat change. ACT3 has staged verified native admission. Do not invent a V### token, issue any stock DO command, or claim Nathan is seated. The GTA task has not started; only describe willingness to try.'
          : '\n[PLAYER SEAT COMMAND] Native seat admission refused this request. Do not issue a substitute stock DO command or claim a seat was entered; explain that the seat/vehicle/controller is unavailable.'
        : '';
      const activityInstruction=activity
        ? '\n[ACTIVITY PLAYER REPLY]\n'+JSON.stringify(activity)+seatInstruction+(
          navigation
            ? activity.kind==='approval_pending'
              ? '\nThis is a recognized navigation command, STAGED for native admission after transcript publication. No GTA movement has been verified. Do not issue a stock DO command or claim driving, progress, or arrival. Respond naturally with tentative intent.'
              : '\nThe player gave a navigation order, but ACT6 cannot execute it ('+String(activity.reason||'unavailable')+'). Explain the limitation plainly; a missing waypoint needs a map marker, driver_required needs an NPC driver, and capability_disabled requires explicit enablement and passed native probes. Do not claim navigation started or substitute aimless stock driving.'
            : activity.kind==='approval_pending'
              ? '\nConsent is staged, not executed. Do not issue a stock DO action or another activity. Never claim physical completion.'
              : '\nThe previous ACT5 invitation is no longer actionable. Do not repeat or execute it. If the player explicitly requested a DIFFERENT existing Essential action, normal player-directed DO validation may still apply; otherwise just respond naturally. Never claim an action already happened.')
        : '';
      return {...context,source,systemInstruction:context.systemInstruction+activityInstruction+
        drivingModelGuidance(vehicleIntent,act6OwnsDrive)+
        (turn.memoryDisabledForTurn
          ? '\n[MEMORY AVAILABILITY] Learned memory is unavailable for this turn. Do not claim to have saved, corrected or forgotten a memory unless a verified durable outcome was supplied. Do not invent prior memories.'
          : '')};
    };
    recoverPreRequest=async(reason,stage)=>{
      check();
      // A prepared M5 command may already have made a privileged durable
      // mutation. Never re-admit its stale acknowledgement as normal dialogue.
      // A new turn may give the player a clean unavailability response.
      if(turn.memoryFallbackUsed||!services.finalizeKnowledgeFrame||
         services.shouldWaitForMemoryCommand?.(finalInput)||
         (turn.characterInputs?.profile &&
          (turn.characterSnapshot?.resolution?.kind!=='persistent'||
           turn.characterProjection?.persistent!==true)))
        throw Object.assign(new Error('memory_fallback_not_authorized'),{code:'memory_fallback_not_authorized'});
      turn.memoryFallbackUsed=true;
      turn.memoryDisabledForTurn=reason;
      turn.memoryPrepared=null;
      turn.knowledgeDelivery?.dispose();
      // Full model body is composed anew by decide/decideStreaming after this.
      turn.knowledgeProjection=await services.finalizeKnowledgeFrame(turn,{
        input:finalInput,history:[],source,forceNoMemory:true});
      check();
      await turn.knowledgeDelivery?.prepareAsync?.();
      check();
      turn.knowledgeDelivery?.watch(listener=>services.subscribeKnowledgeInvalidation?.(listener)??(()=>{}),
        error=>controller.abort(error));
      metrics?.event('memory_fallback',{stage,reason,requestGatePassed:false});
    };
    let durablePlayerReceipt = null;
    if (isPlayer) {
      // D-016 commit decision: the runtime irrevocably adopts these exact words
      // as this turn's player input (the single final STT result, or the typed
      // text the original backend adopted), after the currency checks above.
      const committed = history.commitPlayerInput({ identity, input: finalInput });
      // D01: the accepted-input receipt is minted BY this decision, in the same
      // synchronous step, only for a first commit. The capability re-verifies
      // currency and the original turn record itself; failure never affects
      // the turn. Later interruption does not revoke it (memory plan §5.5).
      let accepted = null;
      if (committed && acceptance) {
        try { accepted = acceptance.accept({ input: finalInput, inputMode: source === 'player_mic' ? 'stt' : 'typed' }); }
        catch { accepted = null; }
      }
      // M2: the RAM history is intentionally trimmed, but the immutable SQLite
      // journal receives the full accepted input with source attribution.
      if (committed && services.recordM2Player) {
        try {
          // Preserve the original D03 no-source diagnostic result without
          // manufacturing an owner lease or attempting a durable write.
          const result=turn.memoryDisabledForTurn&&!turn.m2Capture
            ?{value:await services.recordM2Player({turn,text:finalInput,source})}
            :await boundedMemory(()=>services.recordM2Player({turn,text:finalInput,source}));
          if(result.timedOut){
            turn.memoryDisabledForTurn='memory_capture_timeout';
            metrics?.event('memory_bypass',{stage:'m2_capture',reason:'memory_capture_timeout',requestGatePassed:false});
          }else durablePlayerReceipt=result.value;
        }catch{
          turn.memoryDisabledForTurn='memory_capture_failed';
          metrics?.event('memory_bypass',{stage:'m2_capture',reason:'memory_capture_failed',requestGatePassed:false});
        }
      }
      metrics?.count(committed ? 'playerCommitted' : 'playerDuplicateCount');
      metrics?.event(committed ? 'player_history_committed' : 'history_duplicate_prevented', { role: 'user', inputChars: String(finalInput).length, ...(committed && acceptance ? { accepted: !!accepted } : {}) });
    }
    // WS-6a/b: after the accepted player's durable D03 receipt, and before
    // the model call, use the same P2 store/verified owner to prepare recall,
    // journal CONVERSE and M5. Never infer a receipt from RAM history.
    if(isPlayer && durablePlayerReceipt?.durable!==true)services.noteH1Skipped?.();
    if(isPlayer && services.prepareLiveTurnMemory && durablePlayerReceipt?.durable===true&&!turn.memoryDisabledForTurn){
      try{
        const prepare=()=>services.prepareLiveTurnMemory({
          turn,acceptedReceipt:durablePlayerReceipt,input:finalInput,source,isCurrent:valid});
        // Explicit M5 commands can make privileged writes: never abandon those
        // halfway through a privacy transaction for a speculative reply.
        const result=services.shouldWaitForMemoryCommand?.(finalInput)
          ?{value:await prepare()}:await boundedMemory(prepare);
        if(result.timedOut){
          turn.memoryDisabledForTurn='memory_prepare_timeout';
          metrics?.event('memory_bypass',{stage:'memory_prepare',reason:'memory_prepare_timeout',requestGatePassed:false});
        }else turn.memoryPrepared=result.value;
      }catch{
        turn.memoryPrepared=null;
        turn.memoryDisabledForTurn='memory_prepare_failed';
        metrics?.event('memory_bypass',{stage:'memory_prepare',reason:'memory_prepare_failed',requestGatePassed:false});
      }
      check();
    }
    if(isPlayer&&services.memoryCaptureEnabled&&durablePlayerReceipt?.durable!==true)
      turn.memoryDisabledForTurn||='memory_receipt_unavailable';
    // M9: the independently verified event callback remains optional.
    if(!isPlayer && source==='special_event' && turn.directorTicket){
      if(services.prepareDirectorCallbackMemory){
        try{
          turn.memoryPrepared=await services.prepareDirectorCallbackMemory({turn,source,isCurrent:valid})??null;
        }catch{turn.memoryPrepared=null;}
        check();
      }
      // A social scene has no player-input receipt. Let H1 read existing
      // completed/accepted P2 lines under the *current* native Director proof.
      // This cannot veto a spontaneous scene when P2 is slow or unavailable.
      if(services.prepareDirectorSocialHistory){
        try{
          const result=await boundedMemory(()=>services.prepareDirectorSocialHistory({
            turn,source,isCurrent:valid
          }));
          if(!result.timedOut)
            turn.memoryPrepared=combineDirectorSocialMemory(turn.memoryPrepared,result.value);
        }catch{ /* history unavailable: scene proceeds with no transcript */ }
        check();
      }
    }
    transition('model_running');
    if(services.finalizeKnowledgeFrame){
      try{turn.knowledgeProjection=await services.finalizeKnowledgeFrame(turn,{input:finalInput,history:priorHistory,source});}
      catch(error){
        // A broken optional PS4 projection can fail even when no M2/H1/H2
        // contributor was prepared. Retry once with the verified clean base;
        // any failure of that base remains fatal, never silently masked.
        if(turn.memoryDisabledForTurn||turn.memoryFallbackUsed)throw error;
        await recoverPreRequest('memory_projection_failed','frame_build');
      }
    }
    // P2/D03 source validation must occur before composing the first provider body.
    // Per-attempt HTTP admission still independently revalidates and fences sends.
    try{await turn.knowledgeDelivery?.prepareAsync?.();}
    catch(error){
      if(!safeToRebuild(error))throw error;
      await recoverPreRequest('pre_request_stale','initial_preflight');
    }
    turn.knowledgeDelivery?.watch(listener=>services.subscribeKnowledgeInvalidation?.(listener) ?? (()=>{}),error=>controller.abort(error));
    const recordReasoningSuccess=decision=>{
      check();
      turn.knowledgeDelivery?.success(decision,act5Context ? {
        act5Intents: act5Context.intents,
        act5Choices: act5Context.availableChoices,
      } : undefined);
    };
    // ACT5 suggestions are optional; explicit player navigation is separately
    // recognized and reaches the same owner-fenced ACT6 admission pipeline.
    const navigationIntent = isPlayer ? navigationRequestKind(finalInput) : null;
    const navigationStop = isPlayer && isAct6StopRequest(finalInput);
    const act5SuggestionsEnabled = services.act5?.activities?.engine?.config?.act5 === true;
    let act5Context = null;
    if (isPlayer && services.act5 && valid() &&
        (act5SuggestionsEnabled || navigationIntent || navigationStop)) {
      try {
        act5Context = await services.act5.prepare(turn, source);
        check();
        if (act5Context) {
          const reply = await services.act5.onPlayerInput(turn, finalInput, act5Context, valid);
          check();
          if (reply) {
            turn.act5Reply = reply;
            act5Context = Object.freeze({ ...act5Context, intents: Object.freeze([]), pendingIntent: null });
          }
        }
      } catch {
        if (navigationIntent) metrics?.event('act6_player_direct_context_failed', {intent:navigationIntent,code:'context_exception'});
        act5Context = null;
      }
    }
    // Only the currently authenticated native owner may describe an ACT6 drive.
    if (isPlayer && !act6OwnsDrive && act5Context?.owner) {
      act6OwnsDrive=liveAct6Driving(services.act5?.activities,act5Context.owner);
    }
    // An explicit navigation order must NEVER silently fall into Essential's
    // free-driving DO path when admission or optional context is unavailable.
    if (navigationIntent && !turn.act5Reply) {
      const reason = act5Context ? 'destination_unresolved' :
        services.act5 ? (services.act5.navigationReadiness(navigationIntent) || 'owner_unavailable') :
          'native_unavailable';
      turn.act5Reply=Object.freeze({kind:'unavailable',intent:navigationIntent,reason});
      metrics?.event('act6_player_direct_unavailable',{intent:navigationIntent,code:reason});
      if (act5Context) act5Context=Object.freeze({...act5Context,intents:Object.freeze([]),pendingIntent:null});
    }
    let decision;
    let streamedSegments = [];
    const spokenTtsSegments = []; // exact accepted speech-provider source strings
    let streamMode = null;
    let earlyAudio = null;
    let bufferedLunaHint=null;
    const lunaDeliveryVersion=services.config.expressiveDelivery?.mode==='experimental'
      ?services.config.expressiveDelivery.lunaDeliveryVersion??0:0;
    if (services.config.structuredStreamingEnabled === true) {
      // ACT5 decisions can carry an activity only at EOF; hold ALL candidate
      // speech until the final schema and authorization have been verified.
      const allowEarlyTts = services.config.earlyTtsEnabled === true && !act5Context;
      const modelOptions = ({ signal, timeoutMs, telemetry, dialogueAttempt }) => services.providerStack.decideStreaming({
        identity, context: reasoningContext(), source,knowledgeProjection:turn.knowledgeProjection,knowledgeDelivery:turn.knowledgeDelivery,
        input: isPlayer ? finalInput : '', history: priorHistory, signal, timeoutMs, telemetry, dialogueAttempt,
        lunaDeliveryVersion,
        activityContext: act5Context,
      });
      if (!allowEarlyTts) {
        const result = await performProvider('model', services.providerStack.reasoning.id, modelOptions);
        decision = result.decision;
        streamMode = result.mode;
        if(result.segments?.length===1)bufferedLunaHint=result.segments[0].delivery??null;
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
            // The ledger counts the PCM this runner really handed to native for
            // this segment and later compares it to the provider's own total.
            let ledgerSegment = null;
            // The structured decoder publishes 1-based ordinals; WS-5a's
            // private speech-delivery ledger requires consecutive 0-based indices.
            // Keep external segment identities and telemetry unchanged.
            const ledgerIndex = Number.isSafeInteger(segment.sequence) && segment.sequence > 0
              ? segment.sequence - 1 : null; // invalid ordinals fail closed in the ledger
            try { ledgerSegment = speech?.beginSegment({ sequence: ledgerIndex, text: segment.text }) ?? null; } catch { ledgerSegment = null; }
            const delivery=expressiveDelivery.forSegment({text:segment.text,sequence:segment.sequence,lunaHint:segment.delivery});
            try { reaction?.delivery(delivery?.value); } catch { /* cosmetic only */ }
            let audio;
            try {
              audio = await performProvider('tts', services.providerStack.speech.id,
                ({ signal, timeoutMs, telemetry, isActive: active }) => services.speak({
                  identity, dialogue: segment.text, ...(delivery?{delivery}:{}), speechProfile: turn.speechProfile, signal, timeoutMs, telemetry,
                  playbackStartedAt:()=>nativePlaybackStartedAt,
                  onPcm: chunk => forwardPcm(chunk, active).then(() => { try { ledgerSegment?.forwarded(chunk.byteLength); } catch {} }),
                }), canRetryTts);
              if (!audio?.bytes) throw new Error('empty_segment_audio');
              if (audio.discardedTrailingByte) throw Object.assign(new Error('partial_pcm16_sample'), { code: 'partial_pcm16_sample' });
              if(delivery)renderedDeliveries.push({delivery,providerResult:audio});
            } catch (error) {
              try { ledgerSegment?.failed(); } catch {}
              throw error;
            }
            bytes += audio.bytes;
            chunks += audio.chunks || 0;
            spokenTtsSegments.push(segment.text);
            try { ledgerSegment?.completed(audio.bytes); } catch {}
            metrics?.event('stream_tts_segment_finished', { segmentSequence: segment.sequence, bytes: audio.bytes, chunks: audio.chunks || 0 });
          }
          return { bytes, chunks, discardedTrailingByte: false };
        })();
        speechTask.catch(error => {
          if (!modelFailed && !controller.signal.aborted && !retired && host.isCurrent(identity)) {
            chooseTerminal('tts_error');
            if(nativeHandoffStarted||authorizationRequested)controller.abort(error);
          }
        });
        const modelTask = performProvider('model', services.providerStack.reasoning.id,
          ({ signal, timeoutMs, telemetry, isActive, dialogueAttempt }) => services.providerStack.decideStreaming({
            identity, context: reasoningContext(), source,knowledgeProjection:turn.knowledgeProjection,knowledgeDelivery:turn.knowledgeDelivery,
            input: isPlayer ? finalInput : '', history: priorHistory, signal, timeoutMs, telemetry, dialogueAttempt,
             lunaDeliveryVersion, activityContext: act5Context,
            onSegment: async (segment, mode) => {
              if (!isActive()) throw new Error('provider_attempt_inactive');
              check();
              if (!mode) throw new Error('stream_mode_missing_before_segment');
              if (streamMode && streamMode !== mode) throw new Error('stream_mode_changed');
              streamMode = mode;
              if (turn.directorTicket || source === 'scene_director')
                assertDirectorSpeechDecision({command:''}, {source,directorTicket:turn.directorTicket,streamMode:mode});
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
          if(result.segments?.length===1)bufferedLunaHint=result.segments[0].delivery??null;
          recordReasoningSuccess(decision);
          closeQueue();
          // A final command is invalid in dialogue_only mode (also checked by the
          // strict decoder); the normal stock validator remains the action gate.
          earlyAudio = await speechTask;
        } catch (error) {
          modelFailed = true;
          chooseTerminal(terminalForError(error, 'model_running'));
          if ((nativeHandoffStarted||authorizationRequested) && !controller.signal.aborted) controller.abort(error);
          cancelQueue(error);
          await Promise.allSettled([speechTask]);
          throw error;
        }
      }
    } else {
      decision = await performProvider('model', services.providerStack?.reasoning.id || 'openai.reasoning',
        ({ signal, timeoutMs, telemetry, dialogueAttempt }) => services.decide({ identity, context: reasoningContext(), source,knowledgeProjection:turn.knowledgeProjection,knowledgeDelivery:turn.knowledgeDelivery,
          input: isPlayer ? finalInput : '', history: priorHistory, signal, timeoutMs, telemetry, dialogueAttempt, activityContext: act5Context }));
    }
    // Validate the PS6 passive-speech restriction before the stock action
    // validator or output_transcript, which can synchronously dispatch effects.
    assertDirectorSpeechDecision(decision,{source,directorTicket:turn.directorTicket,streamMode});
    // Closed player-intent reconciliation after Luna but BEFORE stock validation
    // and publication. No model reference can override native ACT3 seat resolution.
    if (isPlayer && seatRequest && turn.act5Reply?.intent==='board_vehicle') {
      const modelCommandKind=vehicleSeatModelCommandKind(decision.command);
      const reconciled=reconcileVehicleSeatDecision(decision,seatRequest,turn.act5Reply,
        {nativeHandoffStarted});
      decision=reconciled.decision;
      metrics?.event('vehicle_seat_reconciled',{seat:seatRequest.slots.seat,
        accepted:reconciled.accepted,code:reconciled.reason,modelCommandKind});
    }
    if (isPlayer && ['go_to_place','vehicle_trip','move_to_and_hold'].includes(turn.act5Reply?.intent)) {
      const corrected=reconcileAct6Decision(decision,turn.act5Reply,{nativeHandoffStarted});
      if (corrected.suppressed) {
        decision=corrected.decision;
        metrics?.event('act6_player_direct_model_conflict',{intent:turn.act5Reply.intent,code:'stock_command_suppressed'});
      }
    }
    if (isPlayer && (vehicleIntent || act6OwnsDrive)) {
      const guarded = reconcileDrivingDecision(decision,{kind:vehicleIntent,act6OwnsDrive});
      if (guarded.blocked) {
        // In early audio mode speech can already be out; never alter its
        // accepted words after handoff. No competing command is published.
        if (nativeHandoffStarted) throw Object.assign(new TypeError('Vehicle command conflicts with player intent or ACT6 ownership.'),{code:'vehicle_command_conflict'});
        decision=guarded.decision;
        metrics?.event('vehicle_command_reconciled',{vehicleReason:guarded.blocked,vehicleKind:vehicleIntent});
      }
    }
    recordReasoningSuccess(decision);
    check();
    transition('decision_validation');
    const validateSpan = metrics?.startSpan('decision_validation');
    let validated;
    try {
      if (turn.act5Reply?.kind === 'approval_pending' && decision.command)
        throw new TypeError('ACT5 confirmation cannot run a parallel stock DO command.');
      if (['go_to_place','vehicle_trip','move_to_and_hold'].includes(turn.act5Reply?.intent) && decision.command)
        throw new TypeError('ACT6 navigation must never fall back to stock free-driving DO.');
      if (act5Context) {
        const {validateAct5Choice} = await import('../activities/act5Dialogue.mjs');
        if (!Object.hasOwn(decision, 'activity') ||
            !validateAct5Choice(decision.activity, act5Context.intents, act5Context.availableChoices) ||
            (decision.activity !== null && (decision.command || streamMode && streamMode !== 'buffered_action')))
          throw new TypeError('ACT5 decision rejected before stock publication.');
      } else if (Object.hasOwn(decision, 'activity')) {
        throw new TypeError('Unsolicited ACT5 activity field.');
      }
      // Stock Essential knows exactly the legacy {dialogue,command} shape.
      validated = await host.validateDecision(act5Context
        ? {dialogue:decision.dialogue, command:decision.command} : decision, context, identity);
      validateSpan?.('finished');
    } catch (error) {
      validateSpan?.('failed', { code: 'invalid_decision' });
      metrics?.event('decision_rejected', { reason: 'invalid_decision' });
      throw error;
    }
    check();
    if (validated.identityValid !== true || !validated.internalTranscript) throw new Error('decision_rejected');
    transition('decision_validated');
    try { speech?.planned(decision.dialogue); } catch { /* evidence only */ }
    metrics?.event('decision_validated', { inputChars: String(decision.dialogue || '').length, attempts: validated.actionCount || 0, outcome: validated.actionCount ? 'accepted' : 'normal' });
    dialogueTurn?.decision({ dialogue: decision.dialogue, command: decision.command, internalTranscript: validated.internalTranscript });
    try { reaction?.validated({ dialogue: decision.dialogue, command: decision.command, actionCount: validated.actionCount }); }
    catch { /* cosmetic only */ }
    history.stage({ identity, spokenReply: decision.dialogue,
      // Only the current Director + P2 owner may seal spontaneous playback for
      // later conversational context. The history commits it after native ACK.
      socialProof:source==='special_event'&&turn.directorTicket?.decisionKey?.startsWith('social:')
        ?services.socialPlaybackProof?.(turn)??null:null });
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
    outputTranscriptAttempted = true;
    await emit({ type: 'output_transcript', text: validated.internalTranscript });
    outputTranscriptPublished = true;
    stockActionPublished = hasAction;
    // Publication is not the Essential handler ACK and not evidence of motion.
    if (stockDrivingCommand(decision.command)) metrics?.event('vehicle_stock_command_published',{
      actionName:stockDrivingCommand(decision.command),verification:'unverified'});
    check();
    if (turn.act5Reply?.kind === 'approval_pending') {
      const accepted = await services.act5?.commitApproved(turn, valid);
      check();
      if (seatRequest && turn.act5Reply.intent==='board_vehicle')
        metrics?.event('vehicle_seat_admission',{seat:seatRequest.slots.seat,
          accepted:accepted?.ok===true,code:accepted?.reason|| (accepted?.ok?'activity_accepted':'admission_rejected')});
      if (!accepted?.ok) throw Object.assign(new Error('act5_confirmation_not_admitted'),{
        code:accepted?.reason||'act5_confirmation_not_admitted'});
      metrics?.event('act5_goal_accepted', { outcome:'accepted' });
    }
    transition('tts_running');
    let audio = earlyAudio?.bytes > 0 ? earlyAudio : null;
    const successfulEarlySpeech = !!audio && spokenTtsSegments.length>0;
    let bufferedSegment = null;
    if (!audio) {
       const delivery=expressiveDelivery.forSegment({text:decision.dialogue,sequence:1,lunaHint:bufferedLunaHint});
      try { reaction?.delivery(delivery?.value); } catch { /* cosmetic only */ }
      try { bufferedSegment = speech?.beginSegment({ sequence: 0, text: decision.dialogue }) ?? null; } catch { bufferedSegment = null; }
      try {
        audio = await performProvider('tts', services.providerStack?.speech.id || 'openai.speech',
          ({ signal, timeoutMs, telemetry, isActive }) => services.speak({
            identity, dialogue: decision.dialogue, ...(delivery?{delivery}:{}), speechProfile: turn.speechProfile, signal, timeoutMs, telemetry,
             playbackStartedAt:()=>nativePlaybackStartedAt,
            onPcm: chunk => forwardPcm(chunk, isActive).then(() => { try { bufferedSegment?.forwarded(chunk.byteLength); } catch {} }),
          }), () => !hasAction && canRetryTts());
        if(audio?.bytes&&delivery)renderedDeliveries.push({delivery,providerResult:audio});
      } catch (error) {
        try { bufferedSegment?.failed(); } catch {}
        throw error;
      }
    }
    check();
    if (!authorizationRequested || !audio?.bytes || !pcmBytesTotal) throw new Error('empty_audio');
    if (!successfulEarlySpeech) {
      try { bufferedSegment?.completed(audio.bytes); } catch { /* evidence only */ }
    }
    history.markModelAndTtsSucceeded(identity);
    await emit({ type: 'generation_complete' });
    check();
    endSent = true;
    transition('stream_end');
    metrics?.count('streamEndCount');
    await emit({ type: 'turn_complete' });
    try { speech?.finalized(); } catch { /* evidence only */ }
    metrics?.event('native_stream_end_handoff', { accepted: true, bytes: pcmBytesTotal, chunks: pcmChunksTotal });
    providerWorkDone?.('finished');

    // The provider deadline ends once native stream completion has been sent. From
    // this point only a bounded failure watchdog remains; it never implies success.
    clearTimeout(providerTimer);
    providerTimer = null;
    transition('playback_completion');
    const sealedAt = performance.now();
    const policy = playbackCompletionPolicy({
      pcmBytes: pcmBytesTotal, nativeStartedAt: nativePlaybackStartedAt, sealedAt,
      minimumMs: services.config.playbackCompletionMinMs ?? 10_000,
      maximumMs: services.config.playbackCompletionMaxMs ?? 600_000,
      graceMs: services.config.playbackCompletionGraceMs ?? 12_000,
    });
    const {expectedDurationMs, watchdogMs} = policy;
    metrics?.event('playback_watchdog_armed', {
      expectedDurationMs, watchdogMs,
      durationMs: policy.estimatedRemainingMs,
      playbackStarted: nativePlaybackStartedAt !== null,
    });
    // A clip exceeding the configured safety cap is observable rather than
    // silently misrepresented as a native completion receipt.
    if (policy.durationCapped) metrics?.event('native_playback_recovery', {
      reason: 'duration_cap', outcome: 'unknown', expectedDurationMs, watchdogMs,
    });
    const result = await observation.completion(watchdogMs);
    if (!result.ok || (controller.signal.aborted && terminalReason !== 'completed')) {
      if (result.reason === 'native_ack_timeout' || !result.type) {
        // Read-only reconciliation: the v3 native protocol does not expose a
        // queue-depth or drain-state query. Never synthesize a success ACK.
        let snapshot = null;
        try { snapshot = host.inspectNativePlayback?.(identity) ?? null; }
        catch { /* A diagnostic probe must never prevent exact-turn recovery. */ }
        metrics?.event('playback_watchdog_fired', {
          watchdogMs, reason: 'native_ack_timeout', outcome: 'unknown',
          expectedDurationMs, pcmBytes: pcmBytesTotal, chunks: pcmChunksTotal,
          playbackStarted: nativePlaybackStartedAt !== null,
        });
        metrics?.event('native_playback_recovery', {
          reason: snapshot?.endpointReady === false ? 'native_transport_unavailable' : 'native_ack_timeout',
          outcome: 'unknown', accepted: snapshot?.turnCurrent === true,
          playbackStarted: snapshot?.playbackStarted === true,
          durationMs: performance.now() - sealedAt,
        });
      }
      if (result.reason === 'native_ack_timeout' || !result.type) chooseTerminal('playback_ack_timeout');
      else chooseTerminal(terminalForNativeEvent(result));
      throw new Error(terminalReason || 'playback_error');
    }
    chooseTerminal('completed');
    if (!history.acceptPlaybackResult({ ...result, playbackSucceeded: true })) throw new Error('history_commit_rejected');
    playbackCommitted=true;
    // An audible invitation is recorded only after exact native playback success,
    // not merely after TTS or transcript publication. No physical command here.
    if (act5Context && decision.activity && !turn.act5Reply) {
      try {
        const published = await services.act5?.publish(turn, decision, act5Context, valid);
        metrics?.event(published ? 'act5_proposal_published' : 'act5_proposal_not_published',
          { intent: decision.activity.intent, reason: published ? 'completed_audio' : 'source_unavailable' });
      } catch { metrics?.event('act5_proposal_not_published', {reason:'source_unavailable'}); }
    }
    try { speech?.historyAccepted(result); } catch { /* evidence only */ }
    for(const {delivery,providerResult} of renderedDeliveries)expressiveDelivery.synthesized(delivery,result,providerResult);
    expressiveDelivery.complete(result,{historyAccepted:true});
    // Only a native terminal receipt that RAM history also admitted, with every
    // PCM chunk counted by the ledger, can classify the line `completed`. D03
    // reads that evidence itself: nothing here supplies text or a status.
    await recordNpcOutcome();
    metrics?.count('assistantCommitCount');
    metrics?.event('assistant_history_committed', { outputChars: String(decision.dialogue || '').length, playbackEndedCount: 1 });
    dialogueTurn?.finish({ reason: 'completed', stage: 'completed', assistantCommitted: true, assistantDiscarded: false });
    notifyVoice('terminal', identity, 'completed');
    transition('completed');
    host.log?.(identity, 'terminal', { source, reason: 'completed', stage: state, cause: null });
    metrics?.finish({ reason: 'completed', stage: state, pcmBytes: pcmBytesTotal, audioDurationMs: expectedDurationMs, traceComplete: true, assistantCommitted: true });
    return { status: 'completed', terminalReason: 'completed', audioBytes: pcmBytesTotal, discardedTrailingByte: audio.discardedTrailingByte };
  } catch (originalError) {
    const stageAtFailure = state;
    let error=originalError;
    // Never retry an already-played stream, reuse an occupied native turn, or
    // resurrect an explicitly aborted/cancelled microphone conversation.
    try {
      const result=await tryLocalFallback(originalError,stageAtFailure);
      if(result)return result;
    }catch(fallbackError){error=fallbackError;}
    turn.knowledgeDelivery?.finish();
    providerWorkDone?.('failed', { code: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'provider_work_failed' });
    if (!terminalReason) chooseTerminal(controller.signal.aborted ? terminalForAbort(controller.signal) : terminalForError(error, state));
    try { speech?.terminal(terminalReason); } catch { /* evidence only */ }
    notifyVoice('terminal', identity, terminalReason);
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
    let cleanupAccepted = false;
    try { cleanupAccepted = await host.failTurn(identity, Object.assign(new Error(terminalReason), { code: cause?.code || terminalReason }), { source, reason: terminalReason, stage: state, cause }) === true; }
    catch { /* Keep the original terminal cause if native cleanup itself fails. */ }
    if (stageAtFailure === 'playback_completion') metrics?.event('native_playback_retirement_requested', {
      accepted: cleanupAccepted, reason: terminalReason, outcome: cleanupAccepted ? 'accepted' : 'unknown',
      playbackStarted: nativePlaybackStartedAt !== null,
    });
    // Provider/segment/TTS failure can end before a Core playback callback.
    // Fail only its native-bound Director waiter instead of waiting 120 s.
    if (turn.directorTicket) {
      try { host.failDirectorTurn?.(turn.directorTicket,identity); }
      catch { /* Failure notification never grants playback. */ }
    }
    // Interrupted / failed speech. The turn is already over for native; the D03
    // write below needs the lease that finally{} revokes, so it is awaited here.
    await recordNpcOutcome();
    if (terminalReason === 'provider_timeout') state = 'deadline';
    else if (terminalReason === 'cancelled' || terminalReason === 'superseded' || terminalReason === 'disconnected' || terminalReason === 'playback_interrupted') state = 'cancelled';
    else if (terminalReason === 'playback_ack_timeout') state = 'ack_timeout';
    else state = 'failed';
    transition(state);
    metrics?.finish({ reason: terminalReason, stage: stageAtFailure, cause, assistantCommitted: false });
    return { status: state, terminalReason, stage: state, cause };
  } finally {
    expressiveDelivery.retire(playbackCommitted);
    retired = true;
    // Any awaited D03 write has settled by now; drop the receipt and lease.
    try { acceptance?.release(); } catch {}
    try{turn.m2Capture?.retire();}catch{}
    try { speech?.release(); } catch {}
    try { reaction?.release(); } catch {}
    history.discard(identity);
    observation?.dispose();
    turn.knowledgeDelivery?.dispose();
    clearTimeout(providerTimer);
    controller.signal.removeEventListener('abort', abortListener);
    connection.detachAbort(identity, controller);
  }
}
