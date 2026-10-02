export const EVENT_NAMES = new Set([
  'run_started','bridge_ready','bridge_disconnected','run_shutdown','turn_bound','turn_stage','phase_started','phase_finished','phase_failed','pcm_first_forwarded','voice_profile_assigned','speech_provider_selected',
  'input_ready','capture_started','capture_stopped','mic_chunk','input_overflow','provider_request_started',
  'provider_headers','provider_first_byte','provider_request_finished','provider_request_failed','model_usage',
  'model_first_content_delta','stream_segment_validated','stream_tts_segment_started','stream_tts_segment_finished',
  'decision_validated','decision_rejected','pcm_first_ready','pcm_delivery_summary','native_authorization_requested',
  'native_authorization_accepted','native_authorization_rejected','native_playback_started','native_stream_end_handoff',
  'native_playback_ended','provider_deadline_fired','playback_watchdog_armed','playback_watchdog_fired','late_pcm_ignored',
  'provider_selected','provider_attempt_started','provider_attempt_succeeded','provider_retry_scheduled','provider_retry_skipped','provider_retry_exhausted','provider_retry_recovered',
  'player_history_committed','history_duplicate_prevented','assistant_history_staged','assistant_history_committed',
  'assistant_history_discarded','history_trimmed','action_validated','action_dispatch_attempted',
  'action_dispatch_accepted','action_dispatch_rejected','action_dispatch_suppressed','cancellation_requested',
  'supersession_requested','late_event_ignored','turn_terminal_summary','telemetry_records_dropped','telemetry_sink_failed',
  'listener_cleared','listener_replaced','world_unavailable','snapshot_created','target_changed','target_missing','target_invalid','reference_map_revision_changed',
  'identity_resolved','identity_binding_created','identity_binding_retired','identity_conflict','identity_evidence_stale','identity_store_unavailable','persistent_voice_loaded',
]);

const safeKeys = new Set([
  'stage','operation','terminalReason','reason','code','nativeType','nativeReason','errorType','actionName',
  'requestId','model','effort','source','provider','role','outcome','eventType','httpStatus','durationMs',
  'bytes','rawBytes','pcmBytes','wavBytes','bodyReadMs','handoffMs','chunks','sampleRate','channels','inputChars','outputChars','inputTokens',
  'outputTokens','totalTokens','cachedInputTokens','reasoningTokens','audioTokens','audioDurationMs',
  'expectedDurationMs','watchdogMs','queueDepth','dropped','historySize','trimmed','accepted','attempts',
  'streamEndCount','playbackStartedCount','playbackEndedCount','assistantCommitted','playerCommitted',
  'traceComplete','detail','parentPid','nodeVersion','bundleHash','dllHash','durationBucket',
  'pcmChunks','rawTtsBytes','assistantStageCount','assistantCommitCount','assistantDiscardCount',
  'playerDuplicateCount','actionValidatedCount','actionDispatchAttempts','actionDispatchAccepted',
  'actionDispatchRejected','authorizationAcceptedCount','authorizationRejectedCount','authorizationAttempts',
  'credentialAvailable','providerWorkDeadlineMs','playbackCompletionMaxMs',
  'micChunks','droppedTelemetryRecords',
  'listenerState','worldStatus','actorStatus','personReferenceCount','vehicleReferenceCount','referenceCount',
  'segmentSequence','segmentCount','segmentChars',
  'profileId','speechProvider','voice','speed','assignmentVersion','selectionMode','gender','ageBand','matchReason','attempt','attemptId','maxAttempts','retryDelayMs','remainingDeadlineMs',
  'identityKind','bindingRevision','characterRecordRevision',
]);
const safeTokens = new Set([
  'openai','gemini','player_text','player_mic','special_event','system','internal','completed','failed',
  'cancelled','superseded','disconnected','provider_timeout','stt_error','model_error','model_refusal',
  'invalid_decision','tts_error','native_auth_rejected','playback_error','playback_interrupted',
  'playback_ack_timeout','native_ack_timeout','timeout','network_error','invalid_response','missing_credential',
  'transcribing','model_running','decision_validation','decision_validated','tts_running','native_authorization',
  'deterministic-session','character-aware-session','male','female','young','adult','mature','older','senior','character-aware-exact','character-aware-nearest-age','character-aware-compatible','fallback-no-compatible-profile',
  'playback_streaming','stream_end','playback_completion','completed_no_audio','interrupted','rejected',
  'accepted','started','finished','headers','first_byte','stt','model','tts','normal','unknown','other','typed','microphone',
  'attempt_limit','side_effect_started','retry_after_above_max','insufficient_deadline','disabled','permanent_provider_error','unknown_rate_limit','unknown_error','non_retryable_provider_error','http_408','http_502','http_503','http_504','rate_limit_error','rate_limit_exceeded','slow_down','attempt_timeout','econnreset','epipe','etimedout','und_err_socket','und_err_connect_timeout','und_err_headers_timeout','timeout_before_effect','connection_reset','connection_closed','temporary_network_failure','server_error','api_error','internal_server_error','service_unavailable_error',
  'present','explicitly_cleared','omitted','available','unavailable','already_unavailable','known','changed','cleared','replaced','target_changed','target_missing','target_invalid','reference_map_revision_changed','missing_or_unknown',
  'persistent','ephemeral','conflict','owner_verified','no_evidence','invalid_evidence','contradictory_claim','incarnation_mismatch','character_already_active','native_stale','actor_mismatch','owner_retired','stale_evidence','binding_limit','store_unavailable','evidence_unavailable','voice_incompatible','session_closed','persistent-character',
]);

