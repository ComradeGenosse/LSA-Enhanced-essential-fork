# PRODUCTION-W09-PACKAGE-REPAIR — pinned AST, external SDK and independent native policy evidence

**Specialist scope:** T9-PACKAGING, branch `feature/memory-k-t9-native-package-closure-20261012` based on T9 PR #111 commit `00aaa4e3a9a16dc7ac9a97a90155d047e7775baa`. Draft PR targets `feature/memory-k-t9-integrated-replay-harness-20261011`. This PR does **not** change Agent K's native project compile list, production registration, runtime bridge, original AST coordinator or final K workflow. It does not change the other T9 specialist's scenario tests.

## Sources audited

- PR #113 D05 / A09a / A09b and PR #97 W09; PR #111 handoff `PRODUCTION-W09.md`.
- Original exact GitHub Actions run [38244785137](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38244785137), Windows pinned-package job `114795845298`, hard A10 runner job `114796550378`.
- Actual `PromotedCharacters.csproj` and `SessionIdentity.csproj` require a compile-only RPH reference. `PromotedCharacters.csproj` additionally requires the DamageTracker DLL. Both projects target `net481`, with the SessionIdentity project explicitly failing when `RphReferencePath` is missing.
- The baseline original Essential source manifest `patches/essential-hooks.json` declares **48** distinct source edits (sum of `expected` 48), but baseline `buildCandidate.mjs` and its built receipt require **70** actual AST edits. This is an independent-manifest coverage gap, not grounds to lower the real patch count or pretend 48=70.
- The baseline **production** C# compile list contains `MemoryOwnerAuthority.cs` and `MemoryProtagonistSource.cs` but does **not** compile `native/intelligence/m9/M9NativeFrameAdapter.cs` or `M9NativeDamageAdapter.cs`. The standalone M9 harness compiles them in its own `m9-tests` project. These files do not therefore constitute installed M9 producers.
- The original pinned Core submission methods do not prove post-acceptance typed/STT input. C01 requires *backend final accepted-input proof + independent native active-player/promoted-owner corroboration* joined by K at the original P2 writer. This inventory remains unfilled until K reviews the producers.
- The M9 harness returned nonzero in the baseline Windows job. The new exact-head Windows run **38250966871** exposed the actual error: **`M9 native test failed: unrelated old collision tick refused`**, `native/intelligence/m9-tests/Program.cs:131`. In the fixture `read.gameTick=400`, `collision.gameTick=1`, and both event/frame `sampledAtMs=1000`; the current M9 adapter permits up to 1,500 game-tick difference, so 399 ticks is not rejected. The acceptance assertion and actual policy contract conflict. T8/K must review both whether callback game ticks must correlate with sampled wall time, and how to reject unrelated receipts without misclassifying legitimate delayed callbacks. Do **not** silence the assertion or call the native production source verified. The standalone policy log now records complete bounded stderr and named per-project exit codes. Existing M9 producer/test sources belong to T8/K, not this packaging agent.

## Legitimate reference candidates and approval gate

