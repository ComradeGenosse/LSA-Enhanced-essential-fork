# Memory K CI execution tiers

Memory K has many independently valuable offline/regression suites. Previously one draft PR synchronization with a large source diff triggered 23 workflows and 72 jobs, repeatedly on every commit. The tests are preserved; only scheduling changes.

## Draft development: fast feedback
- `Memory K development smoke (fast, draft-friendly)`: Linux Node 24 syntax, extracted H1, independent H2, capability policy, and H1/H2 composition when its test exists.
- `Memory K Workstream B policy regression`: focused configuration tests when relevant policy or bootstrap files change.
- Other Memory K broad regression workflows **skip their jobs** on draft pull requests. A skipped workflow is **not** evidence that it passed; do not consider draft CI sufficient for merge/deployment.

## Before merging into integration #138
- Mark the feature PR **Ready for review**. This fires the `ready_for_review` event and runs the existing relevant Windows/Linux regression matrices under their unchanged path filters.
- All original assertions, native/source negative gates, red acceptance failures, replay and baseline comparison checks remain intact. No test is removed, deleted, or weakened.
- Any later push to an already-ready PR again runs the relevant full matrices; per-workflow concurrency cancels older runs for that PR only. If CI is red, do not misreport it as green or merge merely because checks were skipped earlier.
- To force broader workflows with unchanged paths, invoke `workflow_dispatch` on the desired workflow and branch. Running tests is required for completion; no bare status without results.

## Before deployment from #138
- Require a fresh integration-head readiness pass: original runner / WS6, M2/D03, source authenticity, privacy, Windows/Linux, native compile/package and a reversible GTA playtest. The original S01-S10 source gates remain authoritative.
- The previously accepted 10,000-write heartbeat stress limitation remains documented, not reclassified as passing.
- Merging optimized CI to #138 does not retroactively cancel queue entries created under old workflow definitions. New runs will cancel their own superseded predecessors once this change is in use.

## Scope and safety
- Ready-for-review gating applies to 23 existing Memory K or cross-module workflows relevant to Memory K development. The focused policy job remains live on draft PRs.
- Concurrency keys use the workflow name plus PR number or ref, so a smoke run cannot cancel a distinct acceptance suite and one PR cannot cancel another.
- `workflow_dispatch` is preserved or added where absent. Standalone specialist workflows outside this observed over-triggered group are unchanged.
- Full feature PRs may still take minutes (especially Windows); this change reduces *redundant launches* and draft waiting, not individual test execution time.
