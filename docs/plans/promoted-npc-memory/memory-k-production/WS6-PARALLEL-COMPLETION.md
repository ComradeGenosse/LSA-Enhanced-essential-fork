# Memory K WS-6 completion — two parallel agents + final integrator

**Status:** work-order definition, not implementation approval.  
**Repository:** `ComradeGenosse/LSA-Enhanced-essential-fork`  
**Active feature PR:** [#152](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/152), `feature/memory-k-ws6-live-recall-conversation-20261013`  
**Final integration target:** [#138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138), `integration/memory-k-production-20261012`  
**Reviewed WS-6 starting point:** `76383fc97685f85944ada8429546af201c4fdc70`. Branch both agents from **the exact same #152 HEAD that contains this work order**, not from `main` or an older #138 snapshot.

## Why this split

#152 already has real original-acceptance -> P2 journal readback -> M4 recall, M5 command dispatch, CONVERSE-from-journal, and one PS4 allocation path. Its dedicated WS-6 offline CI passed on Windows and Linux. The missing work is (A) authenticated M8 opinion/relationship read preparation and (B) certified G5 coverage plus truthful G3 exact counts/G4 evidence labels. Both can be developed without competing edits to the single-turn runner.

The **source of truth** remains the original Memory plan and the Memory K production implementation plan, especially WS-6a/6b, G3/G4/G5, AD-1/AD-7, and K-02/K-13/K-18. This work order assigns ownership; it cannot weaken those requirements. **Full WS-7b** (personality profile/editor and all long-term behavioral policy) is not silently reclassified as completed by A's M8 read wiring.

## Immutable rules for everyone

- **One source, one writer, one prompt assembler:** P2 SQLite, its authorized serialized transactions, the original D01/D02/D03 accepted/source evidence, and PS4. Never open a competing memory DB, accept user/model-claimed source authority, or create another system-message/prompt writer.
- **Truthful epistemics:** a model's assertion, an absence of journal rows, an open sampling window, or a blank result does **not** establish a negative witnessed fact. Report `unknown`/`unavailable` instead. Opinions are source-linked *character opinions*, never verified world facts.
- **Scope, provenance, revocation:** one human across Franklin/Michael/Trevor, with the original avatar preserved as source provenance; strictly fence world, timeline, exact NPC, authenticated native owner/player lease, saved source incarnation, corrections and permanent suppression. Recheck at asynchronous boundaries and immediately before model send/retry.
- **Small, verifiable code changes:** no cloud calls in tests, no paid M7 opt-in, no GTA deployment or `main` merge. Keep incomplete features off/fail-closed; do not fake green S01–S10 acceptance.
- **Parallel ownership:** A and B may inspect any file, but **must not modify** `liveTurnMemory.mjs`, `essentialGlue.mjs`, `runSequentialTurn.mjs`, `d03OriginalDialogueJoin.mjs`, `knowledgeRenderer.mjs`, `knowledgeDelivery.mjs`, or common workflows. The integrator owns those. Do not cherry-pick/merge the other agent's branch into yours.
- Use your own uniquely named branch and isolated worktree/sandbox. Do not push directly to #152 or #138.

## Agent A — M8 source-authorized read path

**Mission:** Make the *existing* M8 interpretations, relationship signals and running jokes retrievable from verified P2 evidence as a bounded, typed contribution ready for PS4. This is read-side integration, **not** a new personality engine or a new long-term store.

**Starting points:** `lsa-shared-brain/src/memory/m8Interpretation.mjs` (`createM8ReadAdapter`, `preparePs4M8`, `verifyPs4M8Current`); `m8SqliteHistory.mjs`; `lsa-essential-e1-candidate/src/context/knowledgeSelector.mjs` (`projectPreparedM8`). Inspect relevant P2 journal and suppression APIs.

**Own:** a new or narrowly scoped M8/P2 read adapter module under `lsa-essential-e1-candidate/src/memory/` (and focused tests); any helper changes **only** where strictly necessary, explicitly listed in the PR. Prefer production-style factory functions reusable by standalone tests and by the final integrator. Do not edit the shared turn/PS4 caller files.

**Acceptance:**
1. On the confirmed NPC + world + timeline, load only committed and authenticated player/NPC dialogue, verified witnessed-event sidecars, eligible deterministic memories, permitted Luna appraisals, source corrections/forget suppression, and durable M8 history, using the **same P2 SQLite source**. Ensure existing M8 adapter's expected receipt shapes are produced from real store reads, not self-attested booleans.
2. Preserve cross-avatar player continuity, original avatar provenance, explicit approved personality/canon precedence and separate opinion-vs-fact typing. No new relationship knowledge manufactured without traceable IDs.
3. Provide a typed, byte-bounded `preparedM8`/authority verification interface compatible with existing PS4 `projectPreparedM8`. Old source, source switch, revoked timeline, wrong NPC, missing evidence, deleted/corrected memory, delayed reads or retries must drop the entire stale contribution safely.
4. Offline integration tests from real P2 SQLite: genuine positive opinion and joke/history read; cross-avatar continuity; false/forged sidecar and non-delivered NPC speech rejected; forgetting/correction/restart suppress immediately; expired authority and delayed read fail closed; no second writer/system prompt.
5. State precisely what remains for **WS-7b** personality features, rather than claiming that the whole M8 program is complete.

**Deliver:** isolated branch `feature/memory-k-ws6a-m8-reader-20261013`, **draft PR targeting #152**, focused tests/CI evidence, short usage contract for Agent C. No live runner integration.

## Agent B — G5 certified coverage + G3 counts / G4 labels

**Mission:** Build the missing *read-side answer-evidence policy*. Surface what is known, what is not provably known, and when numeric or categorical recall claims are supported.

**Starting points:** `lsa-shared-brain/src/events/m3CoverageSqlite.mjs` (`readM3Coverage`, `readObserverCoverage`), `lsa-shared-brain/src/memory/recallEngine.mjs`, `recallSchemaV1.mjs`, `integrationPorts.mjs`, plus #152's `liveTurnMemory.mjs` and PS4 selector (read-only inspection). The coverage ledger's writer is already in #138.

**Own:** a new scoped read-side coverage/count/label module and corresponding focused tests. If a shared M4/PS4 schema extension is genuinely required, document its minimal intended shape and tests; leave edits to shared runner/rendering files for Agent C. Do not edit A's M8 module.

**Acceptance:**
1. G5: distinguish `witnessed`, independently **certified** `did_not_witness`, `unknown`, and `unavailable` where the original contract supports them. Only issue a specific negative for an appropriately source-qualified native negative certificate with coverage continuity; the observer-frame ledger alone proves a sampling interval, **not** that a specific event was absent. Include ledger gaps, pause/stall, disconnect, partial windows and observer/stream change as disqualifiers.
2. Every coverage conclusion is scoped to the exact NPC/world/timeline, requested time range and authenticated source. Never convert zero results from a bounded page into `did_not_witness` or `not_recorded`.
3. G3: an exact count or first/last claim requires exhaustive, source-qualified, unsuppressed results, not the M4 384-row candidate cap, PS4's 12-item limit, or the 20-message CONVERSE window. If no complete proof or a query is unsupported, return explicitly incomplete/unavailable; never extrapolate an exact number. Preserve the best matched evidence with a precise completeness status.
4. G4: retain byte-exact source quotes and clear distinction among directly observed fact, reported claim, archived memory and character opinion. Do not imply an NPC directly witnessed a report; retain provenance and correction/suppression semantics.
5. Test witness/no-witness/unknown boundaries; partial coverage and lost-observation gaps; two NPCs/saves/avatars; forged native negative; suppression/correction/restart; more than 384 committed rows; exact count or honest refusal; and PS4 size budget preservation.

**Deliver:** isolated branch `feature/memory-k-ws6a-g3-g5-recall-20261013`, **draft PR targeting #152**, focused tests/CI evidence, short data contract for Agent C. No live runner integration.

## Agent C — final review, combine, and acceptance

**Start only after both A and B have pushed their own draft PRs**. Check their work against this file and the original plan, not just green tests.

1. Refresh the latest #152 and #138; confirm both agent branches descend from the pinned planning commit. Independently audit code + tests for authority provenance, truthful negative assertions, count completeness, source suppression, cross-avatar privacy, single P2 writer, single PS4 assembler and no new prompt/LLM writes. Resolve gaps **before** integration.
2. Integrate A/B **without resetting #152**. Own the shared files (`liveTurnMemory.mjs`, `essentialGlue.mjs`, `runSequentialTurn.mjs`, `knowledgeRenderer.mjs`, `knowledgeDelivery.mjs`, `knowledgeSelector.mjs` and CI wiring). Reuse the real D03 native current-source proof and preserve current M4/M5/CONVERSE behavior. Make M8, G5, G3/G4 optional, independently source-fenced PS4 contributions. Never treat a failed optional contribution as authorization for an unverified one.
3. Use a temporary branch from current #152 for conflict resolution and acceptance if needed. Once accepted, merge both specialist branches and any integration fix into **#152 only**; do not open an unnecessary new mega PR or direct-merge to #138. If defects remain, leave specialist PR draft/open with a precise blocker.
4. Run on the **combined exact HEAD**: Node24 Windows and Ubuntu WS-6, original runner and strict D03/W03/WS-5a, M1, M3/coverage, M4, M5, M6/M7 and W05/M8, unified-player, and relevant PS4/render/prune suites. Address flaky tests honestly; do not treat reruns or unrelated legacy global failures as automatically green. Test source loss **during** preparation and immediately before send/retry.
5. Measure recall latency using repeatable production-style *offline* P2/PS4 paths (including cold/restart and a busy journal), report median/p95 and sample count against the plan's **p95 ≤ 40 ms M4** criterion rather than assert it without a measurement. Record G3 count correctness and G5 abstention accuracy. This is not a GTA timing claim.
6. Review #152 against the then-current #138, including any new commits after agent kickoff. Advance to #138 **only after** scoped correctness, source and acceptance checks pass. Keep #138 draft; broad W09, S01–S10, physical GTA, SDK/net481 and later WS-7/WS-8/WS-9 remain distinct release gates. If full WS-6a is not complete, document what is left and keep #152 draft.

**Deliver:** one integrated, source-reviewed #152 with exact-head CI links, changed-file inventory, known blockers and a truthful merge/no-merge verdict. Do not close PRs whose unique work is not recovered.

## Agent handoff format

Every agent's PR description should state: exact starting SHA, owned/modified files, what behavior is actually implemented, targeted tests with results and run links, known missing parts, and the precise instructions the next agent needs to reuse the work. PR count is not a success metric; working code and passing verifiable tests are.

## One-line dispatch messages

- **A:** `Implement Agent A from docs/plans/promoted-npc-memory/memory-k-production/WS6-PARALLEL-COMPLETION.md. Work only on your parallel branch; open a draft PR targeting #152.`
- **B:** `Implement Agent B from docs/plans/promoted-npc-memory/memory-k-production/WS6-PARALLEL-COMPLETION.md. Work only on your parallel branch; open a draft PR targeting #152.`
- **C (after A/B):** `Act as Agent C in docs/plans/promoted-npc-memory/memory-k-production/WS6-PARALLEL-COMPLETION.md. Audit both draft PRs, integrate safely on #152, run combined checks, and decide readiness for #138.`
