# Memory K NPC speech ledger and UX4 committed-target feedback — implementation plan

**Status:** planning only; no runtime, config, database, or native DLL changes in this PR.  
**Repository:** `ComradeGenosse/LSA-Enhanced-essential-fork`  
**Integration target:** draft PR #138, `integration/memory-k-production-20261012`  
**Code baseline inspected:** `cb39610698dd10870f3eb35656605a2264177ae4` (October 16, 2026). Re-read changed sources against the then-current #138 head before implementation.  
**Out of scope:** merging/deploying #138, closing or changing #184, rewriting Essential targeting, proximity listening, voice-provider changes, save/timeline auto-resume, and any database migration.

## 1. User-visible problems and evidence

1. In the October 16 GTA log review, successful promoted-NPC playback coexisted with repeated `memory_journal_not_committed(role=npc, reason=d03_npc_no_outcome)`. Player-side dialogue persistence and H1/H2 recall were substantially healthier. A completed audio turn is **not**, by itself, a verified durable NPC journal entry.
2. The player told an ambient/ephemeral NPC that Vladimir was a Pomsky while expecting to be talking to Nathan. Nathan later did not know that fact, then remembered it after being told directly. A different native ped received the first statement. This is evidence of a *target-identity visibility problem*, not proof that H2 recall lost a saved Nathan fact.
3. The ambient NPC could have the same voice as Nathan. **Voice, model, apparent name, position, ped handle alone, or selected-preview UI must never be treated as P1/P2 identity proof.**

These are two independent changes. Implement/review them separately, or as separately testable commits, then integrate only after their respective acceptance gates.

## 2. Root-cause audit: NPC speech ledger

**Confirmed source mismatch:**

- `lsa-essential-e1-candidate/src/openai/segmentDecoder.mjs` emits streamed `segment.sequence = emitted + 1`; the first structured `dialogue_only` segment is **1**.
- `lsa-essential-e1-candidate/src/openai/streamDecision.mjs` propagates that sequence unchanged to `onSegment`.
- `lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs` passes `segment.sequence` unchanged to `speech?.beginSegment(...)` in the early/structured streaming branch (around line 323).
- `lsa-essential-e1-candidate/src/memory/npcSpeechDeliveryLedger.mjs` requires each ledger `beginSegment({sequence})` to equal `e.segments.length`; its first accepted segment is **0**. A first call with 1 sets `poisoned=true` and returns null. Subsequent `finalized()` cannot certify completion; `evaluate()` returns no outcome; D03 emits `d03_npc_no_outcome`.
- Buffered/non-streaming TTS already passes `sequence: 0` near `runSequentialTurn.mjs:433`. The standalone WS-5a ledger tests use zero-based sequences, so the streaming integration mismatch escaped coverage.
- `runSequentialTurn.mjs` still correctly sends speech and can commit in-RAM history when the optional ledger is poisoned. This explains why audible success and missing *durable NPC* journal receipts can coexist.

**Working hypothesis scope:** the off-by-one *definitively exists* on inspected #138 source and accounts for missing ledger evidence on successful structured-streaming turns. It is not proof that every missing NPC outcome in every mode has this cause. Instrument/test native playback evidence, PCM mismatches, owner corroboration, and interruption separately if any `d03_npc_no_outcome` remain after correction.

### 2.1 Preferred minimal implementation

**Change only the call-boundary numbering, not the stream decoder or the ledger contract.**

`runSequentialTurn.mjs` (structured `dialogue_only` branch only):
```js
// Decoder/public streaming segments are 1-based; private WS-5a
// speech-ledger segments are 0-based. Never renumber streamed
// model events, telemetry, or TTS queue identity.
const ordinal = segment.sequence;
const ledgerSequence =
  Number.isSafeInteger(ordinal) && ordinal >= 1
    ? ordinal - 1
    : null;
const ledgerSegment = speech?.beginSegment({
  sequence: ledgerSequence,
  text: segment.text,
});
```
Proposed pseudocode; retain existing best-effort try/catch and ensure null/invalid ordinals **deny** evidence rather than accidentally defaulting to zero. Prefer a tiny pure `streamOrdinalToLedgerIndex()` helper local to runner, or an explicit contract helper if tests demonstrate multiple consumers need it. Keep `segment.sequence` unchanged for `stream_tts_segment_started/finished`, the streaming response contract, and `streamDecision`.

