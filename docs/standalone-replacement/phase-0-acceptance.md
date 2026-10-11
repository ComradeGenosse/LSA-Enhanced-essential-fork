# Phase 0 — final research and evidence register

**Result: RESEARCH COMPLETE / EXTERNAL GTA BASELINE AND PHYSICAL VALIDATION GATED.**  
**Current \`main\` research pin:** \`79a0aa6eb5f6b655afde65993d5d68cba269bca7\` (2026-10-11).  
**Independent code implementation:** not started. **GTA installation or real-world playback testing:** none performed.

Phase 0 answers the architectural questions needed to start Phase 1. No source-only investigation can certify the contents of the user's actual game installation, physical spatial speech, native task results or lip sync. Those are explicitly deferred to the corresponding GTA/deployment gate, not represented as successes.

## Research-gate disposition

| Gate | Phase 0 disposition | Concrete evidence / remaining boundary |
| --- | --- | --- |
| P0-01 — pinned repository baseline | **PASS** | Recorded exact \`main\` SHA, date and working-v1 scope in [baseline](phase-0-baseline.md) |
| P0-02 — pinned Essential DLL / stock server | **PASS** | DLL SHA-256 \`9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653\`; stock bundle \`5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2\`; reproducible native research catalog |
| P0-03 — implementation phases/offline and GTA gates | **PASS** | [10-phase roadmap](roadmap.md) and independent Milestones A/B/C |
| P0-04 — Essential ownership/dependency source map | **PASS at source/design level** | [baseline](phase-0-baseline.md), [protocol map](phase-0-protocol-audio.md), full-source CI census; runtime-private behavior is explicitly uncertain |
| P0-05 — desired feature parity matrix | **PASS as initial scope freeze** | [feature matrix](feature-parity-matrix.md): Milestone A typed conversation/audio; later PTT, P2, ACT and PS; deferrals documented |
| P0-06 — current branch state separated | **PASS snapshot** | Draft #32 radio / #35 contextual ballistics / #37 C-01 not assumed merged or deployed |
| P0-07 — full direct/reflective candidate inventory | **PASS automated census / bounded static review** | \`phase0-inventory.mjs\` and \`phase0-static-review.mjs\` scan **all production source files** (C#, csproj, .mjs) and emit file/line references, direct native method-call candidates, dynamic/reflection review families; CI keeps JSON evidence. Obfuscated private runtime, dynamic reflection/IL aliasing and actual effects **cannot be proven exhaustive** by textual scanning; adapter-specific implementation review remains Phase 1–4. |
| P0-08 — original server and protocol lifecycle | **PASS logical/contract audit** | [stock patch and proposed contract analysis](phase-0-protocol-audio.md): original 70-edit build, turn/session/audio identities, typed/mic/special source, provider events, completion, history, disconnect and cancellation. Not equivalent to running an independent transport. |
| P0-09 — exact installed GTA baseline and rollback | **EXTERNAL PREDEPLOYMENT GATE** | Safe passive PowerShell fingerprints and rollback protocol in [game baseline](phase-0-gta-baseline.md). Cannot access local installation in this session. Required before Phase 5 game deployment; **not a Phase 1 blocker**. |
| P0-10 — representative physical baseline logs | **EXTERNAL PREDEPLOYMENT GATE** | 10 game scenarios E-01–E-10 specified in [game baseline](phase-0-gta-baseline.md). Real logs must be captured at installed payload versions; no GTA tests have been performed. |
| P0-11 — spatial audio/native hosting technical feasibility | **PASS technology decision / PHYSICAL SPIKE DEFERRED** | IL confirms \`NpcSpatialAudio\` calls NAudio \`WaveOutEvent\`; existing RAGE plugin host is source-proven. [Host/audio research](phase-0-audio-host-licensing.md) selects NAudio **2.x** as the first independent candidate. Actual Windows output, spatialization and lip sync are Phase 4/5 gates, **not passed**. |
| P0-12 — MVP retain/omit decisions | **PASS for Milestone A proposal** | Typed request, strict turn identity, audible NPC TTS and history verification first. Gemini/optional LSPDFR/PR/hostage flows excluded. For Milestone B/C no action is silently lost: unsupported and deferred scope remains visible in the matrix. |
| P0-13 — licensing/dependency rules | **PASS constraints recorded / package sign-off later** | [Rights assessment](phase-0-audio-host-licensing.md): use independently authored source; do not redistribute Essential/RPH proprietary binaries; NAudio 2.x and RAGENativeUI documented licenses. Concrete package bill-of-materials and redistribution sign-off needed when code/dependencies are selected. |
| P0-14 — architecture ownership and decision compatibility | **PASS staged-authority proposal** | The new native core is mutually exclusive with Essential at runtime. Existing D-001/D-012/D-016 remain the current production contract until explicit migration acceptance. A new runtime design must pass separate review before \`main\` cutover; no historical locks silently rewritten. |
| P0-15 — offline evidence strategy and first coding handoff | **PASS at test-design level** | Existing 76 Node test files, numerous .NET stub/interop suites; new scanner unit tests and GitHub Actions complete successfully on PR. [Milestone A protocol](phase-0-protocol-audio.md) describes exact native↔Node tests. **Independent native package build will be Phase 1**, not retroactively marked completed. |

## Offline evidence produced in this PR

- \`node --test tools/standalone/phase0-inventory.test.mjs tools/standalone/phase0-static-review.test.mjs\`: deterministic fixture tests for parsing, ignored test/vendor trees, every production file in the census, line references, dynamic review warnings, missing root errors.
- \`node tools/standalone/phase0-inventory.mjs\`: produces source-path and line-based candidate rule matches plus the complete scanned source list.
- \`node tools/standalone/phase0-static-review.mjs\`: produces known direct Essential member callsites, reflection/stock patch review families, proof caveats, paths and line indexes.
- \`.github/workflows/standalone-phase0.yml\`: runs both tests and a full repo census, enforces source-coverage floor and archives reports as **standalone-phase0-dependency-inventory**. CI source/fixture PASS only; no GTA, Windows output or native game DLL loaded.

The scanner outputs are evidence aids; direct textual matches do not establish runtime control flow or eliminate unknown reflective use. Scoped stock-patch behavior was separately inspected in production Node source. **No claimed semantic exhaustiveness or game equivalence.**

## Remaining *external or implementation*, not Phase 0 research, gates

1. **Before Milestone A game deployment:** run \`capture-installed-baseline.ps1\` in the user-controlled game installation, verify known-good backup/restore and collect selected gameplay traces using [game baseline checklist](phase-0-gta-baseline.md). Do not copy private settings/keys, stock game assets or proprietary Essential code into PR.
2. **During Phases 1–2:** build real independent \`net481\` CLR/RAGE package, ensure zero Essential references, establish game-fiber ownership and mutual-exclusion startup, and run actual two-process protocol interoperability. A compile-time test without an Essential reference is not itself a runtime no-load proof.
3. **During Phases 3–4:** implement the real typed source/turn and independent Windows audio output, test signal/device failures, bound queues, EOS, cancellation and physical-adapter off-thread safety.
4. **At Phase 5:** run actual GTA speech, speaker-position, lip-sync/gaze, input, interruption and rollback smoke. **Only this closes physical acceptance.**
5. **At later phase implementation:** review migrated radio (#32), ballistics (#35) and C-01 (#37) code against newest \`main\`, preserve user-facing capabilities, and verify each action's physical postcondition in GTA.

## Phase 1 handoff — accepted research architecture

The first implementation PR may now define independent interfaces \`IGameClock\`, \`IActorResolver\`, \`IGameWorld\`, \`IInputSource\`, \`IAudioOutput\`, \`IActionExecutor\`; a new run/world epoch and actor incarnation model; a deterministic fake scheduler; and direct baseline/static symbol auditing. Do **not** modify the existing Essential production DLL, stock patched Node launcher or the GTA installation to begin this work.

**Final state:** research/design questions resolved sufficiently for coding; **not a claim that every original Essential side effect is understood**. Phase 0 can be closed as **research-complete / GTA-deployment-gated**. Leave this PR in draft unless intentionally accepting those distinctions.
