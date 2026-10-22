# Single P2 smoke receipt — October 22, 2026

Operator/publisher: Codex, explicitly authorized by Chris's x7-p2-codex-prompt.md.
Candidate: 9efef27163ec148ba5d35f9283f01716d3579a3b. Draft PR #298 was opened
before launch. ASTRA X7 offline source checks run 39819241250 succeeded before
installation. No merge; no second live trial.

GTA was stopped, no controller ownership/pending slot or GTA sender was present.
Original hashes were recorded before the specified X7d installer ran with the
repository driver. Installed and loaded SHA256 both matched
da37a140305ae6d3c0b2b8918aef423aa379926eb05e1ceb9e2840df8746642c.
Afterburner preset 1 was requested, but the launch command's final receipt says
the operation was canceled by the user. Preset application is therefore NOT
confirmed. Observed GPU cap was 460 W, not proof of all preset settings.
Steam app 3240220 launched with offline Story Mode
arguments. The Story Mode window and fresh advancing P2 heartbeat were verified.
Runtime identity is in expected.json; session p2smoke-20261022, owner codex.

The system Python 3.10 rejected .NET's seven-digit ISO timestamp in preflight.
No request was published and controller pending remained null. The unchanged
smoke then ran under bundled Python 3.12.14 with the same owner/session.

Verdicts:

- Command: FAILED. Prepare/camera/shot completed; walk ERROR x7_active_required.
- Gameplay: FAIL. Shot saw a projectile but was late, committed=false,
  nativeParts=0. A shot DONE receipt did not establish physical acceptance.
- World: FAIL_OR_MISSING. Same-controller restore-after-failure returned ERROR
  original_restore_requires_9_of_9. The record shows 6/9 original witnesses.
- Filesystem: PASS after GTA shutdown. All four requested original-file hashes
  match; installer restore also verified absence of all three temporary files.

No timeout occurred and no request was resent. All five correlated requests,
including the failed restoration (omitted by smoke's initial request list), were
collected separately in evidence/manifest.json. The original verdict.json is
preserved verbatim; its filesystem field predates the separate stopped-game
restoration-check.json.

Ownership was released with no pending request after recording the failed world
restoration. GTA was ended and the installer rollback completed. No GTA process
remained. The driver/physics implementation was not changed. This result blocks
claiming P2+X7.2c live acceptance; diagnose offline before another authorization.

X7Walk already has a native task bounded to 25 seconds and clears player tasks.
Its hold=3 is a post-walk observation hold. This trial never reached physical
walking because x7_active_required failed; no W-key input was injected.
