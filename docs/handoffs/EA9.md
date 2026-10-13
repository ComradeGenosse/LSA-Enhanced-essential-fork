# EA9 Final Fix Agent D — offline acceptance, release seal and reversible isolated deployment

Date: 2026-10-11. Repository: ComradeGenosse/LSA-Enhanced-essential-fork.

**Immutable starting commit**: PR #68 head 4cad39198478d7f03bb8ec6657b674e52fa659dd.
**EA9 branch**: feature/ea-final-d-ea9-release-verification-20261011.
**PR base**: integration/elevenlabs-emotional-acting-ea0-ea4-20261011.
**Release decision**: NOT READY; source integrations EA5–EA8 absent on this independent branch and no final F combined HEAD, native GTA run, packaged artifact or paid ElevenLabs evidence has passed.

## Read / verified source dependencies

- PR #52: real M1 SQLite core v2 and lineage guard, not a simulated timeline.
- PR #54 and #60: ElevenLabs provider origin and EA planning contract.
- PR #68: EA0–EA4 integration, native stub CI and original malformed EA4 assertion.
- PR #80 / EA5: dedicated native sensor, native integration tests and authenticated pipe adapter, intentionally disabled until F.
- PR #76 / EA6: real shared brain SQLite and a new timeline source bridge, missing F-owned intelligence subscriptions and packaging of shared imports.
- PR #78 / EA7: bounded mood and receipt corrections; original inherited EA4 parse failure described in its handoff.
- PR #79 / EA8: model-verified tags/PCM cancellation safety; requested F-owned resolver reconciliation.
- EA0–EA4 handoffs: contracts, PS evidence selection, streaming lifecycle, strict Luna v1 schema, ephemeral mood.
- Existing .github/workflows/lsa-v1-offline.yml and ea-integration.yml, Essential npm test runner, actual buildCandidate.mjs manifest, pinned production compileProductionNative.mjs, native ABI/ACT/PS test projects, and legacy deployment scripts.

## Changed files: concrete implementation

- lsa-essential-e1-candidate/tests/ea4-runtime-integration.test.mjs: fixes the exact invalid expression at line 128, preserving cross-owner invalidation equality to null.
- .github/workflows/ea-integration.yml: PR trigger now includes the **actual** PR #68 integration branch and F integration branches, and push trigger includes EA9 feature and integration branches. Explicit checkout uses exact pull_request.head.sha or push SHA. Windows/Ubuntu Node24, isolated Python, full npm test, legacy Node22 JSON tests, pinned RPH native C# and ABI, ACT/C-05/PS/Director/lifecycle/epoch/integration/native input suites. Node24 job uploads per-HEAD evidence even on failure; manual require_combined opt-in fails if separate EA suites are missing.
- tools/ea9/matrix.mjs: fixed phase/suite registry EA0–EA9 plus regression coverage, direct node:test execution or probe mode, four distinct PASSED/FAILED/BLOCKED/NOT-RUN states, exact source HEAD, node/platform/run identity, JSON evidence; --require-combined is the release gate.
- tools/ea9/verify-release.mjs: read-only check and exclusive one-time manifest seal. Checks source SHA, clean source, Node24, stock DLL and AST-patched bundle SHA, original Essential source-directory digest and candidate manifest, EA5/EA6 modules and import graph, shared brain dependency resolution, all four compiled native DLL hashes, every staged file inventory hash, secret/cache exclusion. No assembly of unrelated PR branches or guesswork about commit pins.
- tools/ea9/isolated-deploy.mjs: explicit isolated marker, disallow standard active Steam/Program Files locations, optional additional state paths, full original plugins tree + state backup, SHA-256 verification, manifest-only overlay, separate verify and exact-hash rollback. Never operates unless explicitly invoked by a human with a marked isolated test root.
- tools/ea9/paid-ab-preflight.mjs: written local source/voice/20-sample-and-budget approval plus explicit LSA_EA9_BILLING_APPROVED=1 required even for the offline plan-only pass; never makes network or synthesis requests.
- lsa-essential-e1-candidate/tests/ea9-release.test.mjs: temporary fixture checks hash-preserving rollback with SQLite/WAL/JSON/voices/unrelated mods, modified stage refusal, missing EA5/EA6 verification refusal and missing isolated marker refusal.
- docs/ea9/RELEASE-RUNBOOK.md, GTA-ACCEPTANCE.md and PAID-ELEVENLABS-AB.md: source-bound native artifact mapping, safe stage instructions, 14 operator cases, separate billable A/B signoff.

