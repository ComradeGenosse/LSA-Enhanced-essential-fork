# ACT5 — Luna-initiated activities (experimental)

**Status:** Source implementation of ACT5 over ACT2/ACT3 on PR #238; default-off. The exact updated native DLL and the companion must both be deployed. Offline CI and physical GTA acceptance are independent gates. No physical GTA validation is claimed.

ACT5 is conversational initiative, **not** autonomous activity execution. Nathan proposes one supported activity in normal speech, an exact player turn accepts, and the existing ACT engine executes Essential commands only after authorization. No new scheduler, AI-driven native command, Director, or ACT6 navigation is introduced.

## How it works

1. A requested player turn is bound to a current promoted character, original P2 owner, native encounter/incarnation/host epoch, ACT3 hello and ACT4 knowledge snapshot. Any failure disables the ACT5 path for that turn.
2. The native P2 `inspect` operation now returns a **read-only availability snapshot**, scoped to the inspected owner. ACT5 checks actor-on-foot/in-vehicle, live nearby player, scenario readiness, the nearby current/last player vehicle, whether it is stopped, and free passenger seats. This is a *hint*, not a durable vehicle handle or permission. Missing/uncertain state blocks ACT3 suggestions.
3. ACT5 intersects availability with the existing registry, explicit `act3Capabilities`, *all* per-step native hello capabilities, source/priority permission and accepted probe IDs. The result is a short list of **closed exact slot choices**. The strict Luna JSON schema includes only those choices.
4. Luna may offer one invitation, never a simultaneous stock `DO` command. Segmented delivery uses `buffered_action`; speculative/early TTS is suppressed. A proposal exists only after successful native playback for that precise turn.
5. A short, unambiguous affirmative response stages consent. A validated `output_transcript` for that confirmation turn is required before exactly one `ActivityEngine.assign` request. The original owner, native run, epoch, character, encounter, incarnation, turn and world availability are rechecked.
6. Native actor lease, C-02 per-step reference acquisition, preflight, Essential dispatch, native receipts and completion adapters remain authoritative. Proposed/admitted/handler-accepted/mode-established/physically-completed are **different states**. ACT4 exposes the evidence, not a simulated outcome.

Proposals expire after 90 seconds and are cooled down for 90 seconds. No repeat consent, replay, delayed provider response, owner revocation, competing player activity or native restart is permitted to create another execution. `stop doing that` can cancel only the *currently active ACT5-assigned activity*, never a later user/stock action. Refusal never creates an activity.

## Covered plans

| Spoken activity | Closed ACT intent and native steps | Required native probe IDs |
| --- | --- | --- |
| Wait here | `hold_position` → ACT2 hold | `Q1`, `FR1` |
| Follow / come with me | `accompany` → ACT2 follow player | `Q1`, `F1` |
| Resume ambient | `resume_previous` → ACT2 resume | `R1` |
| Sit on the ground | `sit_here` → ACT2 sit | `K1` |
| Come over and face me | `approach_and_face` → approach, stop/face player | `Q1`, `A1` |
| Walk away / leave the scene | `leave_scene` → walk-away player, resume ambient | `Q1`, `R1` |
| Take cover | `take_cover_and_hold` → cover mode | `C2` |
| Have a coffee / check phone / smoke / lean / idle / clipboard / binoculars | `scenario_here` → Essential `NpcActions.UseScenario`, seven closed scenario choices | `S1` |
| Hop into my car | `board_vehicle` → seat occupancy in the player's vehicle | `V1`–`V4`, `SVE1` |
| Ride along | `ride_along` → passenger occupancy in the player's vehicle | `V1`–`V4`, `SVE1` |
| Get out and wait here | `exit_vehicle_and_hold` → native exit, ACT2 hold | `Q1`, `FR1` |

All capabilities need native hello support, `activities.mode:"on"`, accepted probes and ACT3 capabilities named in the plan. For example, boarding requires `enter_vehicle_seat`, the exit/wait plan requires `exit_vehicle`, and approach/face requires **both** `approach_person` and `stop_and_face` in `act3Capabilities`. The scenario choice `sit_bench` is deliberately **blocked**: a native prop anchor is unavailable. Drive-to, arbitrary NPCs, invented coordinates, autonomous ACT6/ACT7 plans and driver-seat offers are not ACT5 activities.

`board_vehicle` exposes only `any_passenger`, `passenger` or `rear` when the corresponding seats are free in the inspected player vehicle. `ride_along` exposes the same three seat choices, never `driver`. `exit_vehicle_and_hold` is eligible only while the owned actor is actually in a vehicle. `scenario_here` needs the actor on foot and native scenario readiness. Any change between suggestion, acceptance and native preflight rejects safely. A stopped, nearby player vehicle is an eligibility requirement; a stale `LastVehicle` far from Nathan never qualifies.

## Opt-in settings

