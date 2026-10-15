# Memory K Workstream G — review evidence

## Outcome

Independently activate the existing authenticated PS2 → M3 → sole-P2 witnessed-event recorder and authenticated native coverage. A promoted NPC can durably record qualified observations with M2 and PS3 off. Coverage-only records supported native samples as `event_intake_disabled` gaps, without positive-event intake. Both-off acquires no optional M3 resources. Off/shadow/on, legacy defaults, mandatory E2 privacy, D1/D2 source-only policy and original lifecycle remain intact. `memory.promotionGrace` remains unavailable.

Separate operational diagnostics require actual durable/sample evidence and report current source/dependency readiness and bounded content-free counters. Factory construction alone is never operational evidence. No extra polling, scanner, native fiber, writer or event pipeline is introduced.

Adversarial restart/replay testing reproduced an inherited #138 privacy/idempotence hole: fresh PS2 observation IDs could replay the same native signal after suppression. An additive content-free native-receipt index in the original P2 append transaction fences duplicate, suppressed and cross-timeline replay; original immutable event/sidecar bytes remain unchanged. Recorder acknowledgments return the actual existing durable ID. Already-purged pre-G evidence without backfillable native provenance blocks new native event intake for its affected NPC/world, including new timelines (`journal_native_privacy_unresolved`). This conservative upgrade limitation requires review; suppression is never silently cleared.

## Exact integration provenance

- Initial latest #138 at worktree creation, including E2 #168: `246b30b6a9cdbc3b4c5af8c2c6f89470f5a8e5f8`.
- Tested current target/base: `81b8ac51a3ac370acf3d70ebf9538c8f1ffbd9a6`.
- Tested head: `df5ac1ba69763e73e40286faf9fd50cde3c5a2e2`.
- Head branch: `feat/memory-k-g-independent-events-20261015`.
- F #169 merged into #138 during G validation. G was developed independently, then reconciled with accepted integration history in merge `8f74f79e54c51dc08203c6a72e5d4f64ec0a3141`; it was never stacked on F's PR branch. Bootstrap import/diagnostic conflicts preserve both workstreams. F's implementation and 21-test entrypoint match the accepted base byte for byte.

## Capability matrix

| Request | Original #138 at start | G |
|---|---|---|
| No explicit capabilities | Legacy combined M3 | Same legacy behavior |
| Events on / coverage off / M2+PS3 off | Entire explicit M3 consumer blocked | Qualified durable positive events; no coverage tracker/writes |
| Events off / coverage on | Entire explicit M3 consumer blocked | Authenticated native samples and intake-disabled gaps; no event binder/queue/writes |
| Both on | Entire explicit M3 consumer blocked | Independent qualified event intake and coverage |
| Both off | M3 absent | M3 absent; no optional subscription/cursor/work |
| Events on, PS1/PS2 unavailable/off/shadow | M3 absent | Events blocked; independently ready coverage may run |
| Shadow | No independent sink | Attribution/sample preview with bounded counters; no optional persistence |
| Injected test authority | Never native coverage | Still cannot fabricate production coverage |

Coverage alone proves neither that an event did not happen nor that an NPC saw everything. Missing/retired coverage and insufficient evidence remain unknown. Controls are startup/restart controls.

## Validation

Exact-head [Windows/Linux workflow and full artifacts](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38724936410), Node 24.19.0 / .NET 8. Original test entrypoints are SHA-256 compared between baseline and candidate; assertions are unchanged.

| Suite | Linux baseline → candidate | Windows baseline → candidate |
|---|---|---|
| Focused G (candidate) | 42/42 | 42/42 |
| Original M3/PS1/PS2/D1/D2/P2/source + accepted F | 380 pass, 0 fail, 1 Windows-only skip → same, /381 | Final paired comparison running |
| Unchanged E2 original inventory | 264/264 → 264/264 | Final paired comparison running |
| E2 adversarial additions | 28/28 → 28/28 | Final paired comparison running_ADDITIONS |
| Original native producer/M3 witness policy | Both revisions pass | Both revisions pass |
| Original Windows wire/runtime/owner-sample/host source-only+stop+failed | Windows-only | Both revisions pass |
| Original source-verified builders | Both pass, 70 expected AST edits | Final paired comparison running |