function safeScalar(key, value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) < 1e15 ? value : null;
  if (typeof value !== 'string' || !safeKeys.has(key)) return undefined;
  const token = value.trim();
  if (safeTokens.has(token.toLowerCase())) return token.toLowerCase();
  if (key === 'code' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(token)) return token;
  if (['nativeReason','nativeType','errorType','actionName','stage','operation'].includes(key) && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(token)) return token;
  if (key === 'requestId' && /^rid_[a-f0-9]{16}$/.test(token)) return token;
  if (key === 'model' && /^(gpt|whisper|tts)[-_][A-Za-z0-9._-]{1,80}$/i.test(token)) return token;
  if (['bundleHash','dllHash'].includes(key) && /^[a-f0-9]{64}$/i.test(token)) return token.toLowerCase();
  if (key === 'nodeVersion' && /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(token)) return token;
  if (key === 'profileId' && /^vp_[a-f0-9]{20}$/.test(token)) return token;
  if (key === 'voice' && /^[a-z][a-z0-9_-]{0,31}$/.test(token)) return token;
  if (key === 'speechProvider' && /^[a-z][a-z0-9._-]{0,63}$/.test(token)) return token;
  if (key === 'provider' && /^openai\.(reasoning|transcription|speech)$/.test(token)) return token;
  if (key === 'attemptId' && /^(stt|model|tts):[12]$/.test(token)) return token;
  return undefined;
}

export function sanitizeTelemetryData(input = {}) {
  const output = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output;
  for (const [key, value] of Object.entries(input)) {
    if (!safeKeys.has(key)) continue;
    const safe = safeScalar(key, value);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

export function isSafeNativeIdentity(identity) {
  if (!identity || typeof identity !== 'object') return false;
  const { pedId, turnId, generationId, sessionNonce } = identity;
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(value);
  return id(pedId) && id(turnId) && Number.isSafeInteger(generationId) && generationId >= 0 && Number.isSafeInteger(sessionNonce) && sessionNonce >= 0;
}

export function createTelemetryRecord({ sequence, runId, originMs, event, identity, source, provider = 'openai', data = {}, now = performance.now(), utc = new Date().toISOString() }) {
  if (!EVENT_NAMES.has(event)) throw new TypeError('Unknown telemetry event.');
  const record = { schemaVersion: 1, timestamp: utc, runId, sequence, elapsedMs: Math.max(0, now - originMs), event, provider };
  if (isSafeNativeIdentity(identity)) record.identity = { pedId: identity.pedId, turnId: identity.turnId, generationId: identity.generationId, sessionNonce: identity.sessionNonce };
  if (['player_text','player_mic','special_event','system','internal'].includes(source)) record.source = source;
  record.data = sanitizeTelemetryData(data);
  return record;
}
