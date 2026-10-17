# ACT5 — Luna-initiated activities (experimental)

ACT5 lets promoted NPCs invite the player to do something they can *currently* do. **The suggestion is speech, not permission.** The player must affirmatively agree before ACT admits a native activity. The existing ACT0–ACT2 engine, owner leases, native capability probes, C-02 anchors, interruption rules and execution receipts remain the only physical execution path.

## Runtime behavior

- **Disabled by default.** Set `activities.mode: "on"`, `activities.act5: true` in the existing E1 runtime config; keep native ACT compiled/connected and its actual accepted probes. This does not alter Gemini, create a unified settings master or change existing key bindings. The optional unified importer must preserve these runtime fields; do not overwrite an installed config.
- At player-turn model preparation the promoted speaker must have a current P2 profile, original native owner/encounter/incarnation, verified ACT4 activity self-view and live ACT client/engine hello. Any missing or stale evidence disables ACT5 *for that turn*. The prepared list includes only ACT2 intents with enabled runtime capabilities and accepted probes.
- Allowed invitations: `hold_position` (wait here), `accompany` (follow the player), `sit_here` (sit), `resume_previous` (resume ambient). **No invented person/vehicle IDs, coordinates, drive destinations or ACT3/6 verbs.** Those are excluded until their respective native implementations and acceptance exist.
- Luna may return `{dialogue, command, activity:null|{intent,slots}}`, or the same `activity` on the segmented `{mode,segments,command}` schema. Exactly one permitted intent, closed slots and no simultaneous `DO` command. Any offered activity requires `buffered_action`. Candidate ACT5 turns never release speculative early audio, even with early TTS globally enabled.
- An invitation is recorded **only after successful exact native audio playback**, then awaits a simple explicit player affirmation for up to 90 seconds. No goal is created until acceptance. Explicit decline discards it; repeated offers are cooled down. New state/owner/source proof is required when accepting.
- Explicit affirmation is staged as consent; ACT goal admission waits for that **turn's validated `output_transcript` boundary**, then uses existing `ActivityEngine.assign` with `player_dialogue` and `playerApproved` fencing. Actor owner, native epoch/token, current ACT status, capability and references are checked again. The existing engine dispatches to native and returns receipts. Replayed proposal IDs are idempotent. Player UX commands have priority over a busy NPC; ACT5 cannot supersede them.
- Player declines/cancels through the short affirmative/negative/cancel response vocabulary. ACT retains pause, interruption, cancel and resume. The character should say what he *intends* to do, never that arrival, movement or other completion happened before a native receipt.

## Operational boundaries

This is **ACT5 over the verified ACT2 subset**, not ACT3 or ACT4 acceptance. Existing ACT4 activity knowledge remains source/owner-fenced and must be enabled for ACT5; contract rows claiming ACT3 capabilities do not mean their physical steps work. A live native hello or test stub is not, on its own, GTA acceptance. Consent parsing is intentionally closed to short affirmative/negative responses; it is not a new language model call or free-form autonomous planner.

The `act5_proposed`, `act5_admitted`, `act5_declined`, `act5_cancelled`, `act5_rejected` events are privacy-safe state diagnostics; `act5_proposal_published` and `act5_goal_accepted` mark distinct conversation publication boundaries. None is evidence of physical success. Check ACT native `MODE_ESTABLISHED` and `PHYSICALLY_COMPLETED` separately.

## Offline verification

Focused tests: `node --test lsa-essential-e1-candidate/tests/activities-act5.test.mjs`. A PR workflow also runs ACT2/ACT contract, Luna JSON/streaming/turn tests, activity knowledge and existing native ACT host tests. **Record their actual job results on the PR; this document does not assert a test pass.**

## GTA acceptance checklist (pending physical validation)

1. Pin the tested `main`/PR SHA, deployed E1 bundle and promoted/native DLL hashes; verify opt-in, native `hello`, owner identity, ACT4 knowledge and probe evidence.
2. Talk directly to Nathan. In idle/healthy conditions get a natural one-time offer such as “Want me to wait here?” Verify a playback-completed event and one **pending proposal but zero native activity commands**.
3. Say “Sure.” Check exactly one ACT goal admitted *after* the confirmation turn's output boundary, one actor acquisition, and no invented command, owner ID or duplicate action. Check the actual ACT native handler/mode receipt; Nathan should distinguish acceptance from physical completion.
4. Repeat with “No thanks” and then a new offer; ensure decline does nothing physically, repeated offers are bounded, and a changed-mind “stop” cancels an ACT5-assigned task.
5. Interrupt with player command, vehicle movement, native disconnect, despawn, owner/encounter change and stale target; confirm there is no resumed stale action. Replay a provider response and confirm one or zero native execution.
6. Switch ACT5 off and test normal Luna stock commands, dialogue-only stream, Gemini route and existing controller bindings. A successful gameplay run must save build hashes and native receipts.

**GTA acceptance: NOT RUN in a physical game session for this branch.**
