# UX4 Talk Target Selector — GTA acceptance matrix

This document is a physical GTA V Enhanced acceptance checklist. Offline unit tests cannot substitute for these checks.

Architecture: research/ux4-talk-targeting-architecture.md
Implementation plan: plans/UX4-talk-targeting-implementation-plan.md

## A. T0 target-seam proof — required before implementation

Record exact build SHA, installed DLL hashes, RPH version and LSA settings.

### A1 — explicit target beats nearest

Setup:
- NPC A about 2–3 m away
- NPC B about 6–8 m away
- both ordinary, alive and valid

Steps:
1. Use the diagnostic probe to SetPlayerConversationPed(B).
2. Confirm GetPlayerConversationPed() == B.
3. Do not press Talk yet for several seconds.
4. Confirm no microphone/provider turn starts from the setter alone.
5. Press/hold Essential's normal TalkKey and say a short unique line.

Pass:
- created mic turn actor is B
- A receives no turn
- setter alone produced no turn/action/task

### A2 — current speaker does not steal explicit target

Create recent/current speaker A, explicitly set B, then speak.

Pass: B is addressed.

### A3 — driver

Put B in driver seat and A standing closer.

Pass: explicit B receives PTT.

### A4 — passenger

Put B in passenger seat.

Pass: explicit B receives PTT.

### A5 — text

Set B, open Essential TextKey, send unique text.

Record whether B receives it. This result determines whether UX4 can unify typed targeting automatically.

### A6 — target invalidates

Set B, despawn/remove/kill B before TalkKey.

Pass:
- no conversation silently redirects to A or a recycled handle
- failure/clear behavior is observable

### A7 — ActivateAttention comparison

Only if needed, compare SetPlayerConversationPed alone versus setter + ActivateAttention.

Pass criterion for using ActivateAttention in production:
- it is required for correct target acquisition
- it does not introduce unwanted task/behavior ownership

Otherwise omit it.

## B. Selection and cycling

Use at least four nearby human NPCs.

### B1 — first tap

Tap controller Talk once.

Pass:
- no microphone starts
- one NPC receives visible bracket
- HUD/diagnostics show selected target
- chosen NPC is plausibly closest to camera center, not simply nearest behind player

### B2 — cycle

Tap repeatedly within cycleWindowMs.

Pass:
- indicator advances exactly one candidate per tap
- order remains stable while NPCs move modestly
- wraps after final candidate
- no tap starts microphone

### B3 — cycle timeout

Wait beyond cycleWindowMs and tap.

Pass: a new ranking session is built rather than continuing stale frozen order.

### B4 — one candidate

Only one valid NPC in range.

Pass: repeated taps reaffirm the same NPC without errors or microphone starts.

### B5 — no candidates

No valid humans in radius.

Pass: concise No nearby NPC feedback; no PTT begins.

## C. Vehicle visibility

Test driver, front passenger and rear passenger.

Pass for each:
- selected occupant is visually identifiable without exiting vehicle
- indicator tracks head/upper body as vehicle moves slowly
- roof/body does not make selection invisible
- cycling between multiple occupants moves indicator to correct occupant
- no strict LOS rule incorrectly removes a seated occupant

Also test player outside vehicle and player inside another vehicle.

## D. Hold-to-talk

### D1 — selected target

Select B, then hold Talk past talkHoldMs.

Pass:
- indicator remains on B
- Essential TalkKey goes down once
- mic capture begins after target commit
- speaking addresses B
- release emits one TalkKey up
- selection remains briefly after release

### D2 — hold with no prior selection

Clear selection, point camera near B, hold Talk directly.

Pass:
- B is selected/indicated first
- PTT starts only after exact selection commit
- B receives speech

### D3 — short tap

Tap faster than talkHoldMs 30 times.

Pass: zero microphone turns.

### D4 — release during commit

Introduce enough load to release after hold threshold but before native commit reply.

Pass: late reply never presses TalkKey after physical release.

## E. Loss and race cases

### E1 — target walks out of retention radius before hold

Pass: target_lost/clear; no automatic replacement.

### E2 — target despawns after selection

Pass: selection clears; next talk does not hit a new ped with same handle.

### E3 — target dies

Pass: clears/no retarget.

### E4 — world/game clock reset

Pass: selector state and frozen candidates clear with existing P2 reset.

### E5 — target disappears while PTT held

Pass:
- synthetic TalkKey releases
- no stuck capture
- no speech redirected to another NPC

## F. Input safety

Test each while Essential TalkKey is synthetically held:

- alt-tab
- pause
- open RPH console
- open Essential F7 controls
- open LSA RNUI menu
- start cutscene if practical
- trigger player switch
- hot-reload LSA.Enhanced.json
- unload/stop enhanced host if practical

Pass every case:
- TalkKey is released exactly once or idempotently
- no stuck microphone
- next normal talk works

## G. Selected-target reuse

With B visibly selected:

- Follow chord
- Wait from Current NPC menu
- Promote ordinary B
- open Current NPC page
- current_describe
- typed input if A5 passed

Pass:
- each operation refers to B
- expectedEncounterId catches a target change rather than operating on C

Then deliberately change selection to C while a B operation is pending.

Pass: B operation either completes against its captured expectation or fails target_changed/native_stale; it never becomes a C operation.

## H. Compatibility

Verify:

- F6/DLSSNR remains untouched
- L4/R4 mark/text/follow chord behavior remains
- F11 menu remains
- Essential direct MarkedTalk remains unchanged
- disabling UX4 restores old behavior after controller mapping is restored
- no PS perception/provider/playback regressions appear in logs

## I. Latency and tuning

Measure at least 20 hold starts:

- physical Talk key-down -> selector request
- selector commit -> synthetic Essential TalkKey down
- physical key-down -> micStart

Record p50/p95.

Tune talkHoldMs only after measurements. Goal is to prevent accidental tap conversations while keeping deliberate PTT responsive.

## J. Soak

At least 15 minutes:

- cycle/select across many ordinary NPCs
- several vehicle occupants
- repeated talk/release
- Follow/Wait/menu between turns
- target deaths/despawns
- one focus loss

Pass:

- no stuck key
- no runaway selection/encounter growth
- no unbounded queue growth
- no stale target resurrection
- no UX4 exception disables P2
- no wrong-NPC microphone turn observed

## Merge gate

Do not merge if any of these occur:

- indicator points to one NPC while mic turn targets another
- quick tap creates a voice turn
- target loss silently retargets
- held TalkKey can remain stuck
- selecting creates provider/task side effects before hold
- vehicle occupants cannot be reliably distinguished
- current.* commands ignore the selected target
- T0 public targeting seam is not proven and no source-pinned replacement plan exists
