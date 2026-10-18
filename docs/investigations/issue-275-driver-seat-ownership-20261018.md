# Issue #275 — native seat ownership and driver transition (2026-10-18)

## Reconstructed evidence and scope

Issue #275 records an October 18 companion/native split: UX4 sometimes selected an ambient ped; model decisions sometimes failed `segment_empty_dialogue`; ACT5 staged a driver-seat request but sometimes refused with `actor_in_vehicle`. Essential independently logged repeated `Seat: 1` passenger tasks without an encounter or activity correlation. This is not evidence of a completed driver-seat request. The two ZIPs were described in #275; their bytes were not accessible to this patch session. This patch establishes source-level causes, not a reconstructed per-frame GTA trace.

* **Confirmed deterministic defect:** companion ACT5 preflight treated *any* seated actor as blocked unless already in the requested seat. Native ACT3 preflight also returned `state_blocked` whenever the actor occupied a different seat. Neither could dispatch a safe front-passenger → driver seat transition.
* **Confirmed roster presentation defect:** when the native roster succeeded but omitted a stored profile, `CharacterService.list()` fell back to the stored profile's status; F11 could thus display a historical `spawned` without a native actor binding.
* **Independent/unproven causes:** UX4 ambient selection when no verified promoted continuity exists, the model's `segment_empty_dialogue`, intermittent native owner RPC timeouts, and uncategorized Essential passenger-seat tasks are not proved to share a root cause. The pre-existing UX4 verified-continuity policy remains authoritative; a guessed nearest promoted NPC is **not** an equivalent ownership proof.

## Changes

* ACT5 now requires **current-player-vehicle identity**, not merely native seat index, for already-seated eligibility. It admits a front passenger into an empty driver seat only when the same anchored car is stopped, and emits typed `vehicle_mismatch`, `vehicle_moving`, `seat_occupied`, or `seat_change_unavailable` instead of the blanket `actor_in_vehicle`. Unsupported rear-seat/other-car transitions are rejected rather than warped or silently substituted.
* The native ACT3 executor reacquires the owner-anchored vehicle on the dispatch fiber. For a front passenger it uses GTA's `TASK_SHUFFLE_TO_NEXT_VEHICLE_SEAT` against that same vehicle; entry from outside still invokes **Essential's original seat command**, retaining passenger/backseat and regular behavior. It never directly warps the actor or bypasses activity admission.
* Native transition traces label `queued` versus physical `sample`, retain the ACT `executionId` for direct reconciliation with StepRunner receipts, and emit requested seat, observed GTA seat index, same-anchor state, route and terminal proof. A pending shuffle is **weak progress**, never success: the existing seat occupancy adapter requires **driver index −1 and the same native vehicle anchor** for strong completion. ACT cancellation/owner retirement clears shuffle bookkeeping.
* F11 roster reflects a successful **absent** native-roster result as absent even if the persisted profile had previously been spawned; an unavailable roster remains `unverified`. Binding still requires fresh `inspect` and exact incarnation + ownership token.

## Verification

Run: `cd lsa-essential-e1-candidate && node --test tests/activities-act5.test.mjs tests/gameplay-menu-character-binding.test.mjs tests/vehicle-seat-observability.test.mjs` and `dotnet run --project native/activities/tests/ActivityTests.csproj` from the repository root. Native plugin compilation requires the project's pinned Essential and RPH SDK/runtime. Automated tests exercise pre-admission and the native runner/occupancy adapter; they cannot prove GTA's shuffle task execution. Track any workflow/runner results separately.

## Exact GTA smoke (required before closing #275)

1. Install matching latest companion and native promoted-character DLLs with ACT3/ACT5 seat probes enabled. Reset world, spawn Nathan; F11 must show **spawned** and fresh native binding. Record the owner/host epoch, but never raw player dialogue or names in logs.
2. Stand by a stopped player vehicle with an empty driver seat, talk to **Nathan** (UX4 `owner_verified`), say **"Get in the driver's seat."** Correlate `vehicle_seat_requested` → `vehicle_seat_reconciled` → `vehicle_seat_admission` → ACT step receipts → `[LSA ACT3 SEAT]`. Verify entry from outside uses `essential_queue` and actual seat **−1** of the same anchored car.
3. While Nathan occupies the **front passenger seat** of that same stationary car with driver empty, repeat. Verify `native_shuffle`, **pending** trace then `physically_seated` at index −1. A follow-up "drive" must be admitted only with actual driver proof. Test already-driver, driver-occupied, moving car, wrong car, rear-seat, and invalid owner incarnation separately. Seat index 1 alone is *never* driver proof.
4. With ambient NPCs nearby, use UX4 selection to establish promoted continuity before speaking; ensure no silent retarget during subsequent commands. Test F11 after summon, despawn, respawn, world reset, and change of selected NPC. Check `segment_empty_dialogue` as an independent model-format outcome; it must not be logged as native completion.
5. Issue two consecutive commands and interrupt one; neither may leave persistent busy state or claim completion without the strong ACT receipt. Attach one collected OBS2/OBS3 ZIP with E1 JSONL and RPH log to #275. Keep #275 open until the full test passes.

## Known limitations

This is a focused safe front-passenger → driver transition, **not** arbitrary seat swapping. Native Essential passenger `Seat: 1` lines without correlation are observationally ambiguous. Follow-up is needed if the F11 binding is truly absent while a fresh `inspect` should succeed or if UX4 fails *after* owner-verified continuity was established. Native task acceptance remains separate from GTA physical completion.
