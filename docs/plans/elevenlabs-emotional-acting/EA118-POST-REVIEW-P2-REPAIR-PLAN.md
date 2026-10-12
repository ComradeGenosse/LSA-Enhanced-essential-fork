# EA PR #118 — P2 Review Findings Implementation Plan

Status: PLANNING ONLY. This document does not implement the fixes, change runtime defaults, authorize billed ElevenLabs synthesis, or approve GTA deployment.

- Repository: ComradeGenosse/LSA-Enhanced-essential-fork
- Reviewed PR: #118, integration/elevenlabs-emotional-acting-consolidated-20261012
- Exact pinned starting commit: 4db9eeea534ddf90a1eb0a173c7b7167d363a784
- PR #118 review ID: 5491108007
- Upstream provider base PR: #54; leave it separate
- Excluded: Memory K, M0–M9 integration, PR #114, persistent cross-avatar memory migrations
- This plan covers only two reviewed P2 defects plus integration verification.

## 0. Desired end state

1. A source-authenticated native protagonist heartbeat that arrives after the 1,500-ms *protagonist-proof* TTL, but before the existing 60,000-ms *native channel* reset, can establish a fresh protagonist proof on the same still-valid connection. The expired object never becomes valid again. A replay, changed model at the same revision, wrong host, world transition, socket replacement, older revision, source UNKNOWN, or native clock regression still fails closed.
2. No automatic ElevenLabs Text-to-Dialogue TTS retry can resubmit already-possibly-billable text after a provider attempt times out before the first PCM callback. This rule covers buffered speech and every early-streamed segment without altering OpenAI reasoning, transcription, Qwen, or stock scheduling.
3. Failed, cancelled, or incomplete provider calls still cannot create native playback completion, committed assistant history, or EA4 mood. All existing off/shadow payload parity and single-human-player emotional identity rules remain intact.

## 1. Implementation layout

Two **independent** code branches may be started at the pinned commit; one final integrator verifies and combines them. Do not have either agent modify the other's implementation or edit any Memory K branch.

| ID | Owner | Expected files | Branch suggestion |
|---|---|---|---|
| R1 | Native source authority | src/perception/protagonistAuthority.mjs; tests/ea5-native-protagonist-authority.test.mjs; tests/ea-final-a-native-intake.test.mjs; optionally tests/ea-final-h-unified-player.test.mjs | fix/ea118-r1-protagonist-heartbeat-recovery-20261012 |
| R2 | Provider retry safety | src/openai/runSequentialTurn.mjs; tests/ea-final-integration-wiring.test.mjs or dedicated tests/ea118-elevenlabs-retry-safety.test.mjs; optionally tests/ea8-elevenlabs-provider-safety.test.mjs | fix/ea118-r2-elevenlabs-single-submit-20261012 |
| R3 | Integration owner, after R1/R2 | Tests + release / CI evidence only; no cross-scope code changes unless separately justified | integration/ea118-p2-review-repair-20261012 |

Paths above are relative to lsa-essential-e1-candidate/ unless otherwise noted.

### General non-negotiables

- Keep native protagonist model as **authentication and event provenance**, never a partition in player identity, relationship or mood.
- Never make a JS/native claimed model a replacement for authenticated, ordered C-13 source frames.
- Native producer remains opt-in, with intact negotiated_v1 capability check and original host/world/session/revision/sequence validation.
- Do not create a second P2 SQLite store, remove selected-timeline confirmation, modify saved memories, or backport Memory K work.
- No GTA installation, real save mutation, ElevenLabs paid request, or automated deployment from this plan.
- Review evidence must quote an exact code commit, not only a test result on an older source branch.

## 2. R1 — Repair post-expiry same-stream protagonist heartbeat recovery

### Confirmed defect

In src/perception/protagonistAuthority.mjs, live() calls drop() whenever now - acceptedAt > freshMs. drop() erases last and acceptedSequence, but the independent host/maxRevision fence remains. The following valid, monotonic native heartbeat at exactly maxRevision fails the sameStream/heartBeat predicates because last is null, and IntelligenceClient closes the otherwise healthy C-13 pipe. The native shadow runtime permits up to 60 seconds before full channel reset; a 1.5–60 second source-proof gap is reachable.

