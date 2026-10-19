# ASTRA-002 — Executive verdict: an AI Game Master that invents playable GTA gameplay

> **2026-10-19 · research verdict, not an implementation.** No GTA process was run, no production code was changed, nothing was merged. LSA facts are pinned to `main` `cd6bb4e80a7d6537344ac66b7fd61b58e66f26ca` and research base `09c0df2960e84ceff37ac8a1e79765959b65cc00`. Offline experiments X-1…X-6 ran on an abstract model ([offline-experiments/](offline-experiments/README.md)); they rank designs, they do not accept them. Detail: [01 audit](01-current-lsa-capability-audit.md) · [02 evidence](02-external-research-and-evidence.md) · [03 architectures](03-architecture-candidates.md) · [04 contract](04-gameplay-generation-execution-contract.md) · [05 experiments](05-falsifiable-experiment-ladder.md) · [06 roadmap](06-breakthrough-questions-and-roadmap.md).

## 1. How close is LSA today?

**Close to a Game Master's *surface*, far from its *body*.** LSA can already notice opportunity windows (social-scene idle/travel detectors), speak truthfully through C-11 tickets with playback proof, move Nathan through consented ACT activities (ACT2/3/6, opt-in; ACT6 navigation still unproven in GTA), and sense most of what an objective needs: **21 of 31 catalogued fluents are tier A/B**. What it cannot do is make scene events happen: **only 1 of 17 staging capabilities and 8 of 28 actor policies are A/B, and every one of those concerns Nathan**. There is no spawn path besides P2's promoted-character spawn, no objective tracking, and no world/experience ledger. Compiling 300 generated experiences against today's surface: **0 valid with GTA-accepted capabilities, 7 valid (2 mechanically distinct) with merged LSA code, 208 valid (171 distinct) if about fifteen documented-but-unverified staging, actor and sensor capabilities work** (X-1). Runtime reliability (owner stalls, Director candidates rejected, P2 native failures in the 2026-10-18 triage) is a present constraint independent of any Game Master.

## 2. What is already technically possible?