**Must preserve:** zero-based buffered `beginSegment({sequence:0})`; `forwarded(bytes)` only after `host.emit` acceptance; `completed(providerBytes)` equality; `finalized()` only after real `turn_complete`; exact `NpcSpeechDeliveryEvidenceV1` identity; native `playback_ended(completed)` and `DialogueHistory.acceptPlaybackResult` corroboration. Do not make D03 journal writes from an unverified model reply, TTS completion, or UI impression.

### 2.2 Tests, diagnostics, and acceptance

**Files to extend/add:**
- `lsa-essential-e1-candidate/tests/memory/ws5aJournalAndLedger.test.mjs`: retain existing zero-based direct ledger tests; add explicit assertion that a raw 1-based first segment is rejected, no "tolerate both" ledger behavior.
- `lsa-essential-e1-candidate/tests/streaming-decision.test.mjs`: verify decoder still emits 1,2,... in the public structured response.
- Add an **actual runner-to-ledger integration test** under `lsa-essential-e1-candidate/tests/memory/` (or extend the nearest existing runner suite), using `runSequentialTurn` plus the real `createNpcSpeechDeliverySource` and controlled provider/native receipts. This must traverse the structured `onSegment` path rather than manually constructing zero-based `beginSegment` calls.
- Cover one segment, 2–6 segments, buffered fallback, exact PCM byte parity, incomplete PCM, malformed ordinal, duplicate/out-of-order/gap, interrupted speech, playback rejection, delayed/foreign tuple playback events, same-ped new session/generation, provider failure, disconnect, revoked source and changed timeline. Ensure none produce a spurious `completed` durable NPC reply.
- Exercise `D03.recordNpcOutcome()` and actual P2 SQLite readback for the positive case: exactly one NPC journal row with `reply_to` the durable player line, matching text/delivery/provenance; no duplicate/stale row on replay.
- Include a representative ElevenLabs-style PCM chunking fixture (mock bytes only; **no live API/network call**). Provider byte-total mismatch must still deny completion.
- Assert old player-side journal, M5 command receipt, H1 history projection, H2 factual recall and existing stored SQLite data behavior are unchanged.
- If an actual one-based structured stream reaches `beginSegment` as index 1 after fix, test fails.
- Recommended bounded scalar diagnostic (only if needed after the focused fix): `speech_ledger_first_segment_invalid` or a small reason enum at evidence-generation boundary, not text/PCM/secret dumps and not a blanket downgrade of `d03_npc_no_outcome`.

**Offline acceptance:** structured-streaming happy path yields verified native playback, RAM-history acceptance, non-null speech-ledger `completed`, then one durable D03 NPC journal row. No false positive for any interrupted/stale/unproven variant. Existing WS-5a and full relevant companion suite green.  
**Live GTA acceptance:** 5–10 authentic Nathan voice turns with structured streaming and ElevenLabs; match each terminal completion to `memory_journal_committed(role=npc)` and review remaining denial reasons. Record build hash and note that server-only source edits are not deployed until the companion is rebuilt and installed.

## 3. UX4 talk-target feedback: clarify **who actually received** the turn

### 3.1 Current behavior and constraints

