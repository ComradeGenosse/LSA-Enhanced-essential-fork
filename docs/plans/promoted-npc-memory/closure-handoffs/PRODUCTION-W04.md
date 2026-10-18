# Memory K production closure — W04 / A04 T4 handoff

**Status: specialist source submitted, NOT integrated, A04 UNVERIFIED, controlled GTA NO-GO.**  
**Repository:** ComradeGenosse/LSA-Enhanced-essential-fork  
**Immutable starting baseline:** PR #94, commit \`0201731973a1c02a8852271897e2c8df420396b9\`  
**Work branch:** \`feature/memory-k-t4-m5-commands-privacy-20261011\`  
**Draft PR:** https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/104  
**PR base:** \`integration/memory-closure-final-k-20261011\`  
**Exact code commit before this handoff:** \`a6b033121db7ee62f3c08249d09276a1e769688f\` (the subsequent handoff commit changes the PR head; the PR's live head is authoritative for final CI).  
**Planning authority:** PR #97 / W04, gate A04, \`tools/memory-sim/closure-workstreams.v1.json\`. Source reference: Agent F PR #88 and \`closure-handoffs/AGENT-F.md\`.

## Actual implementation delivered

Only W04-owned production modules and a unique W04 test file were edited; **no Agent K exclusive files were changed**.

1. \`lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs\`: original accepted-line dispatch keeps synchronous \`authority.assertCurrent\` checks before source read, writes and returned acknowledgements. Uses the P2 pending-clarification read port when supplied by \`bindCommands\`. For two-part commands, stages all operations without public effects, then atomically writes both through \`commitCommandBatch\`; independently verifies persisted outcome before returning success. Unresolved compounds fail closed without a partial mutation. Stable IDs derive from source-line/scope.
2. \`lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs\`: source-text, source-kind, attribution, world/character/timeline/protagonist, hostRunId and worldEpoch checks against the original persisted \`dialogue_journal\` row; sole existing P2 serialized SQLite transaction/cursor for single and compound remember/forget/correct; replay-conflict rejection and effect readback; source-linked STT correction restricted to an original accepted STT line. Pending alternatives persist with bounded expiry, frozen source candidates, source/epoch/timeline revocation and multiple-pending denial. Tombstones and dependent suppression take effect at the same transaction as a forget. Scope-restricted inspection/export/trash/restore, seven-day trash, durable idempotent purge IDs, final purge receipts and independently verified scoped absence. Purge walks dependent/ancestor evidence to prevent restored recall when tombstones are removed.
3. \`lsa-shared-brain/src/memory/m5ScopedPrivacyFacade.mjs\`: stable purge operation ID and exact postread verification required; all calls continue to require authenticated explicit authorization and current-scope checks. Confidential archive content must be delivered **only to the authenticated local editor**, never to Luna, TTS, PS4 or telemetry.
4. \`lsa-shared-brain/tests/memory-k-production-w04-sqlite.test.mjs\`: *real file-backed* \`createP2MemoryStorage\` / \`node:sqlite\` regression suite, no fake SQLite receipts. Covers post-M2 receipt and replays, one-transaction two-command atomicity with an actual SQLite fault-injection trigger on member two, no false saved ack, missing source and epoch invalidation, durable ambiguous clarification, linked STT correction, trash/restore/purge and seven-day source suppression, cross-character/protagonist/world/timeline veto.

**New/extended P2 ports:** \`createM5SqliteServices({store,filePath,clock,authorize})\`; \`const commandStore = service.bindCommands()\`. Added \`commandStore.commitCommandBatch({scope,line,operations})\`, \`commandStore.findPendingClarification({scope,atUtc,excludeLineId})\`, strengthened \`verifyCommand\` by live effect check. Privacy service now exports \`verifyPurge({scope,result})\` and accepts stable \`operationId\` on \`purgeExpired\`.

All SQLite mutations use the *existing* \`store.withTimelineSqliteWrite(scope, fn)\` and readbacks use \`store.withP2SqliteRead(scope, fn)\`. There is no separately opened connection or separate memory writer.

## Required Agent K exclusive wiring (not implemented in this PR)

### Original turn runner: \`lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs\`

At original source around lines 202–215, the runner commits RAM history and calls \`services.recordM2Player\`, currently catches/drops a failed write and immediately proceeds to \`transition('model_running')\`. The exact change is **after W01 original C-01 acceptance and W03 durable P2 readback, but before \`transition('model_running')\`, \`finalizeKnowledgeFrame\` or ANY Luna/provider send**:

\`\`\`diff
- try { await services.recordM2Player({turn,text:finalInput,source}); }
+ let acceptedLine = null;
+ try {
+   acceptedLine = await services.recordM2Player({turn,text:finalInput,source});
+ } catch { metrics?.event('memory_journal_not_committed',{role:'player'}); }
+ if (acceptedLine && isPlayer && services.dispatchM5CommittedLine) {
+   // EXACT W03 SQLite-readback line; W01 frozen current C-01 turn + P2 scope.
+   const m5 = await services.dispatchM5CommittedLine({
+     turn, line:acceptedLine, originalSource:source
+   });
+   check(); // same source identity/host current after awaits
+   if (m5.handled) {
+     // Present only typed, readback-confirmed acknowledgments through the
+     // original player-priority approved output path. Private editor data
+     // NEVER becomes a model/tool/voice transcript. Do NOT call Luna.
+     return await host.presentM5CommandResult(m5, identity, controller.signal);
+   }
+ }
  transition('model_running');
\`\`\`

\`host.presentM5CommandResult\` is **illustrative proposed integration seam**, not an existing API; K must choose/source-verify the actual Essential output/native priority path rather than merely copying the pseudo-diff. If original output cannot be proven, disable spoken success. A missing durable M2 receipt must **never** become an invented save; if memory-command text lacks an authenticated receipt it must not execute or be interpreted by Luna as committed. Standalone RAM history does not authorize commands.

### Essential runtime: \`lsa-essential-e1-candidate/src/integration/essentialGlue.mjs\`

Build the W04 coordinator only from the one real P2 store and the W01+W03 origin, not an arbitrary JavaScript \`isCurrent\` callback:

\`\`\`js
const m5Sqlite = createM5SqliteServices({
  store: p2Store,
  filePath: p2Store.filePath,
  authorize: ({scope,operation}) => exactAuthenticatedPrincipalScope(scope,operation)
});
const m5Commands = m5Sqlite.bindCommands();
const m5 = createM5RuntimeCoordinator({
  commandStore:m5Commands,
  pendingClarifications:m5Commands,
  authority:{
    assertCurrent({line,scope,sourceProof,stage}) {
      // SYNC, return true ONLY for W01 original C-01 accepted turn,
      // exact immutable generation/session, native owner-incarnation,
      // protagonist and source identity, same host/epoch, currently
      // confirmed P2 world/timeline and same W03 committed player line.
      return verifyOriginalSourceAndOwnerNow({line,scope,sourceProof,stage});
    }
  }
});
// dispatchM5CommittedLine passes the EXACT committed W03 row + native proof.
// Result handled:false means ordinary Luna; handled:true must NOT use Luna.
\`\`\`

Do NOT use \`m5Sqlite\` as an alternative P2 store; bind to the same store. Never expose a \`nativeVerified:true\` caller flag as a proof. Track/revoke clarifications when native host, timeline or current protagonist changes, including transitions without a subsequent M5 call.

### Character editor (K-owned): \`src/characters/editorServer.mjs\` and \`characterService.mjs\`

Add a **separate privileged memory privacy action**, *not* a second legacy P1 memory editor backend, using \`createM5ScopedPrivacyFacade\`. Require existing local editor/session/CSRF token, precise P2 world/character/timeline/protagonist and current W01 owner, and server-side \`authorize\` + \`assertScopeCurrent\`, **plus** SQL scoped authorization. Route \`inspect\`, \`export\`, \`trash\`, \`trash_scope\`, \`restore\`, \`purge\` to \`facade.execute\` and include stable operationId for every mutation. Export private JSON only as an authenticated editor response; never echo content in game dialogue, TTS, Luna or telemetry. Do not treat P1 \`characterService.memory()\` as M5 journal.

### K CI and acceptance

Add these exact test commands to the K-owned Node24 Ubuntu/Windows matrix and run on the **merged integration head**, not just the present specialist PR:

\`\`\`sh
node --check lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs
node --check lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs
node --check lsa-shared-brain/src/memory/m5ScopedPrivacyFacade.mjs
node --test lsa-shared-brain/tests/memory-k-production-w04-sqlite.test.mjs
node --test lsa-shared-brain/tests/memory-m5-closure.test.mjs lsa-shared-brain/tests/memory-integrated-storage.test.mjs
\`\`\`

Add original W01->W03->W04 runner fixtures confirming provider invocation count **zero** for committed commands, source rejection never acknowledges, original host/epoch and protagonist veto, correction/negative response, all W04 SQL tests and M0 S04/S09 replay receipts. The present K final workflow and M5 completion workflow **do not call** the new W04 suite; do not cite their green runs as proof this suite passed.

## Verification record (honest source/offline/physical distinction)

- GitHub code pushed and draft PR created. Original first parent is \`0201731973a1c02a8852271897e2c8df420396b9\`.
- Source syntax: four edited JS files were independently *parsed* by a JavaScript Function constructor after stripping module imports/exports; no reported parsing exception. **This is not a Node24 import, SQLite execution or behavioral test.**
- Actual W04 SQLite suite: **NOT EXECUTED** in this session; direct runtime/working-tree execution unavailable through connector-only repository access.
- PR #104 existing workflows autoqueued; at time of source assessment workflow runs including Memory K final and Memory M5 Completion reported **queued**, not passing. No exact-head green test logs and no separate original runner source integration receipt have been obtained.
- In-game physical GTA tests, original native C-01/M2 receipts, real editor UI and S01–S10 replay: **NOT EXECUTED / NOT CLAIMED**.

## Unverified dependencies and explicit restrictions

1. **W01 T1**: authenticated normal native original accepted C-01 identity, protagonist and promoted owner must be source verified. Test-only authority callbacks cannot authorize GTA behavior.
2. **W03 T3**: original accepted typed/STT bytes must reach the one SQLite journal and be independently read back with original native generation, session, host, epoch and protagonist. Command engine is never invoked on interim STT or RAM history.
3. **Agent K**: exclusive runner/glue/editor routing, full original priority-safe acknowledgement delivery and confidential editor UX are still absent. Without them this branch is not an enabled feature.
4. **Atomic compound clarification**: a two-command input that requires clarification currently returns \`compound_unresolved_no_mutation\`, avoiding partial mutation rather than creating a multi-action clarification UI. Single ambiguous commands persist bounded alternatives. K should not claim full compound clarification UX.
5. **Original ABI and source**: C-01 acceptance and native lifetime must be checked at commit/readback boundary; P2 own transaction source fences are necessary but NOT proof of external native ownership alone.
6. **Corrections/privacy invalidation**: the entire integrated M4/M6/M7/M8/M9 recall projection, cache flush, restored item ordering, privacy exports, and unrelated published external exports must be independently checked against suppression at each use. Existing downloaded exports cannot be retroactively erased.
7. **Physical scope**: no main merge, GTA install, cloud calls, source capability guessing or GO for controlled GTA from this PR.

**Gate A04 verdict: source proposed/committed, test and shared original runtime receipt outstanding, NO-GO.**
