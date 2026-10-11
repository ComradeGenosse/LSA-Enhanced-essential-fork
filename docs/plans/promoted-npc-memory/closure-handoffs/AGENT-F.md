# Memory Closure Agent F — M5 command/UX handoff

**Source authority:** draft PR #75, exact starting SHA `8443a8adec9433626902b46b81bd3e58fc382fb2`; branch `feature/memory-close-f-explicit-ux-20261011`; PR base `integration/memory-completion-h-review-20261011`.
**Implementation source SHA before this handoff revision:** `6495526125fbedc623565d790a9b9a6ae185dd0c`. Use the dedicated PR HEAD for the subsequent documentation commit; the PR HEAD is the authoritative final source revision, not the old integration head. **Status:** isolated offline implementation; **NOT** integrated or deployed. No GTA source receipts, installer build, standalone runtime acceptance, or paid model calls.

## Changed files (F-exclusive)

- `lsa-shared-brain/src/memory/explicitCommands.mjs`: rule-based admission rejects conversational "remember when/how/to", no Luna interpretation authorizes writes, durable frozen-choice save required before asking, private labels never placed in spoken prompts, and exact accepted correction-reply wording with frozen evidence provenance.
- `lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs` (new): verified-M2-entrypoint with scoped deterministic v4 command IDs, per-member compound typed acknowledgments from underlying SQLite verification, durable-choice lookup/reconnect, source lifecycle rechecks, fail-closed original accepted text/identity, private-editor route for inspect/export, no raw content telemetry.
- `lsa-shared-brain/src/memory/m5ScopedPrivacyFacade.mjs` (new): authenticated exact-scope editor operations `inspect/export/trash/trash_scope/restore/purge`, one P2 privacy store port, stable mutation IDs, commit/verifyPrivacy matching for trash/restore, postauthorization recheck and zero source content in telemetry. Purge explicitly returns `verification_required` until B provides post-purge readback.
- `lsa-shared-brain/tests/memory-m5-completion.test.mjs`: imports the F closure fixture so existing M5 completion/combined CI actually executes the new suite without any K-owned workflow changes.
- `lsa-shared-brain/tests/memory-m5-closure.test.mjs` (new): host-neutral positive/adversarial fixture cases for casual remember, model influence, exact accepted bytes and secrets, stable idempotence, two NPC/scope changes, timeline retirement, reconnect/expiry/deleted choice, correction overlays, DB exceptions/lost readback, mixed compounds, private-editor redirection, privileged export, and missing/forged privacy receipts.

**No changes** to B's `m5SqlitePrivacy.mjs` or foundation, K's turn-runner/editor/bootstrap/glue, model knowledge renderer, config, native owner, or CI.

## Exported APIs and strict producer contracts

```js
import {createM5RuntimeCoordinator,stableM5CommandId}
  from './lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs';
import {createM5ScopedPrivacyFacade}
  from './lsa-shared-brain/src/memory/m5ScopedPrivacyFacade.mjs';

const coordinator=createM5RuntimeCoordinator({
  commandStore: m5SqliteService.bindCommands(), // B P2 serial writer
  authority: {
    assertCurrent({line,scope,sourceProof,stage}) {
      // SYNCHRONOUS true only for exactly current verified native promoted
      // owner/turn/hostRunId/epoch/incarnation/encounter, P2 timeline state,
      // committed player source, AND verified protagonist (or real unknown).
    }
  },
  pendingClarifications: {
    // durable B-owned lookup, scope + expiry + protagonist checked
    async findPendingClarification({scope,atUtc,excludeLineId}) {
      return {commandId: 'v4-uuid'}; // or null
    }
  },
  onTelemetry: safeEventsOnly
});
const res=await coordinator.acceptAcceptedPlayerLine({
  line: exactCommittedM2DialogueLine, // original immutable row from P2 readback
  scope: {characterId,worldProfileId,timelineId,protagonistKey},
  sourceProof: nativeCurrentSourceProof,
  clarificationId: null // optional B-verified persisted UI pointer
});
// res: {handled,route:'command'|'private_editor',status,
//       actions: MemoryAction_v1[],acknowledgements: M5UiAck[],clarification?}
// Each acknowledgement has {kind:'m5_ui_ack',outcome,
// durableCommit,commandId?,requestedByLineId?,text}; no source content.

const facade=createM5ScopedPrivacyFacade({
  privacyPort:m5SqliteService,
  authorize: async ({operation,scope,access}) =>
    verifiedAuthenticatedPlayerPermission(operation,scope,access),
  assertScopeCurrent: async ({operation,scope,access}) =>
    confirmedActiveP2SourceScopeAndPrincipal(operation,scope,access),
  onTelemetry: safeEventsOnly
});
await facade.execute({
  operation:'inspect'|'export'|'trash'|'trash_scope'|'restore'|'purge',
  scope,access,recordId?,trashId?,operationId?,limit?
});
// inspect/export returns {status:'ok',confidential:true,data} to editor ONLY;
// trash/restore/scope tombstone returns {status:'ok',receipt} iff B readback.
// Purge without B.verifyPurge returns {status:'verification_required'}.
```