### Required state split

Keep three separate concepts:

- Current proof object (reference identity granting current authority only).
- Last accepted native stream lineage + monotonic sequence + last source-certified model (used exclusively to validate a future source frame, **not** to grant NPC actions).
- Per-native-host maximum revision (existing anti-replay / ABA fence).

When the sole failure is proof TTL expiration on an otherwise healthy matching stream, invalidate only the current proof; retain the last native transport lineage and previous known model for checking a fresh heartbeat. This must not extend TTL or allow any action while fresh proof is missing.

When the failure is revoked/mismatched source, disconnected/replaced session, wrong epoch/stream/host, invalid clock, explicit revoke, or malformed frame, clear resumable lineage exactly as before. Keep the per-host maximum revision to reject old frames after replacement. Do not silently permit an equal revision on a replacement stream.

### Suggested minimal algorithm (design pseudocode; adapt to existing module)

~~~js
let current = null;
let last = null;                 // frozen accepted adapter/stream/host/epoch
let lastProtagonist = null;      // last SOURCE-ACCEPTED model; never a mood key
let acceptedAt = -1;
let acceptedSequence = 0;
let session = null, host = null, maxRevision = 0;

function revokeAllCurrentLineage() {
  current = null;
  last = null;
  lastProtagonist = null;
  acceptedAt = -1;
  acceptedSequence = 0;
  // Keep existing session / host / maxRevision anti-replay policy.
}

function proofIsLive() {
  const source = getNativeStream();
  const now = clock();

  if (!matchesAuthenticatedAcceptedLineage(source, session, last) ||
      !validOrderedNativeSequence(source, acceptedSequence) ||
      !Number.isFinite(now) || now < acceptedAt) {
    revokeAllCurrentLineage();
    return false;
  }

  if (now - acceptedAt > freshMs) {
    current = null; // INVALIDATE ONLY; do not reset valid transport lineage
    return false;
  }
  return current !== null;
}

function acceptAuthenticatedFrame(frame) {
  // Existing strict payload/source/version/host/epoch/stream and exact source
  // lastSequence === frame.sequence checks MUST stay in place.
  const payload = readProtagonistFrame(frame);
  const source = getNativeStream();
  const now = clock();
  if (!strictAuthenticatedFrameIsCurrent(payload, frame, source, now)) {
    revokeAllCurrentLineage();
    return false;
  }

  const sameStream = sameAcceptedLineage(session, last, source, frame, payload);
  const heartbeat =
    sameStream &&
    host === payload.hostRunId &&
    payload.revision === maxRevision &&
    lastProtagonist === payload.protagonist &&
    frame.sequence > acceptedSequence;

  // Strict prior-host revision monotonicity still wins, including known /
  // UNKNOWN transitions and Franklin -> Michael -> Franklin ABA.
  if (host === payload.hostRunId &&
      (payload.revision < maxRevision ||
       (payload.revision === maxRevision && !heartbeat))) {
    revokeAllCurrentLineage();
    return false;
  }
  if (sameStream && frame.sequence <= acceptedSequence) {
    revokeAllCurrentLineage();
    return false;
  }

  // Calculate pre-frame freshness even if no readVerified() ran during pause:
  // an expired old object must NEVER be resurrected or reused.
  const previouslyFresh = current !== null && acceptedAt >= 0 &&
    now >= acceptedAt && now - acceptedAt <= freshMs;
  const reuseSameProof = heartbeat && previouslyFresh;

  // Existing native-host reset / sequence updates and immutable lineage.
  if (host !== payload.hostRunId) { host = payload.hostRunId; maxRevision = 0; }
  maxRevision = payload.revision;
  session = source.sessionToken;
  acceptedSequence = frame.sequence;
  last = Object.freeze({
    adapterEpoch: frame.adapterEpoch,
    streamId: frame.streamId,
    hostRunId: payload.hostRunId,
    worldEpoch: payload.worldEpoch
  });
  lastProtagonist = payload.protagonist;
  acceptedAt = now;
  current = payload.protagonist === 'unknown' ? null :
    reuseSameProof ? current : Object.freeze({ ...payload });

  return true;
}
~~~

