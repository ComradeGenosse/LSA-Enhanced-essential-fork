# E0.4 trajectory research and E0.5 preparation (offline; nothing here has been run in GTA)

## E0.4 — what a reported impact can and cannot tell us
Authorized so far: read-only natives, passive observation, recording **user-fired** shots in an attended session, offline analysis. Not authorized:
autonomous NPC shooting, automatic player shooting, damage, explosions, model hiding, IPL changes, time scale, object stress tests.

* The native impact report is a coordinate (plus bullet-in-area flags). It is **not** a bullet path: it hides spread, recoil, pellet count, ricochet and
  any continuation after penetration. The existing PR notes it can also stay latched across frames.
* `shot_sample` rows now also carry weapon hash, `GET_GAME_TIMER`, and the gameplay camera pose (position, rotation order 2) on firing/impact frames. Camera
  capture is wrapped so a failure is logged as `cam.ok=false` and never fails the probe. **UNVERIFIED in GTA** (compiles only).
* `tools/physics-e0/e04_correlate.py` turns captures into: active-shooting frames, **observed rising firing transitions** (not round counts),
  impact-report frames, **distinct impact runs (a lower bound, not a round count)**, camera-ray class of each distinct impact
  (ON ≤3°, NEAR ≤10°, OFF), weapon hashes; each capture run has independent latch/ammunition accounting. `ShotCorrelation` in `Core.cs` is the tested pure implementation.
* Defensible reconstruction today: an impact near the camera ray is consistent with the aim line at that instant. A projectile *trajectory* through geometry is
  not observable from this evidence. The shortest honest path to a trajectory is to infer it from shape tests along the aim ray (entry/exit layers) and to
  validate that inference against attended impact coordinates — that validation capture has **not** been done (needs the user firing).
* Attended capture recipe (when the user is present): `WPSE0Start E0.4` in player mode, fire single/burst/auto/shotgun at a wall with known CodeWalker geometry,
  then run `e04_correlate.py` on the JSONL. Acceptance per doc 04: <90% confirmed full-auto coverage means deeper capture research.

## E0.5 — bounded temporary-prop collision experiment (prepared, NOT executed)
Question: after a lab-owned prop is deleted, how long does the shape test (options 7 and 0) and actor LOS still see it, in frames and milliseconds?
* Existing probe: 3 frozen lab props + 2 frozen lab peds at the configured site, ray and LOS before/after, delete the centre prop.
* Changed (offline-tested only): every frame 1..30 after deletion is sampled with both option values, `sinceDeleteMs` and first-clear time are recorded, and
  `phantom_collision_summary` classifies: `CLEAR_WITHIN_THRESHOLD` (≤100 ms), `PHANTOM_OVER_THRESHOLD_DELETED_ENTITIES_MAY_BE_UNSOUND`,
  `PERSISTENT_PHANTOM_DELETED_ENTITIES_UNSOUND`, or `INCOMPLETE` (never a pass). `PhantomCollision.WithinBudget` caps it at 3 props / 2 peds / radius ≤10 and the
  probe refuses to start otherwise. The centre prop must be the baseline hit under both options before deletion. Clearance now
  means neither ray still sees the **deleted entity** (an unrelated wall/prop hit is not a phantom); any reappearance within
  the 30-frame observation window explicitly fails. E0.5 is not in the unattended pre-shot allowlist (tested).
* **Requires separate approval before running** (spawns and deletes objects and peds). Run only offline Story Mode, `enabled:true`, a configured safe open site,
  attended, with `WPSE0Start E0.5`; cleanup and the owned-entity ledger already remove everything it creates.