**Exclusive boundaries preserved**: No edits to native producers, actual SQLite engine, EA emotional-delivery implementation, intelligenceClient, bootstrap, essentialGlue, runSequentialTurn or ElevenLabs provider. No PR/main merge and no game installation.

## Acceptance matrix provenance

The following is the **EA9 individual-branch preparation status**, NOT combined integration status. A future CI artifact must supply the exact HEAD and final results. Pass counts from PR #76/#78/#79/#80 are NOT imported as passes here.

| Gate | Status now | Reason / required evidence |
|---|---|---|
| EA4 malformed syntax repair | SOURCE FIXED; EXECUTION NOT RUN | One-character source-correct repair committed; Node parser/CI still required |
| EA0–EA4 targeted JS suites | NOT RUN | Execute new exact-head Windows/Ubuntu matrix |
| EA5 native protagonist JavaScript + Windows C# | BLOCKED | EA5 separate PR #80 not merged into this EA9 branch |
| EA6 SQLite / Node24, Node22 JSON | BLOCKED | EA6 separate PR #76 not merged; final package shared-brain needs staging |
| EA7 continuity | BLOCKED | EA7 separate PR #78 not merged |
| EA8 vendor safety | BLOCKED | EA8 separate PR #79 not merged |
| EA9 isolated release/rollback fixtures | NOT RUN | Run exact-head Node24 CI |
| Full Essential npm test / isolated Python | NOT RUN | Execute both on combined HEAD |
| Production pinned SDK native / ABI / ACT / PS / C-05 | NOT RUN | Windows CI at EA9 exact head and then combined exact head |
| Full candidate build / EA9 package seal | BLOCKED | Absent combined EA5/EA6 source + pinned build and compiled staged outputs |
| GTA operator G00–G13 and native physical playback | NOT RUN | Explicit isolated installation, human receipts, consent |
| Paid ElevenLabs A/B | NOT RUN (DENIED BY DEFAULT) | No billing approval flag or paid call performed |

## Agent F acceptance and integration checklist

1. Merge/cherry-pick **EA9 owned changes** and independent EA5–EA8 implementation source onto ONE reviewed integration tree. Do not rely on separate PR workflow checks.
2. Reconcile EA5 authenticated protagonist intake, native producer opt-in and EA6 C-13 SQLite source to real live runtime; include full EA7/EA8 delivery cross-checks in F-owned code.
3. Verify F combined HEAD with matrix --run --require-combined, full npm test, Python, Node24/Node22, pinned native compile and all Windows C# ABI regressions, and attach exact SHA job IDs/logs. Mark BLOCKED/FAILED explicitly; a workflow pass on EA9 alone does not qualify.
4. Build actual candidate on clean final source, assemble stage from the exact outputs and approved dependencies, supply native-inputs mapping to the actual compiled loader/runtime/bootstrap/identity DLLs, then seal AND verify with verify-release.mjs. No unpinned static binary copy.
5. Set aside an **isolated** GTA Enhanced installation and independent backup, snapshot external appdata if any, perform G00–G11/13 operator tests and signed rollback hash verification. Record real first PCM and first audible timing plus native playback/history receipts; no simulated metrics.
6. Obtain separate written paid vendor authorization, cost limit and explicit flag before 10 paired A/B samples. Keep off if vendor proof is absent. Never mark production-ready solely from code/static/CI checks.

All EA9-specific tools are **non-network** except normal GitHub CI dependencies for pinned SDK restore. No external audio calls, active game mutation, deployment, or native/GTA observation was performed by this agent.