The sketch uses named helpers solely for clarity; it is not a recommendation to introduce public ingress, relax existing wire validators, or replace established predicates. In real code, keep the complete original validation (including current frame sequence == independently admitted native sequence) and explicitly reject clock regression at acceptance.

### R1 regression matrix (mandatory)

Implement deterministic clock/pipe fixtures with these cases:

- R1.01: accept Franklin revision R; after >1,500 ms but <60,000 ms, readVerified() is null and isCurrent(old) is false; accept later ordered Franklin revision R on unchanged authenticated stream; obtain a **new frozen proof reference**. Old reference stays false.
- R1.02: same sequence without a greater native frame sequence is rejected; clone/source-authored payload alone cannot authenticate.
- R1.03: expire without calling readVerified(); then accept same-stream unchanged R heartbeat. Must mint new proof (not reuse the object that silently aged out).
- R1.04: at revision R, a different model (Michael or Trevor) is **not** a legal heartbeat. Revision R+1 is required. Franklin R -> Michael R+1 -> Franklin R+2 never revives the original proof.
- R1.05: accepted UNKNOWN revokes current proof. UNKNOWN same-revision heartbeat stays neutral; known after UNKNOWN requires strictly greater revision.
- R1.06: socket replacement, session token change, host replacement, world epoch advance, explicit revoke, gap, replay, invalid payload or clock regression must not reuse expired proof or equal-revision old lineage.
- R1.07: if native whole-channel authority expires (>60,000 ms) or C-13 tears down, resumed old proof remains invalid; native renegotiation/actual new source proof is required.
- R1.08: EA4 turnSource pinning: a turn holding the pre-expiry proof cannot commit delayed mood after a new proof object is issued. A different eligible turn may consume the same NPC's unexpired soft mood only after independent P1/P2/save/host revalidation.
- R1.09: ordinary fresh heartbeats before expiry preserve current proof reference (no gratuitous mood invalidation).
- R1.10: negotiated opt-in/default disabled, C-13 protocol and native producer unchanged; tests around those contracts remain green.

### R1 acceptance

No incorrectly accepted known protagonist during expiry; no spuriously closed authenticated pipe on normal same-revision recovery; same-host revision/ABA and exact current native turn remain enforced. No native code change should be needed unless a failing authenticated pipe regression demonstrates otherwise.

## 3. R2 — Prevent duplicate ElevenLabs submissions after ambiguous timeout

### Confirmed defect

The current early-segment TTS path in src/openai/runSequentialTurn.mjs around line 274 and buffered TTS path around line 380 pass canRetry = () => !nativeHandoffStarted. That boolean becomes true only on first onPcm->forwardPcm, *after* the ElevenLabs provider sends its Text-to-Dialogue inputs WebSocket frame (src/providers/elevenlabs/speechProvider.mjs, around lines 246–254). With a shorter retry.attemptTimeoutMs and sufficient parent deadline, executeProviderOperation classifies attempt_timeout as retryable and may submit the same text again. Whether the vendor charges for either attempt cannot be observed from an offline run. Prevent duplicate submissions without claiming charge evidence.

### Chosen repair: conservative, zero-ambiguity no-retry policy for ElevenLabs TTS

**Do not** add an unauthenticated provider callback or cross-turn vendor ledger in this narrow fix. Completely disable *automatic retry of a single ElevenLabs speech operation*. This is the simplest fail-safe change and leaves retries for model, STT and other speech providers unchanged.

Introduce ONE shared TTS retry eligibility predicate in the original turn runner and reuse it in both speech sites:

~~~js
const canRetryTts = () =>
  !nativeHandoffStarted &&
  services.config.speechProvider !== 'elevenlabs';

