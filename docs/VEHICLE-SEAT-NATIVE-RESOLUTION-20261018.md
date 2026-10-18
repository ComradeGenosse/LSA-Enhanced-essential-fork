# Vehicle-seat intent and native resolution — October 18, 2026

## Observed failure, evidence, and root cause boundary

The supplied October 18 report shows two attempts: `DO EnterDriverSeat <vehicle>` rejected, followed by `DO EnterDriverSeat V001` accepted and Nathan entering the driver's seat. The original `logs-20261018-143658-7e4629.zip` was **not available to this change session**, so the exact first-turn source snapshot, UX4 target, model prompt, native reference lifetime, and receipt chronology have **not** been independently reconstructed. Do not treat the report or static source reconstruction as a recovered log trace.

Source establishes the systemic failure mode: the OpenAI/Luna output schema allows an arbitrary stock DO **string**. `validateStockDecision` correctly accepts a vehicle-targeted stock command only when its `V###` alias exists in the reasoning-time vehicle map and still resolves to the same native identity at dispatch. Nothing guarantees that Luna inserts a real alias rather than a textual placeholder, and the previous direct-player activity lane recognized ACT6 navigation but not ACT3 vehicle-seat orders. ACT5 proposed passenger seats only and required a separate invitation/approval. That allowed otherwise ordinary direct seat commands to depend on Luna's free-form alias selection.

## Fix, ownership and safety

- A **closed whole-utterance classifier** recognizes direct driver, passenger, rear, or unspecified passenger entry for the *player's vehicle* (e.g. “Get behind the wheel,” “You drive,” “Hop in the passenger seat”). It does not resolve unspecified other cars, scan remarks for embedded commands, or claim that “You drive” starts free driving.
- The existing ACT5 original-player-turn lane stages a `board_vehicle` proposal with `{vehicle:{kind:'player_vehicle'},seat}`. The model supplies **neither** a `V###` alias nor arbitrary coordinates, vehicle handles, or seat indices. The existing ACT3 StepRunner resolves the player vehicle through C-02 native anchors, validates the owner/vehicle/seat, and uses Essential's queued seat command. No new task scheduler or seat controller was created.
- The native promoted-character `inspect` snapshot now advertises `driverFree` and `actorSeatIndex` in addition to the existing passenger checks. This is advisory only. ACT3's native preflight reacquires the exact actor and live anchored vehicle, checks stopped/occupied/destroyed/retired conditions, and returns `alreadySatisfied` only if the actor is physically seated in the **same** anchored vehicle and specified seat. Same-seat no-op requests may therefore succeed without unnecessary re-entry.
- ACT3 registry/probes, explicit ACT5 opt-in, player-turn currency, exact owner/encounter/incarnation, host epoch, native client run, ACT activity ownership, and ACT6 busy status are enforced. If ACT3 or ACT5 is disabled, this direct native path is unavailable; **do not** bypass those gates with a speculative stock command.
- Direct seat orders are reconciled **after** Luna interpretation but **before** the Essential stock validator and `output_transcript` publication. A model-generated `DO EnterDriverSeat <vehicle>`, `{vehicle}`, `VXXX`, an unrelated action, or an unsupported ACT5 invitation is removed for this specific owner-verified direct seat operation. Successful staging produces only a tentative line (“I'll try…”). Native ACT3 admission happens once, **after** validated transcript publication, via the existing `commitApproved` path. A declined operation returns a specific, non-completion response.
- Normal stock DO commands, including valid `V001`, retain the previous strict reference-map validator. This change does **not** weaken stale-map checks, rewrite arbitrary model aliases, change ACT6 route planning, or retry a stock action automatically.

## Distinct results and diagnostics

The companion JSONL records the privacy-safe events:
- `vehicle_seat_requested` — closed intent and requested seat; not verified yet.
- `vehicle_seat_reconciled` — model command suppressed, native admission pending or a bounded refusal code.
- `vehicle_seat_admission` — ACT engine accepted/rejected after owner re-verification. **Accepted != physically seated.**
- Existing `activity_admitted`, `activity_step_started`, `activity_receipt`, `activity_terminal` and C-02/NPC native receipts represent native progression or failure.

The RAGEPluginHook log emits `[LSA ACT3 SEAT]` `queued`, `sample`, `cancel`, `superseded`, and `ownership_ended` for one owned task. Sample logging is **transition-only**, not per-frame; the `physically_seated` transition requires GTA seat index and vehicle-anchor match. `queued` is **not** evidence of entering. No raw player text, player name, or model response is logged by these new seat events.

Failures are native and typed: `vehicle_unavailable`, `vehicle_moving`, `seat_occupied`, `state_blocked`, `vehicle_invalid`, `vehicle_mismatch`, `actor_busy`, `capability_disabled`, ownership changes, timeout, interruption, or despawn. A new direct player request is a new activity; it does not carry forward a failed placeholder or stale vehicle anchor. ACT3's existing cancellation and native owner lease remain authoritative.

## Regression coverage

- Exact October 18 placeholder and malformed alias rejection in stock `validateStockDecision`; valid `V001`, changed entity, and expired entity.
- Pure post-Luna reconciliation of malformed/valid DO strings without side effects or premature success claims.
- Direct driver, passenger, rear, and generic passenger phrases; non-command/ambiguous requests are not classified.
- First-turn owner-scoped proposal creation, no task before stock transcript commit, exactly one ACT activity acquisition, and no duplicate commit.
- Native snapshot gates for destroyed/missing/occupied/moving vehicles, actor already seated, native capability disabled, owner/epoch changes, ACT6 busy navigation, interruption, and retry.
- Existing `activities-act3.test.mjs` and `native/activities/tests/Act3Tests.cs` verify C-02 vehicle anchoring, actual driver/passenger seat occupancy, wrong car/seat, stale anchors, timeout, cancellation, and strong completion receipts.

## GTA acceptance checklist (required before calling this complete)

1. Install matching companion and native DLL built against the **pinned** Essential and RPH versions. Turn on ACT5, ACT3 `enter_vehicle_seat`, and its verified native probes. Check the exact startup capability/owner reports; missing gates must be called out rather than silently bypassed.
2. Spawn Nathan near the player's stopped vehicle, driver seat empty. Say **“Get in the driver's seat.”** Confirm one `vehicle_seat_requested` → `vehicle_seat_reconciled` → `vehicle_seat_admission` series; confirm ACT3 resolved the current anchored player vehicle, Essential queued its existing driver-seat command, and `physically_seated` logged with the correct vehicle anchor and seat index **−1**. Only then count success.
3. Repeat with **“Hop in the passenger seat,” “Get behind the wheel,” “Hop in and drive,” “Get into my car,” “You drive.”** Verify intended seat, not a silently substituted position; do not assume the 'drive' wording starts vehicle motion.
4. Repeat with occupied driver seat, nearby other cars, destroyed/replaced player vehicle, moving vehicle, stale owner token, Nathan already occupying the requested seat, another active ACT6 trip, interrupted entry, character despawn, and legitimate retry. Verify typed failures, no ghost vehicle task, no stale busy state.
5. Inspect both companion JSONL and RPH log. ACT3 `step`/completion receipts plus native `physically_seated` samples constitute the required physical evidence; stock DO acceptance or ACT3 admission alone is insufficient.

## Offline versus runtime verification

Static source inspection establishes the guarded path and the existing ACT3 native seat-occupancy logic; test execution and pinned native compilation must be reported separately. This patch cannot prove actual GTA seat occupation, actual log provenance, or correctness of deployed pinned binaries without a matched GTA session and its logs.