* A companion **outing** (#3 seed): Nathan proposes a destination, the player accepts, ACT travels, narration stays truthful, and the outcome is an honest completion or abandonment — 14 distinct "go/stay somewhere together" mechanics compose from merged capabilities (X-1).
* Truthful narration of verified events and opportunity offers through the existing Director shell.
* **Offline, the whole design loop works on an abstract model:** typed experience IR, 13 hard critics that rejected 759/760 faulty specs with 0 false rejections (X-2), an evidence-ladder monitor that refused every fabricated completion in 20 000 adversarial traces (X-5), a mystery solver that made 100 % of generated cases fair versus 51 % unchecked (X-6), and an algebra that yields mechanically distinct experiences (ratio 0.83 vs 0.02 for templates, X-3).

## 3. What is likely achievable through ordinary implementation?

Once E0 shows the platform holds (and the owner approves D-024): a **Stage Executor** that creates, tasks and cleans up its own scene entities; **objective monitors** with the evidence ladder; the **IR, critics and twin** ported from the prototype; a **compiler + location atlas**; an **experience ledger** on TimelineGuard; an **offer/consent policy**; speech beats and consented ACT proposals. That stack can deliver playable, world-verified missions, action scenes and mysteries built from validated macros (architecture B quality) — real objectives, real actors, real outcomes — without new science.

## 4. What genuinely requires new research or invention?

1. **Scene-actor coexistence** with Essential's reflexes/perception and GTA's own AI (platform unknown; U-01/U-06).
2. **Closing the twin–world gap:** whether specs the abstract twin calls solvable are playable in GTA, and how to calibrate the twin from traces (FF-2).
3. **Model-written IR at a useful validity, novelty and cost** (no real model was measured; FF-4).
4. **Accommodation with stake continuity** that players experience as clever rather than canned, and when live re-design is worth it (E3).
5. **Perceptible novelty and fun**, offer timing and evaluation without model self-judgement (E6).
6. **#40 mechanic invention** — a separate track; nothing here generates code at runtime.

## 5. Most promising architecture

**F — Grounded Experience Algebra.** Experiences are written in a typed algebra of *observable* fluents, actor policies and staged rules; deterministic critics and an abstract-twin solver reject anything unobservable, unauthorised, impossible, trivial or stakeless; a narrowly authorised Stage Executor realises only entities the experience created; monitors accept only stamped world evidence; precompiled accommodations absorb improvisation in the same tick; an idle-time quality-diversity bench removes offer latency; a ledger keeps verified progress and consequences. **Strongest alternative: B** (declarative compiler over a curated mechanic library) — cheaper and more predictable but measurably less novel; F is built so that B is a strict subset (macros), which makes B the automatic fallback. The existing Director (A) stays the offer and narration surface; multi-agent runtime designs (C), runtime code synthesis (G) and neural world models (H) are rejected.

## 6. What would disprove that approach?

| Evidence | Consequence |
| --- | --- |
| E0.2/E0.6: LSA-spawned scene peds lose tasks to Essential or GTA AI even with Essential's yield flags | No general Stage Executor under D-001 → AGM shrinks to vehicles, props, pickups and companions, or moves to the standalone native core; #6 most affected |
| E0.5/E1: world sensors cannot adjudicate objectives reliably at ~4 Hz | Objective algebra restricted to the reliable fluents; generality drops |
| E2: twin-validated specs are often unplayable while hand-written IR plays fine, or model IR stays < 30 % valid after three critic rounds | Adopt B (macros + parameter filling) |
| E6: the owner cannot perceive algebra novelty, or finds it less fun | Adopt B; spend effort on authored macros and pacing |
| E3: precompiled accommodation feels canned and live re-design is preferred at acceptable latency | Revise the adaptation layer (not the architecture) |
| Owner keeps D-001 strict | AGM limited to offers, narration, companion outings, Essential-owned compositions |

## 7. What to experiment with first

**E0.2 + E0.6 in a lab save, one evening, no model calls:** spawn a scene ped and a vehicle out of view near the player with Nathan present; give walk/drive/flee/guard/chase tasks with Essential loaded, yield flags on and off; record task status, Essential `NpcState`, reflex actions and Luna lines at 4 Hz for 60 s per trial (N = 10), then clean up and count orphans. It decides whether F's executor exists at all. Then **E0.5** (sensor accuracy), **E1** with fabricated-completion injection (model says "done", handler acks, reloads, reused handles — 0 fabricated ACHIEVED allowed), and **E2-lite** with the hand-written courier IR to measure twin–world disagreement before any model is involved.

## 8. Realistic path

R0 owner decisions (D-024/D-025 drafts, lab save, budgets) → **R1** platform census (E0) → **R2** one verified objective (E1: monitors, minimal Stage Executor, IR v1, critics) → **R3** first three-stage mission and first action scene (E2, E4) → **R4** improvisation and the first mystery (E3, E5) → **R5** novelty and fun with the idle-time bench (E6) → **R6** persistence and coordination (E7, E8) → owner decides to productise F, fall back to B, or stop. Each vision keeps its own first slice: #3 Nathan's outing, #23 "let's pull off a job" with a voiced approach choice, #6 a rule-driven chase/ambush, #72 a solver-guided mystery, #20 bench offers in idle windows ([06 §4.1](06-breakthrough-questions-and-roadmap.md)). No dates are claimed: every phase is gated by an experiment, not a schedule.

## 9. The single most important breakthrough to pursue next

**Close the loop "spec → twin-verified → staged → world-adjudicated" for one composed objective in the real engine** — a grounded, verifiable gameplay algebra whose objectives are checkable formulas over GTA sensors, validated before staging and judged only by the world. Its precondition is scene-actor authority next to Essential (E0.2/E0.6). This is the one breakthrough that unlocks all five visions at once: #23's missions, #6's scenes, #72's investigations and #3's adventures are different compositions over the same algebra, and #20 is the policy that offers them.

## 10. What to delegate to ordinary coding agents

Lab plugin and probe harness; JSONL evidence and OBS2 inventory entries; catalog file and tier bookkeeping; IR schema v1 and the critic port from the Python prototype; objective monitors (spec and offline reference exist); the Stage Executor's spawn/readback/release/budget plumbing **after** D-024; the location atlas data; the ledger on TimelineGuard; C-11 speech-beat source; ACT `source:'game_master'` proposals; offer rate-limiting and the F11 kill switch; unit tests for all of the above. **Keep at Astra level:** twin calibration and twin–world disagreement analysis, designer/model research, accommodation design and exploitability, fun-evaluation protocol, Essential coexistence analysis, and #40.

## Evidence at a glance

| Experiment | Headline (abstract model unless stated) |
| --- | --- |
| Audit (repo) | Director speech-only by contract; ACT targets player/vehicle/place only; one spawn path; no objective tracking; LSPDFR absent in 162 sessions; mission flag silences Nathan and blocks saving |
| X-1 | 0 / 2 / 171 distinct valid experiences per 300 in accepted / play / lab modes |
| X-2 | 759/760 faulty specs rejected; 0/40 false rejections; one unsolvable path hidden behind an accommodation passed with soft warnings |
| X-3 | Mechanical uniqueness 0.83 (algebra) vs 0.02 (templates) with similar surface variety |
| X-4 | Precompiled accommodation: best designed-stake success, 0 runtime calls, 0 incoherent objectives; live re-plans too late when the threat is the failure condition; generic fail-forward only moves goalposts |
| X-5 | Evidence ladder: 0 fabricated or early completions in 20 000 adversarial traces; p50 0.63 s |
| X-6 | Solver-guided mysteries 100 % fair vs 51 % unchecked (4.4 % misleading) |

## Unresolved blockers

1. **Owner decision D-024** (amend LOCKED D-001 for scene-owned entities, or host the Stage Executor in the standalone core) and **D-025** (world adjudication distinct from NPC knowledge).
2. **No GTA evidence yet** for any tier-C staging, actor or sensor capability (U-01…U-09, U-11…U-13).
3. **No measured model behaviour** for IR generation (validity, latency, cost; U-10).
4. **Runtime reliability** issues recorded on 2026-10-18 (owner stalls, P2 native failures) affect any experiment that involves Nathan.
5. **Fun is unmeasured** and cannot be established offline.

Preserved failed hypotheses and corrections (Director-as-GM, valid-JSON-as-mission, Essential callouts on this install, live re-planning as default, two X-4 artefacts, hard-critic completeness, adaptive-equals-fun) are listed in [06 §6](06-breakthrough-questions-and-roadmap.md).
