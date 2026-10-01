/**
 * E5 structured streaming + E6 early TTS implementation plan.
 * Planning artifact only: importing this module does not run a provider,
 * launch GTA, change configuration, or deploy files.
 * Paths in work items are relative to lsa-essential-e1-candidate/.
 */

// E5 uses strict JSON-schema Responses text and locally completed segment objects.
export const proposedFrameTools = [];

export const e56Plan = {
  schemaVersion: 1,
  title: 'E5 structured streaming and E6 early TTS for the Essential companion',
  createdOn: '2026-10-01',
  status: 'implemented-offline-and-live-api-verified-gta-gate-pending',
  baseline: {
    repository: 'https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork',
    sourceCommit: '4a2fc4a5d5f5c4020f022e963adbf19c186a6d2c',
    architecture: 'E1.1 native adapter + E2 providers/voice profiles + E3 retries + telemetry',
    reasoningModel: 'gpt-6-luna', reasoningEffort: 'low', speechModel: 'gpt-4o-mini-tts',
    lastKnownOfflineTests: { passed: 131, scope: 'Before the subsequent Windows logging fix; rerun current baseline during implementation.' },
    liveEvidence: {
      runId: '56a1c44a-fd1d-4d64-abfe-6900a1905fb7',
      completedTurns: 15, npcCount: 1,
      completedInputToPlaybackMedianMs: 2482.5,
      completedModelMedianMs: 1442.4,
      completedSttMedianMs: 524.7,
      completedTtsFirstPcmMedianMs: 494.2,
      interpretation: 'Small, single-NPC sample with an F4 Talk/console conflict; useful context, not a controlled performance baseline.',
      unverified: ['Live transient retry recovery', 'Multiple NPC voice assignment', 'Native behavior during long gaps between speech segments'],
    },
    phase10BEvidence: {
      turns: 13, audioAcknowledgedTurns: 11, maximumObservedPcmGapMs: 2980,
      source: 'User-reported earlier Phase 10B GTA stream-segments run; treated as prior open-stream evidence, not as validation of this E1.1 implementation or configured API endpoint.',
      architecture: 'One logical utterance, ordered serial TTS, and one final speechEnded.',
    },
    knownFollowups: [
      'Cancelled attempt spans can remain open; cancellation reasons are currently stripped by telemetry sanitization.',
      'LSPDFR initialization failed and Policing Redefined was unavailable in the test install; do not count those integrations as validated.',
      'Remap the conflicting Talk key before live timing comparisons.',
    ],
  },

  goals: {
    E5: 'Stream a bounded strict JSON envelope over Responses SSE and expose only complete locally validated segment objects; reconcile the complete terminal decision before final transcript/action publication.',
    E6: 'Start synthesis and native-authorized playback of an immutable safe segment while the same reasoning response continues producing later segments.',
    scopeDecision: 'First release permits early playback only for dialogue_only turns. Action-bearing turns use the validated buffered path. This is an explicit safety/latency tradeoff.',
    performanceClaim: 'E5 alone promises framing and lifecycle correctness. E6 promises measurable overlap; the amount of latency saved must be measured, not assumed.',
  },

  invariants: [
    'Essential allocates the native turn and generation and remains the only playback/action authority.',
    'Every record, queued segment, callback, authorization, and terminal result is pinned to pedId + turnId + generationId + sessionNonce.',
    'Native identity is supplied by the adapter; never accept model-generated identity as authority.',
    'Never JSON.parse partial text. Complete SSE events are transport frames; only closed locally validated segment objects are exposed before final response reconciliation.',
    'A completed segment is immutable. Later output cannot replace text already submitted to TTS.',
    'A dialogue_only declaration is irrevocable: a later nonempty command is a protocol violation, not an action to execute.',
    'Syntactic schemas cannot prove arbitrary natural-language consistency. Prompts, bounded segments, evaluation, and the action barrier provide the actual safeguards.',
    'One turn has one native authorization, one ordered PCM stream, and one generation_complete/turn_complete handoff, regardless of segment count.',
    'Segment completion is not turn completion. EOF, a final model frame, and native buffer drainage alone are not success.',
    'Assistant history commits only after model completion, full decision validation, all TTS success, final stream-end handoff, and matching successful native PlaybackEnded.',
    'Player input remains durable once accepted. SPECIAL_EVENT/system input never becomes a player utterance.',
    'No model replay or automatic fallback after final transcript publication. No provider retry after action-bearing transcript publication, native authorization, or first PCM handoff; preserve E3 dialogue-only pre-PCM TTS retry eligibility.',
    'Stock Gemini stays on its existing path; existing voice/model/speed/acting choices remain fixed for the whole turn.',
  ],

  framing: {
    primaryProtocol: 'E1 segmented decision v1: one strict JSON-schema Responses output streamed over SSE; complete segment JSON objects are locally parsed before exposure, and the full terminal output is reconciled.',
    request: {
      endpoint: 'responses', model: 'config.reasoningModel', stream: true, store: false,
      schema: { mode: ['dialogue_only', 'buffered_action'], segments: [{ text: 'bounded spoken phrase' }], command: 'empty or one Essential DO command' },
      history: 'Continue explicit bounded text history. Streaming records are attempt-local and never appended to history before successful matching PlaybackEnded.',
      compatibilityGate: 'The configured model/endpoint must emit a complete validated segment before response.completed in the live API smoke. Do not silently substitute another model.',
    },
    acceptFrameAt: 'response.output_text.delta only after a complete closed segment object has been parsed and locally validated; the entire envelope is parsed only at terminal completion.',
    ignoredForSpeech: ['Reasoning items and reasoning summaries'],
    responseTerminal: 'Require response.completed with status completed and one assistant output whose complete text exactly equals all received deltas.',
    frameOrder: ['mode first by strict schema order', 'one to maxSegments ordered complete {text} segment objects', 'one final command field'],
    transportOrder: 'Decode split UTF-8/SSE framing in order; bind text deltas to the one assistant output index and item id.',
    duplicatePolicy: 'Reject duplicate JSON keys, malformed nesting, output identity changes, segment order/count/size errors, and any conflicting final output.',
    reconciliation: 'Strictly parse the whole terminal JSON, freeze ordered segments, reconstruct canonical dialogue, and pass it through existing Essential decision/stock validators.',
    textRules: [
      'Normalize each completed segment once and freeze it; join canonical segments with one space to form the final dialogue.',
      'Apply control-command, pipe, control-character and size rejection to each segment and to the reconstructed dialogue; reject empty content.',
      'Only the final command can enter the stock command validator. Do not send raw model text deltas or per-segment transcripts to the stock action listener.',
    ],
    alternativeIfGateFails: 'Keep both flags off and retain the sequential provider route; do not parse arbitrary incomplete JSON or substitute unstructured text.',
  },

  proposedConfig: {
    structuredStreamingEnabled: false, earlyTtsEnabled: false,
    streamingMaxOutputTokens: 600,
    streamingMaxSegments: 6, streamingMaxSegmentChars: 240, streamingMaxDialogueChars: 1200,
    maxSseEventBytes: 65536, maxResponseBytes: 262144,
    ttsConcurrency: 1, maxPrefetchedSegments: 0,
    notes: [
      'Starting values for measurement, not performance promises. Validate bounded ranges and reject earlyTtsEnabled without structuredStreamingEnabled.',
      'One TTS request runs at a time. Only a bounded number of short segment texts can wait; PCM is streamed directly through the existing awaited native handoff.',
      'Use the existing absolute provider-work deadline and playback watchdog limits. Never reset a clock for a segment, retry, or protocol transition.',
      'Require an explicit capability declaration for streaming providers. Keep sequential defaults for deployments until the live gates pass.',
    ],
  },

  execution: {
    E5: [
      'Accept input and commit player history once using the existing source rules.',
      'Consume strict-schema Responses SSE into attempt-local frozen complete segment records; never parse a partial root object.',
      'Require response.completed and exact output-text reconciliation; reconstruct { dialogue, command } and run existing shape/stock validators.',
      'Stage assistant history, publish the single final output_transcript, and invoke the existing whole-dialogue TTS/native path.',
    ],
    E6: [
      'After the leading dialogue_only mode and first complete valid segment, begin synthesis while reasoning consumption continues.',
      'Use the same immutable voice profile for every segment and exactly one serial TTS consumer; never prefetch PCM or run concurrent TTS.',
      'The ordered consumer forwards segment 1 before segment 2, etc.; pending text is bounded by configured segment count and lengths.',
      'Before the first authorization call, close the shared retry/effect gate. Authorize once and await the matching native acceptance before forwarding PCM.',
      'On final successful response, validate the assembled empty-command decision and publish exactly one output_transcript; a late command in dialogue_only fails and interrupts that exact turn.',
      'Stage final assistant text once, await every admitted TTS job, and mark the model/TTS gates successful.',
      'Only after model completion + final validation + all segments forwarded + no pending writer callback, send generation_complete then turn_complete once.',
      'Use aggregate PCM duration for the watchdog and commit assistant history only on the matching successful PlaybackEnded.',
    ],
    actionBearing: 'buffered_action stays behind the full model/validation barrier. Preserve existing action-before-TTS publication and its E3 retry prohibition.',
    partialFailure: 'Fail/interrupt the exact turn, abort reasoning and all segment requests, drain/release local queues, discard staged assistant history, and preserve accepted player history. Already played words cannot be undone; queued/forwarded bytes are not proof of which words were heard.',
    stateModel: 'Track independent reasoning, queue, native authorization, native playback, and terminal latches. A single linear model_running -> tts_running state cannot describe overlap correctly.',
  },

  reliability: {
    attemptOwnership: 'The reasoning operation promise must include consuming/validating the entire stream. Returning an AsyncIterable immediately must not count as a successful provider attempt.',
    beforeEffects: 'Reuse E3 transient allowlist and two-attempt cap. Reasoning may retry only before a segment is accepted for early playback. Segment TTS may retry only before any native authorization/PCM effect; later segment retries stop after first handoff.',
    afterEffects: 'Conservative turn-wide gate: no reasoning or speech retry after action-bearing transcript/action publication, native authorization, or PCM handoff, even if a later segment itself forwarded zero bytes. Any final transcript also closes reasoning replay/fallback.',
    cancellation: 'One root AbortSignal reaches SSE reader, queue waits, TTS fetches, authorization waits, writer callbacks, and playback observation. Terminal disposition wins once; late work cannot reopen it.',
    segmentAttempts: 'Every segment inherits the immutable native turn identity; each provider attempt remains separately fenced by the existing E3 attempt executor.',
    cleanup: 'Close/cancel readers on all paths, observe all worker rejections, wake blocked queue producers/consumers, close spans as cancelled, and free buffers. No ignored background promises.',
    protocolFailures: 'Malformed/contradictory frames, refusal, incomplete output, final mismatch, and invalid commands are semantic failures; they are not transient retry candidates.',
  },

  stages: [
    {
      id: 'E56P', title: 'Baseline, lifecycle map, and measurement repair', dependsOn: [],
      files: ['src/observability/telemetry.mjs', 'src/observability/eventContract.mjs', 'src/reliability/providerExecutor.mjs', 'tools/summarizeRun.mjs', 'tools/buildCandidate.mjs'],
      work: [
        'Record actual branch/commit, instructions, current suite result, native/source fingerprints, and pre-existing edits.',
        'Document native authorization, transcript/action publication, first PCM, source identity binding, generation_complete, turn_complete, PlaybackEnded, and cleanup ordering.',
        'Repair cancelled-span bookkeeping and retain only allowlisted cancellation reasons. Separate interrupted/failed turns from completed latency.',
        'Capture a clean single-press sequential baseline with multiple NPCs before performance comparison.',
      ],
      exit: ['Current offline baseline passes.', 'The native/transcript dependencies are documented.', 'Baseline timings exclude capture from input-ready latency and record interrupted runs separately.'],
    },
    {
      id: 'E5A', title: 'Typed frame contract and strict assembler', dependsOn: ['E56P'],
      addFiles: ['src/openai/segmentDecoder.mjs', 'tests/streaming-decision.test.mjs'],
      work: [
        'Implement strict JSON schema mode/segments/command records and provider-neutral frozen segment values with locally bound identity/attempt fences.',
        'Implement contiguous segment ordering, immutability, duplicate/conflict rules, local text/command limits, and terminal reconciliation.',
        'Freeze dialogue_only mode before releasing a segment. Validate the final reconstructed decision through existing validators.',
      ],
      exit: ['Malformed, oversized, reordered, conflicting, missing-final, extra-frame, and late-action traces fail closed.', 'Only complete validated records are visible to consumers.'],
    },
    {
      id: 'E5B', title: 'Bounded Responses stream adapter', dependsOn: ['E5A'],
      addFiles: ['src/openai/streamDecision.mjs', 'tests/streaming-decision.test.mjs'],
      modifyFiles: ['src/openai/decide.mjs', 'src/providers/openai/reasoningProvider.mjs', 'src/providers/providerStack.mjs', 'src/context/essentialDecision.mjs', 'src/config/e1Config.mjs'],
      work: [
        'Use the configured Responses endpoint/credential with stream:true and strict JSON schema, preserving context/history/source rules.',
        'Decode split UTF-8 and complete SSE event frames with bounded buffers, composed cancellation, deadline enforcement, sanitized errors, and reader cleanup.',
        'Bind response text deltas to one assistant output index/item id; ignore reasoning summaries and refuse unsupported output.',
        'Consume the entire response within the E3 attempt; read terminal usage and reconcile complete output without re-emitting records.',
      ],
      exit: ['Fixtures split at arbitrary byte boundaries produce identical canonical records.', 'EOF without response.completed, failed/incomplete/refusal, cancellation, and ignored late callbacks cannot appear successful.'],
    },
    {
      id: 'E5C', title: 'Integrate structured output behind the final barrier', dependsOn: ['E5B'],
      addFiles: ['tests/openai-transport.test.mjs'],
      modifyFiles: ['src/integration/essentialGlue.mjs', 'src/openai/openaiConnection.mjs', 'src/openai/runSequentialTurn.mjs', 'e1.config.example.json', 'tools/buildCandidate.mjs'],
      work: [
        'Select sequential or structured-buffered mode once per turn; consume E5 records and return the existing validated decision type.',
        'Keep one STT/player commit, one final output_transcript/action dispatch, the single TTS consumer, and the existing native/history completion boundary.',
        'Preserve stock Gemini and pin any changed AST integration matches. Add build manifest feature/protocol metadata.',
      ],
      exit: ['Early TTS remains off and E1.1/E2/E3 lifecycle regressions pass.', 'Actions and transcripts remain final-only and appear at most once.'],
    },
    {
      id: 'E5V', title: 'Verify Luna framing and actual incremental delivery', dependsOn: ['E5C'],
      addFiles: ['tools/streamingApiSmoke.mjs', 'docs/e5-e6-streaming.md'],
      work: [
        'Run the explicit gated one-request API smoke for dialogue_only using the configured Luna model; offline fixtures cover buffered_action, Unicode framing, refusal, truncation, and segment bounds.',
        'Record validated segment timestamps relative to response.completed. A model that emits all content at the terminal event demonstrates E5 only, not E6 overlap capability.',
        'Verify schema acceptance, prompt obedience, event shapes, token budget, and exactly one Responses request.',
      ],
      exit: ['The exact model/endpoint/protocol capability is evidenced.', 'Incremental segment delivery before full response completion is demonstrated before E6 activation.'],
    },
    {
      id: 'E6N', title: 'Reuse prior native open-stream evidence; verify current Essential boundary', dependsOn: ['E5C'],
      files: ['src/integration/nativeDelivery.mjs', 'tools/verifyNativeContract.mjs', 'docs/native-metadata.json', 'tools/buildCandidate.mjs'],
      work: [
        'Preserve Phase 10B evidence (13 turns, 11 with audio/acknowledgements, largest PCM gap about 2.98 seconds) as strong prior open-stream evidence; it does not validate this E1.1 path or configured API endpoint.',
        'Verify in a controlled GTA session that one authorization carries these segmented TTS requests and the final empty-command transcript cannot restart or clear audio.',
        'Test several-second gaps between PCM segments under one authorized generation, then a single stream-end handoff. No successful PlaybackEnded may occur before explicit final stream end.',
        'Determine actual native/socket queue limits and backpressure. If additional native support is necessary, implement it in reviewed native source, preserve native authority, and deliberately update protocol/fingerprints.',
      ],
      exit: ['Prior stream-gap evidence is preserved and exact native identity remains unchanged.', 'Queue drainage is not final success before stream end.', 'Current in-game confirmation remains a release gate; E6 stays opt-in until it passes.'],
    },
    {
      id: 'E6A', title: 'Concurrent turn context and one effect fence', dependsOn: ['E5V'],
      addFiles: ['src/streaming/streamingTurnContext.mjs', 'tests/streamingEffectFence.test.mjs'],
      modifyFiles: ['src/openai/runSequentialTurn.mjs', 'src/observability/eventContract.mjs'],
      work: [
        'Create a turn-local concurrency context that observes Essential identity and owns only provider work, queues, immutable records, terminal latches, and an effect fence.',
        'Fence every consumer by native identity + reasoning attempt + segment sequence + segment attempt.',
        'Close retry eligibility before authorization/output effects, not after an awaited callback. Abort all work on cancellation, supersession, disconnect, rejection, deadline, or malformed terminal output.',
        'Permit transient retries only before effects; reset attempt-local records and speculative queues atomically without repeating player acceptance.',
      ],
      exit: ['Race fixtures cannot authorize twice, replay a segment, publish stale bytes, or revive a retired turn.', 'Model retry consumes one complete attempt, never an unconsumed iterator.'],
    },
    {
      id: 'E6B', title: 'One serial segmented TTS consumer', dependsOn: ['E6A', 'E6N'],
      addFiles: ['tests/openai-transport.test.mjs'],
      modifyFiles: ['src/openai/speak.mjs', 'src/providers/openai/speechProvider.mjs'],
      work: [
        'Schedule the first complete safe segment immediately; keep one active TTS request and no PCM prefetch.',
        'Use the immutable session voice profile and exact frozen segment text. One consumer preserves segment order.',
        'Bound segment count, text, request time, aggregate provider-work deadline, and awaited native sends; do not silently drop or reorder audio.',
        'Keep 24 kHz mono signed little-endian PCM16. Align bytes within each request, never carry a trailing byte into another segment, and fail malformed/truncated or empty segment audio.',
        'Measure startup buffering and segment seam gaps. Do not invent silence, crossfade, or timing authority to hide native incompatibility.',
      ],
      exit: ['Segments synthesize strictly in order with one active TTS request.', 'Cancellation wakes the consumer and closes the response reader.', 'No speculative PCM/lookahead queue exists.'],
    },
    {
      id: 'E6C', title: 'Early playback integration and final lifecycle barrier', dependsOn: ['E6B'],
      addFiles: ['tests/openai-transport.test.mjs', 'tests/streaming-decision.test.mjs'],
      modifyFiles: ['src/openai/runSequentialTurn.mjs', 'src/openai/openaiConnection.mjs', 'src/integration/essentialGlue.mjs', 'src/integration/nativeDelivery.mjs', 'src/memory/dialogueHistory.mjs', 'tools/buildCandidate.mjs'],
      work: [
        'Subscribe to matching native lifecycle before output, then use E6 execution ordering with one authorization and one ordered writer.',
        'Allow early playback only after dialogue_only plan plus validated segment. Any later command or model revision fails/interrupts the exact generation.',
        'Keep action-bearing turns on the buffered route. Publish the full final transcript only once; no segment-level stock action/transcript events.',
        'Latch model completion, full validation, serial TTS completion, stream end, and matching native completion. Commit assistant history once only when all succeed.',
        'Maintain the original provider-work deadline until the final handoff. Arm one playback completion watchdog using aggregate duration.',
        'On failure after partial speech, preserve player input, discard staged assistant reply, and record partial forwarding without claiming a delivered prefix.',
      ],
      exit: ['First PCM/native playback can occur before reasoning completion on eligible turns.', 'There is one generation_complete and one turn_complete after the last segment.', 'No partial assistant history or success on early native termination, late refusal, missing final, or partial TTS failure.'],
    },
    {
      id: 'E6V', title: 'Fault, listening, and latency validation', dependsOn: ['E6C'],
      addFiles: ['tests/streaming-decision.test.mjs', 'tests/openai-transport.test.mjs'],
      modifyFiles: ['src/observability/telemetry.mjs', 'src/observability/eventContract.mjs', 'tools/summarizeRun.mjs'],
      work: [
        'Cover interruption before headers, during segment 0, between segments, during final validation, and after final stream end; also rapid successor turns and disconnects.',
        'Inject transient failures before effects and confirm one safe retry; inject any failure after effects and confirm no replay/retry or duplicate action/history.',
        'Test stream fragmentation, delayed/out-of-order/duplicate items, malicious commands in speech, late action contradiction, model refusal/incomplete final, TTS odd tail/empty output, and native rejection/early completion.',
        'Run live single-press cases with multiple NPCs, action turns, listening checks for seams/prosody/voice stability, and deliberately delayed segment delivery.',
        'Compare at least 40 eligible completed turns per mode with matching model/voice/context and randomized mode order. Report source/action classes and every excluded/failure/interrupted turn separately.',
      ],
      exit: ['All current regressions and new fault cases pass.', 'Provider/native overlap is observed without ordering/history regressions.', 'Controlled metrics demonstrate an improvement before calling E6 a performance success; otherwise retain opt-in status and report the measured bottleneck.'],
    },
    {
      id: 'E56R', title: 'Release evidence and reversible rollout', dependsOn: ['E6V'],
      files: ['e1.config.example.json', 'README.md', 'docs/e5-e6-streaming.md', 'docs/verification.md', 'tools/buildCandidate.mjs', '../deployment/DEPLOYMENT.md'],
      work: [
        'Document feature flags, frame version, action policy, bounds, partial-delivery semantics, capability evidence, and measured results.',
        'Build with pinned source/native contracts and payload hashes. Commit the final source, tests, and documentation.',
        'For an authorized live rollout, back up and hash-verify the current install, preserve private/live config values, deploy the built payload, and check a new telemetry run.',
        'Rollback by selecting sequential mode for the next turn or restoring the verified payload; never restart/fallback an already affected generation.',
      ],
      exit: ['The release record distinguishes offline, API, native, listening, and performance gates.', 'A reproducible build and backup/rollback path exist.', 'No unresolved native capability gate is represented as complete.'],
    },
  ],

  telemetry: {
    newEvents: ['model_first_content_delta', 'stream_segment_validated', 'stream_tts_segment_started', 'stream_tts_segment_finished'],
    dimensions: ['segmentSequence', 'segmentChars', 'earlyPlayback', 'streamEndCount'],
    timings: ['inputReady -> firstCompletedSafeSegment', 'firstCompletedSafeSegment -> TTS request', 'TTS request -> firstPCM', 'inputReady -> firstForwardedPCM/nativePlaybackStarted', 'firstPCM -> reasoningCompleted overlap', 'segment seam gap', 'inputReady -> finalStreamEnd', 'inputReady -> nativePlaybackEnded'],
    privacy: 'Extend explicit event/field/token allowlists. Do not log segment text, prompts, transcripts, credentials, raw API errors, or raw provider identifiers.',
    performanceGate: {
      target: 'At least 20% lower median input-ready-to-playback-start latency for eligible dialogue-only turns versus the matched sequential run.',
      guardrails: 'Target is provisional: no unexplained p95 regression, no increased non-user failure rate, no perceptible repeated words/out-of-order segments, and no unbounded memory or unacceptable seam gaps.',
      interpretation: 'Do not present the earlier 2.48-second median as a randomized control or promise subsecond replies. STT, reasoning before the first frame, and initial TTS remain on the critical path.',
    },
  },

  example: {
    providerEnvelope: { mode: 'dialogue_only', segments: [{ text: 'Yeah, I saw him.' }, { text: 'He went toward the parking lot.' }], command: '' },
    requiredOverlap: 'In a passing E6 run, segment 1 synthesis and authorized playback begin before response.completed, while every segment keeps the same native identity.',
    contradictoryTrace: 'If a dialogue_only turn later supplies DO flee, reject it and interrupt any open audio. Never dispatch that command or replay the turn to repair already heard speech.',
  },

  deferredExtensions: [
    'Early action-bearing playback would require an immutable validated action commitment before speech and reviewed dispatch timing; it is not enabled by this v1 plan.',
    'Delivered-prefix assistant history requires native segment-level delivery evidence and a deliberate history-policy change.',
    'Voice acting/model upgrades, live microphone/STT streaming, filler speech, speculative alternative answers, Realtime migration, and police integration repairs are separate work.',
  ],

  sources: [
    { url: 'https://developers.openai.com/api/docs/models/gpt-6-luna', supports: 'Luna streaming and structured-output capability; configured account/endpoint still requires a live gate.' },
    { url: 'https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create', supports: 'Response stream events and the distinction between completed output items and completed response.' },
    { url: 'https://developers.openai.com/api/docs/guides/streaming-responses', supports: 'Typed streaming event lifecycle and incremental output.' },
    { url: 'https://developers.openai.com/api/docs/guides/text-to-speech', supports: 'Streaming speech responses and raw 24 kHz mono PCM16 format.' },
  ],
};

// A plan consistency check; runtime behavior is covered by the candidate tests.
export function validatePlan(plan = e56Plan) {
  const ids = new Set();
  for (const stage of plan.stages) {
    if (ids.has(stage.id)) throw new Error(`Duplicate stage: ${stage.id}`);
    ids.add(stage.id);
  }
  const complete = new Set();
  const visiting = new Set();
  const visit = id => {
    if (!ids.has(id)) throw new Error(`Unknown dependency: ${id}`);
    if (visiting.has(id)) throw new Error(`Dependency cycle: ${id}`);
    if (complete.has(id)) return;
    visiting.add(id);
    const stage = plan.stages.find(item => item.id === id);
    for (const dependency of stage.dependsOn) visit(dependency);
    visiting.delete(id); complete.add(id);
  };
  for (const id of ids) visit(id);
  if (plan.proposedConfig.earlyTtsEnabled && !plan.proposedConfig.structuredStreamingEnabled) throw new Error('Early TTS requires structured streaming.');
  return { valid: true, stages: ids.size, protocolTools: proposedFrameTools.length, implementationStatus: plan.status };
}

export default e56Plan;
