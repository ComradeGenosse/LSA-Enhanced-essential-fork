# X8 — approved two-fence catalog / sequential native manager

**Base:** X7.3 draft PR #307 head `c232de1c3ea563f822e12ead5c6d18255273fdc7`.
**Design reference:** #302. **Separate unresolved failure path:** #308.
**Status:** compiled against installed SHVDN; one local P2 preflight stopped on
unresolved approach collision at A, **zero shots**. B's source/approach rays passed;
neither fence has X8 fracture, traversal or post-fracture restoration acceptance.
[Local results and failed evidence](evidence/20261022-local-preflight/RESULTS.md).
Default-off, draft and unmerged.

## What is implemented

- One versioned corrugated fence family (`prop_fnccorgm_02e`, hash
  `1185366416`) and exactly two stable authored placement slots, supplied
  through the P2 command stream after a read-only local audit. No production
  coordinates, GTA map scanner, persistence, or new assets.
- Per-placement identity, position, heading, revision, explicit lifecycle
  (`Registered -> Preparing -> Armed -> Active -> RestorePending -> Registered`),
  expected five root/five anchor ownership count and restoration latch.
- Existing X7.3 j1400 five-section native staging/hide, one-shot RPG projectile
  provenance, actual-impact section selector, protective flags, native fracture
  and walk/collision probes are **delegated unchanged** to X7.3.
- Strict pivot + heading + upright + same-model ambiguity checks before
  staging and before shot; final transform check immediately before hot commit.
  One verified source must occupy the hide scope. Do not assume stable handles
  after hiding/reacquisition.
- **Conservative scope cut:** only **one physical native twin at a time**. The
  second placement remains entirely original while the first is active.
  Restoring A does not stage B, mutate B, or delete B's entities: B has none
  until it obtains the sole native lease. No concurrent two-armed guarantee.
- Failed preparation requires reacquired visible 9/9 original and zero owned
  objects before releasing the lease. A successful restore likewise verifies
  original *world collision* and owned cleanup, including actual absence of entity
  references captured before inherited cleanup clears its lists. Unknown/partial outcomes remain
  `RestorePending` and block the other placement; no made-up recovery for #308.

This is a **working adapter implementation**, not evidence of simultaneous
independent native destruction or physical gameplay acceptance. X8 opt-in is
volatile (`x8Enabled=false` at every runtime start).

## Build and offline checks (cloud/CI)

```sh
dotnet run --project native/destruction-props/tests/X8Tests.csproj --configuration Release
dotnet run --project native/fragment-x7/selection-tests/SelectionTests.csproj --configuration Release
python native/fragment-x7/build_x7.py
git diff --exit-code -- native/fragment-x7/WpsBreachLabX7.3.cs
python native/destruction-props/test_x8_source.py
python native/destruction-props/test_x8_cleanup.py
python native/fragment-x7/test_live_selector_source.py
python -m unittest discover -s native/fragment-x7 -p 'test_*.py' -v
```

The only shipped live-source change is the deterministic inclusion in the
existing generated `WpsBreachLabX7.3.cs`, not a new physics engine. Existing
assets/pack/selector/controller were not edited. Linux CI cannot prove native
fragment behavior or compile the installed SHVDN build.

## Read-only P2 placement audit

After registering a placement, `x8audit id=A` records the currently streamed
source, its nine collision owners, nearby props, unit basis, 18 approach rays
and ground samples. `stream=1 px=... py=... pz=...` additionally streams the
explicit player position, only when no native lease exists. It never stages or
hides a fence, fires, or selects damage. A failed audit is a stop; clear rays
alone do not prove capsule clearance, acceptable ground grade or traversal.
Coordinates must come from real map/native data.

## Local Codex/P2 acceptance procedure

The October 22 user authorized the recorded session. It ended at the collision
stop; the commands below describe the still-uncompleted acceptance, not a retry
within that ended session.

1. Inspect two real, unobstructed `prop_fnccorgm_02e` placements **read-only**.
   Determine exact pivots (`tx ty tz`), headings, unit/upright basis, accessible
   player staging (`px py pz`), full original 9/9, nearest same-model neighbors
   and DLC/LOD ownership. Approve two placements separated by at least 6 m
   with differing headings. Reject ambiguous hides or bad collision. These
   coordinates must come from the game; **do not copy synthetic test fixtures**.
2. With GTA stopped, perform the existing stopped-game backup/install/compile
   process under one named Windows operator. Confirm the loaded script hash,
   addon hashes, P2 protocol 2, run/session identity, and controller ownership
   per `docs/agent-operations/GTA-CONTROLLER-RUNBOOK.md`. Never copy a runtime
   heartbeat as unquestioned proof of binary identity.
3. In the single approved P2 session, send the commands below **one at a time**
   using `controller.py`'s `send` verb with unique `--experiment X8`,
   `--trial` and the established `--lab/--owner/--session/--expected` arguments.
   Replace every `<...>` with audited values; do not send literal placeholders.

```text
x8enable enable=1 approved=1
x8register id=A rev=1 hash=1185366416 tx=<A_X> ty=<A_Y> tz=<A_Z> heading=<A_HEADING> scale=1 updot=1 verified=1
x8register id=B rev=1 hash=1185366416 tx=<B_X> ty=<B_Y> tz=<B_Z> heading=<B_HEADING> scale=1 updot=1 verified=1
x8status
# Complete read-only x8audit and ground/approach qualification before preparing.
x8prepare id=A verified=1 px=<A_PLAYER_X> py=<A_PLAYER_Y> pz=<A_PLAYER_Z> back=9 pu=1.5
x8cam id=A t=-5.5 u=1.5 z=1.5 lu=0 lz=1.1
x8shot id=A label=x8-a mode=script aimu=0 aimv=1.05
x8walk id=A
x8restore id=A
x8status
x8prepare id=B verified=1 px=<B_PLAYER_X> py=<B_PLAYER_Y> pz=<B_PLAYER_Z> back=9 pu=1.5
x8cam id=B t=-5.5 u=1.5 z=1.5 lu=0 lz=1.1
x8shot id=B label=x8-b mode=script aimu=0 aimv=1.05
x8walk id=B
x8restore id=B
x8status
```

Each P2 send looks like:

```powershell
$ctl = @('--lab','C:\EXPLICIT\GTA\WpsBreachLab','--owner','LOCAL-CODEX',
         '--session','X8-SESSION','--expected','C:\HANDOFF\approved-runtime.json')
python tools/gta-controller/controller.py @ctl send 'x8status' --experiment X8 --trial status-001 --timeout 80
```

**Expected result:** A source remains original until an admitted X7.3 RPG
flight; actual impact selects exactly two adjacent sections; other three stay
solid; A is traversable; restored A is visible with **9/9** native collision
witnesses. B stays its untouched original throughout A. Then B repeats at its
different heading and independently achieves native fracture, traversal, and
visible 9/9 restore. Both roots/anchors/debris must return to baseline;
unrelated sentinels remain unchanged. These are *acceptance criteria*, not
claimed observed results. A miss does not automatically rerun or synthetically
blow up the fence.

**Stop conditions:** Any P2 timeout is UNKNOWN — reconcile same request and
owner, never resend. Missing source, ambiguous matches, active A, stale
transform, failed staging or partial restore all block new staging. If an
exposed original is damaged without a commit, issue #308 remains open; report
restoration as failed and do not continue to B. Do not send additional shots
to compensate. After evidence capture, stop GTA, hash-restore scripts/pack and
addons, and release P2 ownership. No X9 work.
