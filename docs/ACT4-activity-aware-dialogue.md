# ACT4 — activity-aware requested dialogue

## Scope

ACT4 feeds one owner-fenced, read-only current ACT activity view into the existing PS4 `SELF.selfFacts` lane on an ordinary requested turn. It uses the existing ACT2 runner, native receipts, ActivityFacts, P0 freeze, P1 owner release, and pre-send stale-reference pruning.

When an owned actor has a current activity, Luna receives the admitted/running/paused/resuming/completed/failed/cancelled state with **explicit evidence strength**. A handler ACK or mode flag is not arrival or task completion. Completion is narrated as physically verified only with a matching strong native completion fact. Terminal state is limited to 60 seconds; unmatched body/host, retired actor, expired pause token, reconnect, and changed state fail closed.

This is **not ACT3 physical execution, ACT5 model-proposed actions, or PS7 social routing**. No new AI request, command dispatcher, lease, pause/resume trigger, profile storage or native binary was added. The ACT engine alone owns interruption/resume rules.

## Activation and deployment

- Deploy source/build from this PR through the normal E1 candidate process; do not copy the test code into GTA.
- Existing opt-ins still apply: `activities.mode: "on"`, `dialogueKnowledge.mode: "active"`, and `dialogueKnowledge.activityFacts: "active"`, a valid PS4 contract, a healthy native ACT channel, and a currently owned promoted NPC. The existing `ps.activity_facts` capability-health validation receipt must also match the deployed payload hash; source code alone does not bypass this gate. No setting is auto-enabled or rewritten.
- Default-off/shadow/non-owned sessions do not receive model-visible ACT4 activity state.

## Verification

Focused test: `node --test tests/activity-act4.test.mjs tests/activity-knowledge.test.mjs tests/activity-capture.test.mjs tests/activity-facts-fencing.test.mjs` from `lsa-essential-e1-candidate`.

In GTA with current built/native hashes, ask the *same owned NPC* what they are doing during `hold_position`, `follow_person`, and `sit_on_ground`; verify that admission, mode/active state, and physical completion are not conflated. Speak again after pausing, explicit resume, cancellation and a native failure. Confirm normal Talk does not clear held activities. Retire/switch the actor, force world reset/disconnect, and ask again: the previous activity must not leak or automatically replay. Test delayed provider requests while status changes, ensuring stale ACT4 facts are pruned before send. Record actual ACT/native lease and receipt evidence, not only the Luna answer.

## Current acceptance

Code and focused regression coverage added in this PR. Offline CI and direct GTA behavior are separate gates; **GTA acceptance remains required**. ACT3-specific capabilities require their own runtime dispatch/physical probes before ACT4 can truthfully narrate them.