`assertCurrent` must check the *same* original accepted M2 turn and owner authority both before and after the await/commit. It must not trust `sourceProof.nativeVerified` supplied by an untrusted caller alone. The current PR #75 native resolver is absent; **do not wire fail-open mock authority in GTA**. `verifyAcceptedLine` MUST compare exact persisted source bytes, committedAtUtc, speaker, delivery, source and protagonist; an in-memory or Luna-decided accept flag is insufficient.

`commandStore` MUST expose `verifyAcceptedLine({scope,line}):Promise<boolean>`, `findCandidates({scope,operation,selector,topic,beforeUtc,excludeRecordId}):Promise<Array<Evidence>>`, `commitCommand(operation):Promise<P2CommitReceipt>`, `verifyCommand({scope,commandId}):Promise<P2CommitReceipt|null>`, `saveClarification({scope,commandId,requestedByLineId,line,parsed,alternatives,frozen,createdAtUtc})`, `getClarification({scope,commandId,atUtc})` and `completeClarification({scope,commandId})`. These exist in B's current `bindCommands()` path. Only the real P2 writer transaction/readback may produce `status:'committed',durableCommit:true` with exact source IDs.

## Missing B ports / K merge dependencies

1. **Durable pending lookup after reconnect:** B must expose `findPendingClarification({scope,atUtc,excludeLineId}):Promise<{commandId}|null>` from the existing `m5_clarifications` table. Require exact world/character/timeline/protagonist, noncompleted, nonexpired rows; return the newest unambiguous pending ID only, and fail closed if multiple eligible (or make K explicitly select one). Never store a second pending map in the host. K may instead pass `clarificationId` obtained from this independently validated B reader. `getClarification` independently validates each frozen row.
2. **Purge readback:** B currently returns `{kind:'m5_purge_result',purgedIds,committedAtUtc}` without an independent read verification API. Expose `verifyPurge({scope,result}):Promise<{confirmed:boolean}>` using B's own serialized reader to verify affected rows, tombstones and provenance were purged, scoped to exactly those IDs. Facade does not claim verified success absent this.
3. **One P2 transaction owner:** PR #75 notes B M5 service opens auxiliary connection to the same SQLite file. B/K must resolve connection/transaction lock ordering before enabling concurrent gameplay/editor writes, while keeping all durable effects owned by P2. This F module adds NO connection and NO migration.
4. **Active original editor host route** (K owns): never add `inspect` or `export` raw data to Luna, PS4, prompts, TTS, chat telemetry, unauthenticated HTTP routes or analytics. Enforce user/session authorization in K and inside B SQL transaction, and only return confidential payload to an authenticated editor response. Confidential JSON export is not a save-file backup or a way to delete old external exports.
5. **P2 source boundaries**: verify real native owner and P2 timeline source at the commit boundary; do not silently blend protagonists, stale host epochs or retired incarnations. Real native proof currently blocked; do not claim GTA acceptance.

