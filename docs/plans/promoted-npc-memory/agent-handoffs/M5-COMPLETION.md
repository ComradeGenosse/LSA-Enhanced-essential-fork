# M5 Completion — Agent D → Agent H

**Base:** PR #61 exact `c26948cacf2e00b076ec1b71fb1af6f8cf1962c9`.  
**Branch:** `feature/m5-completion-clarification-privacy-20261011`.  
**Status:** additional host-neutral M5 command and same-file SQLite privacy code plus integration tests. This branch does **not** wire accepted Essential turns, alter M2/M4/P2 ownership, or prove GTA deployment.

## Owned implementations

- `lsa-shared-brain/src/memory/explicitCommands.mjs`: retains existing strict v1 `memory_action` outcomes; persists frozen clarification choices **before** emitting a callback (when an M5 SQLite facade is provided); `handleMemoryClarificationReply` resolves only first/second offered IDs after revalidation against the accepted original evidence; `detectExplicitMemoryCommands` and `handleExplicitMemoryCommands` handle no more than two clearly separated commands with deterministic per-command UUIDs while retaining the original accepted source-line content and ID.
- `lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs`: `createM5SqliteServices({store,filePath,authorize,clock})`; additive M5 tables in the **existing** P2 database; frozen pending state, SHA-verified readback, five-minute expiry; user-authorized scoped inspection, exact archive JSON and create-only 0600 file export; tombstone-backed reversible trash, restore and expiry-triggered physical purge; downstream derived-memory suppression; legacy committed M5 forget tombstone import upon `ready`; erase associated stored curator jobs, appraisals and command receipts during physical purge. P2's `withTimelineWrite` is used for each transaction.
- `lsa-shared-brain/tests/memory-m5-completion.test.mjs`: real P2 SQLite fixture test for durable multi-turn alternatives, reconnect, no guesswork, isolation/expiry, suppress/restore/purge, authorization/revocation, and two-command parsing.
- `.github/workflows/memory-m5-completion.yml`: Node 22/24 × Ubuntu/Windows; includes the original M5 fixture and original integrated storage tests.

## Agent H integration steps — exact APIs

1. **After** initializing the production P2 SQLite store, create the services with the same file path, not a second DB file:
   ```js
   const m5 = createM5SqliteServices({
     store:p2Store, filePath:p2Store.filePath,
     authorize:({scope,operation}) => verifiedUserPrivacyApproval(scope,operation)
   });
   await m5.ready(scopedPromotedIdentity);
   const commands = m5.bindCommands();
   ```
   The `authorize` callback must be implemented by actual authenticated user consent/UX. No default permit. It must not be set to `()=>true` in production. `ready` requires the active verified native timeline source and recovers legacy `forget` tombstones.
2. **Only after** a source-accepted addressed M2 player line is committed, call `handleExplicitMemoryCommands({line,scope,commandId,store:commands,onClarification})`. `commandId` must be stable across retransmission; preserve literal `line.content`, character, world, timeline and confirmed controlling protagonist. Do not acknowledge successes before `durableCommit:true` and SQLite `verifyCommand` readback. Return independent outcomes for two commands; never combine them into a blanket claim of success.
3. When awaiting a choice, retain the stored `commandId` in the per-addressed-character UI/session. After reconnect, call `m5.ready(scope)` then `commands.getClarification({scope,commandId})` to recover pending alternatives. On an accepted choice line, invoke `handleMemoryClarificationReply({line,scope,store:commands,clarificationId:commandId})` **before** ordinary Luna dialogue. If null/clarify/failed, never invent a new candidate ID or claim the original save happened. Expired choices must be reissued as new commands.
4. For privacy UI: call `m5.inspect({scope})`, `m5.exportArchive({scope})` / `m5.writeArchive({scope,destinationPath})`, `m5.trash({scope,targetId,operationId})`, `m5.restore({scope,trashId,operationId})`. Use consent and exact promoted source scopes; surface the trash ID and expiry to the player. Schedule `m5.purgeExpired({scope})` under confirmed source/timeline and authorized privacy policy; failure must retry without exposure. `trash` returns a verified receipt; it is distinct from strict v1 `memory_action`.
5. **Critical M4 fence:** continue filtering `listSuppressedMemoryIds` and do not give suppressed originals or any dependent curated memories to PS4/PS6. Archive export is sensitive source data and must not be injected into Luna by default. Review the preexisting PR #61 `listSuppressedMemoryIds` reverse dependency behavior before changing its code (owned by integration).
6. Run the new CI matrix and `node --test lsa-shared-brain/tests/memory-m5-completion.test.mjs` with `node:sqlite`; verify exact branch head. A green fixture alone does not certify the live game. Test world epoch change, save-lineage rollback, interrupted speech and privacy UI in GTA separately.

## Boundaries and remaining work requiring the integration owner

- The approved full-character unpromotion/purge must be implemented inside **P2's profile deletion transaction** (shared owner code) so it also clears these M5-specific tables; this branch does not change that transaction. Do not interpret current per-timeline `purgeExpired` as full-character erase.
- The seven-day **scheduled worker** is not installed. `purgeExpired` is an explicit gated API, not an invisible background timer. An offline game cannot purge itself until the source guard permits.
- Existing PR #61 `forget` commits and M5 trash bookkeeping are separate transactions because editing `integratedSqlite.mjs` is outside this branch. Tombstone suppression is immediate; `ready` reconciles missing trash rows. Agent H should consider folding them into one future shared migration and ensure atomic privacy backup/restore.
- Archive JSON is a scoped **export**, not a full transactionally consistent P2 snapshot backup or a mechanism to erase all external exports, installed legacy backups, game files or third-party data. Agent H must handle end-user backup/export destination policy and any restore workflow.
- Legacy `memory_tombstones` and `memory_corrections` do not contain protagonist columns; the M5 facade uses existing command receipt ownership and evidence scope to avoid cross-protagonist exports, but shared schema and M4-level source fences remain integration responsibilities.
- No in-game test, production runtime change, compiled native binary, model call or GTA deployment was performed here.

## Acceptance checklist

| Requirement | Implementation | Qualification |
| --- | --- | --- |
| Durable pending choice with frozen IDs | M5 SQLite service | Requires production facade/accepted-line hookup |
| Expiry/reconnect and scope fences | M5 SQLite service | Requires valid host timeline confirmation |
| Up to two explicit compounds | Core parser/runner | Conservative syntax; no guessed implicit commands |
| Read/export/trash/restore/physical expiry purge | M5 SQLite service | User authorization and scheduling are integration-owned |
| Retain provenance before purge | Original journal + reversible tombstones | External archives/backups not erased |
| Derived suppression | Tombstones plus dependent closure | Review preexisting M4 traversal |
| Durable action acknowledgements | Existing PR #61 SQLite receipt + strict wrapper | Never treat `clarify` as committed action |
| Cross-platform SQLite tests | New CI workflow | Exact-head results must be checked |