The existing E1 configuration must include, for the specific GTA experiment:

```json
{
  "activities": {
    "mode": "on",
    "act5": true,
    "passedProbes": ["Q1", "FR1", "F1", "K1", "R1"],
    "act3Capabilities": []
  }
}
```

The example above opts into ACT2 only. Extend `passedProbes` and `act3Capabilities` **one tested plan at a time**, using the probe matrix above; do not blindly paste every native probe as if it had passed. For full ACT4 narration, also enable the existing `dialogueKnowledge.mode:"active"` and `dialogueKnowledge.activityFacts:"active"` with a current PS4 `ps.activity_facts` capability-health acceptance. No active settings or controller bindings are rewritten by this PR. ACT5 remains disabled unless explicitly opted in.

## Strict Luna and voice rules

Ordinary decisions are `{dialogue,command,activity}`; segmented decisions add the exact `activity` field to the existing `{mode,segments,command}` shape. Each non-null activity is one enumerated, closed pair of `intent` and `slots`. Strict schema `anyOf` branches are generated from verified offered choices. `activity:null` stays legal. Simultaneous stock commands, arbitrary slots, unverified target aliases, additional keys, or an ACT5 proposal in dialogue-only streaming are rejected. The legacy Luna schema is unchanged when ACT5 is unavailable; Gemini and stock Essential commands are not rewritten.

**Real provider acceptance must still be verified** against the deployed Luna endpoint's strict schema processing. Local JSON/stream parsing and schema-shape tests cannot prove that a cloud model will accept or use every dynamically generated schema.

## Offline checks

Run from the repository root:

```sh
node --test --test-concurrency=1 lsa-essential-e1-candidate/tests/activities-act5.test.mjs lsa-essential-e1-candidate/tests/activities-act3.test.mjs lsa-essential-e1-candidate/tests/activities-act2.test.mjs lsa-essential-e1-candidate/tests/activity-act4.test.mjs lsa-essential-e1-candidate/tests/activities-contract.test.mjs lsa-essential-e1-candidate/tests/decisions-and-requests.test.mjs lsa-essential-e1-candidate/tests/streaming-decision.test.mjs lsa-essential-e1-candidate/tests/activity-knowledge.test.mjs
```

The `.github/workflows/act5-luna-proposals.yml` PR workflow runs these suites and the Windows ACT native contracts/runtime suite. Review the actual run conclusion and recorded assertion counts; do not infer a pass from this documentation or from a successful source push.

## GTA acceptance — **NOT RUN**

Log the installed E1 and native DLL hashes and the exact source commit before enabling experiments. For each row above, run: Nathan makes a suitable unsolicited invitation during **requested** conversation → verify audio completion and one pending proposal, with **no actor.acquire** → say “Sure, go ahead” (or “Okay, get in”) → confirm exactly one `act5_admitted`, one `actor.acquire`, per-step `anchor.resolve`/preflight, correct Essential command and native receipt.

- ACT2: wait, follow, sit and resume; show intent and actual active mode separately.
- Approach/face: verify `ApproachFinished` is for Nathan/current player; following face mode is *not* whole-plan physical completion.
- Leave: verify native distance ≥ 40 m and that the subsequent ambient step does not reuse stale target proof.
- Cover: verify current cover mode and safe cancellation, not a fabricated arrival.
- Scenarios: verify each of the seven closed scenario animations activates on foot; test an unavailable scenario state.
- Vehicle board/ride: with **current, stopped and nearby** player vehicle, test free front/rear/any seats; then occupied seat, moving vehicle, distant/stale last vehicle, vehicle despawn or replacement after consent; only real occupancy in the anchored vehicle and correct seat counts.
- Exit/wait: test actor actually seated; verify exit-vehicle receipt, then hold-position mode. A strong exit receipt does **not** prove the second step or completion.
- Dialog: affirmative variants, ambiguous responses, `no stay here instead`, `actually never mind`, cancellation, cooldown, busy owner and subsequent stock player command. Replay the same provider response and expire the proposal.
- Safety: owner/token/incarnation/host epoch changes, native disconnect, P2 despawn, actor injury/death, double approval and lease preemption. Test older/native deployments without availability hints (ACT3 should fail closed).
- Voice: ordinary JSON, strict segmented V0/V1, expressive delivery, buffered audio and no early speculative invitation. With ACT5 off, confirm unchanged Luna stock actions, Gemini, controls and PTT.

Expected privacy-safe ACT5 logs: `act5_proposed`, `act5_declined`, `act5_goal_accepted`, `act5_admitted`, `act5_rejected`, `act5_cancelled`. Distinguish native `HANDLER_ACCEPTED`, `MODE_ESTABLISHED` and `PHYSICALLY_COMPLETED`; **only physical evidence or native final-step completion** may support a claim of physical success.

**ACT5 cannot be considered gameplay-accepted until the exact deployed build has passed this matrix.**