// Early segment (currently around line 274):
await performProvider(
  'tts', services.providerStack.speech.id,
  (...) => services.speak(/* original parameters, unchanged */),
  canRetryTts
);

// Buffered final (currently around line 380):
await performProvider(
  'tts', services.providerStack?.speech.id || 'openai.speech',
  (...) => services.speak(/* original parameters, unchanged */),
  canRetryTts
);
~~~

The production implementation should place the predicate after nativeHandoffStarted is initialized and before either site uses it. Preserve the actual call arguments/telemetry, segmentation, output transcript, stock native playback/history semantics, and all normal cancellation/timeouts. Never rely on voice text, LLM output, provider result tagApplied, or first PCM timing to infer vendor billable state.

This **intentionally sacrifices retries for transient pre-send ElevenLabs failures** in favor of guaranteeing no automatic resubmission. Later optimization could add a trusted synchronous vendor-input-attempt fence to permit pre-submission retries, but only after it is independently tested against timeout/reentrancy and custom-provider implementations. That is not part of R2 acceptance.

### R2 regression matrix (mandatory)

- R2.01: fake WebSocket accepts 1 authenticated handshake and 1 text inputs frame, then never emits PCM/final. With retry.enabled = true, maxAttempts = 2, retry.attemptTimeoutMs short enough to leave parent budget, assert exactly **one** socket/text submission for one ElevenLabs buffered operation. Overall turn terminal != completed.
- R2.02: repeat R2.01 on an early-streamed segment (structuredStreamingEnabled + earlyTtsEnabled), with the same one-submission assertion; never dispatch next segment if preceding synthesis failed.
- R2.03: socket error after text submission and error before text submission both produce at most one ElevenLabs attempt (chosen conservative policy); no leaked socket or pending callback after retirement.
- R2.04: no PCM means no audio_turn_accepted / no output PCM / no native playback completion / no assistant history commit / no mood commit, including tagged text.
- R2.05: actual PCM delivered and completed still uses original provider result WeakMap brand; stock native playback+history must approve before mood, once only.
- R2.06: ElevenLabs off/shadow requests preserve the existing byte-identical untagged socket payload; experimental delivery sanitizer and verified tags unchanged.
- R2.07: OpenAI reasoning/STT retry rules and existing Qwen/OpenAI TTS retries are unchanged, including their native side-effect guard.
- R2.08: cancellation, timeout and supersession close the pending socket; no retry after a native handoff; return an accurate failed/timeout terminal without a manufactured playback receipt.
- R2.09: test explicitly runs through real executeProviderOperation (not a mocked executor that never retries), the original runSequentialTurn, and a fake WebSocket implementation. Test must demonstrate failing behavior before the fix and passing behavior after it.

### R2 acceptance

For each individual ElevenLabs speech operation the number of automatically attempted WebSocket input submissions is <= 1 even with retry.maxAttempts = 2, short attempt timeout and plenty of parent deadline. Keep one socket per segment, without accidentally suppressing intentionally distinct valid segments. This is a *per-segment/operation* contract, not a prohibition on the NPC speaking multiple sentences.

## 4. R3 — Final integration, verification and release decision

1. Each specialist starts from the exact pinned #118 HEAD above (or explicitly documents a newer base after reconciling). Keep R1 and R2 patches independent.
2. Open two draft code PRs against integration/elevenlabs-emotional-acting-consolidated-20261012, documenting their own exact base SHA, changed paths, pre-fix reproduction, post-fix tests, source-bound limitations and handoff.
3. Integrator reviews both diffs and merges/cherry-picks them into a single repair branch. Do not overwrite concurrent work, force-push other agents' branches, or modify main.
4. Run targeted suites first from lsa-essential-e1-candidate/:

~~~sh
node --test tests/ea5-native-protagonist-authority.test.mjs \
  tests/ea-final-a-native-intake.test.mjs \
  tests/ea-final-h-unified-player.test.mjs \
  tests/emotional-mood-continuity.test.mjs \
  tests/ea7-emotional-continuity-completion.test.mjs