Stress on each platform: **2,750 qualified offers**, five promoted NPCs × 500 incidents, **2,500 durable events + 250 duplicates**, zero rejected/dropped/lost, queue high-water 5, M2 disabled, PS3 decisions 0. Linux: tap p95 **0.097 ms**, total **17.528 s**. Windows: p95 **0.141 ms**, total **85.108 s**. SQLite lock held 300 ms: intake returns in 0.163 ms Linux / 0.211 ms Windows; no lost event. These are offline runner measurements, not GTA frame-time claims.

Focused adversarial coverage includes qualified/unqualified observers, cross-NPC attribution, forged/stale/retired source, admission-time retirement, world/timeline changes, disconnect/reconnect, restart/raw replay, bounded saturation/conservation, SQLite and sole-writer contention, in-flight correction/forget/purge, index migration/corruption, independent readback, both-off no effects and coverage-only gaps. Authenticated native parser/authority, PS2 and actual production adapter/P2 are exercised; native transport fixtures do not establish physical GTA acceptance.

### Preserved failures and limits

The overall comparison gate is intentionally red for the inherited unregistered original `memory/ws6Original10kWriteRegression.test.mjs`; Linux also retains the original Windows-only skip. G registers only its own two entrypoints. The separate older C workflow pins a stale baseline and rejects original test hashes already changed in integration history.

Earlier full paired Windows evidence at `f6632c9` against pristine initial #138 shows the same WS6 latency failure on baseline and candidate (E2 originals 263/264 each; additions 28/28 each). A separate E2 Windows run retained two WS6 timing/freshness failures. One local original first-player-line miss did not reproduce in 30 serial/paired-load baseline/candidate comparisons; one accepted-F source-timing miss passed unchanged on both subsequent baseline and candidate runs. All failed logs remain evidence, with no assertions weakened or failures relabeled as K07. K07's historical `memory_source_forgotten` risk is not claimed fixed. The final Windows paired original/E2 comparison remains in progress; its native prerequisites and focused G job have completed successfully. This PR will retain its final receipt and any failures.

## Review and integration

[Handoff, configuration examples, diagnostic examples, risks and reconciliation instructions](docs/plans/memory-k-g-independent-events-20261015.md). Keep draft; do not auto-merge. Recheck target SHA before integration. Preserve F's dialogue gates/lifecycle/diagnostic spread and NPC-parent suppression repair alongside G's independent tap/construction gates, operational rows and event-native receipt transaction. Re-run paired original/F/G/E2/native suites on any subsequently reconciled exact head. Operational rollback is mode off plus restart, retaining mandatory schema/privacy replay fences. No main change, GTA file deployment or release acceptance is performed.

Full S01–S10, production native packaging/SDK acceptance, physical GTA validation and soak remain separate requirements.

## Exact changed files (19 versus tested base)

```text
.github/workflows/memory-k-g-independent-events.yml
docs/plans/memory-k-g-independent-events-20261015.md
lsa-essential-e1-candidate/src/bootstrap.mjs
lsa-essential-e1-candidate/src/memory/m3Activation.mjs
lsa-essential-e1-candidate/src/memory/m3ProductionMemory.mjs
lsa-essential-e1-candidate/tests/m3-production-harness.mjs
lsa-essential-e1-candidate/tests/memory-g-bootstrap.test.mjs
lsa-essential-e1-candidate/tests/memory-g-independent-events.test.mjs
lsa-shared-brain/src/characters/sqliteFoundation.mjs
lsa-shared-brain/src/events/m3BoundedIntake.mjs
lsa-shared-brain/src/events/m3CoverageSqlite.mjs
lsa-shared-brain/src/events/m3ObserverCoverageTracker.mjs
lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs
lsa-shared-brain/src/events/witnessedEventRecorder.mjs
lsa-shared-brain/src/memory/integrationPorts.mjs
lsa-shared-brain/src/memory/journalSqlite.mjs
tools/memory-k-verification/g-native.mjs
tools/memory-k-verification/g-suite.mjs
tools/memory-k-verification/registrations/g-independent-events.json
```

