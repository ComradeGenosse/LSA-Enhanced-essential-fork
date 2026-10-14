# Memory K A/O: recursive inventory and scoped verification

Integration base: `bd51fc180efa6babc597f99f4987ef0538b61854` (#138, including #160). Architecture follows #158; D-021/D-022/D-023 and the existing authority/contracts remain unchanged. This work modifies verification infrastructure only. No production activation or native/game deployment is performed.

## Inventory and discovery

`tools/memory-k-verification/inventory.json` registers every `.test.mjs` in the four active suite roots. There are 158 files: 114 top-level E1, 16 nested E1 memory, 25 shared-brain, two memory-sim and one infrastructure suite. Archived research, helper/fixture modules and standalone companion sources are not active test suites. Removed **or newly unregistered** tests fail discovery, requiring a reviewed inventory update. Test bytes receive SHA-256 fingerprints in each run receipt.

The old `lsa-essential-e1-candidate/tools/runTests.mjs` and Python isolated loader scan only top-level tests. Some wrappers import nested modules, but this does not discover the entire nested tree. They remain available as historical/compatibility entrypoints; the new recursive `all` profile owns comprehensive discovery for #138. It uses explicit files, one process per file, avoiding same-process module cache/global state interference. File-level counts can overlap when a top-level compatibility wrapper imports a nested suite; never add these as unique test-case counts.

`memory-k-modular-verification.yml` targets #138 and runs Node 24 on Linux and Windows, checking out the actual PR head SHA rather than a synthetic merge ref. Separate infrastructure, policy, storage, source and all-source jobs retain logs/receipts even on failure. No failure is converted to a pass. Every existing CI workflow and acceptance assertion is retained. Adding suites in C/E1 requires updating the inventory and focused profile coverage.

## Commands and receipts

Review repair: CI job names and Markdown/JSON summaries now separate scoped verification health from the original S01–S10 release gates. A failed original gate stays failed; any other failing suite is explicitly reported as an unresolved verification/source failure. No assertion, selection, inventory, skip or process exit is softened. Reports require a clean, unchanged exact head for a passing runner result. The reporting regression test verifies classification does not mutate outcomes. Historical Windows WS6 latency/source failures remain unresolved until comparative baseline/candidate evidence explains them; a scoped green job cannot override them or certify full-product acceptance.

`node tools/memory-k-verification/run.mjs --profile NAME --output ABSOLUTE_OUTSIDE_CHECKOUT`

Profiles: `infrastructure`, `policy`, `storage`, `source`, `shared`, `essential`, `essential-nested`, `original-scenarios`, `all`. Profiles are test selections, not runtime configuration. Policy tests cover off intent, dependency failure and sibling requests; they do **not** prove operational switches. Storage/source suites retain positive, negative and regression assertions. C/E1 must supply production lifecycle/off/isolation acceptance tests before operational activation is certified.

Receipts include exact HEAD before/after, tracked and untracked changes, selected files/hashes, discovered counts, Node/platform, test pass/fail/skip/todo/cancellation counts, process errors and scope. `exactCleanHead=false` means a development run, not an exact clean commit certificate. Output belongs outside the checkout. `all` includes original red scenario assertions. External fetch is blocked; HTTP loopback is permitted for the existing real editor/control integration tests. Tests use their existing explicit provider doubles.

Original scenario tests receive a parent-owned temporary SQLite path so they reach the original runner and intended source assertions rather than fail merely for missing environment. Their original assertions/flags are unchanged. This profile is **not** the anti-forgery A10 certifier: run the existing `tools/memory-sim/closure-acceptance-replay.mjs` for independent V8 entry/readback evidence. No new receipt can certify S01–S10 or package/native/GTA acceptance.

## Baseline, rerun locally on Windows Node 24.19.0

At the exact base code, before infrastructure changes:

| Entry | Tests | Pass | Fail | Skip | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| Shared-brain, explicit file list | 318 | 318 | 0 | 0 | Offline unit/integration |
| Nested E1 memory, explicit file list | 169 | 169 | 0 | 0 | Offline unit/integration |
| Memory-sim tests | 7 | 7 | 0 | 0 | Anti-forgery/packaging-policy tests, not packaging acceptance |
| Legacy top-level E1 loader | 1085 | 1073 | 12 | 0 | Ten missing parent DB environments; missing ACT helper; blanket fetch blocked loopback editor |

The sandbox first produced SQLite atomic hard-link `EPERM` errors. Unrestricted reruns above distinguish these environmental failures from code defects; no SQLite atomicity safeguard was weakened. Existing ACT `ActivityTests.csproj` builds successfully with zero warnings/errors and supplies the missing Windows C05 pipe helper. The new loopback allowance resolves the loader/editor harness mismatch without permitting external provider calls.

Historical #138/plan totals (211/215 shared, 1022/1040 E1, 98/98 nested) describe older source/entrypoints and are not current-head certificates. The current shared integrated replay has two conditional T6 skip branches with stale historical labels; neither executes on this base (zero skips). Preserve them until their branch conditions receive separate review; presence of a skip call is distinct from executed skipped coverage. Node versions lacking built-in SQLite can skip M6 SQLite coverage; the new CI deliberately uses Node 24 and reports every actual skip.

## Release and native requirements remain independent

`scenarios.v0.json` still has all S01–S10 `implemented:false`; the final acceptance `m0-scenario-gate` remains red. Original source probes must fail without authentic positive evidence. D-022 replaces historical Core-only issuance for OpenAI, not D02/P2/source proof; stock Gemini remains denial-only. Original scenarios and the parent A10 certifier still require future implementation, not a rewritten pass marker.

Existing CI spans policy/source D01/D02/D03, M1 portability, WS4b durability, WS5a dialogue, WS5b events, WS6 recall/M8, M4–M9 and shared-player/privacy suites. The broad LSA v1 offline workflow targets only `main` and Node 22; it does not certify integration-branch Memory K. The new workflow fills that discovery/platform gap while retaining existing specialized jobs.

Native policy harnesses use .NET 8 and/or Windows net481. Production `native/promoted-characters/PromotedCharacters.csproj` uses net481, real pinned Essential DLL, explicitly approved RPH and DamageTracker paths, and actual project inclusion. Stub harness success is not production native compilation. M9 producer files absent from the production project remain unavailable. The W09 SDK preparation/production pin verifier requires approved external SDK files and hashes; do not find substitutes in a local GTA installation.

Package acceptance requires the original AST manifest/build pins and staged runtime hashes to reconcile at the exact same SHA. Focused green source tests cannot override packaging/native defects. Physical GTA, original S01–S10, latency/soak, and final #138 release are separately blocked/not run unless independently proven. No deployment is authorized by this infrastructure.

## Follow-up ownership

C owns centralized composition/disposal and truthful operational lifecycle receipts; add positive initialization, failure rollback, repeated startup, teardown/restart and sibling isolation tests. E1 owns the explicit storage-only configuration and real SQLite/editor/migration/no-consumer-effects tests. Both reuse #160 and existing single-writer/privacy/source infrastructure. A/O supplies discovery, receipts and profiles; it does not finish the full S acceptance program or authorize a merge.
