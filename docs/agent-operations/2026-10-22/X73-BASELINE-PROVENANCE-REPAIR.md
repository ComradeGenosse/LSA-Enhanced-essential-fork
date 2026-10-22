# X7.3 baseline-handle projectile admission repair (cloud only)

## Evidence motivating the change

Draft #305 contains one failed X7.3 shot against #304 with **78 observations excluded as baseline**, exactly 78 fire-to-nearby-explosion frames, plus 680 rejected samples from handle 142082 that first appeared **136 frames after** the explosion. The evidence does not identify the excluded projectile, so it cannot prove it was the RPG. The earlier, pre-filter X7.2c shot successfully tracked the rocket and fractured exactly two independent sections.

## Minimal repair

Original X7.3 permanently disqualified any post-fire sample whose native handle appeared in the immediately pre-fire enumeration. That is over-conservative when game projectile-pool handles can be reused (reuse remains a hypothesis; direct proof is absent).

In the scripted **one-RPG** mode only, a handle that existed at baseline may now enter the otherwise unchanged selector after BOTH:

1. A live post-fire projectile sample within 1,200 ms of firing, near the corridor from measured muzzle to target (within 0.65m), with forward speed >= 2.5m/s and normalized velocity alignment >= 0.70.
2. A second observed sample of the **same handle**, 1–8 game frames later, with at least 0.018m independently measured forward displacement.

The launch aim is used **only for projectile provenance**, **never** for selecting a section or synthesizing an impact position. Actual section-pair selection still derives solely from `ImpactSectionSelector.TryPredictAndSelect`, including its 250ms maximum prediction horizon, strict sheet bounds and unaltered dynamic commit window. Normal new-handle admission is unchanged. Manual, weapon and no-fire modes retain strict exclusion.

If baseline motion never corroborates, it remains excluded. All eligible real candidates still contribute to the unchanged `readyCount == 1` arbitration; no fallback explosion or force-commit was added. Real-world provenance is inferred from geometry rather than verified by weapon/owner; tests cannot prove an arbitrary nearby projectile is the commanded RPG.

## Observability

- `x7_baseline_snapshot`: pre-fire handle, model, world position and raw velocity.
- `x7_baseline_recovery`: observed handles, plausible frames, confirmed handles, confirmed observations, actual excluded observations.
- `x7_diag_sample scope=baseline_first|baseline_last|baseline_recent`: handles, frame, position, raw velocity, local geometry and TTC. Last 48 frames retained; first and last retained per observed handle. Existing diagnostic counters remain.
- None of these logs are written in the projectile tracking hot loop.

## Restoration: separate unresolved issue

#303 restored only 6/9 and #305 restored **0/9** original collision witnesses after uncommitted impacts. Both original-game file hashes and absences were fully restored and GTA stopped. The exposed original map prop may have suffered natural damage from an explosion when the replacement was never committed; nevertheless **that specific cause is unproven**. An entity existence/visible flag does not prove collision restoration. No restorative model swap, synthetic props or force 9/9 assertions are introduced here. The first controlled live validation must continue to treat below 9/9 as FAIL and preserve all file rollback obligations.

## Verification / handoff

- Offline .NET tests for two-frame recycled-handle motion versus stationary, unrelated, reversed, oblique, too-slow, late and nonfinite samples.
- Existing X7 tests, generator byte-for-byte equality, selectors and P2 offline acceptance tests required.
- **No GTA run or installed SHVDN compilation performed in this cloud branch.** Only one separately authorized local shot after CI and installed API compilation. Record accepted baseline handles and identify the actual projectile from trajectory evidence; distinguish valid fracture from environmental traversal obstruction.
- No merge, physics retune, alternate selection, X8 implementation or blind repeat.
