# Radio track perception R4 — PS3 salience

> **R5 branch note:** this file describes the standalone R4 milestone. On `feature/radio-track-perception-r5-context-projection`, selected radio context can now cross the model boundary; see `radio-track-perception-r5-status.md`.

Status: **implemented on `feature/radio-track-perception-r4-ps3-salience`; build/test/GTA acceptance pending**.  
Base: `feature/radio-track-perception-r3-ps2-hearing@f2388a488c1714043b8bece2f1a666830f063436`.

R4 takes R3's supported per-NPC `radio_heard` observation and classifies it in deterministic PS3 salience. It still does **not** project radio into Luna/model context; that remains R5.

## Implemented behavior

- `radio_heard` is explicitly a routine, low-priority PS3 event.
- Default decision is `context: omit`, `memory: none`, `response: none`.
- Radio can never become urgent, authorize speech, or stage memory through R4.
- A bounded authoritative salience input, `requestedEnvironmentChannels: ['radio']`, may make current supported radio knowledge `context: candidate`.
- PS3 does not keyword-scan player text. Semantic turn relevance remains the responsibility of the later selector/context layer.
- Protective/loyal traits, relationship metadata, and prior memories cannot independently promote radio into speech or memory.
- Supported danger continues to outrank radio.
- Salience policy version is now 2.
- If R5/PS4 later acknowledges a radio context decision as delivered, replaying the same observation revision is suppressed.
- A new track/station revision is independently eligible to become a context candidate again.
- When R3 removes a listener's radio observation or handles `radio_stopped`, the associated PS3 decision/ledger entry is removed so stale track context cannot survive the PS2 fact.

## Boundaries preserved

- no model call;
- no prompt/context projection;
- no automatic speech;
- no memory write/staging;
- no initiative permission;
- no radio preference inference;
- no lyric/audio capture;
- no exterior-hearing inference beyond R3's same-vehicle evidence.

## Tests added/updated

Coverage was added for:

- default radio omission;
- explicit radio environment relevance -> context candidate only;
- traits/relationships/memories not granting radio response or memory;
- radio remaining below supported danger;
- PS4 context acknowledgement suppressing same-track replay;
- a material track revision reopening context candidacy;
- radio ingestion producing a PS3 low-priority decision;
- radio stop clearing both PS2 knowledge and the stale PS3 decision;
- salience policy version 2.

These tests have **not been executed in this GitHub-only implementation pass**. No GitHub Actions run is attached to this branch. The normal Node regression/build run is still required.

## Acceptance before merge

1. Run the full companion regression suite and candidate build.
2. Confirm a real same-vehicle R3 observation creates a PS3 decision with no response/memory entitlement.
3. Confirm radio stop/vehicle exit leaves no current PS2 observation or PS3 radio decision.
4. Confirm simultaneous supported danger ranks above radio.
5. Keep radio shadow-only until the existing R0-R3 GTA acceptance gates are satisfied.

R5 is the next milestone: selectively project a compact current-radio fact to Luna when an authoritative turn selector asks for radio/environment context.
