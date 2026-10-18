import { REASON_CODES } from '../activities/contracts.mjs';
import { isReactionName } from '../reactions/reactionCatalog.mjs';

export const EVENT_NAMES = new Set([
  'run_started','bridge_ready','bridge_disconnected','run_shutdown','turn_bound','turn_stage','mic_input_captured','stt_completed','memory_bypass','memory_fallback','audio_handoff_started','phase_started','phase_finished','phase_failed','pcm_first_forwarded','voice_profile_assigned','speech_provider_selected',
  'input_ready','capture_started','capture_stopped','mic_chunk','input_overflow','provider_request_started',
  'provider_headers','provider_first_byte','provider_request_finished','provider_request_failed','model_usage',
  'model_first_content_delta','model_command_normalized','stream_segment_validated','stream_segments_reflowed','model_decision_validation_failure','stream_tts_segment_started','stream_tts_segment_finished',
  'decision_validated','decision_rejected','pcm_first_ready','pcm_delivery_summary','elevenlabs_tts_timing_summary','elevenlabs_stream_stage','native_authorization_requested',
  'native_authorization_accepted','native_authorization_rejected','native_playback_started','native_stream_end_handoff',
  'native_playback_ended','provider_deadline_fired','playback_watchdog_armed','playback_watchdog_fired','native_playback_recovery','native_playback_retirement_requested','late_pcm_ignored',
  'provider_selected','provider_attempt_started','provider_attempt_succeeded','provider_retry_scheduled','provider_retry_skipped','provider_retry_exhausted','provider_retry_recovered',
  'player_history_committed','history_duplicate_prevented','assistant_history_staged','assistant_history_committed',
  'assistant_history_discarded','history_trimmed','action_validated','action_dispatch_attempted',
  'action_dispatch_accepted','action_dispatch_rejected','action_dispatch_suppressed','cancellation_requested',
  'supersession_requested','late_event_ignored','turn_terminal_summary','telemetry_records_dropped','telemetry_sink_failed',
  'listener_cleared','listener_replaced','world_unavailable','snapshot_created','target_changed','target_missing','target_invalid','reference_map_revision_changed',
  'identity_resolved','identity_binding_created','identity_binding_retired','identity_conflict','identity_evidence_stale','identity_store_unavailable','persistent_voice_loaded',
  'session_profile_created','character_name_assigned','promotion_started','promotion_completed','promotion_failed','persistent_profile_loaded','character_spawned','character_roster_status','character_dismissed','character_profile_edited','character_memory_created','character_memory_edited','character_memory_deleted','character_unpromoted','character_safe_failure','character_canon_projected','character_reasoning_request_composed',
  'intelligence_status','companion_shadow','knowledge_frame_projected','knowledge_delivery','knowledge_request_stale',
  'intelligence_frame_rejected','director_gate','director_candidate','director_handoff',
  'memory_journal_committed','memory_journal_not_committed',
  'memory_m3_intake_loss','memory_m3_coverage','m9_callback_shadow',
  'reaction_channel_ready','reaction_channel_closed','reaction_channel_mode_mismatch','reaction_ack',
  'reaction_selected','reaction_sent','reaction_dropped',
  'activity_channel_failure','activity_channel_counter','activity_channel_ready','activity_channel_closed',
  'system_health','system_health_manifest','system_health_gap',
  'voice_fallback_requested','voice_fallback_selected','voice_fallback_playback_started',
  'voice_fallback_playback_completed','voice_fallback_playback_failed','voice_fallback_recovery_completed',
  'activity_admitted','activity_rejected','activity_step_started','activity_receipt','activity_paused','activity_resumed','activity_terminal','activity_lease_lost','activity_breaker_tripped',
  'vehicle_request_classified','vehicle_command_reconciled','vehicle_stock_command_published',
  'vehicle_seat_requested','vehicle_seat_reconciled','vehicle_seat_admission',
  'act6_player_direct_recognized','act6_player_direct_readiness','act6_player_direct_staged',
  'act6_player_direct_rejected','act6_player_direct_unavailable','act6_player_direct_context_failed',
  'act6_player_direct_admitted','act6_player_direct_model_conflict',

  'stream_segments_reflowed','model_decision_validation_failure','elevenlabs_tts_timing_summary','perception_trace','radio_trace','native_pcm_forward_failed', // Main/EA allowed vocab preserved alongside Memory K
]);