- `native/enhanced/Input/TalkTargetInput.cs` maps **tap** to an explicit bracket/cycle preview and **direct hold** to `talk.ptt_start(selectFirst=true)`. Selection already displays only a generic `Target n/m` HUD. On a successful start it changes internal state but does **not** show the committed recipient.
- `native/promoted-characters/TalkTargetSelector.cs`: direct hold selects the best current ped, calls `NpcTargeting.SetPlayerConversationPed(ped)`, then `InputController.SendMicStart(ped)`; the deliberate no-bracket direct-talk UX remains. Explicit hold revalidates the frozen selected ped. The selector already returns `pedId`, `encounterId` and `started`, but they are not trustworthy display names.
- `native/promoted-characters/NativeCommands.cs` `CurrentView()` already distinguishes native owned vs non-owned encounters using the P2 registration roster and publishes `ownerAlias` only for an owned character. It is **not** a display-name provider. `PromotedCharactersIntegration` owns the live `Encounter` roster and matching P1 registrations.
- `native/promoted-characters/TalkTargetIndicator.cs` renders the existing explicit preview bracket/ordinal from Core Update through `Game.FrameRender`.
- `docs/UX4-talk-targeting-status.md` explicitly says stock **Text** has independent `GetBestConversationPed` targeting. This improvement covers UX4-controlled **mic** turns; do **not** claim to fix text-input retargeting or stock Talk when UX4 is disabled.
- Identity is based on current ped **plus exact native address/incarnation/current P1 owner proof**, not ped handle, voice, label, model, or prior selection. Avoid a blocking SQLite/HTTP/pipe lookup on the GTA game fiber.

### 3.2 Preferred MVP behavior (feedback only; no target-behavior change)

At a **successfully committed** `talk.ptt_start`, have the existing UX4 HUD show one concise, short-lived notice:

- `Talking to: Promoted NPC` when the **committed exact ped** currently has fresh verified P1/P2 promoted ownership.
- `Talking to: Nearby NPC` when the committed exact ped is known not to be a currently promoted/owned NPC.
- `Talking to: NPC (identity unavailable)` if the ownership lookup cannot be performed or cannot be safely corroborated. **Do not call this Nathan** and do not infer it from his ElevenLabs voice.

A tap/cycle may show `Target 2/3 · Promoted NPC` / `Nearby NPC` when the same evidence is available, retaining the existing bracket and timeout behavior. The decisive HUD confirmation must follow the **native commit result**, not preview, button-down, request acceptance, or model response. **No toast** if start is cancelled, rejected, target lost/changed, or mic ownership transferred. Do not display repeated "talking" popups per game tick; emit once per committed generation/target, with optional short throttle of identical statuses.

For the Vladimir mistake, hearing an ambient NPC use the same voice would still be possible, but a prompt `Talking to: Nearby NPC` would identify the actual conversation destination.

### 3.3 Identity-resolution contract and API sketch

Implement a *read-only, bounded* native feedback resolver using the existing P2 owner roster; do not create new ownership or character records for display alone:

```csharp
// Proposed shape, not an existing API:
internal enum TalkRecipientKind { Promoted, Ambient, Unknown }
internal sealed class TalkRecipientFeedback {
    public TalkRecipientKind Kind;
    public string SafeLabel;   // fixed generic label for MVP
    public string EvidenceCode; // bounded diagnostic reason, no identity secrets
}
TalkRecipientFeedback ResolveCommittedRecipient(Ped ped, long retainedAddress);
```

**Resolver invariants:** use the actual committed `essentialPed` and retained address; verify current `Ped.Exists`, not dead, current world/host generation; match retained P2 `Encounter`, registration incarnation and P1 `TryResolveCurrent` claim; return `Promoted` only if all relevant proofs match. If a registered owner exists but the proof is stale/unavailable, show `Unknown`, not `Ambient`; only clearly unowned valid peds are `Ambient`. Do not publish aliases, UUIDs, raw addresses, player notes or character biographies in HUD/normal logs. Do not do entity inspection or DB lookup from `Game.FrameRender`; cache a bounded immutable feedback snapshot created on Core Update / committed `talk.ptt_start`.

