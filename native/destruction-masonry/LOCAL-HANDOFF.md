# X9 local Codex handoff — candidate qualification ONLY

**Objective:** Return one viable full-height brick/concrete wall candidate, or an explicit evidenced **NO-GO**. Do not implement X9 native fracture yet, launch a destructive test, or mutate gameplay files to manufacture a candidate. Follow `AGENTS.md` and `docs/agent-operations/GTA-PC-PLAYBOOK.md`. Use the current X9 PR exact head. Reconcile existing P2 ownership and local uncommitted work first.

## Step 1 — installed assets / CodeWalker (offline first)

- Examine `prop_wallbrick_01`, `prop_wallbrick_02` and `prop_wallbrick_03`; optionally inspect `prop_barier_conc_01a` only as negative-control material. Determine whether each is actually a self-contained, ≥1.8 m freestanding panel or a pile/decoration. Prefer no new asset extraction/download. Read/model only; do not copy Rockstar/NVE asset bytes into the repository.
- For each viable name record actual native/model type (Prop vs Building), YTYP/YFT/YDR, pivot and scale, dimensions, normal/hi@ collision ownership, LOD parent/occluder, adjacent bounds and whether an independent `CREATE_MODEL_HIDE`-style original removal could leave a ghost. Mark **UNKNOWN** if it requires a local GTA test.
- Locate **two** naturally streamed, separately oriented low-risk instances at level ground, with a player-height walkable space behind each and no shared wall, windows, traffic path or mission interference. If no natural placements exist, **stop and report** rather than fabricate approval by spawning your own prop.

## Step 2 — optional exact-source read-only P2 check

If needed, install only the approved read-only X9 instrumented driver during a verified **stopped-game** window, using the branch's current P2 driver installation procedures, original-file hash backups and approved loaded SHA. No forced GUI interaction. Build with:

```powershell
python native/destruction-masonry/build_runtime.py C:\approved\x9-survey-runtime
```

Using the named Windows/P2 owner, once the player is genuinely within **35 m** of an approved target, issue one bounded command **through controller.py only**, with actual measured coordinate/heading values:

```text
x9survey approved=1 x=<real-native-x> y=<real-native-y> z=<real-native-z> heading=<measured-heading>
```

This command never moves the player. `x9_model` is only model availability, `x9_candidate_prop` only a nearby observed Prop, and `x9_probe_ray` is diagnostic world collision, not 9/9 **source-owned** X8 witnesses. Static collision with handle 0, Building wrappers, or invisible YBN layers require separate CodeWalker / native source proof. Don't call it PASS based solely on nine hits or valid model metadata. **No X9Prepare/X9Shot exists.** Don't send X8 preparation with a brick hash: X8 deliberately rejects it.

## Step 3 — evidence and disposition

Record inspected versions, original asset/stack provenance, exact candidate/source identity, actual measurements, one or two safe placements and orientations, 9/9 source-owner and foreign collision evidence if actually provable, YBN/LOD negative checks, representative images, model resource-path/hashes (not proprietary bytes), limitations and **GO/NO-GO/UNKNOWN**. Provide the path to raw P2 rows and request IDs; the handoff should never claim a CodeWalker metadata read proves GTA-native collision.

For a GO, make an **untracked** copy of `proposal.template.json`, fill actual dimensions and all attested gates, supply evidence IDs and run:

```powershell
python native/destruction-masonry/recipe.py --proposal C:\private\qualified-x9.json --output C:\private\x9-plan
```

The output `NOT_DEPLOYABLE.txt` still forbids installation. This creates an offline five-root geometry spec only. If no real two-site candidate qualifies, report why and the cheapest alternate family.

## Ownership / shutdown

No RPG shots, no cheat/labsetup opt-ins unless separately approved; no forced source hide, collision edits, script-spawned masquerading as YMAP. Stop GTA after any optional survey, restore every local installed file/addon/NVE archive by hash and original absence, release P2, preserve old run evidence and branch history. Do **not** merge the draft X9 PR or start X10.
