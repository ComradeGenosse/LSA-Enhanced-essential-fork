# Memory K PR cleanup — Wave 5 foundation and historical planning review (2026-10-13)

**Read-only audit; no PR closures, branch deletions, source merges, workflow changes or GTA deployments.** Canonical integration PR [#138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138) unchanged at `2a164120926c1d743cbd382044639edff07d97d9`.

## Method

Read every target PR head from GitHub; compare the resulting GitHub PR changed-file blob SHA and name with the complete #138 tree; inspect changed production implementations and fixture test suites for the foundation group; read each missing historical plan/research artifact for the documentation group. Matching file paths alone do not prove semantic parity, and we did **not** execute tests. All original source branches remain available. This review does not establish original S01–S10 production acceptance.

## Implementation PRs: candidates to close administratively as superseded by #138

| PR | Exact reviewed head | Paths present / total | Identical blob SHA | Original named test scenarios retained | Notes |
|---|---|---:|---:|---|---|
| #55 | `32ed2aeee7b688a397c1a1938cffe3c355327182` | 8/8 | 2/8 | 14/14 | `M9NativeEventProducer` preserves event families (vehicle crash, rollover, stunt, water, wanted-level, wasted/busted) under rewritten stricter candidate/source checks. WitnessedEventRecorder preserves grace and evidence normalization with new continuity/negative-coverage checks. Original test suite retained by name. |
| #56 | `de10ca83bbba1f2e99ec5787edeb5ac5b20f183d` | 9/9 | 2/9 | 12/12 | `selection`, `consolidation`, `lunaCurator`, `queueContract`, `evidence` and Essential bridge all present; expanded/reworked for durable provenance, cloud consent and cross-avatar ownership. This does *not* resolve newer #99 M7 production-consent test gaps. |
| #57 | `6fadd184bc49cff2c34b017cba9e5894b744272e` | 5/5 | 2/5 | 8/9 unmodified; 1 deliberately updated | Recall engine/SQLite adapter retained with v4 verification, source hash, false-memory suppression, stronger PS4 budgets; changed test enforces shared player across Franklin/Michael/Trevor rather than isolating per-protagonist memory. There are 16 tests total, 8 more than original after the renamed case. |
| #59 | `39c8e16414dd9e26d993961015ecba9500de6733` | 6/6 | 3/6 | 20/20 | Original M5 parser, command authority and fixture store retained; additional atomic multi-command/clarification helpers and shared-avatar behavior. Does *not* resolve distinct #104 privacy-purge contract concerns. |

Original code is not generally byte-identical; these are **administrative supersedence** recommendations after inspecting changed sources and tests, not a guarantee every undocumented behavior is unchanged. Preserve branch tips and cite this audit upon closure.

## Historical planning and research: files absent from #138

| PR | Head | Unique original files | Recommendation | Reason |
|---|---|---:|---|---|
| #77 | `d8480438bf212215d487bf7a697c9c19c4a5fca6` | 12 | **Historical planning closure candidate (archive only)** | Old phased A–K prompts/plan; documented as planning-only and no runtime code. Work has progressed through later implementations. Original 12 files are NOT in #138; preserve source branch and describe as archived historical planning, **not incorporated code**. |
| #97 | `d6bd5f3f36881513c17e1add1a6fcf1c96944e01` | 4 | **HOLD / archive only after plan reconciliation** | Unique W00–W10 plan, machine-readable `closure-workstreams.v1.json`, source-anchor DAG validator and plan-lint CI. #138 has newer living plan/audit with differences, including explicit discussion of #97 changing acceptance requirements. Preserve as historic acceptance-contract reference until discrepancies are reconciled or explicitly archived. |
| #110 | `7431a310f8878233807110d649891d2aaab3df01` | 4 | **HOLD** | Unique pinned original native Core IL reader / call graph research tool, .NET project, workflow and C01 investigation. Original post-acceptance evidence remains an open issue; tool is neither runtime implementation nor present in #138. Retain discoverable for further source tracing. |
| #113 | `45cae96bcd2ece646fa62a904651cb9346849548` | 4 | **HOLD / archive only after source gate tracking verified** | Unique D01–D07 dual-source acceptance and W09 anti-forgery closeout plan, machine-readable gate manifest, validator and workflow. Some downstream work has landed under new branches, but original S01–S10 acceptance remains blocked. Before closure, ensure open gates are tracked in #138's living plan or issues, and preserve archive reference. |

## Suggested next action

1. Administratively close **#55 #56 #57 #59** as superseded, rechecking unchanged heads and leaving branches intact.
2. **#77** may be closed as a *historical plan archive*, with an explicit warning that its original planning files are retained **only in its source branch**, not included in #138.
3. Keep **#97 #110 #113** open pending targeted plan/research retention decisions. Keep all original #99/#100/#104, #117/#130 and repair #139–143 open.
4. Do **not** merge #138 to main or claim GTA readiness from this source-only review.

[Wave 1](memory-k-pr-cleanup-wave1-20261013.md) · [Wave 2](memory-k-pr-cleanup-wave2-20261013.md) · [Wave 3](memory-k-pr-cleanup-wave3-20261013.md) · [Wave 4](memory-k-pr-cleanup-wave4-20261013.md).