const safeKeys = new Set([
  'captureObservationCount','capturePairCount','capturePoolBytes','captureMissingSalience','captureRevisionMismatch','captureRetiredRefs','captureBudgetExcluded',
  'acknowledgedObservations','retiredAcknowledgements','knowledgeRequestHash','projectionHash',
  'knowledgeMode','preview','selectedObservations','frameBytes','frameHash',
  'frameType','count','status','rosterState','configuredMode','executionAvailable','nativeExperimental','diagnosticReason','captureMissingReason','captureResetReason',
  'captureAnchorStatus','captureEventFiring','captureEventDeath','captureEventImpact','captureEventInjury','captureEventOther',
  'captureContextOmit','captureContextCandidate','captureContextMustInclude',
  'captureResponseEligible','captureResponseUrgent',
  'perceivedUnsupportedClaims','perceivedRevisionMismatch','perceivedUnmatchedSalience',
  'perceivedBudgetExcluded','perceivedSafetyOverflow',
  'stage','operation','terminalReason','reason','code','nativeType','nativeReason','errorType','actionName','retryable','requestGatePassed',
  'requestId','model','effort','source','provider','role','outcome','eventType','sceneType','httpStatus','durationMs',
  'bytes','rawBytes','pcmBytes','wavBytes','bodyReadMs','handoffMs','chunks','sampleRate','channels','inputChars','outputChars','inputTokens',
  'outputTokens','totalTokens','cachedInputTokens','reasoningTokens','audioTokens','audioDurationMs',
  'expectedDurationMs','watchdogMs','queueDepth','dropped','historySize','trimmed','accepted','attempts',
  'streamEndCount','playbackStartedCount','playbackEndedCount','assistantCommitted','playerCommitted',
  'traceComplete','detail','parentPid','nodeVersion','bundleHash','dllHash','durationBucket',
  'pcmChunks','rawTtsBytes','assistantStageCount','assistantCommitCount','assistantDiscardCount',
  'playerDuplicateCount','actionValidatedCount','actionDispatchAttempts','actionDispatchAccepted',
  'actionDispatchRejected','authorizationAcceptedCount','authorizationRejectedCount','authorizationAttempts',
  'credentialAvailable','providerWorkDeadlineMs','playbackCompletionMaxMs',
  'micChunks','droppedTelemetryRecords','hasPcm','hasTranscript',
  'listenerState','worldStatus','actorStatus','personReferenceCount','vehicleReferenceCount','referenceCount',
  'anchors','queued','retainedSignals','received','stale','malformed','duplicate','gaps','expired','resets',
  'historyExpired','historyEvicted','historySkipped','historyHighWater','dropAnchorCapacity','dropObserverCapacity',
  'resetInitializations','resetDisconnects','resetFaults','resetTimeouts','resetManual',
  'nativeDropped','nativeStaleRejected','pedDamageCallbacks','playerDamageCallbacks','vehicleDamageCallbacks','finalSnapshot',
  'ps2Correlated','ps2Witnessed','ps2Duplicates','ps2Dropped','ps3Decisions','ps3Urgent','ps3Eligible','ps3Staged','ps3Suppressed','ps3Faults',
  'ps3ReasonSafetySelfDanger','ps3ReasonSafetyPlayerHarm','ps3ReasonSafetyNearbyThreat','ps3ReasonRepetitionSuppressed','ps3ReasonRevisionStale','ps3ReasonNoveltyEscalation','ps3ReasonSuppressionCapacity','radioUnknownTextIds','radioCatalogMismatches',
  'segmentSequence','segmentCount','segmentChars',
  'profileId','speechProvider','voice','speed','assignmentVersion','selectionMode','gender','ageBand','matchReason','attempt','attemptId','maxAttempts','retryDelayMs','remainingDeadlineMs',
  'identityKind','bindingRevision','characterRecordRevision',
  'profileRevision','profileCount','collisionCount','canonHash','systemPromptHash','runtimePromptHash','finalReasoningRequestHash',
  'traitsIncluded','memoryCount','biographyIncluded','relationshipIncluded','generatedPersonaPolicy',
  'truncatedFields','truncatedFieldCount','droppedMemoryCount',
  'activityId','executionId','goalId','commandId','clientRun','nativeRun','adapterEpoch','hostRunId','worldEpoch',
  'systemId','healthState','proofLevel','evidenceEvent','manifestHash','category','originalFailure',
  'companionMode','nativeMode','reaction',
  'intent','capability','receiptState','stepIndex','delivery',
  'act5Suggestions','nativeAdvertised','missingProbeCount','destinationKind',
  'vehicleKind','vehicleReason','verification','seat','modelCommandKind',

  'reflowedSegments','originalSegments','firstPcmMs','wallMs','generatedChunks','forwardedChunks','modelId','maxSegmentChars','maxDialogueChars','responseChars','playbackBufferMode','receivedChunks','generationDurationMs','forwardDurationMs','maxChunkGapMs','p95ChunkGapMs','slowChunkCount','forwardWaitMaxMs','underRealtime','streamRate','bufferedBytes','underrunRiskCount','fallbackUsed','captureEventRadio','selectedRadio','radioQuestion','traceCode','signalKind','producer','catalog','receipts','selfReceipts','qualified','ownedQualified','ownedObservers','ps2','ps2Reason','observations','ownedObservations','ps3Owned','ps3Reason','urgency','ps2OwnedWitnessed','ps2DedupeEvicted','ps2DropInvalidInput','ps2DropRadioIdentityMismatch','ps2DropUnsupportedEvent','ps2DropEpisodeClaimCapacity','ps2DropEpisodeRejected','ps2DropObservationClaimCapacity','ps2DropObservationRejected','ps3OwnedDecisions','ps3OwnedEligible','ps3OwnedUrgent','radioChanged','radioStopped','radioKnown','radioUnknown','radioMismatch','radioOff','radioObservations','radioOwnedObservations','nativeRadioSamples','nativeRadioEdges','nativeRadioFailures','nativeRadioWitnessed','nativeRadioWitnessUnknown','nativeWitnessDeferred','nativeWitnessUnknown','nativeWitnessRejected','ownerStalls','ownerStallMaxMs','traceEmitted','traceSuppressed', // Main/EA allowed vocab preserved alongside Memory K
  // Bounded PS2/PS3/PS6 correlation diagnostics (closed vocabularies below).
  'captureEventRadio','selectedRadio','radioQuestion',
  'traceCode','signalKind','producer','catalog','receipts','selfReceipts','qualified','ownedQualified','ownedObservers',
  'ps2','ps2Reason','observations','ownedObservations','ps3Owned','ps3Reason','urgency',
  'ps2OwnedWitnessed','ps2DedupeEvicted','ps2DropInvalidInput','ps2DropRadioIdentityMismatch','ps2DropUnsupportedEvent',
  'ps2DropEpisodeClaimCapacity','ps2DropEpisodeRejected','ps2DropObservationClaimCapacity','ps2DropObservationRejected',
  'ps3OwnedDecisions','ps3OwnedEligible','ps3OwnedUrgent',
  'ps3OwnedAmbientWitness','ps3OwnedLowRelevance','ps3OwnedRepetitionSuppressed',
  'ps3OwnedCharacterPresent','ps3OwnedCharacterPresentEligible',
  'ps3OwnedLocationChanged','ps3OwnedLocationChangedEligible',
  'ps3OwnedActivityChanged','ps3OwnedActivityChangedEligible',
  'ps3OwnedVehicleTransition','ps3OwnedVehicleTransitionEligible',
  'radioChanged','radioStopped','radioKnown','radioUnknown','radioMismatch','radioOff','radioObservations','radioOwnedObservations',
  'nativeRadioSamples','nativeRadioEdges','nativeRadioFailures','nativeRadioWitnessed','nativeRadioWitnessUnknown',
  'nativeWitnessDeferred','nativeWitnessUnknown','nativeWitnessRejected',
  'ownerStalls','ownerStallMaxMs','traceEmitted','traceSuppressed',
  'chunkBytes','forwardedBytes','playbackStarted',
]);
// Per-key closed vocabularies for the correlation diagnostics. Anything else
// is dropped by the sanitizer, so no actor, ref, transcript or content leaks.
const closedValues = new Map([
  ['rosterState', new Set(['active','empty','unavailable'])],
  ['signalKind', new Set(['firing','damage','death','injury_state','vehicle_damage','body_discovered',
    'presence_changed','location_changed','activity_changed','vehicle_transition','radio_changed','radio_stopped'])],
  ['producer', new Set(['shooting','ped_damage','player_damage','vehicle_damage','state','action','playback','radio'])],
  ['catalog', new Set(['known','unknown','mismatch','off','stopped','invalid'])],
  ['ps2', new Set(['accepted','unwitnessed','duplicate','dropped'])],
  ['ps2Reason', new Set(['none','invalid_input','radio_derived_identity_mismatch','unsupported_event','episode_claim_capacity',
    'episode_rejected','unsupported_claim_detail','radio_normalization_failed'])],
  ['ps3Owned', new Set(['urgent','eligible','none','not_evaluated'])],
  ['ps3Reason', new Set(['none','evidence_expired','evidence_lifetime_ended','evidence_channel_unhealthy','evidence_unsupported',
    'evidence_uncertain','revision_stale','repetition_suppressed','suppression_capacity','safety_self_danger','safety_player_harm',
    'safety_nearby_threat','involvement_self','involvement_player','relationship_close','relationship_conflict','prior_memory',
    'novelty_escalation','novelty_material','situation_occupied','situation_conversation','trait_policy','environment_requested',
    'routine_low_relevance','ambient_direct_witness'])],
  ['urgency', new Set(['urgent','routine'])],
  ['sceneType', new Set(['shared_vehicle_entry','reunion','shared_idle','travel','activity_transition','manual','personal_curiosity'])],
  // No free-form dialogue, actor identifiers or arbitrary model commands in vehicle telemetry.
  ['vehicleKind', new Set(['continue','speed_up','slow_down','evasive','normal','start','stop'])],
  ['seat', new Set(['driver','passenger','rear','any_passenger'])],
  ['modelCommandKind', new Set(['none','placeholder','reference_shaped','other'])],
  ['vehicleReason', new Set(['act6_owns_drive','continuation_must_not_reset_task',
    'speed_up_requires_essential_faster_mode','slow_down_requires_normal_mode',
    'stop_must_not_switch_driving_mode','start_must_not_be_evasive',
    'normal_must_not_be_evasive'])],
  ['verification', new Set(['unverified'])],
  ['destinationKind', new Set(['waypoint','named','unresolved'])],
]);
const safeTokens = new Set([
  'delivered','expired','ack_key_retired','observation_expired',
  'social','reactive','native_social_unavailable',
  'native_memory_source_timeout','memory_capture_unavailable','memory_receipt_unavailable','memory_capture_timeout','memory_capture_failed','memory_prepare_timeout','memory_prepare_failed','pre_request_stale',
  'memory_stale','recall_stale','opinion_stale','revision_mismatch','unclassified_stale_reason',
  'invalid_json','invalid_order','invalid_contract','sequence_gap','runtime_consistency',
  'firing_burst','vehicle_impact','injury','death_seen','body_found','threat',
  'character_present','location_changed','activity_changed','vehicle_transition',
  'unsupported_director_event','non_13a_event','ps3_entitlement_stale','ps3_response_ineligible',
  'direct_witness_unavailable','ps3_evidence_expired',
  'hello','anchors','retire','retire_batch','observer_index','observer_situation',
  'world_epoch','director_priority','director_response','signal','diagnostics',
  'channel_or_protocol_unavailable','player_anchor_unavailable','no_owned_observer',
  'owner_proof_unavailable','no_ps3_response_candidate','candidate_filtered',
  'dedupe_capacity','player_priority_or_owner_stamp_unavailable','producer_failed',
  'native_owner_stalled','deferred_ticket_already_active','deferred_rate_limited','deferred_scene_or_speaker_cooldown','deferred_ambient_cadence',
  'player_priority_missing','native_director_not_enabled','player_priority_invalid','player_priority_stale','player_priority_host_mismatch','stamp_provider_unavailable',
  'stamp_unavailable','original_ps3_entitlement_unverified',
  'retire','retire_batch','lease_expired','not_tracked','none',
  'reset_initialization','reset_disconnect','reset_fault','reset_timeout','reset_manual',
  'shadow_only','native_opt_in_and_live_c06_required','experimental',
  'reserved','submitted','bound','unsafe','busy','stale','no_candidate','not_admitted',
  'segment_empty_dialogue',
  'no_eligible_evidence','event_context_unavailable','original_ps3_unavailable',
  'native_rejected','stale_after_reserve','stale_before_submit','native_submit_rejected',
  'stale_before_intake','incomplete_intake','tuple_rejected','not_delivered',
  'verified_observer','contract_unavailable','missing','index_missing','lease_expired','not_observer','kind_mismatch',
  'off','shadow','active','unsupported_contract','missing_dialogue_knowledge_contract','native_payload_unavailable','perception_contract_mismatch','dialogue_contract_mismatch','native_observer_index_unavailable','native_observer_situation_unavailable','native_host_context_unavailable','no_actor_capture','no_observer_index','wrong_actor','host_mismatch','world_epoch_changed','channel_unhealthy','anchor_expired','participant_retired','owner_unverified','projection_failed',
  'openai','gemini','player_text','player_mic','special_event','system','internal','completed','failed','npc','player',
  'cancelled','superseded','disconnected','provider_timeout','stt_error','model_error','model_refusal',
  'invalid_decision','tts_error','native_auth_rejected','playback_error','playback_interrupted',
  'playback_ack_timeout','native_ack_timeout','duration_cap','native_transport_unavailable','timeout','network_error','invalid_response','missing_credential',
  'transcribing','model_running','decision_validation','decision_validated','tts_running','native_authorization',
  'deterministic-session','character-aware-session','male','female','young','adult','mature','older','senior','character-aware-exact','character-aware-nearest-age','character-aware-compatible','fallback-no-compatible-profile',
  'playback_streaming','stream_end','playback_completion','completed_no_audio','interrupted','rejected',
  'accepted','started','finished','headers','first_byte','stt','model','tts','normal','unknown','other','typed','microphone',
  'attempt_limit','side_effect_started','retry_after_above_max','insufficient_deadline','disabled','permanent_provider_error','unknown_rate_limit','unknown_error','non_retryable_provider_error','http_408','http_502','http_503','http_504','rate_limit_error','rate_limit_exceeded','slow_down','attempt_timeout','econnreset','epipe','etimedout','und_err_socket','und_err_connect_timeout','und_err_headers_timeout','timeout_before_effect','connection_reset','connection_closed','temporary_network_failure','server_error','api_error','internal_server_error','service_unavailable_error',
  'present','explicitly_cleared','omitted','available','unavailable','already_unavailable','known','changed','cleared','replaced','target_changed','target_missing','target_invalid','reference_map_revision_changed','missing_or_unknown',
  'persistent','ephemeral','conflict','owner_verified','no_evidence','invalid_evidence','contradictory_claim','incarnation_mismatch','character_already_active','native_stale','actor_mismatch','owner_retired','stale_evidence','binding_limit','store_unavailable','evidence_unavailable','voice_incompatible','session_closed','persistent-character',
  'profile_store_unavailable','promotion_failed','owner_unavailable','scripted_state','ownership_conflict','native_operation_failed','identity_unavailable','unsafe_spawn_location','appearance_unavailable','invalid_ped_model','profile_projection_failed',

  'native_authorization_rejected','chunk_after_end','stale_or_cancelled','provider_attempt_inactive','streaming_pcm_limit','unclassified_pcm_forward_error',
  'native_owner_stalled','deferred_ticket_already_active','deferred_rate_limited','deferred_scene_or_speaker_cooldown','deferred_ambient_cadence','adaptive','complete-utterance','streaming',
  'source_silence','hello_timeout','transport_error','unverified',
  'inventory_build_failed','inventory_write_failed','health_monitor_attach_failed', // OBS2 bounded failure stages; never serialize exception strings.
]);

