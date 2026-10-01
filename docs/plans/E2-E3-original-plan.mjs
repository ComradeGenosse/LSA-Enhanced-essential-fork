/**
 * Declarative E2/E3 implementation plan for the current
 * E1.1 + Observability Essential companion candidate.
 *
 * This is an implementation plan, not a rewrite of E1.1.
 *
 * Architectural rule:
 * - Essential remains authoritative for GTA/native state.
 * - E1.1 remains the native/provider lifecycle adapter.
 * - E2 adds provider abstraction + stable session voice profiles.
 * - E3 adds stage-aware provider reliability without retrying across
 *   native or gameplay side-effect boundaries.
 *
 * Do not modify the old/custom LSA 2.1 branch.
 * Do not deploy to GTA unless separately instructed.
 */

export const e23Plan = {
  schemaVersion: 1,

  title: "E2 Provider/Voice Abstraction + E3 Stage-Aware Reliability",

  baseline: {
    branch: "Essential Hotfix #3 companion",
    runtime: "E1.1 hardened + observability",
    testsAtPlanningTime: {
      passed: 106,
      failed: 0,
      cancelled: 0,
    },

    assumptions: [
      "E1.1 native lifecycle is already accepted",
      "Essential owns native turn/generation/playback/action truth",
      "PlaybackEnded remains the only successful assistant-delivery boundary",
      "PLAYER_TEXT and PLAYER_MIC are durable player history once accepted",
      "assistant history remains staged until matching native playback success",
      "SPECIAL_EVENT/system input remains non-player context",
      "stock Gemini ownership/audio behavior remains isolated and unchanged",
    ],
  },

  preservedOwners: [
    "Essential native identity",
    "Essential native generation allocation",
    "Essential playback authorization",
    "Essential native audio lifecycle",
    "Essential exact interruption",
    "Essential stock action validation/dispatch boundary",
    "Essential GTA/NPC context",
    "Essential NPC state",
  ],

  doNotRewrite: [
    "nativeDelivery.mjs unless a proven interface adaptation is unavoidable",
    "pedId + turnId + generationId + sessionNonce identity model",
    "PlaybackEnded success boundary",
    "stock Gemini lifecycle",
    "PTT capture/controller ownership",
    "SPECIAL_EVENT source semantics",
    "stock action handler behavior",
    "source-pinned native lifecycle AST hooks",
    "existing E1.1 history semantics",
  ],

  architecture: {
    target: `
Essential / GTA
      ^
      |
E1.1 lifecycle adapter
      ^
      |
E3 Reliability Executor
      ^
      |
E2 Provider Stack
  |        |        |
 STT    Reasoning  Speech
                    ^
                    |
              Voice Resolver
                    |
              Speech Profile
      `,
  },

  stages: [
    // ------------------------------------------------------------
    // E2
    // ------------------------------------------------------------

    {
      id: "E2A",
      title: "Provider contracts and stack",

      goal:
        "Move current OpenAI reasoning/STT/TTS behind clean provider interfaces without changing runtime behavior.",

      dependsOn: [],

      addFiles: [
        "src/providers/providerContract.mjs",
        "src/providers/providerStack.mjs",
        "src/providers/openai/reasoningProvider.mjs",
        "src/providers/openai/transcriptionProvider.mjs",
        "src/providers/openai/speechProvider.mjs",
      ],

      modifyFiles: [
        "src/integration/essentialGlue.mjs",
        "src/openai/decide.mjs",
        "src/openai/transcribe.mjs",
        "src/openai/speak.mjs",
        "src/config/e1Config.mjs",
        "src/observability/telemetry.mjs",
        "src/observability/eventContract.mjs",
      ],

      work: [
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
      ],

      conceptualInterfaces: {
        ReasoningProvider: `
interface ReasoningProvider {
  id: string;

  decide({
    identity,
    source,
    inputText,
    contextText,
    capabilities,
    history,
    signal,
    telemetry,
  }): Promise<ValidatedProviderDecision>;
}
        `,

        TranscriptionProvider: `
interface TranscriptionProvider {
  id: string;

  transcribe({
    identity,
    pcm,
    sampleRate,
    channels,
    signal,
    telemetry,
  }): Promise<{
    text: string;
    usage?: object | null;
  }>;
}
        `,

        SpeechProvider: `
interface SpeechProvider {
  id: string;

  synthesize({
    identity,
    dialogue,
    speechProfile,
    signal,
    onPcm,
    telemetry,
  }): Promise<{
    byteLength: number;
    usage?: object | null;
  }>;
}
        `,
      },

      invariants: [
        "No provider interface owns native generation state",
        "No provider interface dispatches GTA actions directly",
        "No provider interface commits assistant history",
        "No provider interface determines playback success",
        "No provider interface infers current speaker from globals",
        "No fallback to another provider without explicit future policy",
      ],

      checks: [
        "All pre-E2 106 tests still pass",
        "OpenAI behavior remains functionally equivalent",
        "stock Gemini path is byte/behavior unchanged where practical",
        "provider IDs appear in telemetry without prompt/dialogue leakage",
        "unknown provider config fails clearly",
        "no provider abstraction leaks secrets into logs",
      ],
    },

    {
      id: "E2B",
      title: "Stable session voice profiles",

      dependsOn: ["E2A"],

      goal:
        "Assign a stable deterministic speech profile to an NPC native session without pretending E2 has solved long-term character identity.",

      addFiles: [
        "src/voice/voiceResolver.mjs",
        "src/voice/voiceProfile.mjs",
      ],

      modifyFiles: [
        "src/integration/openaiConnection.mjs",
        "src/integration/essentialGlue.mjs",
        "src/providers/openai/speechProvider.mjs",
        "src/config/e1Config.mjs",
        "src/observability/telemetry.mjs",
        "src/observability/eventContract.mjs",
        "tools/summarizeRun.mjs",
      ],

      identityRule:
        "Voice assignment is scoped to the current native NPC/session identity, not permanent world identity.",

      preferredVoiceKey: [
        "pedId",
        "sessionNonce",
      ],

      work: [
        "Create VoiceResolver",
        "Resolve a deterministic voice profile once per native session",
        "Do not use Math.random() for production assignment",
        "Hash stable session identity into configured voice pool",
        "Store/reuse resolved profile on OpenAIConnection/session object",
        "Context refresh must not reroll voice",
        "New native session may resolve to a different profile",
        "Do not persist voice mappings across game sessions yet",
        "Keep future durable-character identity integration possible",
      ],

      profileShape: `
{
  profileId: string,
  provider: "openai",
  voice: string,
  speed: number,
  instructions: string
}
      `,

      configAdditions: {
        speechVoices: [
          "nova"
        ],
        voiceAssignment: "deterministic-session",
        ttsSpeed: 1.0,
      },

      notes: [
        "Actual configured voice pool may contain more supported voices after validation",
        "Do not add custom voice cloning/creation in E2",
        "Do not key permanent identity directly to GTA ped handle",
      ],

      telemetry: [
        "voice_profile_assigned",
        "speech_provider_selected",
      ],

      safeTelemetryFields: [
        "profileId",
        "speechProvider",
        "voice",
        "speed",
      ],

      forbiddenTelemetryFields: [
        "dialogue text",
        "acting instructions",
        "prompt text",
        "transcript",
      ],

      checks: [
        "same pedId + same sessionNonce resolves same profile",
        "context refresh preserves voice",
        "separate native session can resolve independently",
        "assignment is deterministic in tests",
        "unsupported configured voice fails closed",
        "no durable identity claims are made",
      ],
    },

    {
      id: "E2C",
      title: "Speech acting/style plan",

      dependsOn: ["E2B"],

      goal:
        "Improve NPC delivery through bounded speech instructions without changing Luna's current decision schema.",

      modifyFiles: [
        "src/voice/voiceProfile.mjs",
        "src/voice/voiceResolver.mjs",
        "src/providers/openai/speechProvider.mjs",
        "src/config/e1Config.mjs",
      ],

      work: [
        "Pass speechProfile into SpeechProvider",
        "Use provider-supported speech instructions where available",
        "Use configured speed where supported",
        "Keep spoken dialogue text exactly the validated Luna dialogue",
        "Do not let TTS instructions add/remove dialogue content",
        "Do not yet add emotion/style fields to the Luna JSON schema",
      ],

      initialInstructionIntent: [
        "Natural conversational performance",
        "Grounded character delivery",
        "Match emotion implied by the dialogue",
        "Avoid announcer-like exaggeration",
        "Do not add, remove, paraphrase, or repeat words",
      ],

      checks: [
        "validated dialogue text is unchanged by speech planning",
        "speech profile reaches TTS provider",
        "existing PCM contract is unchanged",
        "native playback path is unchanged",
        "telemetry does not persist speech instructions",
      ],
    },

    {
      id: "E2D",
      title: "E2 validation and freeze",

      dependsOn: ["E2A", "E2B", "E2C"],

      work: [
        "Run full offline suite",
        "Add provider-contract tests",
        "Add voice-profile tests",
        "Run live OpenAI TTS smoke with multiple configured profiles",
        "Optionally perform short GTA voice stability smoke",
        "Document E2 provider/voice architecture",
        "Freeze E2 baseline before E3",
      ],

      requiredTests: [
        "provider stack preserves current OpenAI route",
        "stock Gemini route remains unchanged",
        "same session retains voice across multiple turns",
        "new session does not inherit stale profile state",
        "speech provider receives profile once per synthesis",
        "TTS output remains valid PCM16 mono 24kHz",
        "no dialogue/prompts in telemetry",
      ],

      releaseGate: {
        offline: "all tests pass, zero failed/cancelled",
        api: "reasoning/STT/TTS smoke still passes",
        gta: "voice remains stable for repeated turns on same NPC session",
      },
    },

    // ------------------------------------------------------------
    // E3
    // ------------------------------------------------------------

    {
      id: "E3A",
      title: "Reliability primitives",

      dependsOn: ["E2D"],

      goal:
        "Create reliability primitives that can retry provider operations without owning or restarting the native turn.",

      addFiles: [
        "src/reliability/retryPolicy.mjs",
        "src/reliability/providerExecutor.mjs",
        "src/reliability/abortableDelay.mjs",
        "src/reliability/errorClassifier.mjs",
      ],

      modifyFiles: [
        "src/openai/request.mjs",
        "src/providers/openai/reasoningProvider.mjs",
        "src/providers/openai/transcriptionProvider.mjs",
        "src/providers/openai/speechProvider.mjs",
        "src/config/e1Config.mjs",
        "src/observability/telemetry.mjs",
        "src/observability/eventContract.mjs",
        "tools/summarizeRun.mjs",
      ],

      rule:
        "Retry provider operations only. Never retry an entire native turn.",

      initialPolicy: {
        maxAttempts: 2,
        meaning: "one original attempt + at most one automatic retry",

        retryableHttpStatus: [
          408,
          429,
          500,
          502,
          503,
          504,
        ],

        retryableTransport: [
          "connection_reset",
          "connection_closed",
          "temporary_network_failure",
          "timeout_before_side_effect",
        ],

        neverRetry: [
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
        ],
      },

      requirements: [
        "Extract bounded Retry-After metadata when provider supplies it",
        "Do not implement retry inside low-level request.mjs itself",
        "Keep request.mjs a single-request primitive",
        "Reliability executor owns retry classification and attempt scheduling",
        "Retry delays must be abortable",
        "Retry executor must receive the exact turn AbortSignal",
        "Retry executor must verify generation is still current before each attempt",
      ],

      checks: [
        "401 retries zero times",
        "400 retries zero times",
        "503 may retry once",
        "429 may retry once",
        "abort during backoff prevents next attempt",
        "supersession during backoff prevents next attempt",
      ],
    },

    {
      id: "E3B",
      title: "Shared provider deadline integration",

      dependsOn: ["E3A"],

      goal:
        "Retries consume the existing provider-work budget rather than creating fresh full deadlines.",

      modifyFiles: [
        "src/openai/runSequentialTurn.mjs",
        "src/reliability/providerExecutor.mjs",
      ],

      work: [
        "Create one absolute provider deadline per native generation",
        "Pass remaining provider budget to each provider attempt",
        "Do not restart providerWorkDeadlineMs for retries",
        "Abort retry if insufficient useful time remains",
        "Check signal/current generation before and after backoff",
      ],

      correctBehavior: `
deadlineAt = turnStart + providerWorkDeadlineMs

attempt 1
  -> transient failure

backoff
  -> consumes same deadline budget

attempt 2
  -> receives only remaining time
      `,

      forbiddenBehavior: `
attempt 1 gets full 45s
attempt 2 gets a fresh full 45s
      `,

      checks: [
        "second attempt receives reduced remaining budget",
        "retry never exceeds original provider deadline",
        "deadline expiry during backoff terminates cleanly",
        "old retry cannot wake after supersession",
      ],
    },

    {
      id: "E3C",
      title: "STT retry integration",

      dependsOn: ["E3A", "E3B"],

      modifyFiles: [
        "src/providers/openai/transcriptionProvider.mjs",
        "src/openai/runSequentialTurn.mjs",
      ],

      work: [
        "Wrap STT provider operation with providerExecutor",
        "Retry only before successful transcript is emitted",
        "Emit input transcript/history exactly once",
        "Preserve current native identity across attempts",
      ],

      checks: [
        "STT 503 -> retry -> success",
        "STT network reset -> retry -> success",
        "STT 401 -> no retry",
        "supersession during STT retry prevents transcript emission",
        "player history is committed once",
      ],
    },

    {
      id: "E3D",
      title: "Reasoning retry integration",

      dependsOn: ["E3A", "E3B"],

      modifyFiles: [
        "src/providers/openai/reasoningProvider.mjs",
        "src/openai/runSequentialTurn.mjs",
      ],

      work: [
        "Wrap reasoning provider operation with providerExecutor",
        "Retry only transport/retryable HTTP failures",
        "Do not automatically retry completed refusals",
        "Do not automatically retry invalid validated decisions",
        "Only one final validated decision may leave provider stage",
      ],

      checks: [
        "model 503 -> retry -> success",
        "model 429 + bounded Retry-After -> retry -> success",
        "model refusal -> no retry",
        "invalid decision -> no retry",
        "late first-attempt result cannot escape after second attempt wins",
        "output transcript/action route runs once",
      ],
    },

    {
      id: "E3E",
      title: "TTS pre-side-effect retry boundary",

      dependsOn: ["E3A", "E3B"],

      goal:
        "Allow TTS retry only before any PCM/native playback side effect has begun.",

      modifyFiles: [
        "src/providers/openai/speechProvider.mjs",
        "src/openai/runSequentialTurn.mjs",
      ],

      work: [
        "Expose explicit first-PCM side-effect boundary",
        "Track whether usable PCM has been handed to native lifecycle",
        "Permit bounded TTS retry only before that boundary",
        "Once first PCM side effect occurs, TTS failure becomes terminal",
        "Do not rewind to reasoning/action stages",
      ],

      sideEffectBoundary: `
before first usable onPcm:
  TTS retry MAY be safe

after first usable onPcm:
  TTS retry is FORBIDDEN
      `,

      checks: [
        "TTS 503 before first PCM -> retry -> success",
        "TTS network failure before first PCM -> retry -> success",
        "TTS failure after first PCM -> no retry",
        "action does not dispatch twice",
        "native authorization does not occur twice",
        "stream-end remains exactly once",
        "assistant history remains staged/discarded correctly",
      ],
    },

    {
      id: "E3F",
      title: "Retry telemetry and reporting",

      dependsOn: ["E3A", "E3C", "E3D", "E3E"],

      modifyFiles: [
        "src/observability/eventContract.mjs",
        "src/observability/telemetry.mjs",
        "tools/summarizeRun.mjs",
      ],

      events: [
        "provider_retry_scheduled",
        "provider_retry_started",
        "provider_retry_recovered",
        "provider_retry_exhausted",
      ],

      safeFields: [
        "operation",
        "provider",
        "attempt",
        "maxAttempts",
        "retryDelayMs",
        "reason",
        "httpStatus",
        "remainingDeadlineMs",
      ],

      forbiddenFields: [
        "response body",
        "dialogue",
        "transcript",
        "prompt",
        "API key",
        "Authorization header",
      ],

      reportAdditions: [
        "retry count by provider operation",
        "retry recovery count",
        "retry exhaustion count",
        "latency added by retry",
        "HTTP status/reason distribution",
      ],

      checks: [
        "retry metrics do not change lifecycle behavior",
        "logs remain privacy-filtered",
        "report marks incomplete traces correctly",
      ],
    },

    {
      id: "E3G",
      title: "Fault-injection regression suite",

      dependsOn: ["E3C", "E3D", "E3E", "E3F"],

      addOrModifyTests: [
        "tests/reliability.test.mjs",
        "tests/providerRetry.test.mjs",
        "tests/nativeAudio.test.mjs",
        "tests/sessionHistory.test.mjs",
        "tests/observability.test.mjs",
      ],

      requiredCases: [
        "STT transient failure -> retry -> success",
        "model transient failure -> retry -> success",
        "429 with short Retry-After -> success",
        "401 -> no retry",
        "400 -> no retry",
        "refusal -> no retry",
        "invalid decision -> no retry",
        "TTS transient failure before PCM -> retry -> success",
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
      ],

      invariant:
        "A retry may repeat an external provider request, but may never duplicate a native/gameplay side effect.",
    },

    {
      id: "E3H",
      title: "Live API fault/recovery smoke",

      dependsOn: ["E3G"],

      requiresExplicitLiveOptIn: true,

      work: [
        "Run normal offline suite first",
        "Run existing real OpenAI smoke",
        "Exercise at least one controlled retryable provider path if safely reproducible",
        "Do not intentionally abuse rate limits",
        "Do not use bad credentials as a retry test",
        "Verify sanitized retry telemetry",
        "Run offline suite again afterward",
      ],

      checks: [
        "normal API path still passes",
        "retry does not duplicate output/native events",
        "no credentials in logs",
      ],
    },

    {
      id: "E3I",
      title: "GTA reliability smoke",

      dependsOn: ["E3G", "E3H"],

      requiresDeploymentInstruction: true,

      gtaChecks: [
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
      ],

      acceptance:
        "No stale retry or provider failure may cause wrong-NPC speech, duplicated actions, duplicate stream completion, or incorrect history.",
    },
  ],

  globalInvariants: [
    "Essential remains authoritative for GTA/native runtime state",
    "E2/E3 never allocate their own native generation IDs",
    "pedId + turnId + generationId + sessionNonce remain immutable per job",
    "PlaybackEnded remains the assistant-history success boundary",
    "one native stream-end per generation",
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
  ],

  retrySafetyMatrix: {
    transcription: {
      retry: true,
      boundary: "before successful transcript leaves STT stage",
    },

    reasoning: {
      retry: true,
      boundary: "before one final validated decision leaves reasoning stage",
    },

    decisionValidation: {
      retry: false,
      reason: "semantic outcome, not transport reliability",
    },

    speech: {
      retry: "pre-side-effect only",
      boundary: "first usable PCM handed to native lifecycle",
    },

    nativeAuthorization: {
      retry: false,
      reason: "Essential is authoritative",
    },

    nativeAudio: {
      retry: false,
      reason: "side effects already started",
    },

    actionDispatch: {
      retry: false,
      reason: "GTA side effect",
    },

    playbackCompletion: {
      retry: false,
      reason: "native lifecycle acknowledgement",
    },

    historyCommit: {
      retry: false,
      reason: "deterministic local lifecycle",
    },
  },

  configPlan: {
    preserve: [
      "provider",
      "reasoningModel",
      "reasoningEffort",
      "transcriptionModel",
      "ttsModel",
      "ttsVoice",
      "providerWorkDeadlineMs",
    ],

    addE2: {
      speechVoices: ["nova"],
      voiceAssignment: "deterministic-session",
      ttsSpeed: 1.0,
    },

    addE3: {
      retry: {
        enabled: true,
        maxAttempts: 2,
        baseDelayMs: 500,
        maxDelayMs: 3000,
        honorRetryAfter: true,
      },
    },

    intentionallyNotAddedYet: [
      "automatic provider fallback",
      "persistent cross-session character voice database",
      "custom voice cloning",
      "circuit breaker",
      "global provider concurrency limiter",
      "automatic semantic repair of invalid decisions",
    ],
  },

  finalAcceptance: {
    E2: [
      "Provider interfaces exist and current OpenAI behavior remains functional",
      "Same native NPC session retains a stable voice",
      "TTS can receive bounded acting/style instructions",
      "Essential native lifecycle remains untouched",
      "Stock Gemini remains unchanged",
      "Offline + live API + GTA voice smoke pass",
    ],

    E3: [
      "Transient STT/model failures can recover within original provider deadline",
      "TTS retries only before native audio side effects",
      "No retry can resurrect a stale generation",
      "No retry can duplicate actions",
      "No retry can duplicate native audio/stream end/history",
      "Retry events are observable and privacy-safe",
      "Offline fault injection, live API smoke, and GTA smoke pass",
    ],
  },

  postE3Roadmap: [
    {
      id: "E5",
      scope: "Structured model/segment streaming",
    },
    {
      id: "E6",
      scope: "Early TTS using the existing native generation contract",
    },
    {
      id: "SESSION_IDENTITY",
      scope: "Durable verified character identity beyond one native session",
    },
    {
      id: "PERCEPTION",
      scope: "Additional supported world/context enrichment",
    },
    {
      id: "SALIENCE",
      scope: "Prioritize observations, threats, opportunities, and memory",
    },
    {
      id: "SCENE_DIRECTOR",
      scope: "NPC initiative and coordinated behavior through Essential-native turns",
    },
  ],

  implementationInstruction: `
Implement this plan against the CURRENT E1.1 + Observability Essential companion candidate.

Do not stop after producing another plan.

Before changing code:
1. inspect the actual current modules,
2. map each planned file/change to the real implementation,
3. adjust file names/boundaries where the repository differs,
4. preserve all approved E1.1 lifecycle behavior.

Implement E2 fully first.
Run and pass its complete regression/API validation before beginning E3.

Then implement E3 incrementally using the explicit retry safety matrix.

Do not deploy to GTA or make live API calls unless the relevant stage above explicitly allows it and the environment/user authorization exists.

At completion produce:
- architecture delta,
- files changed,
- removed/replaced code,
- tests added,
- full test results,
- API smoke results if run,
- remaining GTA-only unknowns,
- updated documentation,
- updated GTA smoke checklist.
  `,
};

export default e23Plan;