# Promoted NPC Memory v4 — One Shared Human Player

Date: 2026-10-12. Draft implementation/verification handoff. **No user database or GTA game modified.**

- Protected EA PR #96: `b1a9b01b72c406706bb640daacbe30a56efd6d4e`.
- Memory base: G repaired branch `fix/ea-final-g-completion-audit-20261012`, commit `f37193845859b94afb960f7e5ebd04b6b721d236`, itself based on G PR #106 and G audit PR #108.
- New independent draft [PR #114](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/114), branch `fix/ea-memory-unified-player-v4-20261012`, base **G repair branch**, not PR #96/main.
- Source verification point `300c033d844f1cc1f3939e00a2507d22e31cf410` (documentation commit not covered by prior test head).

## Player identity and safe source provenance

Franklin, Michael and Trevor are three *controlled avatar models of one human*. Player-facing permanent memories, commands, corrections, privacy, M4 recall, M7 curation and replay are scoped by verified `worldProfileId + promoted NPC characterId + confirmed timelineId`; no model-based relationship or player-identity partition.

The legacy `protagonist` / `protagonist_key` columns in committed v4 rows **are NOT rewritten**. They retain immutable original source provenance. M5 new commands still require a currently durably accepted original player utterance from the matching authenticated source model; source-independent *prior memories* may now span any of the three. NPC/M3 eyewitness proofs and verified native C-13 save authority remain mandatory. Unknown is never used as an identity wildcard.

### Changed production files

- `lsa-shared-brain/src/memory/integratedSqlite.mjs`: cross-avatar evidence candidates, source-verified permanent memory and correction readers, command receipt availability, deterministic mixed-source proposals (`multi_avatar` provenance).
- `lsa-shared-brain/src/memory/sqliteIntegratedRecallProjection.mjs`: one-NPC/one-save M4 query, accepted original dialogue/verified witnessed events and cross-model correction/suppression, retained per-source provenance in output.
- `lsa-shared-brain/src/memory/p2ReplayCursor.mjs`: v4 evidence feed remains immutable per-event source; canonical `shared_player_v1` cursor namespace (new opaque v2) crosses avatars; an old v1 avatar cursor *rewinds to zero* rather than incorrectly skipping other avatars' committed events. Stable record IDs must be deduplicated by replay consumers; new cursor cannot silently reuse old per-model high water.
- `lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs`: inspect/export, reversible forgetting/restoration and physical purge operate on one promoted NPC/save across avatar models; authorization and P2 single writer remain required; ledger rows retain model provenance.
- `lsa-shared-brain/src/memory/curationSqlite.mjs`: mixed-source qualifications and Luna appraisals for one player, with exact existing evidence/witness and tombstone gates.
- `lsa-shared-brain/src/characters/sqliteProfileStore.mjs`: source- and save-fenced M4 recall at the actual P2 read, no stale post-fork query.

### Tests and source verification

- `lsa-essential-e1-candidate/tests/ea-shared-player-memory.test.mjs` executes against a real temporary P2 SQLite v4 database: Franklin and Michael accepted turns recalled by Trevor; shared replay cursor and old token safe rewind; M5 cross-avatar forget/restore and whole-scope deletion; M7 deterministic memory from two different models; reopened persisted database requires fresh confirmation and does not leak different NPCs or saves.
- `.github/workflows/ea-shared-player-memory.yml` adds Node24 Windows/Ubuntu syntax verification and real G01–G15, EA6, EA Final B, P2 profiles and EA-F regression suites.
- Older focused CI [38246884248](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38246884248) **PASS on Windows and Ubuntu** at `4ac914286eedddb5456f4d5c25617aaa08020ac3` for the three initial cross-avatar tests and G regressions.
- Expanded suite at source SHA `300c033d844f1cc1f3939e00a2507d22e31cf410`: [workflow 38247619211](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38247619211). Verify its final Windows/Ubuntu outcome; a preceding Windows run found a disposable fixture WAL handle cleanup order and was repaired at this SHA.
- No real GTA M0 S01–S10 acceptance was performed. No mixing of distinct save timelines is allowed.

## Integration and remaining acceptance

This PR is a **production-code correction and test harness**, not a completed GTA deployment. Final Integration Agent I still must merge G/H/EA9 and this targeted memory repair, reconcile the original Memory K production closure requirements, run combined exact-head native/Node tests, package from pinned source and perform separately authorized physical game/audio acceptance. Existing M0 original accepted-turn / PS2 witness coverage may independently be blocked upstream; do not claim them complete because these storage tests pass.

Review proposed `multi_avatar` provenance value and replay-cursor v2 with Memory K's M4/M6 consumers as part of cross-system integration. Legacy cursors are rewound intentionally, not silently advanced. No user schema downgrade, no second P2 writer, no force-push, no main merge.