## Minimal K accepted turn order (no additional model frame)

1. Resolve original player-input native turn and promoted `CharacterId` with verified C-01/C-07 host/epoch/owner and protagonist (or `unknown` when real proof absent). Reject invalid/retired/timeline-unwritable source.
2. Commit M2 accepted typed/STT player bytes through original P2 serialized writer. Read the exact accepted `dialogue_line` row back (including exact bytes, `recordId`, source, `committedAtUtc`, `attribution.protagonist`). **No parsing an STT interim hypothesis or Luna text.**
3. Invoke `acceptAcceptedPlayerLine({line,scope,sourceProof})` **before any Luna provider send** and before PS4 recall composition. If `handled:false`, run normal dialogue. If `route:'command'`, present each typed acknowledgement only from verified readback, honoring partial mixed outcomes. If `route:'private_editor'`, launch authenticated UI action; do not send private data or save-claims into Luna.
4. When a clarification is pending, obtain ID from the scoped durable B lookup, revalidate frozen choices after reconnect/return, then route original accepted choice/replacement line through the same entrypoint. Missing, changed, expired or tombstoned choices never get reselected by Luna or a fresh nearest-neighbor search.
5. Recheck original current native authority and P2 suppression/corrections before any next PS4 provider send or retry; M4 owns the **sole** knowledge frame. Never let a model produce command receipts.
6. Wire UI endpoints behind verified auth+CSRF/session ownership: `GET /characters/:id/memory?timelineId=&protagonistKey=` -> facade.inspect; `GET /characters/:id/memory/export` -> facade.export; `POST /characters/:id/memory/trash` `{recordId,operationId,timelineId,protagonistKey}`; `POST .../trash-scope` `{operationId,...}`; `POST .../restore` `{trashId,operationId,...}`; `POST .../purge-expired` `{limit,...}`. Paths are *proposed contracts*, not routes added by F. Reject supplied `characterId` unless it matches authenticated scope; do not grant a wildcard actor lookup or pass `destinationPath` from arbitrary HTTP input.

## Tests & true execution status

```sh
node --check lsa-shared-brain/src/memory/explicitCommands.mjs
node --check lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs
node --check lsa-shared-brain/src/memory/m5ScopedPrivacyFacade.mjs
node --test lsa-shared-brain/tests/memory-m5-closure.test.mjs
node --test lsa-shared-brain/tests/memory-m5-completion.test.mjs
node --test lsa-shared-brain/tests/memory-integrated-storage.test.mjs
```

**Execution evidence:** NOT RUN locally in this session: repository clone/network and Node test runtime are not available through this connector-only working environment. Files and adversarial test cases were written to GitHub, but writing tests is not equivalent to a green run. The original M5 completion test now imports the new F closure suite, allowing the existing M5/H workflows to execute its cases on the PR head; this still requires exact-head Windows + Linux green logs before offline GO. K should also add explicit syntax checks and a direct new-suite command to K-owned final combined CI. Existing PR #75 CI results cannot be reinterpreted as testing these additions. No paid Luna calls, physical GTA receipts, merged main, or installation.

## Remaining hazards

- Three-turn `correct that` -> ordinal-only choice -> free-text replacement needs a durable *selected-choice* transition that B's current immutable clarification row does not support. Supported bounded alternatives are (a) direct single-candidate `correct that` -> explicit accepted replacement line or (b) two-candidate `correct that` -> one accepted `first: corrected wording` reply. An ordinal-only reply in the latter case remains `clarify`, never silently writes. B must own an additive transactional clarification phase if this three-turn UX is required.
- Exact B SQL timing and source restoration after external/offline backups must be tested with real P2 SQLite. A source tombstone suppresses immediate recall; physical purge after seven days is only performed by explicit authorized B worker calls. A scheduled purge worker and full P2-character deletion cascade are K/B integration work.
- Host-neutral mocked owner/port tests do **not** establish real native owner proof, cross-NPC GTA behavior, app installation, or S04/S09 physical acceptance. Source gap remains unknown rather than guessed.
