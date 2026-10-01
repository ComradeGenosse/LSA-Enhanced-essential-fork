/** Revised declarative E2/E3 plan. Review artifact; not application runtime code. */
export const e23Plan = {
  "schemaVersion": 2,
  "title": "E2 Provider/Voice Abstraction + E3 Stage-Aware Reliability",
  "baseline": {
    "branch": "Essential Hotfix #3 companion",
    "runtime": "E1.1 hardened + observability",
    "testsAtPlanningTime": {
      "claimedPassed": 106,
      "claimedFailed": 0,
      "claimedCancelled": 0,
      "independentlyVerified": false,
      "requirement": "Record the actual baseline command, commit, source-hook fingerprint, and results before edits. Preserve all existing regression tests; do not hard-code 106 as the final expected suite size."
    },
    "assumptions": [
      "E1.1 native lifecycle is already accepted",
      "Essential owns native turn/generation/playback/action truth",
      "PlaybackEnded remains the only successful assistant-delivery boundary",
      "PLAYER_TEXT and PLAYER_MIC are durable player history once accepted",
      "assistant history remains staged until matching native playback success",
      "SPECIAL_EVENT/system input remains non-player context",
      "stock Gemini ownership/audio behavior remains isolated and unchanged",
      "All baseline assumptions are supplied claims until E2P verifies them against the accepted candidate."
    ]
  },
  "preservedOwners": [
    "Essential native identity",
    "Essential native generation allocation",
    "Essential playback authorization",
    "Essential native audio lifecycle",
    "Essential exact interruption",
    "Essential stock action validation/dispatch boundary",
    "Essential GTA/NPC context",
    "Essential NPC state"
  ],
  "doNotRewrite": [
    "nativeDelivery.mjs unless a proven interface adaptation is unavoidable",
    "pedId + turnId + generationId + sessionNonce identity model",
    "PlaybackEnded success boundary",
    "stock Gemini lifecycle",
    "PTT capture/controller ownership",
    "SPECIAL_EVENT source semantics",
    "stock action handler behavior",
    "source-pinned native lifecycle AST hooks",
    "existing E1.1 history semantics"
  ],
  "architecture": {
    "target": "Essential / GTA (native authority)\n    <-> E1.1 lifecycle adapter + existing sequential-turn orchestrator\n          -> E2 provider stack: STT / Reasoning / Speech\n          -> E3 providerExecutor wraps each provider operation once\n          -> VoiceResolver resolves one immutable session speech profile\nOnly E1.1 reads/changes native state, dispatches actions, and commits history.\nE3 receives read-only lifecycle guards; providers receive immutable inputs and guarded callbacks."
  },
  "stages": [
    {
      "id": "E2P",
      "title": "Verify baseline and map real interfaces",
      "dependsOn": [],
      "goal": "Establish the accepted source and real side-effect ordering before changing adapters.",
      "work": [
        "Identify the current companion repository, branch/commit, clean or pre-existing edits, native source fingerprint, and applicable repository instructions.",
        "Run the baseline offline suite and record actual results. Preserve the old/custom LSA 2.1 branch.",
        "Map all planned modules to real files, dependency injection seams, session creation/teardown, and current decision validation.",
        "Trace STT acceptance, player-history acceptance, decision publication, stock action dispatch, native authorization, first PCM handoff, stream completion, PlaybackEnded, cancellation, and terminal cleanup.",
        "Confirm when the current provider-work clock starts; retain its budget semantics and exclude capture/playback waits unless E1.1 already includes them.",
        "Record whether native authorization is a harmless reservation or starts a native effect. Unknown boundaries are treated conservatively as effects.",
        "Inspect request client/SDK retry behavior, response-stream cleanup, attempt timeout behavior, and PCM framing/backpressure.",
        "Record configured reasoning/STT/TTS models, voice, limits, and supported speech capabilities; do not upgrade models as part of abstraction."
      ],
      "checks": [
        "Baseline evidence is recorded and accepted E1.1 regressions pass.",
        "One written lifecycle/side-effect map explains which stages can retry under the current ordering.",
        "Do not proceed past an unverified native interface or failing baseline by changing native ownership."
      ]
    },
    {
      "id": "E2A",
      "title": "Provider contracts and stack",
      "goal": "Move current OpenAI reasoning/STT/TTS behind clean provider interfaces without changing runtime behavior.",
      "dependsOn": [
        "E2P"
      ],
      "addFiles": [
        "src/providers/providerContract.mjs",
        "src/providers/providerStack.mjs",
        "src/providers/openai/reasoningProvider.mjs",
        "src/providers/openai/transcriptionProvider.mjs",
        "src/providers/openai/speechProvider.mjs"
      ],
      "modifyFiles": [
        "src/integration/essentialGlue.mjs",
        "src/openai/decide.mjs",
        "src/openai/transcribe.mjs",
        "src/openai/speak.mjs",
        "src/config/e1Config.mjs",
        "src/observability/telemetry.mjs",
        "src/observability/eventContract.mjs"
      ],
      "work": [
        "Introduce explicit ReasoningProvider contract",
        "Introduce explicit TranscriptionProvider contract",
        "Introduce explicit SpeechProvider contract",
        "Wrap existing OpenAI implementations rather than rewriting their request logic",
        "Create one provider stack during E1 runtime construction",
        "Route runSequentialTurn services through provider stack",
        "Keep config.provider semantics as the top-level E1-vs-stock-Gemini route",
        "Do not force stock Gemini through the new provider interfaces",
        "Keep provider selection explicit and deterministic",
        "Add provider identity to safe telemetry fields",
        "Specify provider capabilities and normalized safe error metadata: category, operation, provider, optional httpStatus, allowlisted errorCode, and parsed Retry-After. Never use raw error messages or bodies as telemetry.",
        "Keep the existing decision validator authoritative for all providers; ValidatedProviderDecision means the same accepted Luna schema and stock action validation, not provider-specific trust.",
        "Define immutable per-operation snapshots, explicit PCM format, callback/backpressure semantics, cancellation cleanup, and input limits. Preserve existing limits or report unsupported input as a terminal error; never silently truncate dialogue.",
        "Providers perform one external request per invocation and own only request/reader cleanup. Native authorization, actions, transcript publication, history mutation, and stream-end remain in the existing orchestrator.",
        "Resolve unsupported provider/model/configuration combinations before turn execution. Leave stock Gemini outside the provider stack."
      ],
      "conceptualInterfaces": {
        "ReasoningProvider": "\ninterface ReasoningProvider {\n  id: string;\n\n  decide({\n    identity,\n    source,\n    inputText,\n    contextText,\n    capabilities,\n    history,\n    signal,\n    telemetry,\n  }): Promise<ValidatedProviderDecision>;\n}\n        ",
        "TranscriptionProvider": "\ninterface TranscriptionProvider {\n  id: string;\n\n  transcribe({\n    identity,\n    pcm,\n    sampleRate,\n    channels,\n    signal,\n    telemetry,\n  }): Promise<{\n    text: string;\n    usage?: object | null;\n  }>;\n}\n        ",
        "SpeechProvider": "\ninterface SpeechProvider {\n  id: string;\n\n  synthesize({\n    identity,\n    dialogue,\n    speechProfile,\n    signal,\n    onPcm,\n    telemetry,\n  }): Promise<{\n    byteLength: number;\n    usage?: object | null;\n  }>;\n}\n        "
      },
      "invariants": [
        "No provider interface owns native generation state",
        "No provider interface dispatches GTA actions directly",
        "No provider interface commits assistant history",
        "No provider interface determines playback success",
        "No provider interface infers current speaker from globals",
        "No fallback to another provider without explicit future policy"
      ],
      "checks": [
        "All existing baseline tests still pass; record new total separately.",
        "OpenAI behavior remains functionally equivalent",
        "stock Gemini path is byte/behavior unchanged where practical",
        "provider IDs appear in telemetry without prompt/dialogue leakage",
        "unknown provider config fails clearly",
        "no provider abstraction leaks secrets into logs"
      ]
    },
    {
      "id": "E2B",
      "title": "Stable session voice profiles",
      "dependsOn": [
        "E2A"
      ],
      "goal": "Assign a stable deterministic speech profile to an NPC native session without pretending E2 has solved long-term character identity.",
      "addFiles": [
        "src/voice/voiceResolver.mjs",
        "src/voice/voiceProfile.mjs"
      ],
      "modifyFiles": [
        "src/integration/openaiConnection.mjs",
        "src/integration/essentialGlue.mjs",
        "src/providers/openai/speechProvider.mjs",
        "src/config/e1Config.mjs",
        "src/observability/telemetry.mjs",
        "src/observability/eventContract.mjs",
        "tools/summarizeRun.mjs"
      ],
      "identityRule": "Voice assignment is scoped to the current native NPC/session identity, not permanent world identity.",
      "preferredVoiceKey": [
        "pedId",
        "sessionNonce"
      ],
      "work": [
        "Create VoiceResolver",
        "Resolve a deterministic voice profile once per native session",
        "Do not use Math.random() for production assignment",
        "Hash stable session identity into configured voice pool",
        "Store/reuse resolved profile on OpenAIConnection/session object",
        "Context refresh must not reroll voice",
        "New native session may resolve to a different profile",
        "Do not persist voice mappings across game sessions yet",
        "Keep future durable-character identity integration possible",
        "Absent speechVoices derives a singleton pool from the existing ttsVoice. An explicit pool must be non-empty, duplicate-free, ordered, and supported by the configured model.",
        "Specify a versioned stable hash over unambiguous canonical pedId/sessionNonce bytes; do not include turnId/generationId/context in the assignment key.",
        "Freeze the resolved provider/model/voice/speed/instructions and pool version for the session. Runtime config changes apply to new sessions only; unsupported old configuration fails clearly rather than silently rerolling.",
        "Destroy voice profile state on the matching session teardown/replacement; a delayed old-session teardown must not clear a new session with a reused ped handle.",
        "Deterministic hashing provides stable distribution, not guaranteed unique voices. Finite voice pools permit collisions."
      ],
      "profileShape": "{\n  profileId: string, // allowlisted preset/config digest; not raw native identity\n  provider: \"openai\",\n  model: string,\n  voice: string,\n  speed: number,\n  instructions: string,\n  assignmentVersion: 1\n}",
      "configAdditions": {
        "speechVoices": null,
        "voiceAssignment": "deterministic-session",
        "ttsSpeed": 1
      },
      "notes": [
        "Actual configured voice pool may contain more supported voices after validation",
        "Do not add custom voice cloning/creation in E2",
        "Do not key permanent identity directly to GTA ped handle",
        "The original singleton nova example would preserve stability but give every NPC the same voice. Validate at least two configured voices to demonstrate the distinct-voice goal."
      ],
      "telemetry": [
        "voice_profile_assigned",
        "speech_provider_selected"
      ],
      "safeTelemetryFields": [
        "profileId",
        "speechProvider",
        "voice",
        "speed"
      ],
      "forbiddenTelemetryFields": [
        "dialogue text",
        "acting instructions",
        "prompt text",
        "transcript"
      ],
      "checks": [
        "same pedId + same sessionNonce resolves same profile",
        "context refresh preserves voice",
        "separate native session can resolve independently",
        "assignment is deterministic in tests",
        "unsupported configured voice fails closed",
        "no durable identity claims are made",
        "Legacy ttsVoice continues to work when speechVoices is absent; no default nova override.",
        "Ped handle reuse and delayed disconnect cannot leak or delete another session profile.",
        "Config/context refresh does not mutate an active session profile.",
        "Multi-voice fixture demonstrates distribution without asserting uniqueness for every NPC."
      ]
    },
    {
      "id": "E2C",
      "title": "Speech acting/style plan",
      "dependsOn": [
        "E2B"
      ],
      "goal": "Improve NPC delivery through bounded speech instructions without changing Luna's current decision schema.",
      "modifyFiles": [
        "src/voice/voiceProfile.mjs",
        "src/voice/voiceResolver.mjs",
        "src/providers/openai/speechProvider.mjs",
        "src/config/e1Config.mjs"
      ],
      "work": [
        "Pass speechProfile into SpeechProvider",
        "Use provider-supported speech instructions where available",
        "Use configured speed where supported",
        "Keep spoken dialogue text exactly the validated Luna dialogue",
        "Require exact validated dialogue at the TTS request boundary; acting instructions express intended word fidelity, which synthesized audio must be assessed for during live listening.",
        "Do not yet add emotion/style fields to the Luna JSON schema",
        "Use bounded trusted acting templates (initial application limit: 512 Unicode code points). Do not interpolate raw player/world instructions or create per-turn emotion fields.",
        "Validate finite speed against provider/model-supported bounds (OpenAI Speech API documents 0.25 through 4.0). Reject invalid values; preserve default 1.0.",
        "Send instructions only when the selected model supports them. Explicit acting-enabled configuration on an unsupported model fails clearly; legacy speech can continue with acting disabled. Never silently change the TTS model.",
        "Document that exact request text is enforceable locally; perfect audible wording/emotion is a quality goal, not a deterministic TTS guarantee."
      ],
      "initialInstructionIntent": [
        "Natural conversational performance",
        "Grounded character delivery",
        "Match emotion implied by the dialogue",
        "Avoid announcer-like exaggeration",
        "Do not add, remove, paraphrase, or repeat words"
      ],
      "checks": [
        "validated dialogue text is unchanged by speech planning",
        "speech profile reaches TTS provider",
        "existing PCM contract is unchanged",
        "native playback path is unchanged",
        "telemetry does not persist speech instructions",
        "Unsupported acting capability is caught before synthesis; no silently ignored acting acceptance.",
        "Input limit violations fail without splitting/paraphrasing text or redesigning E1.1 streaming."
      ]
    },
    {
      "id": "E2D",
      "title": "E2 validation and freeze",
      "dependsOn": [
        "E2A",
        "E2B",
        "E2C"
      ],
      "work": [
        "Run full offline suite with provider/voice/capability/config migration/cleanup coverage.",
        "Document E2 architecture and record an immutable offline-verified E2 checkpoint before E3.",
        "With explicit live API authorization, run existing reasoning/STT/TTS smoke and listen to at least two supported configured voices for stability, acting, and wording.",
        "With separate GTA deployment/launch instruction, perform repeated-session voice stability and teardown smoke.",
        "Record API/GTA checks as passed, failed, or deferred with evidence. Deferred external checks do not block offline E3 implementation; they block full release acceptance."
      ],
      "requiredTests": [
        "provider stack preserves current OpenAI route",
        "stock Gemini route remains unchanged",
        "same session retains voice across multiple turns",
        "new session does not inherit stale profile state",
        "speech provider receives profile once per synthesis",
        "TTS output remains valid PCM16 mono 24kHz",
        "no dialogue/prompts in telemetry"
      ],
      "releaseGate": {
        "implementationCheckpoint": "Offline regressions and new E2 contract tests pass; freeze this checkpoint before E3.",
        "api": "Explicitly authorized API smoke passes with model-compatible multi-voice configuration and acting support, or remains deferred.",
        "gta": "Explicitly authorized GTA voice stability smoke passes, or remains deferred.",
        "releaseReady": "Requires offline + API + GTA evidence. A deferred check is not a pass."
      },
      "requiresExplicitLiveOptIn": true,
      "requiresDeploymentInstructionForGta": true
    },
    {
      "id": "E3A",
      "title": "Reliability primitives",
      "dependsOn": [
        "E2D"
      ],
      "goal": "Create reliability primitives that can retry provider operations without owning or restarting the native turn.",
      "addFiles": [
        "src/reliability/retryPolicy.mjs",
        "src/reliability/providerExecutor.mjs",
        "src/reliability/abortableDelay.mjs",
        "src/reliability/errorClassifier.mjs"
      ],
      "modifyFiles": [
        "src/openai/request.mjs",
        "src/providers/openai/reasoningProvider.mjs",
        "src/providers/openai/transcriptionProvider.mjs",
        "src/providers/openai/speechProvider.mjs",
        "src/config/e1Config.mjs",
        "src/observability/telemetry.mjs",
        "src/observability/eventContract.mjs",
        "tools/summarizeRun.mjs"
      ],
      "rule": "Retry only one unpublished provider operation; never retry the native turn or any operation after an irreversible native/gameplay effect.",
      "initialPolicy": {
        "maxAttempts": 2,
        "meaning": "one original attempt + at most one automatic retry",
        "retryableHttpStatus": [
          408,
          429,
          500,
          502,
          503,
          504
        ],
        "retryableTransport": [
          "connection_reset",
          "connection_closed",
          "temporary_network_failure",
          "attempt_timeout_before_effect_and_deadline"
        ],
        "neverRetry": [
          400,
          401,
          403,
          404,
          "model_refusal",
          "invalid_decision",
          "native_auth_rejected",
          "playback_interrupted",
          "playback_ack_timeout",
          "cancelled",
          "superseded",
          "stale_generation",
          "quota_or_billing_error",
          "deadline_exceeded",
          "unknown_error",
          "invalid_pcm",
          "consumer_callback_failure",
          "irreversible_native_or_gameplay_effect_started",
          "permanent_dns_or_tls_configuration_error"
        ],
        "statusQualification": "HTTP status alone is insufficient. 429 retries only for temporary throttling; quota/billing/spend/access errors are terminal. Unknown errors fail closed."
      },
      "requirements": [
        "Parse bounded Retry-After as delta-seconds or HTTP-date; validate safely and retain only normalized metadata. A valid server delay is a minimum, never clamp it downward.",
        "Do not implement retry inside low-level request.mjs itself",
        "Keep request.mjs a single-request primitive",
        "Reliability executor owns retry classification and attempt scheduling",
        "Retry delays must be abortable",
        "Executor receives the exact root turn AbortSignal. Compose any attempt/deadline child signal from it; parent cancellation always aborts the child and never gets replaced by an independent controller.",
        "Retry executor must verify generation is still current before each attempt",
        "Disable client/SDK retries for executor-controlled requests; confirm request counts using injected transport tests.",
        "Use bounded exponential backoff with injected jitter. Deterministic voice assignment does not prohibit retry jitter; inject clock/random/delay for deterministic tests.",
        "If valid Retry-After exceeds maxDelayMs or cannot fit the remaining budget plus minAttemptBudgetMs, skip the retry. Never wait less than the server minimum.",
        "Classify root cancellation, supersession, terminal state, and overall deadline expiry before considering HTTP/transport recovery.",
        "Use an attempt-local token/closed flag, distinct from native generation identity. Close and abort a failed/timed-out attempt before scheduling another. Ignore all late completion, errors, PCM, transcript, and telemetry callbacks from closed attempts.",
        "Check full native identity, root/attempt signal, deadline, terminal status, active attempt, and output/effect boundary before each request and immediately before every output publication.",
        "Attempt settlement cleans its response reader and framing state; cleanup errors cannot create a new retry or overwrite the original terminal result."
      ],
      "checks": [
        "401 retries zero times",
        "400 retries zero times",
        "503 may retry once",
        "Temporary rate-limit 429 may retry once when its server delay fits.",
        "abort during backoff prevents next attempt",
        "supersession during backoff prevents next attempt",
        "429 quota/billing retries zero times.",
        "Long Retry-After skips retry rather than shortening the delay.",
        "Nested retries cannot exceed maxAttempts actual requests.",
        "Late callbacks are rejected even when the native generation is still current."
      ]
    },
    {
      "id": "E3B",
      "title": "Shared provider deadline integration",
      "dependsOn": [
        "E3A"
      ],
      "goal": "Retries consume the existing provider-work budget rather than creating fresh full deadlines.",
      "modifyFiles": [
        "src/openai/runSequentialTurn.mjs",
        "src/reliability/providerExecutor.mjs"
      ],
      "work": [
        "Preserve the actual E1.1 provider-work start boundary and store one immutable monotonic deadline per generation; do not assume microphone/turn creation time equals provider start.",
        "Pass remaining provider budget to each provider attempt",
        "Do not restart providerWorkDeadlineMs for retries",
        "Abort retry if insufficient useful time remains",
        "Check signal/current generation before and after backoff",
        "An overall deadline aborts active requests, body reads, and backoff. A Promise.race alone is insufficient without closing the attempt and guarding late callbacks.",
        "Differentiate optional per-attempt timeout from root/overall timeout. Only the former may retry with remaining budget and an open effect boundary.",
        "Convert HTTP-date Retry-After using wall time only at parsing; measure provider elapsed time/deadlines using a monotonic injected clock.",
        "Keep native playback acknowledgement timeout and existing interruption/finalization timing separate from provider retries."
      ],
      "correctBehavior": "deadlineAt = originalProviderWorkStartMonotonic + providerWorkDeadlineMs\nSTT, reasoning, speech, every failed attempt, and all backoff share this deadline.\nremaining = deadlineAt - monotonicNow()\nattemptTimeout = min(configured attempt cap if any, remaining)\nretry only if delay + minAttemptBudgetMs <= remaining\nAll result/callback delivery is gated against the original deadline.",
      "forbiddenBehavior": "\nattempt 1 gets full 45s\nattempt 2 gets a fresh full 45s\n      ",
      "checks": [
        "second attempt receives reduced remaining budget",
        "retry never exceeds original provider deadline",
        "deadline expiry during backoff terminates cleanly",
        "old retry cannot wake after supersession",
        "STT retry reduces reasoning and TTS budget.",
        "An HTTP-200 body stall obeys the same deadline.",
        "Late success after overall timeout produces no native output.",
        "Clock changes do not extend the provider deadline."
      ]
    },
    {
      "id": "E3C",
      "title": "STT retry integration",
      "dependsOn": [
        "E3A",
        "E3B"
      ],
      "modifyFiles": [
        "src/providers/openai/transcriptionProvider.mjs",
        "src/openai/runSequentialTurn.mjs"
      ],
      "work": [
        "The orchestrator wraps the single-request STT provider operation in providerExecutor; the provider does not wrap itself.",
        "Retry only before successful transcript is emitted",
        "Emit input transcript/history exactly once",
        "Preserve current native identity across attempts",
        "Snapshot/reuse the same accepted microphone PCM and history inputs across attempts. Keep transcript publication and history commit outside the retry closure.",
        "Accept one transcript only after attempt/current-generation guards pass; empty/invalid successful results retain E1.1 semantic failure behavior and are not transport retries."
      ],
      "checks": [
        "STT 503 -> retry -> success",
        "STT network reset -> retry -> success",
        "STT 401 -> no retry",
        "supersession during STT retry prevents transcript emission",
        "player history is committed once"
      ]
    },
    {
      "id": "E3D",
      "title": "Reasoning retry integration",
      "dependsOn": [
        "E3A",
        "E3B"
      ],
      "modifyFiles": [
        "src/providers/openai/reasoningProvider.mjs",
        "src/openai/runSequentialTurn.mjs"
      ],
      "work": [
        "The orchestrator wraps the single-request reasoning provider operation in providerExecutor; the provider does not wrap itself.",
        "Retry only transport/retryable HTTP failures",
        "Do not automatically retry completed refusals",
        "Do not automatically retry invalid validated decisions",
        "Only one final validated decision may leave provider stage",
        "Reuse an immutable snapshot of dialogue input, context, capabilities, history, and model configuration for retries; do not reread mutable globals.",
        "Keep output transcript, staging, action validation/dispatch, and native authorization outside the retry closure."
      ],
      "checks": [
        "model 503 -> retry -> success",
        "model 429 + bounded Retry-After -> retry -> success",
        "model refusal -> no retry",
        "invalid decision -> no retry",
        "late first-attempt result cannot escape after second attempt wins",
        "output transcript/action route runs once"
      ]
    },
    {
      "id": "E3E",
      "title": "TTS pre-side-effect retry boundary",
      "dependsOn": [
        "E3A",
        "E3B"
      ],
      "goal": "Allow TTS retry only while its output is unpublished and no earlier irreversible native/gameplay effect has started.",
      "modifyFiles": [
        "src/providers/openai/speechProvider.mjs",
        "src/openai/runSequentialTurn.mjs"
      ],
      "work": [
        "Wrap one speech request in providerExecutor in the orchestrator, keeping authorization/actions/stream-end outside the closure.",
        "Inspect the E2P effect map before enabling TTS retry. Earlier action dispatch or native playback-start effect makes failure terminal, even with zero PCM.",
        "Use identical validated dialogue and immutable session profile across attempts.",
        "Guard PCM callbacks with attempt token and full lifecycle/deadline state; close retry eligibility synchronously immediately BEFORE the first usable PCM is handed to E1.1.",
        "Empty chunks and incomplete PCM samples are not usable handoffs. Malformed output or consumer failures are terminal; never treat them as transient network errors.",
        "Discard all failed-attempt byte carries/buffers and cancel its response reader. Never concatenate audio from two attempts.",
        "After any irreversible effect, failure follows accepted E1.1 cleanup/finalization/history handling. Never rewind reasoning/actions, replay audio, or repeat authorization."
      ],
      "sideEffectBoundary": "Retry MAY occur only if all of these hold:\n  current nonterminal generation + current live attempt + remaining deadline\n  no earlier action or irreversible native effect\n  no successful PCM handoff or speech output publication\nImmediately before native/action handoff: boundary closes permanently.\nFirst usable PCM is the latest possible TTS boundary, not always the first effect.",
      "checks": [
        "TTS 503 before any effect/PCM -> retry -> success.",
        "TTS network failure before any effect/PCM -> retry -> success.",
        "TTS failure after first PCM -> no retry",
        "action does not dispatch twice",
        "native authorization does not occur twice",
        "stream-end remains exactly once",
        "assistant history remains staged/discarded correctly",
        "Action dispatched before TTS failure -> no retry even with zero PCM.",
        "Native playback begins before PCM -> no retry.",
        "PCM consumer throws at first handoff -> terminal; retry boundary stays closed.",
        "Late old-attempt PCM cannot enter new-attempt/native output.",
        "A terminal speech failure does not undo an already executed action."
      ]
    },
    {
      "id": "E3F",
      "title": "Retry telemetry and reporting",
      "dependsOn": [
        "E3A",
        "E3C",
        "E3D",
        "E3E"
      ],
      "modifyFiles": [
        "src/observability/eventContract.mjs",
        "src/observability/telemetry.mjs",
        "tools/summarizeRun.mjs"
      ],
      "events": [
        "provider_retry_scheduled",
        "provider_retry_started",
        "provider_retry_recovered",
        "provider_retry_exhausted",
        "provider_retry_skipped"
      ],
      "safeFields": [
        "operation",
        "provider",
        "attempt",
        "maxAttempts",
        "retryDelayMs",
        "reason",
        "httpStatus",
        "remainingDeadlineMs",
        "attemptId",
        "errorCode",
        "skipReason"
      ],
      "forbiddenFields": [
        "response body",
        "dialogue",
        "transcript",
        "prompt",
        "API key",
        "Authorization header"
      ],
      "reportAdditions": [
        "retry count by provider operation",
        "retry recovery count",
        "retry exhaustion count",
        "latency added by retry",
        "HTTP status/reason distribution",
        "skipped retries by bounded reason",
        "separate counts for initial failure, retry started, recovery, exhaustion, cancellation/deadline, and side-effect suppression"
      ],
      "checks": [
        "retry metrics do not change lifecycle behavior",
        "logs remain privacy-filtered",
        "report marks incomplete traces correctly"
      ],
      "work": [
        "Attach existing safe lifecycle correlation fields to each event; attemptId is local bookkeeping, never a native generation ID.",
        "Retry exhausted means all allowed attempts failed. Cancellation/deadline/nonretryable/effect-suppressed outcomes must not be misreported as retry exhaustion.",
        "Emit allowlisted reason/code enums only; retain existing privacy filters and bounded payload sizes."
      ]
    },
    {
      "id": "E3G",
      "title": "Fault-injection regression suite",
      "dependsOn": [
        "E3C",
        "E3D",
        "E3E",
        "E3F"
      ],
      "addOrModifyTests": [
        "tests/reliability.test.mjs",
        "tests/providerRetry.test.mjs",
        "tests/nativeAudio.test.mjs",
        "tests/sessionHistory.test.mjs",
        "tests/observability.test.mjs"
      ],
      "requiredCases": [
        "STT transient failure -> retry -> success",
        "model transient failure -> retry -> success",
        "429 with short Retry-After -> success",
        "401 -> no retry",
        "400 -> no retry",
        "refusal -> no retry",
        "invalid decision -> no retry",
        "TTS transient failure before any native/gameplay effect or PCM -> retry -> success",
        "TTS failure after first PCM -> no retry",
        "generation superseded during backoff -> no retry",
        "provider deadline expires during backoff -> no retry",
        "retry cannot resurrect terminal job",
        "action handler invoked once",
        "RequestBackup-like final action remains once",
        "assistant history commits once",
        "player history remains correct",
        "stream end emitted once",
        "terminal summary emitted once",
        "Gemini route unaffected",
        "quota/billing 429 -> no retry",
        "Retry-After above maxDelayMs or remaining budget -> skipped, never shortened",
        "Retry-After HTTP-date, malformed, missing, and zero values handled safely",
        "SDK/client hidden retries disabled; request counts match configured cap",
        "attempt timeout versus parent abort versus total deadline classified separately",
        "late transcript/decision/PCM from closed attempt while same generation remains current -> ignored",
        "late success after terminal deadline -> ignored",
        "body-read stall after HTTP 200 -> bounded deadline and reader cleanup",
        "action/native effect before TTS first PCM -> no retry",
        "first usable PCM handoff throws -> terminal, no retry",
        "empty/odd chunks and partial sample carry cannot contaminate retry audio",
        "unsupported acting model, invalid speed, empty/duplicate/unsupported voice pool -> clear configuration failure",
        "singleton legacy ttsVoice migration preserves behavior",
        "session config refresh, ped handle reuse, delayed old disconnect -> stable correct profile",
        "all attempts use the same immutable operation input and speech profile",
        "all terminal paths remove timers/listeners/readers and discard staged assistant history appropriately",
        "telemetry distinguishes retry skipped/exhausted/cancelled and excludes raw errors/body/headers"
      ],
      "invariant": "A retry may repeat a provider request only inside an open stage/effect boundary. Native/gameplay publication remains at most once, with existing E1.1 completion guarantees."
    },
    {
      "id": "E3H",
      "title": "Live API fault/recovery smoke",
      "dependsOn": [
        "E3G"
      ],
      "requiresExplicitLiveOptIn": true,
      "work": [
        "Run normal offline suite first",
        "Run existing real OpenAI smoke",
        "Exercise a controlled retryable path using the injected transport fault harness around an authorized live request if available; do not depend on inducing real provider outages. Label injected faults versus observed provider failures.",
        "Do not intentionally abuse rate limits",
        "Do not use bad credentials as a retry test",
        "Verify sanitized retry telemetry",
        "Run offline suite again afterward"
      ],
      "checks": [
        "normal API path still passes",
        "retry does not duplicate output/native events",
        "no credentials in logs"
      ]
    },
    {
      "id": "E3I",
      "title": "GTA reliability smoke",
      "dependsOn": [
        "E2D",
        "E3G"
      ],
      "requiresDeploymentInstruction": true,
      "gtaChecks": [
        "same NPC repeated turns",
        "long speech",
        "interrupt speech with new turn",
        "rapid supersession",
        "PTT during/after previous response",
        "stock wait/follow action",
        "two NPCs in quick succession",
        "disconnect/reconnect",
        "Gemini regression",
        "inspect E1 observability JSONL afterward",
        "action dispatched before speech failure: action remains once, no provider retry crosses the effect",
        "reused ped handle and delayed old-session cleanup",
        "compare baseline and candidate provider latency with sanitized traces"
      ],
      "acceptance": "No stale retry or provider failure may cause wrong-NPC speech, duplicated actions, duplicate stream completion, or incorrect history.",
      "additionalReleaseRequirement": "Live API validation E3H and E2D API checks must also pass before full release acceptance; offline implementation and separately authorized GTA checks need not wait for an unavailable API fault."
    }
  ],
  "globalInvariants": [
    "Essential remains authoritative for GTA/native runtime state",
    "E2/E3 never allocate their own native generation IDs",
    "pedId + turnId + generationId + sessionNonce remain immutable per job",
    "PlaybackEnded remains the assistant-history success boundary",
    "At most one native stream-end; exactly one where the existing E1.1 allocated-stream protocol requires it (do not fabricate streams for early failures).",
    "one terminal outcome per generation",
    "one stock action dispatch per validated turn",
    "no retry of whole turns",
    "no retry across a gameplay/native side-effect boundary",
    "no automatic provider fallback",
    "no retry after supersession",
    "no retry after terminal state",
    "no retry budget reset",
    "no Gemini lifecycle migration into E2/E3",
    "no dialogue/prompts/transcripts in observability logs",
    "no secrets in logs/artifacts/errors",
    "normal tests remain offline",
    "GTA is not launched by build/unit tests",
    "All provider output is gated by both immutable native identity and a live attempt token.",
    "Retry eligibility closes before any irreversible native/gameplay handoff, even if the consumer throws.",
    "One retry layer only; actual external request counts are bounded.",
    "A deferred API/GTA check is not release acceptance."
  ],
  "retrySafetyMatrix": {
    "transcription": {
      "retry": true,
      "boundary": "Before one transcript is accepted, while the generation is current and no irreversible native/gameplay effect exists."
    },
    "reasoning": {
      "retry": true,
      "boundary": "Before one validated decision is published, while the generation is current and no irreversible native/gameplay effect exists."
    },
    "decisionValidation": {
      "retry": false,
      "reason": "semantic outcome, not transport reliability"
    },
    "speech": {
      "retry": "pre-side-effect only",
      "boundary": "Before the earliest irreversible action/native effect or first usable PCM handoff; unknown effect state forbids retry."
    },
    "nativeAuthorization": {
      "retry": false,
      "reason": "Invoked once outside provider retry; rejection is terminal; authorization that starts an effect closes all later retry eligibility."
    },
    "nativeAudio": {
      "retry": false,
      "reason": "side effects already started"
    },
    "actionDispatch": {
      "retry": false,
      "reason": "GTA side effect"
    },
    "playbackCompletion": {
      "retry": false,
      "reason": "native lifecycle acknowledgement"
    },
    "historyCommit": {
      "retry": false,
      "reason": "deterministic local lifecycle"
    }
  },
  "configPlan": {
    "preserve": [
      "provider",
      "reasoningModel",
      "reasoningEffort",
      "transcriptionModel",
      "ttsModel",
      "ttsVoice",
      "providerWorkDeadlineMs"
    ],
    "addE2": {
      "speechVoices": null,
      "voiceAssignment": "deterministic-session",
      "ttsSpeed": 1,
      "actingEnabled": false,
      "actingInstructionsMaxCodePoints": 512
    },
    "addE3": {
      "retry": {
        "enabled": true,
        "maxAttempts": 2,
        "baseDelayMs": 500,
        "maxDelayMs": 3000,
        "honorRetryAfter": true,
        "jitter": "bounded-injected",
        "minAttemptBudgetMs": 1000,
        "attemptTimeoutMs": null,
        "retryAfterAboveMax": "skip",
        "note": "Timing defaults are initial values to validate against stage latency. Null attemptTimeoutMs uses the remaining shared budget; a request consuming it leaves no retry time. maxDelayMs never shortens a valid server minimum."
      }
    },
    "intentionallyNotAddedYet": [
      "automatic provider fallback",
      "persistent cross-session character voice database",
      "custom voice cloning",
      "circuit breaker",
      "global provider concurrency limiter",
      "automatic semantic repair of invalid decisions"
    ],
    "migrationRules": [
      "speechVoices absent/null means [existing ttsVoice]; explicit empty/duplicate pools are invalid.",
      "voiceAssignment remains deterministic-session; singleton configuration preserves legacy sound.",
      "Multi-voice demonstration requires at least two model-supported voices; hashing allows collisions.",
      "actingEnabled=false preserves legacy requests. Explicit acting=true requires an instructions-capable selected model and bounded trusted templates.",
      "Freeze session profiles across live config changes; no automatic model/provider/voice fallback.",
      "Validate finite numeric retry options, maxAttempts integer in [1,2], nonnegative delays, and positive minimum useful attempt budget.",
      "retry.enabled=false/maxAttempts=1 runs exactly one request with unchanged deadline and publication guards."
    ]
  },
  "finalAcceptance": {
    "E2": [
      "Provider interfaces exist and current OpenAI behavior remains functional",
      "Same native NPC session retains a stable voice; a model-compatible multi-voice configuration demonstrates varied assignment without promising uniqueness.",
      "Configured instructions-capable TTS receives bounded acting guidance; request dialogue remains exact and live listening evaluates audible fidelity.",
      "Essential native lifecycle remains untouched",
      "Stock Gemini remains unchanged",
      "Offline + live API + GTA voice smoke pass"
    ],
    "E3": [
      "Transient STT/model failures can recover within original provider deadline",
      "TTS retries only before the earliest irreversible native/gameplay effect or usable PCM handoff.",
      "No retry can resurrect a stale generation",
      "No retry can duplicate actions",
      "No retry can duplicate native audio/stream end/history",
      "Retry events are observable and privacy-safe",
      "Offline fault injection, live API smoke, and GTA smoke pass"
    ]
  },
  "postE3Roadmap": [
    {
      "id": "E5",
      "scope": "Structured model/segment streaming"
    },
    {
      "id": "E6",
      "scope": "Early TTS using the existing native generation contract"
    },
    {
      "id": "SESSION_IDENTITY",
      "scope": "Durable verified character identity beyond one native session"
    },
    {
      "id": "PERCEPTION",
      "scope": "Additional supported world/context enrichment"
    },
    {
      "id": "SALIENCE",
      "scope": "Prioritize observations, threats, opportunities, and memory"
    },
    {
      "id": "SCENE_DIRECTOR",
      "scope": "NPC initiative and coordinated behavior through Essential-native turns"
    }
  ],
  "implementationInstruction": "This artifact is a revised plan. A request to review it does not authorize implementation.\nWhen implementation is requested, apply it only to the verified CURRENT E1.1 + Observability Essential companion candidate.\nBegin with E2P: inspect the repository, confirm the accepted baseline, map actual interfaces and native/action ordering, and record evidence.\nPreserve approved E1.1 behavior, the existing validator, native identities, interruption, history rules, and stock Gemini.\nImplement E2 first and freeze its passing offline checkpoint before E3.\nDo not let unavailable/unapproved live checks block independent offline E3 work. Report them as deferred; do not claim release readiness.\nImplement E3 incrementally through one orchestrator-owned executor, immutable input snapshots, attempt tokens, monotonic shared deadline, safe error classification, and the conservative effect matrix.\nDo not move native/action effects or rewrite E1.1 simply to obtain a retry opportunity.\nDo not modify the old/custom LSA 2.1 branch. No live API execution or GTA deployment/launch without the corresponding explicit authorization.\nAt completion provide architecture delta, files changed, removed/replaced code, tests added and actual full results, API smoke results if run, remaining GTA-only unknowns, documentation, GTA checklist, and separate implementation versus release-readiness status.",
  "review": {
    "reviewedOn": "2026-10-01",
    "scope": "Plan review against the supplied E2/E3 goals; no implementation, API execution, or GTA deployment.",
    "verdict": "Sound architecture after the safety, compatibility, and validation clarifications in this revision.",
    "evidenceLimit": "No implementation repository was supplied or present in this chat workspace. File paths, E1.1 behavior, native ordering, and the claimed 106 passing tests require preflight verification.",
    "goalsDocument": "The supplied E2/E3 goal statement remains the source of scope; no new provider, streaming, identity, or gameplay feature is added."
  },
  "providerContractDetails": {
    "capabilities": "Speech provider declares model-compatible voices, instructions support, speed bounds, input limits, and PCM output format. Reasoning/STT declare their accepted input/result formats and limits.",
    "decisionValidation": "Retain the shared existing validation path and its exact failure semantics. A valid response is published only after executor and lifecycle guards accept it.",
    "errors": "A bounded internal metadata envelope supports retry classification. Inspect only needed provider error code/type internally; do not retain or emit the response body, headers, or free-form error text.",
    "audio": "Headerless signed little-endian PCM16, mono, 24kHz. Network chunks need not align to samples: carry partial sample bytes within one attempt, reject malformed final framing, and discard carry on failed attempts.",
    "callbacks": "Specify synchronous/awaited handoff to preserve E1.1 backpressure. Gate every external publication immediately before delivery; do not infer safety from Promise resolution alone.",
    "cleanup": "Close/cancel failed readers, consume no further callbacks, clear timers, remove abort listeners, and release session-owned resources exactly once."
  },
  "retrySafety": {
    "owner": "The sequential-turn orchestrator wraps each raw provider invocation in providerExecutor exactly once; provider implementations and request.mjs contain no retry loop.",
    "scope": "At most two actual external requests per stage operation, counting every client/SDK attempt. No nested SDK/client retries; maxAttempts=2 means up to six requests for an STT+reasoning+speech turn, subject to eligibility and one shared deadline.",
    "sideEffectRule": "Use the conservative combined-goals rule: no automatic provider retry after any irreversible native/gameplay effect for this turn. This includes action dispatch and any earlier native playback-start effect, as well as first PCM handoff.",
    "orderingConsequence": "If E1.1 dispatches an action or starts native playback before TTS, subsequent TTS failures are terminal even before PCM. Do not reorder accepted E1.1 actions or lifecycle merely to enable retries. First-PCM TTS retries are available only when preflight proves no earlier effect.",
    "nativeAuthorization": "Authorization is invoked at most once by E1.1 outside the retry loop. Treat it as a blocking effect unless preflight proves it only reserves permission and starts no native effect. Its rejection is terminal.",
    "effectTracking": "Read existing E1.1 job state or add minimal turn-local observation in the orchestrator; E3 gets a read-only canRetry/acceptOutput guard, never a new native state machine. Mark the boundary immediately before native/action handoff; uncertainty or a throwing consumer keeps it closed.",
    "historyException": "Accepted player history is an intentionally durable E1.1 input boundary, not a reason to retry its commit or restart the turn. Later stage requests may retry if their own output is unpublished and no irreversible native/gameplay effect exists. Never roll back accepted player history.",
    "externalExecution": "A repeated provider request can still execute remotely and incur duplicate cost after an ambiguous transport failure. Local guards prevent duplicate native publication; they do not provide exactly-once remote execution. Reasoning providers must have no provider-executed gameplay/tools with side effects."
  },
  "validationStatus": {
    "plan": "Reviewed and revised; module syntax and plan dependency consistency checked separately from runtime tests.",
    "implementation": "Not performed; repository absent from the supplied review context.",
    "offline": "Not run against runtime; baseline count is a supplied claim.",
    "api": "Not run; requires explicit live opt-in.",
    "gta": "Not run; requires deployment/launch instruction.",
    "readiness": "Offline-verified checkpoints permit the next implementation stage. Full release readiness requires all authorized external gates to actually pass."
  },
  "sources": [
    {
      "url": "https://developers.openai.com/api/docs/guides/text-to-speech",
      "supports": "Model-dependent voice availability and raw PCM output format.",
      "checkedOn": "2026-10-01"
    },
    {
      "url": "https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create",
      "supports": "Speech instructions unsupported on tts-1/tts-1-hd; speed range and request input limit.",
      "checkedOn": "2026-10-01"
    },
    {
      "url": "https://developers.openai.com/api/docs/guides/rate-limits",
      "supports": "Server retry minimum, jitter, bounded attempts/deadlines, and avoiding nested SDK retries.",
      "checkedOn": "2026-10-01"
    },
    {
      "url": "https://developers.openai.com/api/docs/guides/error-codes",
      "supports": "Distinguish temporary 429 rate limits from billing/quota/spend errors.",
      "checkedOn": "2026-10-01"
    }
  ]
};

export default e23Plan;
