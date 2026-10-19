# ASTRA-002 · 02 — External research and technical evidence

> **Status:** research synthesis, 2026-10-19. About 110 web searches/fetches were made for this dossier (all accessed 2026-10-19). Nothing here was run inside GTA. A source being cited is not an endorsement that its technique works in GTA V Enhanced; the **transfer** column of each table says why it does or does not.

## 0. How to read the evidence

| Class | Meaning |
| --- | --- |
| **PUB** | Peer-reviewed paper (venue confirmed by the publisher page or proceedings listing) |
| **PRE** | Preprint or paper whose venue could not be confirmed |
| **POS** | Position paper / theoretical proposal (argues, does not demonstrate) |
| **PROD** | Technique documented as shipped in a production game (developer talk, official docs, community wiki of the shipped game) |
| **MOD** | Shipped community mod or tool, described by its own page (claims not independently verified) |
| **OSS** | Reproducible open-source implementation (licence recorded in §9) |
| **CLAIM** | Vendor/press statement or unverified claim |

| Read depth | Meaning |
| --- | --- |
| **F** | Full text or a substantial portion was read in this session |
| **A** | Abstract / landing page / project page only |
| **S** | Bibliographic only (search result); facts stated from the record, not re-read |

Source IDs (`[S-nn]`) resolve in §13.

## 1. Ten findings that constrain an AI Game Master

