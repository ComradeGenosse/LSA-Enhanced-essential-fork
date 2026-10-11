# EA Final Integration — source and acceptance handoff

Date: 2026-10-11. Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`. **DRAFT / NOT DEPLOYMENT-APPROVED**.

## Provenance and exact source commits

Approved immutable PR #68 starting point: `4cad39198478d7f03bb8ec6657b674e52fa659dd`. Final integration branch: `integration/elevenlabs-emotional-acting-final-20261011`; draft PR #96; **base** `integration/elevenlabs-emotional-acting-ea0-ea4-20261011`, never main.

EA0 #62; EA1 #64; EA2 #65; EA3 #63; EA4 #66 (combined originally in #68). Upstream ElevenLabs #54; planning #60; M1 #52 `1ca219fd8b95ba2dbf2d1f8031d40fe93308a404`.

EA5 #80 `0c817d40efe3660faa2d5c08eb06ab4c7a97b8dc`; EA6 #76 `ab1804f6aaa4207d161e194c92c45ee89e20c4b4`; EA7 #78 `7e9427fa704ddfba9405bef6c423db0f7f3cdca6`; EA8 #79 `199d602f725e323763441da6cb139e5d0a0241c7`; EA9 #93 `f030d2c9853ce3b91158ad0facc9630c15a86ffe`.

Final fix A #92 `a2092f590deee890789ed048999800387438ada4`; B #91 `4f98d28efac2d5979035534d63f4a3726a2a2b50`; C #95 `62e961705a4615501b2dd36d4f29f530eba7c61b`; D #93 `f030d2c9853ce3b91158ad0facc9630c15a86ffe`. All four verified by Git compare to merge-base exactly `4cad39198478d7f03bb8ec6657b674e52fa659dd`, with no behind commits.

One multi-parent merged source commit: `b34deab9e8ed9184da5801e90456df8813c479e9`. Initial shared wiring commit: `7836f746cb922c2bee09367afeadb265d7ba804e`. Check PR #96 HEAD and its workflow source SHA for final documentation-only follow-up commits; acceptance is always tied to exact latest PR HEAD, never the earlier source SHA.

## Audit of actual source, not completion claims

- A supplies 11/11 unchanged non-handoff EA5 source blobs and real authenticated Intake/IntelligenceClient integration, native default-disabled sensor, C-13 subscriptions and dedicated tests.
- B imports 13/16 byte-equal EA6 non-handoff files. Deliberate replacements are `timelineSourceBridge.mjs` and `sqliteProfileStore.mjs` to add reincarnation/queue fences and avoid synthetic host reload proof. Original EA6 workflow was omitted from B; imported separately here.
- C reconciles EA7/EA8 source; compared original EA7/EA8 named files against combined blobs. The changes to mood runtime, store, resolver, provider/tag policy and tests are reconciled, not blindly overwritten. EA4 test path overlapped C and D; selected C's richer behavioral tests, which include D's invalid assertion syntax correction.
- D contributes executable `tools/ea9/{matrix,verify-release,isolated-deploy,paid-ab-preflight}.mjs`, acceptance fixtures, Windows+Ubuntu/Node22+24/native CI and explicit GTA/paid-audio gates.
- Source code alone does not demonstrate live correctness. The original A/B/C/D branch handoffs explicitly had no new exact-branch CI on their final heads.

## Final integrator changes and runtime authority

- `src/integration/essentialGlue.mjs`: EA4 gets a **live read-only forwarding facade** for the real `IntelligenceClient.protagonistAuthority`; missing/expired/unknown authority reads null and never invents protagonist proof. Existing test injection is preserved.
- `src/bootstrap.mjs`: when P2 SQLite explicitly opted in, await actual `CharacterService.initialize()`, then bind `bindTrustedTimelineSource` to A's admitted C-13 host/boundary subscriptions **before** starting IntelligenceClient. On optional failure source remains unauthorized. Mood is cleared on native host/world changes; stopped native source and timeline binding are revoked before storage closes.
- `src/openai/runSequentialTurn.mjs`: buffered and EACH early provider invocation retain exactly its original speak() result; after exact native completed playback and successful original `history.acceptPlaybackResult` each eligible segment calls `synthesized(delivery,receipt,providerResult)`, then one `complete(receipt,{historyAccepted:true})`. No synthetic tagApplied or separate mood-only TTS call; failures/cancels retire neutral.
- `lsa-essential-e1-candidate/tools/buildCandidate.mjs`: package exact same-checkout shared-brain source as sibling `plugins/lsa-shared-brain/src` required by the unmodified M1 relative import; record the additional shared source tree checksum. Never use a host-global or v4-overwritten SQLite core. Existing pinned stock bundle + DLL checks remain intact.
- `e1.config.example.json`: explicitly defaults P2 to JSON. SQLite remains operator opt-in; expressive delivery remains off. All stock action, canonical transcript and memory processing remains on existing paths.
- `.github/workflows/ea6-sqlite-timeline.yml` retained from source EA6; `.github/workflows/ea-integration.yml` enforces combined EA0–EA9 matrix specifically on the F integration branch.
- `tests/ea-final-integration-wiring.test.mjs` adds actual turn runner + real ElevenLabs provider/fake socket cases for early/buffered applied tags, history rejection and shadow parity, with **no real paid request**.

## Security, privacy and project compatibility

The native protagonist stream must be a validated real C-13 transport with independent host/world/sequence proof and current 1500 ms lease. Known Franklin/Michael/Trevor revisions and ABA may be checked only after native producer activation is separately shown safe for the receiver; **production native producer is intentionally disabled by default**. A successful native hello does not independently verify a GTA save-slot ID. The P2 SQLite timeline UUID must be selected and exactly manually confirmed in the editor, with source revocation on restarts, disconnect, fork and queue/source ABA.

**High-severity memory-v4 blocker:** this branch's imported M1 P2 SQLite `PRAGMA user_version=2` implementation deliberately rejects higher v3/v4 databases. Separate promoted-NPC memory integration evolves the same storage to v4. Never open, migrate backward, delete, rebuild or copy a v4 live DB into the v2 writer. Experimental activation on that data is **GATED** pending a single coordinated forward-port of source-incarnation fences into the v4 schema and v4-aware recovery/acceptance. Mood itself remains volatile (22 s, 128 entries, one follow-up), never permanent P2 memory.

EA1 scene evidence continues to require current original PS2 witness ownership/P1 binding; no inferred observer or scene grant. Verified current danger outranks soft mood, and `ephemeral_mood` cannot re-seed itself. Only the provider's private in-process applied-tag result and accepted completed native receipt, followed by accepted original history, can commit mood. Eleven v4 Turbo allowlist maps `fearful` to `[scared]`, never synthesizes unsupported `[concerned]`; experimental affects ONLY temporary speech copy. No paid request was made.

## Offline and CI verification matrix

**This report begins as a pre-execution, source-level integration handoff.** Earlier EA5/6/7/8 branch successes do NOT count as combined-head evidence. Initial PR run IDs for source-wiring SHA `7836f746cb922c2bee09367afeadb265d7ba804e`: push 38185074571 and PR 38185115314, both initially QUEUED. Those runs are invalid as exact-head evidence after documentation/verification commits. Read GitHub Actions for the CURRENT HEAD and fill explicit status; absence of completed evidence is never PASS.

| Test gate | Status at report creation | Evidence / condition |
|---|---|---|
| Exact combined-head Node24 Windows + Ubuntu EA0–EA9 and F tests | NOT RUN | GitHub Actions required |
| Full Essential npm test / isolated Python | NOT RUN | GitHub Actions required |
| Node24 native SQLite migration and Node22 default JSON | NOT RUN | GitHub Actions required |
| Windows compiled production native + PS/ACT/C-05/Director/ABI | NOT RUN | GitHub Actions required |
| Strict Luna schemas, E1 actions, early/buffered/typed/STT/Director | NOT RUN | Existing suites included; exact CI result required |
| ElevenLabs mock WS, cancelled output, off/shadow parity | NOT RUN | Existing suites + F runner fixture require execution |
| Build, staged source/pins, native DLLs, EA9 seal/verify | BLOCKED | No exact-head staged binary/manifests verified |
| Isolated package hash-preserving rollback dry run | NOT RUN | Offline harness pending; no installed GTA touched |
| GTA G00–G13 and actual native receipt/audio timings | NOT RUN | No running isolated GTA test environment available |
| Paid ElevenLabs tagged-vs-untagged A/B | NOT RUN | Explicit billing approval absent; no paid request authorized |

When CI finishes, the release manager must record job IDs, conclusions and exact failed assertions. Green earlier branch tests or queued/in-progress jobs cannot satisfy these rows. No CI runner was directly accessible to this connector outside normal GitHub Actions.

## GTA acceptance / rollback / vendor gates

Franklin, Michael, Trevor, F→M→F ABA, unknown/cutscene, world/load/reconnect/save fork, two promoted owners, real witnessed/unwitnessed PS2, typed/STT/early/buffered/spontaneous Director speech, native started/ended/interrupted receipts, exact dialogue history, mood expiry/revalidation and rollback all remain **NOT RUN IN GTA**. No accepted physical game/audio receipt, measured first PCM to audible latency or validated cancellation metrics exist. EA9 `docs/ea9/GTA-ACCEPTANCE.md` contains operator scenarios, `RELEASE-RUNBOOK.md` has isolated staging and hash rollback, `PAID-ELEVENLABS-AB.md` requires separate approval. Vendor documentation/mock sockets show allowable textual tags only; they do not prove natural audible emotional acting or its API cost.

## Defects, severity, ownership and readiness verdict

1. **P0 / F+memory-v4 integrator:** v2-v4 database compatibility/forward-port not demonstrated. Preserve the selected database read-only/closed until proven.
2. **P0 / F+EA9:** exact-head Windows/Ubuntu/full Native/ABI/Node/Python acceptance and sealed compiled release are outstanding; no recorded execution is a pass.
3. **P0 / native producer owner+F:** producer remains disabled for legacy receiver safety; explicit supported-receiver activation/rollback and real native player/receipt lifecycle are unproven in GTA.
4. **P0 / GTA operator:** isolated shadow source/save/owner/audio/rollback receipts absent.
5. **P1 / vendor+operator:** no approved paid paired A/B, cost or audible emotional naturalness data.

**Offline-ready: NO, pending exact-head green matrix.**
**Shadow GTA-ready: NO, pending native/ABI, sealed isolated rollback package and offline acceptance.**
**Experimental GTA-ready: NO, additionally needs live authority, verified save lineage, accepted audio/history and shadow operator receipts.**
**Production-ready: NO, additionally needs approved vendor-audio A/B and rollout signoff.**

All upstream PRs unchanged, final PR remains DRAFT against PR #68, no main merge, no installed GTA writes, no ElevenLabs billing.
