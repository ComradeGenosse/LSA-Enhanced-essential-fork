# EA-G Independent Completion Audit — SQLite v4

Date: 2026-10-12. This is a BRANCH-SCOPED source/CI audit, **not** an authorization to deploy.
Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.

## Exact provenance and isolation

- Original specialist PR [#106](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/106), `feature/ea-final-g-sqlite-v4-compatibility-20261011`, observed head `f69ac03d5090f666870b399bd559c0e7040dadbd`.
- Separate repair PR [#108](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/108), `fix/ea-final-g-completion-audit-20261012`, parent **#106 branch**, not PR #96.
- Protected EA parent PR #96 `b1a9b01b72c406706bb640daacbe30a56efd6d4e`; Memory K source PR #94 `0201731973a1c02a8852271897e2c8df420396b9`.
- Source repair commits before this report: `cf14c00378ce57341eecb1051dc4937c4affaa1c`, `8723a93d624ecb81a726b869fe309f86aee91960`. The commit adding this report is documentation-only; compare exact check SHA before final acceptance.

## Method

Compared G's actual 16-file diff, v2 and memory-v4 foundations, native C-13 timeline adapters, replay/journal/recall/privacy/cursor tables, fixtures and workflow. Read real GitHub Actions logs, including both prior failures. Production host wiring is still the existing CharacterService singleton P2 store, opt-in SQLite in `createRuntimeForBundle`, and `bindTrustedTimelineSource` subscribed to accepted C-13 hello/world boundaries. Memory methods use that P2 owner rather than another persistent SQLite writer. This audit does **not** activate unfinished M2–M9 runtime producers.

## Confirmed unfinished work corrected

1. **FAIL -> PASS, test-module path:** `tests/ea-g-v4-compatibility.test.mjs` imported `../../../lsa-shared-brain` outside checkout. Corrected to `../../lsa-shared-brain`. Prior run [38240858996](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38240858996) failed on both OS before G01–G15 executed.
2. **FAIL -> PASS, Windows SQLite/WAL test teardown:** `tests/ea-final-b-timeline.test.mjs` removed Windows temporary SQLite files BEFORE its later-registered close hook, causing EBUSY errors. Reworked fixture teardown to close the P2 store/bridge before removal.
3. **OUTDATED ASSERTION -> PASS, v4 contract:** Old EA Final B case asserted a valid v4 DB must be rejected by a v2-only reader. G's approved behavior is the opposite. Replaced with a no-downgrade v4 reopening/extension-table/evidence preservation assertion; it checks stored evidence and user_version=4 rather than accepting an obsolete rejection.
4. **NOT TESTED -> PASS, CI discovery:** Added isolated repair-branch push and specialist-base PR triggers; expanded G dedicated CI to execute EA Final B cases as well as v4 G01–G15, EA6, EA-F and P2.

## Exact executed verification

New source repair SHA `8723a93d624ecb81a726b869fe309f86aee91960`: dedicated [run 38243841935](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38243841935), **Ubuntu PASS and Windows PASS**.

- Node24 focused suite: **60 passed, 0 failed per operating system**, including real G01–G15 v2/v3/v4, populated journal/FTS replay, extension memory/corrections/privacy/curation rows, unknown/corrupt refusal, read-only inspection, writer lock, native timeline and queue ABA, EA Final B and EA-F.
- Node22 default JSON `tests/p2-profiles.test.mjs`: **25 passed, 0 failed per operating system**.
- These results demonstrate tests on disposable fixtures; **not** real GTA saves or a full deployed package.
- G's original branch full EA9 matrix had other failures. Repair workflow does not claim full Node24 `npm test`, Windows native package, EA9 rollback or physical GTA acceptance. Do not substitute this suite for full final integration acceptance.

## Acceptance inventory

| Area | Result | Evidence / limitation |
| --- | --- | --- |
| Supported v2-to-v4, v3-to-v4 and populated-v4 opening | PASS (offline) | G01/G02/G14 and updated EA-B |
| Existing source-revision/profile/voice and journal preservation | PASS (fixture) | G01/G02/G15, EA-B |
| Nonmutating inspector, corrupt/unknown schema refusal | PASS (fixture) | G03/G04/G05/G13 |
| Writer exclusivity, queued-source and save re-confirmation fences | PASS (fixture) | G06–G09/G11, EA6, EA-B |
| One P2 database owner; JSON Node22 no SQLite dependency | PASS (source + tests) | ProfileStore adapter, G12 and Node22 CI |
| No permanent ephemeral-mood state | PASS (source + fixture) | G10 |
| Authenticated *physical* GTA save/host receipts and installed migration | NOT TESTED | No game/data access |
| Live M2–M9 production memory behavior | BLOCKED (separate upstream) | Memory K PR #94/#97 still has original C-01/PS2/PS4/PS6 lifecycle work |
| Cross-avatar permanent memory/recall/replay continuity | **PARTIAL / INTEGRATION BLOCKER** | See below |

## Critical architecture discrepancy requiring final integration decision

The user's player identity is **one human across Franklin, Michael and Trevor**. The imported memory-v4 SQL still retains model-scoped `protagonist_key` as an **access/identity partition**, not merely recorded provenance:

- `lsa-shared-brain/src/memory/integratedSqlite.mjs`: candidate queries, source equality and command lookup filter exact `scope.protagonistKey`.
- `lsa-shared-brain/src/memory/sqliteIntegratedRecallProjection.mjs`: dialogue and durable recall filter `protagonist=?` / `protagonist_key=?`.
- `lsa-shared-brain/src/memory/p2ReplayCursor.mjs`: durable feed/cursor keys are partitioned by model.
- The G fixtures use `protagonistKey:'franklin'`; none establishes that a Michael request can recover the same NPC's Franklin memory.

**Do not claim permanent NPC memories are unified across playable avatars on this evidence.** The schema-v4 compatibility patch preserves approved PR #94 storage semantics. Unifying durable memory requires an explicit forward-compatible player-subject vs source-provenance contract coordinated with Memory K and Final Integration Agent I, plus migration-safe handling of old rows/cursors/commands, exact per-NPC/witness/save boundaries, and tests `Franklin memory -> Michael/Trevor recall`. Removing a source check or treating `unknown` as a wildcard is unsafe. This wider contract is NOT resolved by G's isolated schema-compatible port.

## Cross-branch integration handoff

H authenticates an actual current native model and keeps ephemeral mood separate from avatar identity. G supplies the unchanged P2-selected timeline authority. Final Integration Agent I must combine their code, verify that native C-13 and P2 share current host/world evidence, define canonical player-subject behavior for permanent memory together with Memory K, and run EA9 full matrix, native ABI, packaging/rollback, game and vendor acceptance. Existing EA9 isolated-deploy rollback fails in historical combined workflows and belongs to EA9/final integration, not this G storage repair.

**G SQLite storage-compatibility readiness: YES for draft G+H source integration, with above blocker disclosed.**
**Full one-human permanent-memory acceptance: NO.**
**Experimental GTA and production: NO.**
No PR #96 writes, main merge, installed-game mutation or vendor billing.
