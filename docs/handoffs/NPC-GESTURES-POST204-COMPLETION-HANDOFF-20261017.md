# Implementer handoff — gesture work remaining after PR #204

**Use:** [completion plan](../plans/npc-nonverbal-acting-completion-after-pr204-20261017.md). Base each implementation PR on the latest integration branch containing #204 and #215. Do **not** modify the existing docs-only planning PR.

## First task: G0 compatibility closure

Review [#199](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/199), [#204](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/204), `docs/plans/npc-gestures-findings.md`, and the live reaction native/companion code. Establish GTA Enhanced safety/clip evidence for facepalm and middle finger and verify native ownership, playback timing, cleanup, and speech coexistence. Add only narrow diagnostics/repairs and focused regression tests; open a separate draft implementation PR. Do not claim GTA proof from a stub test. If GTA unavailable, provide a reproducible in-game checklist and mark gameplay validation open.

## Second task: G1 facial feasibility, then implementation only if safe

Audit Essential `NpcLipSync`, #215 `NpcVoiceMouthOverlay`, and any gaze owner; verify native facial clips and safe arbitration in Enhanced. First deliver an explicit compatibility verdict. If safe, use #204's existing per-turn fenced reaction pipeline for up to three whitelisted subtle expressions (amusement, concern, frustration as examples), speech/lip sync higher priority, default off, no second model request or untrusted animation IDs. If ownership or clips cannot be proven, do **not** force implementation; document the blocker and leave expressions disabled.

## Optional future work: G2 natural body language

Nods, shrugs, subtle hand emphasis and dismissive gestures are **new scope** not promised by #199. Start a separate, limited proposal and small PR per verified gesture after G0; do not put `square_up`/combat-oriented behavior into cosmetic reactions.

## Regression/acceptance (each PR)

Retain exact-ped/turn/generation/world checks, one bounded reaction, native preflight, default-off, clip-scoped stop, no task clearing or heading/movement/weapon changes. Validate both male and female ordinary/promoted actors, off/shadow/on, dialogue cancellation, native reconnect, Memory K/EA/UX4 unaffected, and actual Enhanced visuals when possible. Report **offline tests**, **production native build**, and **physical GTA test** separately.

**Deliverable:** small focused draft PR, concise source-rooted summary of implemented versus still gated functionality, and a clearly labeled GTA testing checklist.
