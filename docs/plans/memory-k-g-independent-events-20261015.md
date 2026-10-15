# Memory K G — independent witnessed events and coverage

Goal: make the existing authenticated PS2 → M3 → sole-P2 event pipeline and native coverage independently operable inside #138. Scoped implementation acceptance only; no merge, deployment, main changes, or full Memory K release acceptance.

Starting base: `246b30b6a9cdbc3b4c5af8c2c6f89470f5a8e5f8` (latest #138 including E2 #168 at worktree creation). Updated integration base: `81b8ac51a3ac370acf3d70ebf9538c8f1ffbd9a6` after F #169 merged into #138 on October 15. G merges that accepted integration history, rather than stacking on the F PR branch. Branch: `feat/memory-k-g-independent-events-20261015`. Architecture: #158 G. G was developed independently of F #169; the accepted F integration is now reconciled at the shared bootstrap seams. Exact final head is recorded in the draft PR and exact-head workflow receipts, since a document cannot contain its own commit SHA.

## Runtime contract and capability matrix

Restart-required startup controls use the existing closed capability map and `off`/`shadow`/`on` modes. No promotion grace production authority exists; `memory.promotionGrace` remains unavailable. Mandatory source authority, P2 SQLite and E2 privacy are never switched off by G.

| Configuration | Before, pinned #138 | After G |
|---|---|---|
| No explicit capability map | Legacy combined M3 registration with qualifying SQLite/native ports | Same legacy on/on behavior and original lifecycle |
| Events on, coverage off, PS1/PS2 on, M2/PS3 off | Explicit configuration suppresses entire M3 factory | Original qualified observation tap, bounded queue and durable event/sidecar; no coverage tracker or writes |
| Events off, coverage on | Entire M3 factory suppressed | Native authenticated samples persist intake-disabled gaps; no event tap, owner binder, admission queue or event writes; PS2/PS3 can be absent |
| Both on, PS1/PS2 on | Entire M3 factory suppressed | Independent authenticated positive events and native coverage; queue/commit losses remain gaps |
| Both off | No M3 factory | No M3 factory, authority subscription, tap, queue, coverage work or cursor advancement |
| Events on with PS1/PS2 off or shadow | No M3 factory | Event gate blocked; independent coverage may continue |
| Missing SQLite/native/source/timeline/privacy support | No verified operation | No acquisition without required ports; local source/timeline/privacy checks continue to refuse writes |
| Events shadow | No independent production shadow sink | Original PS2/native attribution validation and bounded counters; no event queue or durable acknowledgment/write |
| Coverage shadow | No independent production shadow sink | Bounded native tracker preview; no coverage persistence, checkpoint acknowledgment or sealing write |
| Injected authority | Attribution fixture, never production coverage | Still no production coverage; diagnostics explicitly report this limitation |

Example capability request for witnessed events without conversation capture or salience:

```json
{"memoryK":{"capabilities":{
  "ps1.producers":"on", "ps2.observations":"on", "ps3.salience":"off",
  "memory.dialogue.player":"off", "memory.dialogue.npc":"off",
  "memory.events":"on", "memory.coverage":"off"
}}}
```

Use the existing OpenAI/P1/promoted-character SQLite configuration and authenticated native channel. For coverage-only set `memory.events` off and `memory.coverage` on; PS1/PS2/PS3 may all be off. Native source-only policy continues sampling on its original owner fiber. No extra scanner, fiber, polling loop, transport, scheduler or database writer is introduced.

## Evidence, coverage and privacy

G retains PS1 qualification, PS2 accepted proof, D-023 observation-time index/incarnation/encounter/owner matching, host/world attribution, immutable source sidecars, native source fences and E2's transaction/read suppression. PS3 notability, M2, M4, M6/M7 and callbacks are not event prerequisites. Nearby/player-relevant/dialogue-mentioned incidents confer no witnessing.

Coverage windows certify the supported authenticated owner/sample stream and intake continuity only. `complete` never proves an incident did not happen or that an NPC saw everything. Time outside sample frontiers, source retirement and missing authority remain unknown. With positive event intake off (including shadow), native samples persist as `event_intake_disabled` gaps without invented observation IDs. The read result exposes their supported sample bounds in `nativeSamples`; these do not count as positive witnessed events or lost event counts. Real queue/commit losses retain `lost_observation` accounting. Existing integrated recall still reports `coverageComplete:false`.

A new adversarial reconnect probe reproduced an inherited defect on pristine #138: PS2 resets assign fresh observation IDs to re-delivered native signals, allowing duplicate events and bypassing observation-ID suppression. G fixes this in the original P2 append transaction with the additive `event_native_receipts` index. Keys are hashed from original native signal/tick/owner-incarnation evidence, partitioned by world/NPC/timeline, with integrity checks. The index stores no event/dialogue content, preserves original event/sidecar bytes and uses no second writer or intake path. The original recorder/journal ports return the actual durable record ID for a re-derived duplicate, so independent readback never targets a newly proposed, nonexistent PS2-derived ID. Re-derived copies resolve to the already verified durable event; suppressed copies are rejected, including after purge and reopening P2. Changed proof bytes cannot borrow a receipt key. A native incident already attributed to another timeline cannot be re-journaled into a newly selected lineage, even while its old PS2 observation remains current; this fails with `journal_native_timeline_replay`. Genuine new/revised source evidence still uses the original event append and replay feed.

The mandatory P2 upgrade installs/backfills this privacy/idempotence index once from verified existing sidecars; optional-off behavior excludes runtime capture effects, not mandatory schema/privacy migration. Character deletion removes its receipt metadata; ordinary profile edits and event purge preserve content-free replay fences.

Already-purged pre-G evidence cannot supply a missing native fingerprint. If such an event suppression has no backfillable provenance, new native event intake for that NPC/world (including a newly selected timeline) fails closed with `journal_native_privacy_unresolved`; it does not delete or ignore the suppression. This is an explicit upgrade limitation requiring review of the affected privacy scope, not automatic recovery or guessed proof. Selecting another timeline cannot bypass an unresolved native source fingerprint.

Recovery trash retains immutable original bytes during E2's recovery window. Active replay/derivative reads hide suppressed evidence immediately; purge removes source/sidecar bytes. Franklin/Michael/Trevor remain provenance of one human within world + NPC + timeline privacy scope. G does not change F's conversation-recorder implementation. The post-integration focused run executes F's unchanged tests alongside G.

## Diagnostics

`runtime.services.memoryKRuntimeDiagnostics().capabilities` adds independent operational rows for `memory.events` and `memory.coverage`. The older policy/registration read model remains descriptive. Each G row supplies requested/effective mode, operational state, source/dependency readiness, safe blocking reason, restart requirement and bounded scalar counters. A constructed factory is `waiting`, never proof of operation. Events require a verified durable outcome (or qualified shadow receipt); coverage requires a persisted current window/sample frontier (or current shadow sample). Retirement invalidates operation evidence. Immediate close and graceful shutdown stop native sample admission before draining queued events, so later frames cannot extend the coverage frontier or advertise a stopped sink as operational. Privacy/index faults expose fixed content-free reason codes.

Typical event row after a qualified durable incident:

```json
{"requestedMode":"on","effectiveMode":"on","state":"operational","operationalState":"operational","sourceReady":true,"dependencyReady":true,"reason":null,"counters":{"offered":1,"qualified":1,"committed":1,"duplicate":0,"lost":0,"dropped":0},"restartRequired":true}
```

Coverage-only: event mode/effective mode are off and state stopped; coverage mode is on, becomes operational after native samples persist, and its read result has `complete:false`, `nativeSamples` and `event_intake_disabled` gaps. Source loss reports blocked with `authenticated_native_source_unavailable`. Unresolved legacy privacy reports `journal_native_privacy_unresolved`. Rows/telemetry contain no identities, transcripts, dialogue or memory content. Full adapter snapshots remain internal evidence/debug data, not telemetry.

Counters distinguish qualified offers, queued admissions, committed events, durable duplicates, stale revisions, refusals/unattributed observations, bounded-intake drops and known qualified losses. At settled checkpoints, production positive intake satisfies `qualified = committed + duplicate + stale + lost`. Overflow/oversize are a subset of known losses (`dropped`); pre-qualification refusals are not invented witnessed losses. Crashed unpersisted JavaScript callbacks remain unknown and are never silently reconstructed.

## Validation and evidence

The dedicated `g-suite.mjs` runs unchanged original M3, PS1/PS2, D1/D2, source authentication and P2 entrypoints on both the pinned baseline and candidate, verifies identical entrypoint SHA-256s, then runs G separately. It invokes the unchanged E2 runner for its original WS6/10k/durability/privacy inventory and E2 additions. Full TAP logs, counts, SHAs, inventory errors and platform limits are retained. No original assertion is changed.

The G tests exercise all on/off combinations through actual bootstrap, shadow/mixed modes, native source-only coverage, injected authority rejection, two qualified observers and an unqualified one, forged attribution, source retirement after admission, native disconnect/reconnect, raw native replay, world/timeline changes, overflow/conservation, real SQLite lock contention, sole-writer contention, correction/forget/purge in flight, P2/M3 reopen, index upgrade/corruption, and independently verified durable sidecars.

The 2,500-event G stress uses the actual authenticated-pipe parser, PS2 correlator, native authority, M3 adapter/binder/recorder and file-backed P2. Five promoted NPCs witness each of 500 incidents, with 250 additional duplicate offers. Only the native/game-side transport and clock are offline fixtures. It measures synchronous tap latency and elapsed time, verifies every event's sidecar independently, and requires zero unexplained loss with M2/PS3 disabled. Native/GTA authenticity is not inferred from the fixture.

Initial Linux source receipts before the replay-index repair: baseline and candidate each 359 pass / 0 fail / 1 Windows-only skip in 360 original tests; G 25/25; unchanged E2 originals 264/264 and additions 28/28 on both. Both original builders passed 70 expected AST edits. Later replay probes deliberately failed on baseline and candidate before repair; these failed receipts are retained, not replaced by green reruns. Subsequent exact-head Linux G runs passed 36/36 before the additional cross-lineage probe. A later E2-original run retained a distinct WS6 first-player-line assertion failure (263/264), while its E2 adversarial additions passed 28/28. Ten serial baseline/candidate pairs plus twenty paired-load baseline/candidate pairs of that exact unchanged assertion all passed; this isolated failure is not classified as K07 or claimed fixed. Final source/Windows/Linux results and any further reproduction evidence are in the draft PR and exact-head artifacts.

Known inherited gates remain explicit: Linux cannot execute the original Windows net481 user-ACL wire test; native wire/host execution is separately run on Windows. General inventory has the original unregistered `memory/ws6Original10kWriteRegression.test.mjs`; G additively registers only its own tests and reports that inherited error. K07's intermittent `memory_source_forgotten` issue remains an inherited risk; report each actual baseline/candidate outcome rather than declaring it fixed. Full S01–S10, production native packaging/SDK acceptance, physical GTA and soak remain separate NO-GO release gates.

Exact-head workflow: `.github/workflows/memory-k-g-independent-events.yml` runs Node 24.19.0 on Windows and Ubuntu, both pinned-baseline and candidate suites/builders, portable D2 producer and M3 witness/source-time policy, Windows original native owner-sample/wire/runtime/host tests, and always uploads full receipts even on failure. Independent focused jobs run G alone on each host; the separate unchanged-original comparison retains its own failures, native prerequisites and inventory gate. G fixture teardown disposes the runtime/SQLite writer before deleting its directory on Windows; its earlier EBUSY teardown failures are retained as test-fixture failures, with behavior assertions unchanged. Local Linux lacks dotnet; its missing-tool receipt is retained rather than presented as a native pass.

Reproduce:

```sh
node tools/memory-k-verification/g-suite.mjs --baseline /path/to/pr138-worktree --output /path/to/g-receipts
node tools/memory-k-verification/g-native.mjs --baseline /path/to/pr138-worktree --output /path/to/g-native-receipts
```

## Integration, F reconciliation and rollback

Keep the PR draft and target `integration/memory-k-production-20261012`, never main. Do not merge automatically. Before integration, recheck #138 head and ensure E2 source/privacy history is present. F #169 is now inherited only through the accepted #138 integration merge. F's conversation implementation and original F test file match that base byte for byte. Review G's bootstrap changes as event/coverage-only: retain F's dialogue gates, private D01/NPC recording lifecycle and operational diagnostics, while retaining G's event tap gate, combined M3 construction condition, separate availability rows and G operational-state spread. Combine the two diagnostics spreads; do not restore `memoryKConsumersAllowed(config)` around M3. G's `journalSqlite.mjs` changes concern native event receipts and additive migration; retain F's independent NPC-parent suppression fix in `appendDialogue`. No F M2/D01/D02/D03/runner changes should be overwritten.

F landed during G validation. The merge resolved only the bootstrap import and operational-diagnostics spread conflicts, retaining both F and G; event SQL auto-merged with F's NPC parent-suppression repair. The G comparison now pins the updated integration base and includes F's unchanged 21-test entrypoint. For any subsequent integration changes, reconcile on a dedicated checkout; rerun G, F, unchanged original D01/D02/D03, M3, source/native, P2, E2/WS6 and builders on the resulting exact #138 head. Preserve inherited failures and inventory errors. Disabling events or coverage and restarting is the operational rollback. Retain mandatory SQLite/privacy receipts and schema; do not downgrade or delete suppression/replay fences to roll back optional activation.

Changed files are the G activation/factory/bootstrap, existing shared adapter/intake/tracker/coverage SQL and recorder/journal ports, original P2 event append plus character-deletion cleanup, additive G tests/registration/runners/workflow, additive harness options, and this handoff. The draft PR's exact diff is the authoritative changed-file list.
