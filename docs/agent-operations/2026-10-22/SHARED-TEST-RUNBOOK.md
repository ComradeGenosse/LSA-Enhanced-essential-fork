# Proposed shared GTA test operating contract

Review artifact, October 22, 2026. These are procedures and implementation requirements; the locking/request protocol is not yet installed.

## Ownership and handoff

- Name one live PC/GTA operator and one integration/push owner before a session. Both agents may code/analyze in separate worktrees.
- The live operator owns deployment, launch/shutdown, render state, command submission and desktop input until restoration and handoff finish.
- Record branch/HEAD, dirty paths, protected outputs, pack/driver SHA256, runtime identity and the next bounded action in shared state. Private chat memory is a pointer to this record.
- After compaction or handoff, re-read state and recheck live facts. Never assume an expired timestamp means it is safe to take over a live operator.

## Preflight

1. Confirm current checkout/candidate and protected-output hashes; preserve unrelated edits.
2. Verify MSI Afterburner running, preset 1 applied with available evidence, and observed GPU power cap. This also precedes Blender/3D testing.
3. Confirm GTA/RPH stopped before installation or rollback. Preserve originals and journal intended changes before mutating anything, including DLSS add-on renames.
4. Verify pack/model manifest and real binary hashes. Use the X7d-aware path for X7d assets; the inherited PowerShell installer's variant list does not include X7d.
5. Use the known launcher route. Require fresh heartbeat, advancing frames and matching expected loaded source SHA. Runtime identity includes game PID, runtime loadedUtc and source SHA because scripts can reload under one game process.
6. Prove current-launch render state. Freeze character, site, camera, weapon/launch distance, aim and frame/render settings for comparisons.
7. Require pristine original collision 9/9 and dormant twin 0/9 before a shot. Classify site obstructions separately.

## Commands and evidence

- The current sender's exit 0 is not a sufficient success check. Inspect runtime error/exception rows and the exact command/run until the stronger protocol is implemented.
- Implement unique request IDs, explicit success/error results and an exclusive controller lock. Atomically publish requests; preserve command/response identity in every result.
- A timeout means outcome unknown. Reconcile current status and the original request before any retry.
- Every trial gets experiment/session/trial IDs, exact prepare/shot/walk/restore run IDs, pack SHA and loaded runtime identity. A changed loaded identity starts a new session generation.
- Separate command completion, gameplay verdict, world restoration and filesystem restoration.
- Generate tables/ranges from structured evidence; link each row to its runs. Preserve failed, skipped and invalid cases. Absence of a walk record is not a passing walk.

## Stop and restore

- Stop on wrong/stale loaded build, unmatched request, runtime error, missing baseline witness, ownership conflict or unexplained installed-file change.
- Restore the original world and verify exactly 9/9 witnesses before another shot.
- Stop GTA before file rollback; compare every recorded original hash/existence state, including add-ons. Retain rollback receipt and unresolved failures.
- Publish using scoped staging after a separate review. Do not use automatic stash or delete a Git lock merely because a previous operation appeared slow.

## Current gameplay boundary

X7.2b tested prepared strength patterns and achieved passage for +0.65 twice and center-v2 once. Center-v1 failed its lane check. Dynamic choice from the real incoming impact remains unproven. Review the corrected CSV and full audit before choosing the next test.