node --test tests/ea8-elevenlabs-provider-safety.test.mjs \
  tests/ea-final-integration-wiring.test.mjs \
  tests/ea2-turn-lifecycle.test.mjs \
  tests/ea2-speech-delivery.test.mjs
npm test
~~~

5. Run exact-head GitHub Actions on Windows and Ubuntu for the consolidated EA0–EA9 acceptance workflow, combined G/H/EA9 acceptance, native Windows pinned RPH/Core production build and ABI tests. Check actual job step results/logs; do not carry green checks from old commit 4db9eeea into a new head.
6. Review built candidate and EA9 isolated release verification separately; seal release only from the actual fully tested source SHA. A CI pass does not establish physical GTA source/playback receipts or billed ElevenLabs v4 audio performance.
7. Require a fresh independent final PR review to confirm no regressions in native C-13 checks, persisted save confirmation, per-NPC perspective, model-vs-human identity, stock side-effect ordering, and partial PCM failure handling.
8. Explicitly report which gates are green and which remain unverified. Main/GTA experimental/production deployment all remain **NO GO** until real opt-in, source receipts, paid vendor authorization (if applicable), real audio A/B and rollback rehearsal are completed. No billing is authorized by these repair PRs.

## 5. Acceptance checklist

- [ ] R1 source freshness lapse yields no live current proof until a new accepted native frame.
- [ ] R1 same-revision/new-sequence heartbeat on unchanged authenticated stream recovers a *new* proof.
- [ ] R1 old proof reference is invalid forever after expiry; no ABA/replay or foreign-host model acceptance.
- [ ] R1 native unknown and exact host/world/session/socket revocations remain fail closed.
- [ ] R1 same human across all three story avatars; per-NPC temporary emotion not partitioned by model.
- [ ] R2 single ElevenLabs WebSocket text input per speech operation despite retry policy.
- [ ] R2 partial/failed audio never implies native playback/history/mood commit.
- [ ] R2 off/shadow exact raw payload parity and per-segment verified tag proof maintained.
- [ ] R2 model/STT and other vendor retry behavior unchanged.
- [ ] Exact-head targeted tests, complete Essential tests, Windows native pinned build and EA0–EA9 matrix all pass.
- [ ] External GTA and billable ElevenLabs tests are explicitly reported as not performed until actually authorized and run.
- [ ] Two independent specialist code PRs reviewed; final combined repair reviewed before updating #118.

## 6. What NOT to do

- Do not pretend a stale native protagonist proof is a currently valid game event.
- Do not automatically reuse an expired proof object after heartbeat recovery.
- Do not solve the error by removing protagonist detection; it is still required as source authentication, not as a separate player identity.
- Do not enable protagonistEvidence by default or weaken the native negotiated_v1 gate.
- Do not claim that the success of P2 SQLite schema checks proves the independent M0–M9 production work.
- Do not suppress the ElevenLabs timeout by allowing duplicate paid submissions or synthesize a fake native completion.
- Do not update or merge original PR #54, main, PR #114, or Memory K branches as part of this assignment.

## 7. Developer notes / source anchors

- src/perception/protagonistAuthority.mjs: live() 17–29, heartbeat checks 52–63, proof assignment 65–83
- src/perception/intelligenceClient.mjs: independent source getter 119–133, accepted frame gate 733–735
- src/perception/shadowRuntime.mjs: owner stall 1500ms, reset 60000ms, channelFresh()
- src/voice/emotion/moodRuntime.mjs: per-turn native proof WeakMap; validated playback/mood commit
- src/openai/runSequentialTurn.mjs: forwardPcm side effect (~119–151), early TTS (~274), buffered TTS (~380), playback+history+EA4 (~411–428)
- src/reliability/providerExecutor.mjs: attempt timeout / retry gate
- src/reliability/errorClassifier.mjs: attempt_timeout is retryable
- src/providers/elevenlabs/speechProvider.mjs: vendor socket inputs submitted around 246–254

Plan authored based on reviewed PR #118 at the pinned exact head. Specialist implementation must recheck source positions at their actual code heads.
