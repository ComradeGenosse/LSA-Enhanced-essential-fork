# Memory K cleanup Wave 6 — pending plan/research closure and W09 source-sim consolidation

**Date:** 2026-10-13. **Read-only review:** no PR closed or merged; canonical umbrella [#138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138) pinned to `8d74cb684d108abfda696b6c881d56073a733659`. All targets verified open with original reviewed SHAs. Prior audit Wave 5 closed #55,#56,#57,#59,#77; its original #77 archive is already present in umbrella.

## Three uniquely unincorporated plan / research PRs

| PR | Pinned head | Distinct paths missing in #138 | Decision |
|---|---|---:|---|
| [#97](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/97) | `d6bd5f3f36881513c17e1add1a6fcf1c96944e01` | 4/4 | **Hold, archive then reconcile**. W00–W10 production plan; `closure-workstreams.v1.json` (11 workstreams, 12 gates, S01–S10 mapping); manifest validator; plan-lint CI. Newer living plan and audit exist but are **not** byte-equivalent and their acceptance-authority interpretation differs. Preservation is necessary; historical validator should not become a new unreviewed active gate. |
| [#110](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/110) | `7431a310f8878233807110d649891d2aaab3df01` | 4/4 | **Hold, preserve research tool**. Distinct pinned original Core private IL .NET10 call-graph audit, project file, investigator's receipt and Windows workflow. Scan deliberately emits `nativeAcceptedTurnReceiptVerified:false`; no normal final C01 native accepted-turn proof. Research tool and provenance still useful. Archive byte-identically with source paths/SDK dependencies documented, not claim it implements an actual callback. |
| [#113](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/113) | `45cae96bcd2ece646fa62a904651cb9346849548` | 4/4 | **Hold, archive and track gates**. Distinct D01–D07 dual-source plan, eight-blocked-gate addendum manifest, validator and plan CI. The addendum *proposes* original backend postacceptance typed/STT + authenticated current native owner, not fabricated native postacceptance. Compare revised contract to authoritative current accepted source/go-no-go decision and ensure still-failing S01–S10 listed before closing. |

**Recommendation**: emulate PR #77 historical preservation by copying all 12 source blobs into clearly historical subfolders on #138, and recording SHA, origin branch, runnable references, and superseding doc links. Keep research tooling and named acceptance decisions available; do not silently activate archived workflows. Following preservation, close only after reconciling outstanding gates, with review comments and source branches retained.

## New implementation check

| PR | Head | Files exact / total | Reviewed source deltas | Decision |
|---|---|---:|---|---|
| [#111](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/111) | `00aaa4e3a9a16dc7ac9a97a90155d047e7775baa` | 1/6 | **All 6 original files present**: five have later revisions. Source-sim replay suite retains S01/S03/S07, 205+ dialogue / 2501+ events, 2 NPCs, durable cursor, privacy and rollback. Obsolete M6 adapter-negative case replaced with more precise strict negative plus positive SQLite P2 checkpoint/CAS/restart cases and three-avatar human ownership. Original W09 stdout-self-attestation acceptance was replaced with independent Git blob checks, parent-measured V8 execution and SQLite readback and a forged-receipt test. Workflow adds native policy jobs and approved external SDK preparation; pinned verifier now separates packaging/native-policy/original-runner and records true blocked states. Producer manifest v2 explicitly separates backend accepted input and current native corroboration. W09 still not production/GTA-ready. | **SAFE ADMINISTRATIVE CLOSE** against #138, with audit note; retain branch. |
| [#115](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/115) | `073094a8c13d323cb9e1b0f8054aba86b03a09d1` | 8/27 | All 27 paths present but **19 revised**, including durable P2 memory, M5 deletion/privacy, cursor migration, M7 curation and tests. Overlaps held #99/#100/#104 and audit K05/K06/K07 fixes. | **HOLD** until a dedicated behavioral/adversarial diff review, especially forget/purge, cursor migration and cross-avatar source scope; path presence insufficient. |
| [#114](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/114) | `6eb288f5f1d6f02f9db7d2cb959c3a985adc4613` | 0/9 | Six original implementation file paths present but revised. Three **missing**: `.github/workflows/ea-shared-player-memory.yml`, `docs/handoffs/EA-MEMORY-UNIFIED-PLAYER-CLOSURE.md`, `lsa-essential-e1-candidate/tests/ea-shared-player-memory.test.mjs`. The PR is originally based on the separate EA G-closure branch, not canonical Memory K. | **HOLD**, requires cross-EA lineage/behavior review and preservation of unique regression coverage, not blanket Memory K closure. |

## Operational next steps

1. After pinned-head recheck, administratively close **only #111**, no branch deletion or merge, with Wave 6 source link and caveat that W09 original S01–S10 and GTA remain NO-GO.
2. Preserve **12 missing artifacts from #97, #110, #113** as immutable historical snapshot(s) before any closure. Reconcile the change in C01 accepted-turn authority and source-gate definitions. No test-only CI is acceptance.
3. Schedule separate behavioral diff for **#115**; cross-project review and missing test retention for **#114**. Continue holding #99,#100,#104,#117,#130 and newer repair PRs #139–143.

No tests executed during this review. Source blob comparison and inspections only.