**Suggested narrowly scoped changes:**
- `native/promoted-characters/PromotedCharactersIntegration.cs` / `NativeCommands.cs`: expose a read-only verified committed-ped feedback resolver via the existing integration, without changing source of truth or P1/Memory K admissions.
- `native/promoted-characters/TalkTargetSelector.cs`: resolve recipient *after* mic ownership/commit succeeds and include bounded `recipientKind` / `recipientLabel` in the existing `talk.ptt_start` success payload; optionally in the preview payload after per-ped safe validation. No new IPC transport or additional mic command.
- `native/enhanced/Input/TalkTargetInput.cs`: in `PollStart()`, validate the returned enum/string against a fixed allowlist and display the one-shot notice using the existing `IHud.Show`. Keep `startExplicit`, PTT generation ownership, `selectionId`, stale `encounterId` rejection and stop/retry behavior intact.
- `native/promoted-characters/TalkTargetIndicator.cs`: leave the frame renderer alone for MVP; optional later presentation refinement only if HUD alone proves too subtle.
- `docs/UX4-talk-targeting-status.md`, `docs/UX4-talk-targeting-gta-acceptance.md` and relevant `native/enhanced/input-tests/` + `native/promoted-characters/runtime-tests/`: document/test the committed-recipient HUD and confidence rules.

**Named promoted characters (optional follow-up, not the MVP gate):** `Talking to: Nathan` is desirable, but the native P2 roster has owner aliases, **not** authoritative profile names. A name must be obtained from a separately verified current P2 companion profile binding keyed by world + owner alias/CharacterId with a bounded, revocable cache; never derive it from voice/model/LLM output, and never block a mic start waiting for this lookup. If a trustworthy current mapping is missing, render generic `Promoted NPC`. Do not add a new cross-process service just to meet the first acceptance gate.

### 3.4 UX4 tests and physical verification

- Native/loader tests: direct hold against A while promoted Nathan B stands behind A -> committed HUD says `Nearby NPC`; explicit tap select B and hold -> `Promoted NPC`; check exact committed `pedId`/native address is the HUD source (not a previous preview or recent speaker).
- Multiple candidates and equal/shared TTS voice: never infer promoted status from voice.
- Ped despawn, reused numeric handle/new memory address, invalid registration, P1 proof expiry, world epoch/reset, selected-target timeout, start/stop reordering, focus loss, late commit result and host disconnect: no stale name/kind shown and never redirect mic to a different NPC.
- Preview vs commit: taps/cycles never open the microphone or mutate `PlayerConversationPed`. Direct hold keeps the no-bracket behavior; explicit hold retains the bracket preview. F11 Current NPC and Follow/Wait/Promote continue to reference the correctly selected current ped.
- Existing shared Essential Talk interception, MarkedTalk, stock Text, custom keys, and `talkTargeting.enabled=false` continue working as before.
- No UI spam, leaked tokens, new control ownership, new background threads, or additional expensive per-frame native calls.
- Live GTA A/B: place ambient A between player and Nathan B; perform direct hold and then explicitly select B; compare HUD vs RAGE `SendMicStart` target, P2 `CurrentView`, companion turn ped/character ID, and SQLite player journal owner. Check three consecutive switches and one invalidated ped. **Never** claim a HUD message proves the source/identity unless native/companion logs corroborate.

**Acceptance:** every committed UX4 microphone turn displays a concise correct generic recipient class from the actual post-commit ped; errors/abort show no misleading successful target. A direct hold may still choose A; feedback prevents it being silent, but **does not lock Nathan or enable proximity overhearing**. Those are separate follow-up features.

## 4. Phased execution

### Phase 0 — baseline pin and reproducibility
- [ ] Refresh #138 head and read current `segmentDecoder`, `runSequentialTurn`, ledger, native UX4 loader, P2 ownership, and installed voice overlay constraints.
- [ ] Preserve anonymized excerpt/counters from October 16 session; record exact deployed companion/native build hashes. Do not assume installed ElevenLabs overlay exists in #138.
- [ ] Confirm `memory.dialogue.player`, `memory.dialogue.npc`, `memory.journalContext`, `memory.recall`, active timeline, and structured streaming settings from *installed nonsecret* config before attributing symptoms to code.

