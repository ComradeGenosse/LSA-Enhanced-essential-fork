# UX4 Talk Target Selector — GTA acceptance matrix

This document is a physical GTA V Enhanced acceptance checklist. Offline unit tests cannot substitute for these checks.

Architecture: research/ux4-talk-targeting-architecture.md
Implementation plan: plans/UX4-talk-targeting-implementation-plan.md

## A. T0B direct-mic seam smoke test

T0A is already complete from the checked-in DLL. Do not test the obsolete "SetPlayerConversationPed then press normal TalkKey" design: static analysis proves stock Talk recomputes GetBestConversationPed and can overwrite that target.

### A1 — exact target beats nearest

- Put ordinary NPC A closer than B.
- UX4 selects B without mutating NpcTargeting.
- Hold past the threshold.
- Native `talk.ptt_start` revalidates B, calls `SetPlayerConversationPed(B)`, then `InputController.SendMicStart(B)`.
- Speak, then release through `talk.ptt_stop`.

Pass: B gets the mic turn, A does not, and preview taps alone create no conversation side effects.

### A2 — current speaker does not steal selection

Make A the recent/current speaker, explicitly select B, then start through UX4.

Pass: B is addressed.

### A3 — vehicle occupants

Repeat with B as driver, front passenger and rear passenger.

Pass: direct UX4 mic start addresses B in every supported seat.

### A4 — release lifecycle and partner ownership

Start B, release, let B's reply begin/finish, inspect Current NPC during the reply, then start C.

Pass:
- B receives one matching stock microphone release and no old mic state leaks into C.
- UX4 does **not** clear `PlayerConversationPed` merely because PTT was released.
- B remains the Essential conversation partner through the reply unless Essential itself or a newer committed input replaces/clears it.
- F11/P2 Current NPC and other partner readers do not become null or silently retarget during B's reply.
- A failed/cancelled PTT start still rolls back any provisional `PlayerConversationPed` mutation.

### A5 — target invalidation before start

Select B, then kill/despawn/remove B before the hold commits.

Pass: start fails closed; speech never redirects to A or a recycled handle.

### A6 — text is separate

Stock TextInputService recomputes GetBestConversationPed. Do not count stock TextKey as UX4-target-aware unless a separate typed-target integration is added.

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
- InputController.SendMicStart runs once for the exact selected Ped
- mic capture begins after target commit
- speaking addresses B
- release emits one matching talk.ptt_stop / SendMicStop
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

Pass: a late start reply never leaves `InputController.SendMicStart` running after the physical release. The matching `talk.ptt_stop` has already run, or the start was fenced and never called `SendMicStart`.

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
- the UX4-owned generation calls `InputController.SendMicStop()` once
- no stuck capture
- no speech redirected to another NPC

## F. Input safety

Test each while a UX4 hold has the microphone open:

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
- the matching UX4 mic generation is stopped exactly once or idempotently
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
- selector commit -> `InputController.SendMicStart(selectedPed)`
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
- a UX4 microphone generation can remain open after release, focus loss, or shutdown
- selecting creates provider/task side effects before hold
- vehicle occupants cannot be reliably distinguished
- current.* commands ignore the selected target
- successful PTT release clears or redirects Essential's conversation partner before the reply lifecycle is finished
- T0 public targeting seam is not proven and no source-pinned replacement plan exists
