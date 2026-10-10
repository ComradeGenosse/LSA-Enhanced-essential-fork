# Phase 13a — Architectural Piece #3B implementation status
**Code head validated:** `2a746de3500b5b74a609f94db44124ed4a68b0fb`
**Automated validation:** [GitHub Actions run 38053980659](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38053980659) — SUCCESS, Ubuntu and Windows (October 10, 2026).

## Implemented in this bounded slice

- The original Essential `kb` invocation cannot infer a ticket from `ps:` alone. The companion matches its *exact* native-submitted one-shot ticket, context, original PS3 entitlement, backend source incarnation/revision and captured actor/player identities. Actor hydration must retain that exact claim.
- A source-owned staged lease follows **the stock** `kb → Xi → Zi/WP → Xn` entrypoints. Expected transitions of the *same claimed ticket* advance it; player mic/text, other owners, unexpected turn/session transitions, revocation and lease expiry kill it rather than rebasing a quiet snapshot. Stock player turns keep their normal path.
- The actual source-generated **PedId/TurnId/Int64 GenerationId/SessionNonce** is exported exactly once from `Xn` on the authenticated original pipe. The native owner fiber decodes a strict closed binding frame, checks the already-claimed native stock intake, real speaker/local-player anchors, host/world, PS3 grant and retained original backend evidence, then attempts `BindActualTuple`. A sender-supplied tuple never grants itself permission.
- The native owner fiber returns a typed `director_response: bound|unsafe` to this exact ticket. The source **awaits a positive native binding response** before sending any Director text to the model (`vi`); a queued pipe write, foreign/late response, disconnect or timeout is denied without another attempt.
- Core playback start/end callbacks are independently matched by the native bound speaker/turn/generation, with the original session nonce retained by the native reservation. A final or interrupted callback cannot fabricate playback started, complete an unrelated ticket or repeat an acknowledgment. Native player-turn/core and P2 owner revisions remain vetoes.
- Valid native playback is checked as an **occupied** turn after binding. The original 250 ms backend idle sample and ~2 s PS3 admission grant legitimately expire during model/TTS processing; they do not become permanent playback requirements. Current host/world, speaker/player/P2 identity, text, controls, mic, script/reflex and independent player/Core epochs still fence each callback. An interrupt, mismatch, timeout or player takeover retires the ticket without successful completion.
- Director-only model actions/DO and stock approach side effects are vetoed. Ordinary Essential player/event paths retain their existing behavior.

## Matching code-head tests

- Ubuntu isolated Node: **734 passed / 71 files / 0 failures**.
- Windows isolated Node: **734 passed / 71 files / 0 failures**.
- Focused Phase 13a Node: **48/48 on each OS**.
- Windows native Director/PS3/turn admission: **314 assertions PASS**; production-source integration: **151 assertions PASS**; ACT: **263 PASS**; shared PS: **115 PASS**; P2 lifecycle: **194 PASS**; native host/anchor: **62 PASS**.
- Added positive and negative tests for the real patched stock `kb/Xi/Zi/Xn` identity flow, typed original binding frame, native owner-fiber acknowledgment, duplicate/foreign/late response, source takeover, expiry after binding, real playback completion after short admission receipts expire, and player-text veto.

## Explicit boundary — no project-wide review or deployment

This is the **offline #3B implementation checkpoint**, not a claim of installed-game playback acceptance. The production Director admission and `DirectorSchedulerIntake` remain **default-OFF**; no GTA/RPH process, Harmony runtime timing or live audio was exercised. No merged PR, installed GTA file or production speech mode was changed. No Phase 10a, unrelated milestone, or *final review pass of the entire project* was performed.

Next separately requested work: a focused code/contract review and deployment/GTA acceptance plan, including native pipe timing, original Core callback ordering, player takeover behavior and real spoken-audio receipts, **before** considering activation. PR #23 remains draft/unmerged.
