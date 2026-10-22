# X7.2c controller smoke repair

Operator, implementation lead and publisher: Codex. Independent bounded diagnosis
and review: Claude Code through the local CLI coordinator. Personal mod: one useful
end-to-end result, no broad physics changes or verification matrix. PRs #296–#299
remain unmerged. Repair starts at #299 head 3c14bb84 plus latest #298 receipt 28cc223c.

## Diagnosis before changes

Failed shot frame 11440: TTC 50.316 ms, frame 6.842 ms; the default predictor threshold
40 + 1.5 * 6.842 = 50.263 ms misses by 0.053 ms. RPG impact occurs at frame 11441.
No stall explains it (maximum window 14.661 ms, no frame over 50 ms). This is a
pre-existing predictor/setup timing margin, not lost P2 transport: requests were
correlated and executed once, projectile tracking ran every frame.

Earlier successful center raw log `native/fragment-x7/evidence/x72c/logs/20261022-161716-263440.jsonl`
committed at TTC 51.827 ms against horizon 52.029 ms, two frames before impact.
All four successful trials used default 40, committing 2/1/2/1 frames before impact.
Frame-dependent timing put the successful center barely inside the window and the
failed center barely outside. Exact reason the RPG detonates ahead of the tracked
target plane (projectile collision extent/face geometry/velocity sampling) is not
established; no physics rewrite is justified.

The missed swap left the original exposed to a real RPG. Its post-shot witnesses
fell from 9 to 0, and cleanup found two unowned props with the original model hash.
Restore removes the hide and reacquires the nearest same-model prop; it does not
rebuild a naturally damaged original. It returned 6/9 with three other hits, correctly
ERROR. Damage/reacquisition is the likely secondary cause; the precise reacquired
entity is not logged, so fragment identity remains unproven. Walking then failed its
Active-state gate; no traversal occurred. Dormant neighbors remaining invisible are
not evidence of faulty protection flags.

## Minimal repair

Use existing shot argument `horizon=60`, a 20 ms margin. Replay of the failed trace
would commit at frame 11437, four frames before impact; this is a prediction, not a
substitute for live acceptance. The generated C# driver, build_x7.py, assets, native
fracture, selective protection and collision mechanics are unchanged.

The smoke adapter checks gameplay acceptance after prepare and shot before proceeding,
performs one same-owner restore on definite failure, retains failed restore IDs, and
treats restoration timeout as UNKNOWN. Existing output directories are refused before
any command. Native walking is already bounded; removed misleading hold-W instructions.

Coordinator addition is isolated: explicit local complexity/model/effort profiles,
frozen task selection and argv, inherited handoff complexity, local supported-model
allowlist, no silent downgrade/fallback. Chris's cost preference overrides defaults:
Haiku/Luna low for simple work; Sonnet/Sol low for planned implementation and high for
thinking. Fable/Astra excluded. Opus 5.5/Sol ultra require explicit confirmation.

## Offline evidence before GTA

Windows: 21 controller/smoke tests; 16 real C# protocol scenarios with stubs; 11
coordinator tests; 12 X7 tests; all source validators; eight structured historical
records match. Generator reproduces unchanged driver SHA256
`da37a140305ae6d3c0b2b8918aef423aa379926eb05e1ceb9e2840df8746642c`.
The peer Codex read-only CLI could not run temp-directory tests under its sandbox;
host Codex ran them successfully. This is a sandbox limit, not a passing peer test.

CLI discovery: installed Claude 2.1.308 supports --model and --effort; local /model
resolves Haiku 5.5 low and Sonnet 5.5 medium. Codex 0.163.0 cached catalog lists
gpt-6-luna and gpt-6.1-sol and their reasoning levels. Capability resolution alone
does not establish paid quota. A Fable high request was refused for usage credits,
produced no review, and was reconciled without retry or credit purchase. Excluded
after Chris clarified costs. Initial Claude placeholder responses are retained as
incomplete; the later substantive diagnosis and actual peer verification are separate.

Sonnet high independently approved one bounded trial. Its unreadable-evidence and
provisional-verdict findings were fixed; restoration now also has no automatic second
attempt. The review's claim of 25–40 ms sample spacing is incorrect: the raw last
samples are about 7 ms apart. TTC predicts the target plane, not the exact collision
instant; horizon=60 is an empirically justified margin, not a mathematical guarantee.
Codex retains the decision and requires live evidence.

Live result and stopped-game restoration: pending. No successful acceptance claimed yet.
