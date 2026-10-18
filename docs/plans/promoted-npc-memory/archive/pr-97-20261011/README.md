# Memory K PR #97 — historical archive

This directory is a byte-for-byte archive of the four files added by [PR #97](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/97) at immutable source head `d6bd5f3f36881513c17e1add1a6fcf1c96944e01` (branch `planning/memory-k-production-closure-20261011`).

**Scope:** Original W00–W10 production closure implementation plan, machine-readable workstream/gate manifest, integrity validator, and CI plan-lint workflow.

**Status:** Historical planning specification. Its source and acceptance assumptions may differ from the newer Memory K independent audit and current production plan. Historical validators test plan consistency only; they do NOT certify source, GTA, or S01–S10 acceptance.

**Important safeguards:** This archive does **not** merge old plans or old tests into active production and does not imply any S01–S10 scenario, native C-01 source callback, package build, or GTA deployment was accepted. Archived `.github/workflows` files are deliberately outside the repository's active workflow directory. Archived code/validators are **not automatically executable at their original repo-relative paths**. Treat these files as an immutable reference, not as current engineering authority.

For the active current state, see [Memory K umbrella PR #138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138), its `docs/plans/promoted-npc-memory/MEMORY-K-INDEPENDENT-AUDIT-20261012.md` and `MEMORY-K-PRODUCTION-IMPLEMENTATION-PLAN-20261012.md`, and newer repair PRs.

## Original files and original Git blob hashes

- `.github/workflows/memory-k-plan-lint.yml` — `8c9790bf81cbc3a9143ffdacf8f26bdbf6abfb7d`
- `docs/plans/promoted-npc-memory/MEMORY-K-PRODUCTION-CLOSURE-IMPLEMENTATION-PLAN.md` — `46283f8e8225f33a0c06f225411bf2505cf51110`
- `tools/memory-sim/closure-workstreams.v1.json` — `01958b148a8bd097fd44eab114fba317e45c6b68`
- `tools/memory-sim/validate-closure-workstreams.mjs` — `90966305a3171c33d8df88e028732d991e968b58`

Original relative file paths are preserved under this archive root, keeping the four source blobs unchanged.
