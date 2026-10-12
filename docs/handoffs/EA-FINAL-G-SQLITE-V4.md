# EA Final G — SQLite v4 Memory Compatibility and Save Timeline Integration

**Branch:** feature/ea-final-g-sqlite-v4-compatibility-20261011
**Exact source baseline:** EA final PR #96, b1a9b01b72c406706bb640daacbe30a56efd6d4e
**Memory source:** PR #94, 0201731973a1c02a8852271897e2c8df420396b9
**Target:** integration/elevenlabs-emotional-acting-final-20261011
**Mode:** DRAFT ONLY; do not merge/deploy/turn on ElevenLabs or memory.

## Actual source comparison / implementation

| Concern | EA #96 before | Memory #94 before | This branch |
|---|---|---|---|
| Profile schema | v2 exclusive | v2, v3, v4 migration | v2/3 read-only verification, forward to v4; v4 retained |
| P2 writer | single cross-process exclusive lock | P2 single writer and nested transactions | EA exclusive lock, revocation and ABA generation retained; memory methods use same writer |
| Journal | absent | durable M2/M3 evidence and FTS5 | imported v4 schema, journals and SQL APIs; no live M2 producer activation |
| Memory | absent | permanent memory, corrections, M5 privacy, replay, M7 budget | additive tables/indexes, original storage transaction and cursor retention |
| Source proof | C-13 host + epoch + manual selection + generation | incomplete stale queue and implicit confirmation | keep strict EA proof; no guessed save identity |
| EA4 acting | independent native protagonist + confirmed timeline | not applicable | unchanged mood runtime; mood is never written to SQLite |
| Legacy JSON | default | default | default; no node:sqlite required to import in JSON mode |

### Code-level changes

- Imported the exact v4 P2 SQLite journal, replay, recall, curation, privacy and evidence dependencies from memory #94. No second SQLite connection was added for memory operations.
- Forward-ported the memory storage methods into EA #96's *newer* source-generation-fenced \`P2SqliteProfileStore\`, rather than replacing EA's confirmed C-13 source logic with #94's weaker confirmation.
- Protected source-qualified memory reads against queued ABA via context/generation checking. M3 appends may supply verified source evidence while the hostContext is always taken from the trusted adapter.
- Added a read-only integrity/world/schema preflight for existing DB files before writable SQLite open or journaling mode selection. v4 assertions are mandatory; future versions fail closed. M3/M5/replay extension DDL/backfill is one additive transaction after approved v2/v3->v4 journal migration.
- Retained the existing CharacterService.store adapter and bootstrap bindTrustedTimelineSource / teardown, without touching native, provider or Agent H-owned files.
- Replaced the EA6 workflow triggers with G-branch and target-branch Node24 Windows/Linux SQLite tests and Node22 JSON profile regression. Added isolated G01-G12 SQLite adversarial tests.

## Migration and non-mutation acceptance

| Gate | Result on commit creation | Evidence |
|---|---|---|
| Fresh v2 upgrade preserves profile bytes/revisions | **PENDING CI** | G01 |
| Existing populated v4 and journal/replay cursor survive | **PENDING CI** | G02 |
| Read-only inspection does not migrate v2 | **PENDING CI** | G03 |
| Unknown future schema preserves bytes | **PENDING CI** | G04 |
| Corrupt database preserves original bytes | **PENDING CI** | G05 |
| Writer exclusivity | **PENDING CI** | G06 |
| Save fork/reconnect/clock/host source revocation | **PENDING CI** | G07 |
| Franklin-Michael-Franklin transition does not confer save identity | **PENDING CI** | G08 |
| Queued write fails when same host is re-confirmed | **PENDING CI** | G09 |
| Mood is ephemeral without proven native protagonist | **PENDING CI** | G10 |
| Accepted C-13 host + independent exact manual timeline confirmation | **PENDING CI** | G11 |
| Default JSON / Node22 support | **PENDING CI** | G12 + workflow |

**Caution:** No local Node24 executable / native GTA host was available in the tool environment. Tests are added as executable source and CI results must be independently inspected at the exact final SHA. A source diff is not a green test result.

### Deliberately unresolved integration dependencies

- Memory K PR #94 expressly remains NO-GO for original C-01 accepted-turn, source-time witnessing, single live PS4 frame, M5 UX, M6/M7 idle and PS6 callbacks. This storage port does NOT claim to enable M2-M9 runtime features. Their producers remain disabled until separate integration and authenticated source acceptance.
- G only changes original shared brain character/storage internals, required SQL modules, SQLite tests and EA6 workflow. Shared bootstrap/runner/native/Agent H implementation is unchanged; final integrator must test that a real admitted C-13 source and independently accepted protagonist authority coexist under controlled GTA.
- Existing production SQLite mode remains opt-in, default JSON. No live user database inspected or migrated and no GTA files changed.
- A full physical Windows GTA save/fork/soak receipt and packaged native/Node24 exact-head verification remain required.

**Deployment verdict: BLOCKED** pending exact-head Node24 Windows/Linux CI, packaging, authentic native receipts, and physical GTA test gates. Do not merge either parent integration branch.
