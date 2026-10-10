# Paused implementation handoff — October 9, 2026

The user requested a stopping point and submission of all unfinished work to GitHub for continuation on the web. Implementation is paused, not complete. Resume only when the user requests it.

## Branch and authority

Continue `feature/unified-intelligence-implementation-20261008`; do not restart from main or redesign the architecture. Read `AGENTS.md`, `docs/ROADMAP.md`, `docs/research/CURRENT.md`, `docs/research/DECISIONS.md`, and `docs/research/system-contract-register.md` first. The unified master plan remains the specification, but `docs/lsa-v1-implementation-milestone.md` records the user's narrower, authoritative stopping boundary. The goal tool's original full-master objective predates this override.

Preserve PR #21's `docs/research/PS4-code-level-implementation-plan-20261008.md` unchanged (SHA256 c2a34b240acae61df0727f670c19a4d0a897207e24f089e8a9f6657292967192), PR #22's settled plan, C-01–C-15, and existing systems. No new research program, decision infrastructure, d1, local models or inference infrastructure.

## Current implementation and unfinished work

The branch contains the PS4 frozen, actor-qualified PS2/PS3 projection into actual Luna requests, parent proof/canon release, bounded rendering and request serialization, all nine typed/microphone/internal and buffered/streaming/early-TTS paths, exact reasoning acknowledgement, independent default-off capability gates, ACT SELF facts, C-05 receipt projection and truthful C-06 ownership. The detailed record is `docs/unified-intelligence-implementation-status.md`, through checkpoint 72. Implemented does not mean merged, deployed, enabled or GTA accepted.

Phase 6 offline coverage includes all 65 pinned C-05 action templates, 66 Windows pipe interoperability checks, late callback/world reset/overflow fences, and actual native owner sampling. Synthetic callback/template coverage does not prove physical action outcomes. Actual Essential callback association, body resolution and physical owner admission remain external gates. Native lifecycle tests do not directly exercise every actual EssentialActivityWorld Begin/End binding.

Baseline PS4 acceptance is still incomplete. `docs/ps4-v1-acceptance-audit.json` and its Markdown companion map all 81 original requirements and nine gates. Individually reviewed automated oracles currently include T06, T20, T29, T39, T42, T44, T45, T48, T49, T63, T64 and T65. T51 is partial. Other mapped requirements need source/oracle review or missing tests; aggregate suite success does not close them. Radio-only requirements remain deferred. Physical gates remain unperformed.

Phase 13a is **not implemented**. After Phase 6 and baseline automated acceptance closure, implement the existing bounded deterministic SceneDirector and native checked Essential intake, using existing PS3 grants, PS pipe, frozen PS4/provider/TTS path and exact full successful playback acknowledgement. Follow the master plan and milestone for reserve/submit/cancel contracts, one-use tickets, empty-command enforcement before effects, rate/expiry bounds, player takeover and current body/owner checks. No PS5 prerequisite or automatic memory writes. Reuse ACT/Essential authority.

Phase 10a is conditional: first obtain evidence that stock Essential speaking/engagement gaze is insufficient. An unperformed GTA probe is not such evidence. All other master phases and standalone C-09 F11 diagnostics are deferred.

## Last validation and reproducible tooling

The final complete normal-Node isolated offline regression passed **663 tests across 63 files**, with no failed files. The latest changes only strengthen T20 selector/input acceptance tests and update the audit; production code/payload is unchanged. Focused selector and input suites passed 8 and 13 cases. `git diff --check` passed before submission.

The aggregate Node test process intermittently exits with Windows access violation 0xC0000005 without a failed test stack. This tooling issue remains open; do not weaken assertions or change production JIT behavior. The actual isolated runner and offline fetch guard used for this validation are preserved under `tools/isolated-offline-tests/`. Run `python tools/isolated-offline-tests/run.py /absolute/path/to/lsa-essential-e1-candidate`; normal Node must be on PATH. Logs are written to the system temporary directory, not the checkout.

Recent native evidence: ACT suite 263 assertions, RuntimeEntry 154 (one existing unused-stub warning), P2 lifecycle 157, and Windows C-05 pipe helper 66 checks. These are prior native results, not a fresh final matching build. The previous matching companion build verified 54 pinned stock seams. Fresh matching native/companion payload build and gate closure remain required. Native GTA/RPH assemblies and Windows pipe prerequisites are local dependencies; web/Linux validation must explicitly distinguish unavailable Windows/native checks from passes. Do not commit proprietary game libraries, generated payloads, secrets or local configuration.

## Next implementation steps and release boundary

1. Continue the individual baseline acceptance audit against actual production code; add only necessary missing tests. Close remaining Phase 6 automated obligations and refresh matching native/companion build evidence and payload hashes.
2. Implement Phase 13a in the established infrastructure, with the master plan's native/companion agreement, all provider paths, fail-closed safety and full-playback tests. Keep controls default-off.
3. Document the external GTA gates already enumerated in the milestone: baseline PR21 GTA cases, Phase 6 callback/ownership cases and Phase 13a spontaneous-speech/busy/player-takeover cases. Add gaze only if the conditional evidence warrants it.
4. Complete included automated/build validation and stop at playable v1.0 implementation scope. Do not claim release acceptance or synthesize successful physical acceptance receipts. No installation, deployment or activation occurred during this handoff.

All source changes and unfinished acceptance work are committed on the branch. There is no live test/build process to recover. Continue from branch HEAD and this handoff, not from historical archived research.