A specific public official package exists: [RagePluginHook NuGet 1.124.0](https://www.nuget.org/packages/RagePluginHook/1.124.0), compatible with net481 and documenting `SDK/RagePluginHook.dll`. It forbids redistribution without written permission. [DamageTrackerLib NuGet 2.0.0](https://www.nuget.org/packages/DamageTrackerLib/2.0.0) is the author-published source of the compile DLL and includes vehicle damage support. These are **candidate** API versions, not verified against this fork's pinned original native ABI. Neither package/DLL SHA256 nor a version-compatibility approval was present in the pinned baseline. **No hashes have been fabricated and no SDK bytes are committed or redistributed.**

CI downloads exclusively those exact upstream NuGet package IDs/versions into the Windows runner's temporary `w09-approved-sdk` only after four separately reviewed secrets are supplied:
`W09_RPH_PACKAGE_SHA256`, `W09_RPH_DLL_SHA256`, `W09_DAMAGE_PACKAGE_SHA256`, `W09_DAMAGE_DLL_SHA256`.
It checks both downloaded NUPKGs and the extracted exact-named DLL bytes against approved hashes, resolves unambiguous assembly names, and publishes `W09_RPH_DLL_PATH` / `W09_DAMAGE_DLL_PATH` only after **both** pass. The independent verifier rechecks DLL hashes and supplies `RphReferencePath` and `DamageReferencePath` to the actual original main net481 project (and its SessionIdentity ProjectReference). An arbitrary local GTA path, fake stub, unpinned NuGet version or package hash used as a DLL hash is rejected.

Without approvals or a compatible SDK the true native compile status is `BLOCKED: MISSING_EXTERNAL_PINNED_SDK`, not PASS. Hash verification failure is a separate FAIL. K must verify compatibility and approve the official upstream version/hash pair; merely adding GitHub secrets does not prove native game behavior.

## Changed files

- `tools/memory-sim/verify-pinned-production.mjs`: original source/DLL pins from independently versioned hook manifest, exact original compiled AST edits/labels/source byte ranges, original runtime import, staged production hashes, production-only C# source list, dual-source C01 contract, SDK gates, compiled net481 job, independently recorded .NET policy results and separate machine-readable gate states.
- `tools/memory-sim/closure-native-producers.v1.json`: v2 contract distinguishes backend accepted input from native owner corroboration. The four actual game-fiber producer inventories **remain empty** deliberately.
- `tools/memory-sim/prepare-approved-native-sdk.ps1`: official NuGet-only temporary compile-only references, four SHA256 approvals, no game dependency or redistribution.
- `tools/memory-sim/verify-native-policy.mjs`: independent per-harness process/diagnostic receipt, M9 error details.
- `.github/workflows/memory-k-w09-integrated-replay.yml`: Node24 Windows/Linux packaging-policy source tests, original pinned build and optional strictly approved SDK compile, separate native-policy Windows job, independent hard A10 Windows/Linux, on-failure JSON artifacts.
- `tools/memory-sim/tests/w09-packaging-policy.test.mjs`: specialist safety/manifest contract tests; these are never producer or GTA evidence.

## Run and read actual gate outcomes

```sh
node --test tools/memory-sim/tests/w09-packaging-policy.test.mjs
node --check tools/memory-sim/verify-pinned-production.mjs
(cd lsa-essential-e1-candidate && npm run build)
node tools/memory-sim/verify-pinned-production.mjs
# Windows:
node tools/memory-sim/verify-native-policy.mjs
node tools/memory-sim/closure-acceptance-replay.mjs
```

Machine receipts, all bound to exact checkout SHA:
`artifacts/memory-k/w09-pinned-package-receipt.json`,
`w09-sdk-preparation.json`, `w09-native-policy-receipt.json`, and independent `w09-receipt.json`.
`gates.packaging`, `gates.productionCompile`, `gates.nativePolicies`, `gates.requiredProducers`, and `gates.originalRunner` are **separate**. Standalone .NET harness or policy PASS never asserts a registered production GTA producer. The original runner remains subject to the *other* T9 agent's real S01–S10 acceptance work.

## Baseline findings / required downstream K actions

| Gate | Baseline evidence | State |
| --- | --- | --- |
| Node24 P2 SQLite source simulation | Run 38244785137 Windows/Linux; 205 lines and 2,501 fixture events | **PASS (fixture only)** |
| Pinned upstream input & staged Essential build | Baseline build with 70 AST hooks completed; original input hashes and staging checks succeeded | **PASS (baseline output)** |
| Independent full hook manifest reconciliation | 48 versioned entries versus 70 real hooks; K owns original AST builder | **BLOCKED pending all 70 source-matched entries** |
| Net481 main production compile | RPH reference missing; DamageTracker separately required; no approved hashes | **BLOCKED — MISSING_EXTERNAL_PINNED_SDK** |
| Native M9 standalone test | Run 38250966871: `Program.cs:131` rejected old collision tick fixture fails; M9 adapter accepts tick delta 399 under max 1500 | **FAIL — T8/K must correct source-time correlation/fixture contract** |
| Native C01/M3/M7/M9 registered game-fiber sources | All inventories empty, M9 implementations standalone only | **BLOCKED; K must audit wiring and project compile paths** |
| A10 original S01–S10 | Original-runner tests do not exist at exact baseline | **BLOCKED (other T9 repair agent)** |
| Physical GTA test / final A09-A10 | Never executed or authorized | **NO-GO** |

**Verification policy:** This handoff describes source modifications and a baseline CI run, not invented new passing runs. Only new exact-head GitHub Actions jobs after push can establish what executed. K must review the remaining 22 original AST edits, all true producer registrations, the supported SDK versions/hashes, original runner, and confirmed M9 time-correlation/test-contract mismatch before any GO statement.