// Closed PS6 reason vocabulary: preserve diagnostics without arbitrary text.
const safeDirectorReasons = new Set([
  'invalid_or_disabled','invalid_clock','ticket_already_active',
  'decision_already_attempted','rate_limited','scene_or_speaker_cooldown',
  'evidence_expired','source_or_safety_veto','ticket_id_unavailable',
  'reservation_unavailable','original_ps3_entitlement_changed',
  'reservation_recheck_veto','completion_tuple_invalid',
  'native_playback_unverified','completion_safety_veto',
  'ps6_ack_rejected','completion_unclassified',
  'native_reserve_exception','native_submit_exception','stock_dispatch_exception','playback_terminal_exception',
]);
function safeScalar(key, value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) < 1e15 ? value : null;
  if (typeof value !== 'string' || !safeKeys.has(key)) return undefined;
  const token = value.trim();
  if (key === 'traceCode') return /^[0-9a-f]{10}$/.test(token) ? token : undefined;
  if (key === 'systemId') return /^[a-z][A-Za-z0-9_.-]{1,79}$/.test(token) ? token : undefined;
  if (key === 'healthState') return ['initializing','initialized','ready','connected','disconnected',
    'degraded','blocked','verified','stopped','unknown'].includes(token) ? token : undefined;
  if (key === 'proofLevel') return ['none','resource_lifecycle','transport','provider_result',
    'native_terminal','world_strong','durable_write','history_commit','source_event','frame_projected'].includes(token) ? token : undefined;
  if (key === 'evidenceEvent') return EVENT_NAMES.has(token) && token !== 'system_health' ? token : undefined;
  if (key === 'category') return ['misheard','lost_thought','speech_lost',
    'action_unconfirmed','action_succeeded','action_failed'].includes(token) ? token : undefined;
  if (key === 'reaction') return isReactionName(token) ? token : undefined;
  if (key === 'companionMode' || key === 'nativeMode') return ['off','shadow','on'].includes(token) ? token : undefined;
  if (key === 'reason' && REASON_CODES.includes(token)) return token;
  if (closedValues.has(key)) return closedValues.get(key).has(token) ? token : undefined;
  // ACT receipts are a case-sensitive protocol enum. Do not lowercase them
  // just because 'failed' also appears in the generic safe-token vocabulary.
  if (key === 'receiptState') return /^(REQUESTED|VALIDATED|REJECTED|DISPATCHED|HANDLER_ACCEPTED|MODE_ESTABLISHED|FAILED|CANCELLED|SUPERSEDED|TIMED_OUT|DETACHED)$/.test(token) ? token : undefined;
  if (safeTokens.has(token.toLowerCase())) return token.toLowerCase();
  if (['diagnosticReason','reason','terminalReason'].includes(key) &&
      safeDirectorReasons.has(token)) return token;
  if (key === 'code' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(token)) return token;
  // Closed memory-journal refusal codes (d03_*, m2_*, journal_*): never free text.
  if (key === 'reason' && /^(d03|m2|journal|timeline)_[a-z0-9_]{1,80}$/.test(token)) return token;
  if (['nativeReason','nativeType','errorType','actionName','stage','operation'].includes(key) && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(token)) return token;
  if (['activityId','executionId','goalId','commandId','clientRun','nativeRun','adapterEpoch','hostRunId','requestId'].includes(key) &&
      (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token) ||
       key === 'requestId' && /^rid_[a-f0-9]{16}$/.test(token))) return token;
  if (key === 'worldEpoch' && /^\d{1,9}$/.test(token)) return Number(token);
  if (key === 'model' && /^(gpt|whisper|tts)[-_][A-Za-z0-9._-]{1,80}$/i.test(token)) return token;
  if (['manifestHash','bundleHash','dllHash','frameHash','knowledgeRequestHash','projectionHash'].includes(key) && /^[a-f0-9]{64}$/i.test(token)) return token.toLowerCase();
  if (['canonHash','systemPromptHash','runtimePromptHash','finalReasoningRequestHash'].includes(key) && /^[a-f0-9]{64}$/i.test(token)) return token.toLowerCase();
  if (key === 'generatedPersonaPolicy' && ['suppressed','subordinate'].includes(token.toLowerCase())) return token.toLowerCase();
  if (key === 'truncatedFields' && /^(?:name|nicknames|personality\.description|personality\.traits|relationship\.description|biography|memory\.text)(?:,(?:name|nicknames|personality\.description|personality\.traits|relationship\.description|biography|memory\.text))*$/.test(token)) return token;
  if (key === 'nodeVersion' && /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(token)) return token;
  if (key === 'profileId' && /^vp_[a-f0-9]{20}$/.test(token)) return token;
  if (key === 'voice' && /^[a-z][a-z0-9_-]{0,31}$/.test(token)) return token;
  if (key === 'speechProvider' && /^[a-z][a-z0-9._-]{0,63}$/.test(token)) return token;
  if (key === 'provider' && /^openai\.(reasoning|transcription|speech)$/.test(token)) return token;
  if (key === 'attemptId' && /^(stt|model|tts):[12]$/.test(token)) return token;
  if (key === 'intent' && /^(hold_position|accompany|resume_previous|sit_here|scenario_here|scenario_at|move_to_and_hold|approach_and_face|hang_out_with|board_vehicle|ride_along|exit_vehicle_and_hold|leave_scene|take_cover_and_hold|go_to_place|vehicle_trip)$/.test(token)) return token;
  if (key === 'capability' && /^[a-z][a-z0-9_]{2,31}$/.test(token)) return token;
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

export function createTelemetryRecord({ sequence, runId, originMs, event, identity, source, provider = 'openai', data = {}, component, severity, now = performance.now(), utc = new Date().toISOString() }) {
  if (!EVENT_NAMES.has(event)) throw new TypeError('Unknown telemetry event.');
  const record = { schemaVersion: 1, timestamp: utc, runId, sequence, elapsedMs: Math.max(0, now - originMs), event, provider };
  if (['activities','reactions','memory','speech','native','observability'].includes(component)) record.component = component;
  if (['debug','info','warn','error'].includes(severity)) record.severity = severity;
  if (isSafeNativeIdentity(identity)) record.identity = { pedId: identity.pedId, turnId: identity.turnId, generationId: identity.generationId, sessionNonce: identity.sessionNonce };
  if (['player_text','player_mic','special_event','system','internal'].includes(source)) record.source = source;
  record.data = sanitizeTelemetryData(data);
  return record;
}