### Phase 1 — JavaScript ledger numbering repair (independently mergeable)
- [ ] Normalize 1-based structured decoder ordinal to 0-based *private ledger* index only.
- [ ] Add true runner-to-ledger-to-D03 SQLite end-to-end offline regression plus denial-path tests.
- [ ] Run companion targeted suites, full relevant tests, and production companion build. No P1/SQLite/Memory K schema changes.
- [ ] Review actual newly installed ElevenLabs TTS wrapper for byte accounting before deployment; preserve the overlay.

### Phase 2 — Native UX4 identity feedback (separately testable)
- [ ] Add side-effect-free, verified recipient classifier and bounded read-only result fields.
- [ ] Show one-shot post-commit HUD recipient notice; optional verified preview class, no unverified name.
- [ ] Run native P2/UX4 loader regression suites with pinned production native references and Windows `net481` build. Retain host/core hash pins and do not ship/repackage private SDK binaries.
- [ ] Run the specific GTA A/B physical test, focus/stop/timeout regression, then full affected smoke checks.

### Phase 3 — rollout and evidence
- [ ] Treat both runtime fixes as separate reviewed changes targeting **#138**, with clear test receipts. Keep **#184 open and untouched**.
- [ ] Back up live `e1.config.json`, voice-provider overlay, promoted-character profiles, SQLite/WAL/SHM using a safe stopped-process snapshot, and existing DLL/companion payloads.
- [ ] Reconcile/preserve installed ElevenLabs compatibility explicitly. A repo build that lacks the separate overlay is **not** automatically safe to deploy.
- [ ] Deploy only the intended validated artifacts: JS companion build for phase 1; matching native DLLs/loader for phase 2, without overwriting saved memory.
- [ ] Run 5–10 Nathan turns and 3 ambient/explicit targeting changes. Archive `RagePluginHook.log` and new `logs/e1-run-*.jsonl`/dialogue JSONL with build hashes. Compare NPC and player journal outcomes and the target messages to actual current native owners.
- [ ] Roll back only touched code/binaries on a regression; preserve SQLite/profile data and open PRs.

## 5. Non-negotiable safety and dependency boundaries

1. Do not relax D01 accepted-player-input authority, D02 verified native owner/player source, D03 exclusive P2 SQLite writer, exact turn tuple, native playback receipts, journal `reply_to`, current timeline authority, readback, or generation/revocation fences to get green counts.
2. The generic UI label has **zero** identity or dialogue authorization power. It cannot mint ownership, copy memories between characters, retarget a turn, or promote an ambient NPC.
3. No changes to SQLite schema, M5 command authorization, H1/H2 privacy, existing M6/M7/M9 activation, or source-origin rules. No "save failure => invent success" fallback.
4. Keep a supported stock/UX4-off path; preserve controller bindings, stop-after-release, pause/focus-loss cleanup, and original Essential scheduling.
5. Keep the separate installed ElevenLabs v4 Turbo/emotional-delivery overlay compatible; do not assume the source in #138 contains that overlay.
6. This plan itself changes **no** runtime source or environment. Implementation and merging require separate review and explicit authorization.

## 6. Completion criteria

**A. Ledger:** confirmed first structured segment is normalized (1 -> 0 at the private ledger boundary); real streamed test reaches `NpcSpeechDeliveryEvidenceV1.delivery=completed` only after provider PCM parity + native completion + accepted RAM history and writes one durable NPC `reply_to` row. Fault/replay tests deny. On real GTA, completed Nathan turns no longer systematically produce `d03_npc_no_outcome`.

**B. Feedback:** an ambient NPC stepping between the player and Nathan can still receive a direct hold, but the player sees `Talking to: Nearby NPC` from that exact committed native ped. Explicitly selecting Nathan yields `Talking to: Promoted NPC` (or a *verified* short name if optional name binding is separately proven). No false claims for expired/recycled/unknown ped identities.

**C. Compatibility:** existing real-game speech and recall work, ElevenLabs still plays, #184 remains unmodified/open, #138 remains unmerged until authorized, and no memory data was replaced or reset.