1. **Every credible system that produces *verified* or *playable* results puts a deterministic checker between the model and the world.** LLM-Modulo makes "hard critics" (model-based verifiers) the only authority on validity and says LLMs "cannot take on the role of hard critics" [S-01]; LLM+P hands the plan to a classical planner [S-04]; SayCan multiplies the model's "say" score by a learned "can" (affordance) score [S-05]; DeepMind's Code World Models verify an LLM-written game model with unit tests built from real trajectories [S-30]; IVIE validates every generation stage with schema, reachability (DFS) and completability checks [S-27]; *Orchestrated Reality* commits only "schema-validated, content-hashed JSON deltas" through a Plan-Diff-Validate-Apply kernel owned by a single orchestration agent [S-29].
2. **Language models alone are poor at constraint-satisfying plans and at game mechanics.** GPT-4 reached a 0.6 % final pass rate on TravelPlanner [S-03]; LLM-Modulo quotes Valmeekam et al. that "only about 12 % of the plans that the best LLM (GPT-4) generates" were executable and reached their goals [S-01]; RPGBench finds models "can produce engaging stories but often struggle to implement consistent, verifiable game mechanics" [S-24]; Spec2Game (Oct 2026) finds that runnable ≠ correct: of 387 projects passing every executability check, 87 still scored below 60 on specification realisation, and "Goal and Termination Modeling" was the weakest component (44.05) [S-25].
3. **Validated generators still leak in exactly the two ways that matter to us.** In IVIE, two of eight failed play sessions were "structurally impossible objectives that passed validation", and in 3 of 16 worlds players bypassed puzzles "by simply claiming to solve them" [S-27]. Lesson: the validator must model the *actual* authority (here: the GTA world), and a claim — by player or model — must never be evidence (→ critic H5 and the evidence ladder, [04 §5](04-gameplay-generation-execution-contract.md)).
4. **Production directors win by selection and pacing, not by authoring content at runtime.** Left 4 Dead's Director drives a Build-up → Sustain-peak (3–5 s) → Peak-fade → Relax (30–45 s) cycle from a per-survivor intensity estimate, spawns out of sight inside an "active area set", picks which designer-placed weapon caches exist, and "adjusts pacing frequency, not difficulty amplitude" [S-10]. RimWorld storytellers weigh colony wealth, population, recent deaths and time since the last major event [S-11]. F.E.A.R. picks squad dialogue *after* the behaviour decision ("smoke and mirrors") [S-12]. → The Game Master's always-on part should be a cheap deterministic director; model inference belongs at design time.
5. **Interactive-narrative research solved the *structure* of adaptation long ago — and documented its failure modes.** An experience manager either *intervenes* (prevents the deviation) or *accommodates* it (re-plans to repair causal breaks) [S-13]. Riedl et al.'s Automated Story Director precomputes a contingency tree offline (> 2000 nodes, mean branching 2.87, depth capped at 6) and keeps authorial intent through "islands" every valid plan must pass through; users found adaptations "absurd, obsessive, or frustrating" and some learned to *force* adaptations [S-14]. → Precompiled accommodation (tested offline in X-4) needs stake continuity *and* variety, or it becomes exploitable.
6. **Generators that guarantee playability do so by construction — and then repeat themselves.** Puzzle-Dice generates puzzle trees backwards from the goal so every puzzle is solvable by construction, but its game became repetitive "after several playthroughs" [S-17]; Doran & Parberry's quest grammar (750+ quests, 4 MMORPGs, 9 NPC motivations) checks world state through Prolog backtracking [S-16]. → Novelty has to be measured mechanically and searched for explicitly (expressive range [S-19], MAP-Elites [S-20]).
7. **LLMs are useful *inside* symbolic search as heuristics, but brittle to surface wording.** Farrell & Ware used GPT-3.5 to guide the Sabre narrative planner: it helped on most of 13 problems, but obfuscating names cut the share of explained nodes from 75 % to 33 % (below the 37 % baseline) [S-22]. Wang & Kreminski found GPT-4-tier models produce causally sound plans at small scale, that intentionality and dramatic conflict "remain challenging", and that clingo feedback lifted GPT-4o from 13/30 to 29/30 solved tasks [S-21]. → Ground on catalog *semantics*, not names; keep the solver in the loop.
8. **Code-as-action is powerful in sandboxes and unsafe as a runtime game mechanism.** Voyager stores skills as executable code and self-verifies with another GPT-4 agent [S-06]; Code as Policies states "we cannot tell if a response will be correct a priori", and its only safety measure was a lexical pre-execution filter [S-07]. → Rejected for the shipped loop (brief constraint 7); acceptable for *offline, reviewed* tooling (#40).
9. **Neural world models cannot be the authority on GTA's state.** Genie 3 runs 720p/24 fps, keeps consistency for "a few minutes", has a constrained action space and calls multi-agent interaction "an ongoing research challenge" [S-32]; GameNGen simulates DOOM at ~20 fps on one TPU [S-33]. Neither can tell us whether a GTA courier is dead. *Code* world models are different: an executable, testable model that is checked against real transitions [S-30, S-31] is exactly the role our abstract twin plays (§10).
10. **In the GTA ecosystem, the closest prior art is LSA's own upstream: Essential's generated-callout pipeline** (LLM writes a grounded JSON scene, server validates, regenerates once with a correction prompt, repairs deterministically) — which needs LSPDFR, absent from all 162 owner sessions ([01 §2.6](01-current-lsa-capability-audit.md)). Public mods are template randomisers (PGM [S-41], LIQUIDATOR [S-42]), AI-*written code* (GPT Callouts [S-43]) or AI *conversation* (Sentience [S-44], Sentient Streets [S-45]). **No public project was found that generates multi-stage GTA gameplay, verifies objectives from world evidence, and adapts its structure at runtime.**

## 2. Production game techniques

| Source | Class / depth | What it does | Transfer to GTA V Enhanced / LSA |
| --- | --- | --- | --- |
| Left 4 Dead AI Director, Booth 2009 [S-10] | PROD / F | Intensity per survivor (damage, incapacitation, nearby kills; decays when not engaged); pacing cycle; *Active Area Set* populates only near the team; spawns out of sight, ~75 % of mobs from behind; mobs every 90–180 s on Normal; bosses shuffled (Tank/Witch/Nothing, no repeats); designers place *possible* item locations, Director chooses; "Static placement of enemies and loot hinders replayability"; "Structured Unpredictability". | **High** for *pacing and offer timing* (an intensity estimate from PS samplers, relax windows, out-of-sight spawning via `IS_SPHERE_VISIBLE`-class natives, tier C). **Not** for population: GTA's ambient population is engine-owned; the AGM stages only its own few scene entities. |
| RimWorld storytellers [S-11] | PROD / F (wiki) | Event choice from colony wealth, building wealth, colonist/animal counts, recent death or injury, time since last major event; threat scale by difficulty; adaptation score grows over time and drops on damage; population-intent curves. | **Medium**: a world-state-driven *opportunity selector* (time since last experience, player's recent intensity, Nathan's state, location) is the right shape for #20's "when to offer". |
| F.E.A.R. GOAP, Orkin 2006 [S-12] | PROD / F | STRIPS-like world-state array, A* over actions with costs, goals compete by priority, only three FSM states (Goto/Animate/UseSmartObject); squad behaviours emerge; dialogue chosen after the decision to explain it. | **Medium**: actor policies for scene NPCs (guard/flee/chase) can be small goal/action sets *if* LSA owns the actor; dialogue-after-decision is how AGM narration should work (speech explains verified state, never asserts it). |
| HTN in shipped games (Humphreys, *Game AI Pro*) [S-36]; Fluid HTN [S-37] | PROD / S; OSS / F | Hierarchical task decomposition for NPC behaviour; Fluid HTN is a C# total-order forward-decomposition planner (MIT). | **Medium-high** as an *execution* layer for scene-actor policies in C# (RPH plugin language); not as the experience *designer* (HTNs need authored methods). |
| Façade drama manager (Mateas & Stern 2005) [S-15] | PUB / S | Beat-based drama manager sequencing authored dramatic beats. | **Low** directly (hand-authored beats) but the *beat* abstraction matches C-11 speech beats. |
| Nemesis system, *Shadow of Mordor* [S-46] | PROD + patent US 10,926,179 / A | Persistent enemies whose hierarchy, names and appearance change with player actions and who remember the player. | **Design caution**: persistent rival consequences are in scope for #20/#23, but if LSA were ever distributed, avoid cloning patented hierarchy mechanics (this is not legal advice). |
| *Caves of Qud* history generation (Grinblat & Bucklew 2017; GDC talk) [S-47] | PUB+PROD / S | Generates events, then rationalises them into mythic biographies. | **Medium** for consequences: generate *verified* events first, narrate their meaning afterwards (inverse of narration-first). |
| Ubisoft *Teammates* (21 Nov 2025) [S-48] | PROD research / F | Playable generative-AI research project: voice-commanded squadmates and an assistant (highlight enemies, lore, settings); writers keep "fences that let NPCs improvise within the world but stay within the boundaries of the lore". Control mechanism not disclosed. | **Supports** the bounded-improvisation posture; offers no evidence about generated *missions*. |
| AI Dungeon memory FAQ [S-49] | PROD / F | Context-window limits; "Memory" mitigation "is not guaranteed to work 100 % of the time". | **Negative lesson**: model memory is not game state. The AGM keeps state in a ledger, not in prompts. |

## 3. Interactive narrative and experience management

| Source | Class / depth | Key result | Transfer |
| --- | --- | --- | --- |
| Riedl & Bulitko 2013, *Interactive Narrative: An Intelligent Systems Approach* [S-13] | PUB / F | Experience manager = omniscient, disembodied agent that monitors and intervenes; tension between authorial intent and player agency; **boundary problem** (e.g., the player kills an NPC needed later); strategies **intervention** vs **accommodation**. | **Core vocabulary of BQ-3.** The AGM must never "make the gun jam" in GTA (intervention against the player is forbidden by our constraints), so it is accommodation-first. |
| Riedl, Stern, Dini, Alderman 2008, Automated Story Director [S-14] | PUB / F | Daemons report possible plan conflicts; four-tier repair escalation; contingency tree computed *offline* (> 2000 nodes, branching 2.87, depth ≤ 6); authorial **islands**; adaptations sometimes "absurd, obsessive, or frustrating"; players learned to force adaptations; no controlled user study. | **Directly reused**: precompiled accommodations with stake-continuity islands (X-4). **Risk carried forward**: exploitability and repetition must be measured in E3/E6. |
| Riedl & Young 2010, IPOCL (JAIR) [S-18] | PUB / F | Every character action must belong to a *frame of commitment* (goal + motivating step); unexplained actions are "orphans" that must be repaired. | Our critic **H8_ORPHAN** borrows the idea: every spawned actor must serve an objective, rule or deliberate affordance. Character intentionality for scene actors (why the courier flees) is a soft critic. |
| Sabre narrative planner (Ware et al.) [S-23]; Farrell & Ware 2025 [S-22] | PUB + OSS / F | Puppet-master forward search over beliefs/intentions; LLM-guided search helps on most problems but is wording-sensitive. | **Offline only** (CC BY-NC 4.0, Java). Useful as a reference for intentional NPC behaviour in mysteries (#72). |
| Thue et al. 2007, PaSSAGE [S-26] | PUB / F | Player model over five play styles chooses encounter branches; 90 students; results "fail to strongly support either of the hypotheses" (74 % / 71 % confidence for fun / agency). | **Caution for BQ-10**: adaptive selection did not clearly beat fixed stories in the only controlled study found. Fun must be measured, not assumed (E6). |
| Story sifting: Felt (2019), Winnow (2021) [S-34, S-35] | PUB / A | Datalog-style patterns detect "storyful" event sequences; Winnow runs them *incrementally* while events unfold. | **High** for #20: sift the PS event stream for *opportunities* ("player keeps tailing cars", "same gang hit twice") and for callbacks; cheap and deterministic. Code has no licence file → study the idea, do not copy code. |
| Ramírez & Geffner 2009, plan recognition as planning [S-38] | PUB / S | Infers goals from observed actions by comparing plan costs. | **Medium** for BQ-3: recognise abandonment vs a creative alternative route (compare the player's trajectory with the solution shapes the validator already computed). |

## 4. Procedural quests, puzzles, mysteries and novelty measurement

| Source | Class / depth | Key result | Transfer |
| --- | --- | --- | --- |
| Doran & Parberry 2011 [S-16] | PUB / F | 750+ quests from EverQuest (266), Vanguard (137), WoW (205), EVE (145); 9 motivations; strategies of 1–6 actions; recursive BNF; Prolog backtracking avoids quests "for something they already have". | **Medium**: motivations/strategies are a good *seed vocabulary* for the AGM designer, but the actions must bind to GTA fluents, not RPG verbs. |
| Fernández-Vara & Thomson 2012, Puzzle-Dice [S-17] | PUB / F | Backward generation from the reward; solvability by construction (no solver); door-unlock items placed outside guarded areas; repetitive after several playthroughs; ~40 items per game. | **High for #72 mysteries** (X-6 uses solver-guided construction, which extends this with fairness/red-herring checks). |
| Smith & Mateas 2011, ASP for PCG [S-39]; Ludocore 2010 [S-40] | PUB / S, A | Generate content by declaring a design space and constraints for an answer-set solver; Ludocore models game rules in the event calculus to generate traces and answer temporal queries. | **High** as the *formal* home of our validator (clingo, MIT). The offline prototype uses a hand-written BFS; a production validator could compile the IR to ASP. |
| Smith & Whitehead 2010, expressive range [S-19] | PUB / F | Generate ~10 000 levels, score on metrics, plot 2-D histograms; exposed a bias "from a small implementation detail"; a generator producing many "effectively identical" levels is of little value. | **Adopted** in X-3 (pressure × solution-shapes grid) and E6. |
| Mouret & Clune 2015, MAP-Elites [S-20] | PRE / A | Keep the best solution per cell of a user-chosen behaviour space ("illuminating search spaces"). | **Adopted** for the idle-time candidate bench: one elite experience per mechanic-feature cell instead of the "best" one. |
| Yannakakis & Togelius 2011, experience-driven PCG [S-50] | PUB / S | Content generation steered by models of player experience. | Framework for E6 metrics; no transferable model of GTA player experience exists. |
| LLM mystery games (*Vaudeville*, etc.) [S-51] | MOD/PROD / S | Commercial LLM detective games exist; preview coverage criticised AI questioning "to nowhere". | **Cautionary**: free-form LLM interrogation without a ground-truth solver produces unfair mysteries (X-6: 4.4 % of unchecked cases point at an innocent). |

## 5. Language models as planners, designers and game engines

| Source | Class / depth | Key result | Transfer |
| --- | --- | --- | --- |
| Kambhampati et al. 2024, LLM-Modulo (ICML) [S-01] | POS (PUB venue) / F | Generate-test-critique loop; hard critics decide validity, soft critics judge style/preferences; soundness "is inherited from the soundness of the critics". | **The governing pattern** of architecture F. |
| Valmeekam et al., PlanBench (NeurIPS 2023 D&B) [S-02] | PUB / S | Benchmark on which autonomous LLM plans are mostly invalid (≈12 % cited in [S-01]). | Sets expectations for E2 validity rates. |
| Xie et al. 2024, TravelPlanner (ICML) [S-03] | PUB / A | GPT-4 0.6 % final pass rate; failure modes: staying on task, tool use, tracking multiple constraints. | Multi-constraint missions will fail unchecked. |
| Liu et al. 2023, LLM+P [S-04] | PRE / A | LLM translates to PDDL, classical planner solves, LLM translates back; LLM-only planning rarely feasible. | **Supports B/F**: let the model choose *what*, the solver decide *whether*. |
| Ahn et al. 2022, SayCan [S-05] | PRE / A + blog F | Say (usefulness) × can (affordance value function); 101 instructions; 84 % plan / 74 % execution success. | **Capability catalog with evidence tiers is our "can" term**; E0 measures it in GTA. |
| Liang et al., Code as Policies [S-07] | PRE / F | LLM writes policy code over perception/control primitives; hierarchical code-gen; correctness unknowable a priori; lexical filter only. | **Rejected for runtime** (constraint 7); informs #40's offline-generator + review gate. |
| Wang et al. 2023, Voyager [S-06] | PRE + OSS (MIT) / A+F | Automatic curriculum, code skill library, iterative prompting with environment feedback and GPT-4 self-verification; 3.3× more unique items, 2.3× distance, tech tree up to 15.3× faster. | **Partially**: the *curriculum + skill library* idea maps to a *verified capability library* that grows only through E0-style acceptance, never through runtime self-verification. |
| Park et al. 2023, Generative Agents (UIST) [S-08] | PUB + OSS (Apache-2.0) / S + repo F | Memory stream, reflection, planning for 25 sandbox agents; repo notes simulations "can be costly" and rate-limit stalls. | **Not** for scene actors (cost, latency, authority); LSA already has a stronger, evidence-gated memory for promoted characters. |
| Zhu et al. 2023, CALYPSO (AIIDE) [S-09] | PUB / F | LLM tools for D&D DMs over 4 months with 71 players/DMs; "LLMs assist, rather than replace, human DMs"; hallucinated monster traits. | Supports a *human-in-the-loop* posture where the player is co-designer (#23 "let's plan a robbery"). |
| Wang & Kreminski 2025 [S-21] | PRE / F | Causal soundness OK at small scale for strong models; intentionality and conflict hard; clingo calibration 13/30 → 29/30 (GPT-4o). | Solver feedback in the design loop (E2). |
| Farrell & Ware 2025 (IEEE ToG) [S-22] | PUB / F | LLM as search guide; wording sensitivity. | Catalog semantics over names. |
| Yu et al. 2025, RPGBench [S-24] | PRE / A | LLMs as text RPG engines: engaging stories, inconsistent mechanics. | Supports "the world, not the model, runs the mechanics". |
| Cai et al. 2026, Spec2Game [S-25] | PRE / F | 14 models, 3 330 projects; runnable ≠ spec-correct; goals/termination weakest; detailed specs help (50.59 → 68.62); judge swaps reversed 6 of 27 rankings. | Supports "valid JSON ≠ playable" and against LLM-only judging (BQ-10). |
| Vaucher et al. 2026, IVIE (ICCC '26, per proceedings URL) [S-27] | PUB / F | Neuro-symbolic, staged, validated IF world generation; Generate mode 8/8 completions, Inspiration mode 4/8; impossible objectives passed validation; claim-based puzzle bypass; N = 8. | **Closest academic analogue** of architecture F in a text world. |
| Góngora et al. 2026, world-state transformations [S-28] | PRE / A | LLM predicts which *pre-programmed* state transformations player text should trigger; exploratory, 8 participants. | Same pattern as ACT5 consent mapping: model selects, symbolic layer executes. |
| Huang, Li, Fang 2026, *Orchestrated Reality* [S-29] | PRE / A | Singleton GM orchestration agent; PA-POMDP; Plan-Diff-Validate-Apply; schema-validated content-hashed deltas; "15 illustrative incidents", no quantitative results. | Validates the *authority* idea (one owner of world truth); weaker than F on verification (schema checks only). |
| Lehrach et al. 2025, Code World Models (DeepMind) [S-30] | PRE / F | LLM writes an OpenSpiel-style executable model from rules + trajectories, verified with unit tests; MCTS on top; matches/beats Gemini 2.5 Pro as a policy in 9/10 games; Gin rummy poorly learned. | **Pattern for calibrating our abstract twin** from E0 traces. |
| Dong et al. 2026, Mind-Studio [S-31] | PRE / F | LLM-written executable world model for Atari; lookahead previews; "subgoal progress only advances on real-environment states, with rollback to the last verified checkpoint"; deterministic model misses stochastic respawns. | **Same rule as our ledger**: progress only from the real environment; roll back to verified checkpoints. |
| Munk et al. 2026, small LMs for dynamic content [S-52] | PRE / A | Narrowly fine-tuned small model, DAG-generated synthetic data, retry-until-success; "local quality assessment remains an open question". | Supports a provider-agnostic, possibly local *bench generator*; quality must still be checked deterministically. |
| Gallotta et al. 2024, LLMs and Games survey (IEEE ToG) [S-53] | PUB / A | Taxonomy of LLM roles in games; potential and limitations. | Context only. |
| Structured-output decoding (vendor announcements, 2024) [S-54] | CLAIM / S | Schema adherence via constrained decoding. | Guarantees *shape*, not *semantics*: X-1 shows ~30 % of schema-valid specs unsolvable. |

## 6. Neural / generative game worlds

| Source | Class / depth | Key result | Transfer |
| --- | --- | --- | --- |
| Genie 3 (Google DeepMind, Aug 2025) [S-32] | CLAIM (vendor research preview) / A | 720p, 24 fps, consistency for "a few minutes", visual memory ~1 min, promptable world events; constrained action space; multi-agent interaction an open challenge; limited preview. | **Rejected as GM** (architecture H): cannot observe or control GTA's state; would replace GTA rather than orchestrate it. |
| GameNGen, Valevski et al. (ICLR 2025) [S-33] | PUB / A | Diffusion model simulates DOOM at ~20 fps on one TPU; PSNR 29.4; human raters near chance on short clips. | Same rejection; no state authority. |

## 7. Planning, verification and solver tooling

| Source | Class / depth | Role in an AGM |
| --- | --- | --- |
| SHOP2 (Nau et al., JAIR 2003) [S-55] | PUB / S | Reference HTN planner semantics. |
| Fluid HTN [S-37] | OSS (MIT, C#) / F | Candidate executor for scene-actor policies inside a C# RPH plugin (E0/E4), not a designer. |
| clingo / Potassco [S-56] | OSS (MIT) / F | Candidate production validator backend (IR → ASP), offline or out-of-process. |
| Fast Downward [S-57] | OSS (GPL-3.0) / F | PDDL planning research only; GPL-3.0 makes linking into a distributed plugin a licensing decision. |
| Runtime verification (Leucker & Schallhart 2009) [S-58] | PUB / S | Monitors over finite traces with three-valued verdicts (true / false / inconclusive) — the formal analogue of our objective evidence ladder (X-5). |

## 8. GTA V / RAGE ecosystem prior art

| Project | Class / depth | Mechanism | What it proves / does not |
| --- | --- | --- | --- |
| Essential (Los Santos Alive Hotfix #3) generated callouts | proprietary; repo audit ([01 §2.6](01-current-lsa-capability-audit.md)) | LLM JSON scene grounded in real activity points, closed action enum, validate → regenerate once → deterministic repair → expand into an LSPDFR callout. | Proves the upstream author already treats "LLM proposes, validator disposes" as necessary. Unusable on this install (no LSPDFR); proprietary — design study only. |
| GPT Callouts (LCPDFR, Feb 2023) [S-43] | MOD / F | "only the classes were generated by GPT" (author comment). | Offline code generation, hand-integrated. Not runtime generation. |
| ProcedurallyGeneratedMissions 0.1.2 (Jan 2025) [S-41] | MOD / F | Missions from lists of maps × objectives (steal car / steal object / kill person); comments report unhandled exceptions at mission start. | Template randomisation — the baseline X-3 calls "template". |
| LIQUIDATOR v1.02 (Sep 2021) [S-42] | MOD / F | Random assassination targets with type, morale, weapon training, bodyguards, ambush squads. | Parameterised single archetype; good example of *pressure parameters*. |
| Sentience (Nexus GTA V Enhanced mod 503, 2026) [S-44] | MOD / F | Local-LLM NPC overhaul (memory, emotions, archetypes, TTS, voice input, JSON scenario engine); no generated missions; ScriptHookV/SHVDN. | AI conversation and reactions, not gameplay invention; shows SHVDN-based LLM mods run on Enhanced. |
| Sentient Streets / Inworld storyline (Aug 2023) [S-45, S-59] | MOD / F | Hand-crafted storyline with ~30 Inworld-driven NPCs and ElevenLabs voices; taken down after Take-Two copyright claims (Aug 2023). | AI dialogue over authored missions; **distribution risk precedent** for AI mods. |
| LSPDFR callout packs (various) [S-60] | MOD / S | Hand-authored callouts. | Rich authored mechanics; no generation. |
| Rockstar Mod Guidelines (dated 2026-09-10) | policy / via ASTRA-001 S-12 | Non-commercial; no software interfering with online services; Rockstar may take mods down. | AGM research stays single-player, local and undistributed ([ASTRA-001 doc 01 §3.10](../astra-001/01-current-capability-and-engine-evidence.md)). |

## 9. Licensing and reuse

| Component | Licence | Language | Recommended use |
| --- | --- | --- | --- |
| clingo (Potassco) [S-56] | MIT | C++/Python | OK to embed or run out-of-process as a validator backend. |
| Fluid HTN [S-37] | MIT | C# | OK for scene-actor behaviour in an LSA plugin. |
| Voyager [S-06] | MIT | Python/JS | Ideas only (Minecraft-specific). |
| Generative Agents [S-08] | Apache-2.0 | Python | Ideas only. |
| Fast Downward [S-57] | GPL-3.0 | C++/Python | Research only unless the owner accepts GPL obligations. |
| Sabre [S-23] | CC BY-NC 4.0 | Java | Non-commercial research only; not in shipped code. |
| Felt / Winnow [S-34, S-35] | no licence file (all rights reserved by default) | JavaScript | Re-implement the published idea; do not copy code. |
| Essential / Los Santos Alive upstream | proprietary | C#/JS | Study design via documented APIs; never copy code or prompts. |
| This dossier's offline experiments | repository licence | Python (stdlib) | Research prototypes; not production code. |

## 10. Transfer matrix: which evidence answers which Game Master problem

| AGM problem | Best external evidence | Transfers to GTA V Enhanced? | Why / what is missing |
| --- | --- | --- | --- |
| Turning an idea into an executable spec (BQ-1) | LLM-Modulo, LLM+P, IVIE, Orchestrated Reality | **Partly** | All assume the symbolic layer *is* the world (text worlds, PDDL). In GTA the world is an external engine: the symbolic layer is only a *model* of it and must be calibrated (E0) and monitored (E1). |
| Rejecting impossible objectives (BQ-2) | SayCan "can" scores, Puzzle-Dice construction, ASP | **Partly** | Affordance knowledge for GTA is the capability catalog; today it is mostly tier C (desk-audited, unmeasured). |
| Real-time improvisation (BQ-3) | Intervention/accommodation, ASD contingency trees, islands | **Yes structurally** | Must be accommodation-only (no player intervention); runtime choices precompiled; repetition/exploitation risk documented. |
| World-level situation model (BQ-4) | L4D AAS + intensity; RimWorld storyteller inputs; story sifting | **Yes** | LSA already samples the needed facts for NPC knowledge; the AGM needs a separate world-level read model (doc 04 §8). |
| Novelty (BQ-5) | Expressive range, MAP-Elites, Puzzle-Dice repetition lesson | **Yes (method)** | No metric exists for multi-stage open-world missions; X-3 proposes an IR-level mechanical signature. |
| Objective verification (BQ-6) | Runtime verification; Mind-Studio "real-environment states only"; IVIE claim bypass | **Yes (method)** | GTA sensor reliability is unknown (E0/E1). |
| Emergent narrative with consequences (BQ-7) | Story sifting, Caves of Qud, Nemesis | **Partly** | Persistence must respect LSA's save-lineage rules (TimelineGuard); patents if distributed. |
| Multi-actor coordination (BQ-8) | GOAP squads, HTN, *Orchestrated Reality* singleton owner | **Partly** | GTA ambient AI and Essential's reflexes are third-party controllers; no literature covers coexisting with them. |
| No arbitrary code (BQ-9) | Code as Policies / Voyager limits; ASP declarative generation | **Yes** | Declarative composition is well precedented; runtime code generation is not safe. |
| Fun (BQ-10) | L4D pacing, PaSSAGE (weak result), Spec2Game judge instability | **Partly** | Only human play can answer it; controlled studies are rare and small. |

## 11. Design rules adopted from the evidence

| Rule | Statement | Sources |
| --- | --- | --- |
| R1 | The model proposes; deterministic critics and then the world dispose. | S-01, S-04, S-27, S-29 |
| R2 | Objectives are formulas over sensed fluents; prose, claims and acknowledgements are never evidence. | S-27, S-29, S-31, D-017 |
| R3 | Every capability carries an affordance/evidence tier; compile modes decide which tiers are allowed. | S-05, ASTRA-001 |
| R4 | Adaptation is precompiled where possible; runtime chooses among validated alternatives. | S-10, S-14 |
| R5 | Accommodations must preserve the experience's *stakes* (islands), or end it gracefully. | S-14, X-4 |
| R6 | Pace by frequency and timing, offer rather than impose, protect relax windows. | S-10, S-11 |
| R7 | Measure novelty on mechanics, not wording; keep an archive across mechanic cells. | S-19, S-20, S-17 |
| R8 | Logic-bearing content (mysteries, puzzles) is solver-checked at construction. | S-17, S-39, X-6 |
| R9 | No runtime code generation in the play loop; code generation only offline, reviewed, for #40. | S-07, S-06 |
| R10 | Expensive inference happens at idle/design time; the runtime is deterministic and budgeted. | S-10, S-52 |
| R11 | The abstract twin is calibrated against recorded GTA traces and is never trusted over live evidence. | S-30, S-31 |
| R12 | Fun and novelty are judged by the player (blind comparisons), not by a model judging itself. | S-25, S-26, brief §7 BQ-10 |

## 12. What the literature does not answer (ASTRA-002 must test it)

1. **No published evidence of LLM-generated physical gameplay inside a commercial open-world engine with an independent executor and third-party AI controllers.** Every verified system controls its whole world (text worlds, Minecraft, Atari, PDDL).
2. **Coexistence with foreign AI controllers** (GTA ambient AI, police dispatch, Essential's reflexes and conversations) is unstudied. This is a GTA/LSA-specific unknown (E0.2, E0.6).
3. **Player perception of accommodation vs live re-planning in open-world action** has no controlled data; ASD reports only anecdotes.
4. **Fun evaluation of generated missions** rests on small studies (N = 8 in IVIE; PaSSAGE inconclusive at N = 90).
5. **Mechanical novelty metrics for multi-stage open-world missions** do not exist; X-3's metric is a proposal.
6. **Persistent consequences of generated content under save/reload** in a single-player sandbox are unaddressed outside LSA's own TimelineGuard design.

## 13. Source register

All accessed 2026-10-19.

| ID | Source | Class / depth |
| --- | --- | --- |
| S-01 | Kambhampati et al., "Position: LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks", ICML 2024, PMLR 235 — https://arxiv.org/abs/2402.01817 ; https://arxiv.org/html/2402.01817v2 ; https://proceedings.mlr.press/v235/kambhampati24a.html | POS (PUB) / F |
| S-02 | Valmeekam et al., "PlanBench", NeurIPS 2023 Datasets & Benchmarks — https://arxiv.org/abs/2206.10498 | PUB / S |
| S-03 | Xie et al., "TravelPlanner: A Benchmark for Real-World Planning with Language Agents", ICML 2024 — https://arxiv.org/abs/2402.01622v2 ; https://proceedings.mlr.press/v235/xie24j.html | PUB / A |
| S-04 | Liu et al., "LLM+P: Empowering Large Language Models with Optimal Planning Proficiency", 2023 — https://arxiv.org/abs/2304.11477v3 | PRE / A |
| S-05 | Ahn et al., "Do As I Can, Not As I Say: Grounding Language in Robotic Affordances", 2022 — https://arxiv.org/abs/2204.01691 ; https://research.google/blog/towards-helpful-robots-grounding-language-in-robotic-affordances/ | PRE / A + blog F |
| S-06 | Wang et al., "Voyager: An Open-Ended Embodied Agent with Large Language Models", 2023 — https://arxiv.org/abs/2305.16291v2 ; code https://github.com/MineDojo/Voyager (MIT) | PRE + OSS / A+F |
| S-07 | Liang et al., "Code as Policies: Language Model Programs for Embodied Control" — https://arxiv.org/pdf/2209.07753 | PRE / F |
| S-08 | Park et al., "Generative Agents: Interactive Simulacra of Human Behavior", UIST 2023 — https://arxiv.org/pdf/2304.03442v1 ; code https://github.com/joonspk-research/generative_agents (Apache-2.0) | PUB + OSS / S + repo F |
| S-09 | Zhu et al., "CALYPSO: LLMs as Dungeon Masters' Assistants", AIIDE 2023 — https://arxiv.org/pdf/2308.07540 ; https://ojs.aaai.org/index.php/AIIDE/article/view/27534 | PUB / F |
| S-10 | Booth, "The AI Systems of Left 4 Dead", Valve, 2009 — https://cdn.fastly.steamstatic.com/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf | PROD / F |
| S-11 | RimWorld Wiki, "AI Storytellers" — https://rimworldwiki.com/wiki/AI_Storytellers | PROD / F |
| S-12 | Orkin, "Three States and a Plan: The A.I. of F.E.A.R.", GDC 2006 — https://pages.cs.wisc.edu/~dyer/cs540/handouts/gdc2006_orkin_jeff_fear.pdf | PROD / F |
| S-13 | Riedl & Bulitko, "Interactive Narrative: An Intelligent Systems Approach", AI Magazine 2013 — https://faculty.cc.gatech.edu/~riedl/pubs/aimag.pdf | PUB / F |
| S-14 | Riedl, Stern, Dini, Alderman, "Dynamic Experience Management in Virtual Worlds for Entertainment, Education, and Training", ITSSA 2008 — https://www.cs.uky.edu/~sgware/reading/papers/riedl2008dynamic.pdf | PUB / F |
| S-15 | Mateas & Stern, *Façade* beat-based drama manager, AIIDE 2005 — proceedings PDF returned by search (https://cdn.aaai.org/AIIDE/2005/AIIDE05-016.pdf; title not re-verified in this session); overview https://en.wikipedia.org/wiki/Fa%C3%A7ade_(video_game) | PUB / S |
| S-16 | Doran & Parberry, "A Prototype Quest Generator Based on a Structural Analysis of Quests from Four MMORPGs", PCG 2011 — https://ianparberry.com/pubs/pcg2011.pdf | PUB / F |
| S-17 | Fernández-Vara & Thomson, "Procedural Generation of Narrative Puzzles in Adventure Games: The Puzzle-Dice System", PCG 2012 — https://pcgworkshop.com/archive/fernández-vara2012procedural.pdf | PUB / F |
| S-18 | Riedl & Young, "Narrative Planning: Balancing Plot and Character", JAIR 2010 — https://arxiv.org/pdf/1401.3841 ; https://www.doi.org/10.1613/JAIR.2989 | PUB / F (partial) |
| S-19 | Smith & Whitehead, "Analyzing the Expressive Range of a Level Generator", PCG 2010 — https://www.pcgworkshop.com/archive/smith2010analyzing.pdf | PUB / F |
| S-20 | Mouret & Clune, "Illuminating search spaces by mapping elites", 2015 — https://arxiv.org/abs/1504.04909 | PRE / A |
| S-21 | Wang & Kreminski, "Can LLMs Generate Good Stories? Insights and Challenges from a Narrative Planning Perspective", 2025 — https://arxiv.org/html/2506.10161v1 | PRE / F |
| S-22 | Farrell & Ware, "Large Language Models as Narrative Planning Search Guides", IEEE Transactions on Games 17(2), 2025 — https://www.cs.uky.edu/~sgware/reading/papers/farrell2024large.pdf | PUB / F |
| S-23 | Ware et al., Sabre narrative planner — https://www.cs.uky.edu/~sgware/projects/sabre ; AIIDE paper https://ojs.aaai.org/index.php/AIIDE/article/view/18896 | OSS (CC BY-NC 4.0) + PUB / F (project page) |
| S-24 | Yu et al., "RPGBench: Evaluating Large Language Models as Role-Playing Game Engines", 2025 — https://arxiv.org/abs/2502.00595 | PRE / A |
| S-25 | Cai et al., "Spec2Game: Can LLMs Generate Complete Playable Games from Detailed Specifications?", 2026 — https://arxiv.org/html/2610.04253v1 | PRE / F |
| S-26 | Thue, Bulitko, Spetch, Wasylishen, "Interactive Storytelling: A Player Modelling Approach" (PaSSAGE), AIIDE 2007 — https://cdn.aaai.org/ojs/18780/18780-52-22477-1-10-20210929.pdf | PUB / F |
| S-27 | Vaucher, Silveira, Góngora, Chiruzzo, "IVIE: A Neuro-symbolic Approach to Incremental and Validated Generation of Interactive Fiction Worlds", ICCC 2026 (venue inferred from the proceedings URL; not printed on the page) — https://computationalcreativity.net/iccc26/papers/ICCC26_paper_47.pdf | PUB / F |
| S-28 | Góngora, Chiruzzo, Méndez, Gervás, "World-State Transformations for Neuro-symbolic Interactive Storytelling", 2026 — https://www.alphaxiv.org/abs/2605.24719 | PRE / A |
| S-29 | Huang, Li, Fang, "Orchestrated Reality: From Role-Play to Living, Playable Game Worlds — LLM-Driven World Simulation as a Parameterized-Action POMDP", June 2026 — https://arxiv.org/abs/2606.16014 | PRE / A |
| S-30 | Lehrach et al., "Code World Models for General Game Playing", Google DeepMind, Oct 2025 — https://arxiv.org/html/2510.04542v1 | PRE / F |
| S-31 | Dong et al., "Mind-Studio: Executable World Models with Lookahead Evaluation for Partially Observable Games", 2026 — https://arxiv.org/pdf/2606.16070 | PRE / F |
| S-32 | Google DeepMind, "Genie 3: A new frontier for world models", Aug 2025 — https://deepmind.google/blog/genie-3-a-new-frontier-for-world-models/ | CLAIM / A |
| S-33 | Valevski et al., "Diffusion Models Are Real-Time Game Engines" (GameNGen), ICLR 2025 — https://arxiv.org/abs/2408.14837v1 | PUB / A |
| S-34 | Kreminski, Dickinson, Wardrip-Fruin, "Felt: A Simple Story Sifter", ICIDS 2019 (cited in https://ceur-ws.org/Vol-2862/paper18.pdf); code https://github.com/mkremins/felt | PUB / A |
| S-35 | Kreminski, Dickinson, Mateas, "Winnow: A Domain-Specific Language for Incremental Story Sifting", AIIDE 2021 — https://ojs.aaai.org/index.php/AIIDE/article/view/18903 ; code https://github.com/mkremins/winnow | PUB / A |
| S-36 | Humphreys, "Exploring HTN Planners through Example", Game AI Pro (2013) | PROD / S |
| S-37 | Fluid Hierarchical Task Network — https://github.com/ptrefall/fluid-hierarchical-task-network (MIT, C#) | OSS / F |
| S-38 | Ramírez & Geffner, "Plan Recognition as Planning", IJCAI 2009 — https://www.ijcai.org/Abstract/09/296 | PUB / S |
| S-39 | Smith & Mateas, "Answer Set Programming for Procedural Content Generation: A Design Space Approach", IEEE TCIAIG 2011 — https://course.ccs.neu.edu/cs5150f14/readings/smith_asp4pcg.pdf | PUB / S |
| S-40 | Smith, Nelson, Mateas, "Ludocore: A Logical Game Engine for Modeling Videogames", IEEE CIG 2010 — https://www.kmjn.org/publications/Ludocore_CIG10-abstract.html | PUB / A |
| S-41 | ProcedurallyGeneratedMissions (PGM) 0.1.2 — https://www.gta5-mods.com/fi/scripts/procedurallygeneratedmissions-pgm-0-1-0 | MOD / F |
| S-42 | LIQUIDATOR: Random Assassination Mission Generator v1.02 — https://www.gta5-mods.com/de/scripts/liquidator-random-assassination-mission-generator | MOD / F |
| S-43 | GPT Callouts (LCPDFR file 42923) — https://www.lcpdfr.com/files/file/42923-gpt-callouts/ | MOD / F |
| S-44 | Sentience (Nexus Mods, GTA V Enhanced mod 503) — https://www.nexusmods.com/gta5enhanced/mods/503 | MOD / F |
| S-45 | Wccftech, "New GTA V Mod Adds a Whole Storyline Powered by Inworld AI's Dynamic NPCs", 4 Aug 2023 — https://wccftech.com/new-gta-v-mod-adds-a-whole-storyline-powered-by-inworld-ais-dynamic-npcs/amp/ | MOD / F |
| S-46 | MCV/DEVELOP, "Warner Bros secures patent for the Nemesis System" — https://www.mcvuk.com/business-news/warner-bros-secures-patent-for-the-nemesis-system-from-shadow-of-mordor/ ; patent listing https://www.patentarcade.com/video-game-patent/US10926179/nemesis-characters-nemesis-forts-social-vendettas-and-followers-in-computer-games | PROD + patent / A |
| S-47 | Grinblat & Bucklew, "Subverting historical cause & effect: generation of mythic biographies in Caves of Qud", FDG 2017; GDC talk https://gdcvault.com/play/1024990/Procedurally-Generating-History-in-Caves | PUB + PROD / S |
| S-48 | Ubisoft, "Ubisoft Reveals Teammates: An AI Experiment to Change the Game", 21 Nov 2025 — https://news.ubisoft.com/en-us/article/3mWlITIuWuu0MoVuR6o8ps/ubisoft-reveals-teammates-an-ai-experiment-to-change-the-game | PROD (research) / F |
| S-49 | AI Dungeon help, "Why does the AI forget or mix things up?" — https://help.aidungeon.io/faq/why-does-the-ai-forget-or-mix-things-up | PROD / F |
| S-50 | Yannakakis & Togelius, "Experience-Driven Procedural Content Generation", IEEE Trans. Affective Computing 2011 — https://pure.itu.dk/en/publications/experience-driven-procedural-content-generation/ | PUB / S |
| S-51 | KeenGamer, "Vaudeville preview: the AI questioning to nowhere" — https://www.keengamer.com/articles/previews/vaudeville-preview-the-ai-questioning-to-nowhere/ | CLAIM / S |
| S-52 | Munk, Valdivia, Burelli, "High-quality generation of dynamic game content via small language models: A proof of concept", 2026 — https://www.alphaxiv.org/abs/2601.23206 | PRE / A |
| S-53 | Gallotta et al., "Large Language Models and Games: A Survey and Roadmap", IEEE Transactions on Games (DOI 10.1109/TG.2024.3461510) — https://arxiv.org/abs/2402.18659v5 | PUB / A |
| S-54 | Structured-output / constrained-decoding announcements (e.g., OpenAI, Aug 2024) — https://www.okoone.com/spark/technology-innovation/openai-launches-structured-outputs-now-available-via-api/ | CLAIM / S |
| S-55 | Nau et al., "SHOP2: An HTN Planning System", JAIR 2003 — https://arxiv.org/abs/1106.4869 | PUB / S |
| S-56 | clingo — https://github.com/potassco/clingo (MIT) | OSS / F |
| S-57 | Fast Downward — https://github.com/aibasel/downward (GPL-3.0) | OSS / F |
| S-58 | Leucker & Schallhart, "A Brief Account of Runtime Verification", J. Logic and Algebraic Programming 78(5), 2009 — https://isp.uni-luebeck.de/node/453 | PUB / S |
| S-59 | Rockstar Intel, "Viral AI GTA V mod shutdown by Take-Two", 18 Aug 2023 — https://rockstarintel.com/viral-ai-gta-v-mod-shutdown-by-take-two/ | CLAIM (press) / F |
| S-60 | LCPDFR callout catalogue examples — https://www.lcpdfr.com/downloads/gta5mods/scripts/53942-la_callouts/ | MOD / S |
