# LSA Enhanced — System Convergence Architecture

> **Corpus status note:** The architecture, ownership conclusions, contract IDs and convergence rationale in this report remain authoritative. Its pinned refs, branch relationships, test counts and deployment/status tables are a historical snapshot of the audit run on October 5, 2026. Use [CURRENT.md](CURRENT.md) for current research interpretation and [../ROADMAP.md](../ROADMAP.md) for current merged/built/deployed/GTA-validated state.


Research report. **No runtime code, configuration or gameplay behavior is changed by this branch.**

| | |
|---|---|
| Date | 2026-10-05 |
| Branch | `research/system-convergence-architecture-20261005` |
| Base | `origin/main@8c63b20492fbf6bc2e1ba98acc598259c22a57fe` |
| Companion documents | [ownership matrix](system-ownership-matrix.md) · [contract register](system-contract-register.md) · [risk register](system-convergence-risks.md) · [dependency graph](system-convergence-dependency-graph.md) · [evidence JSON](system-convergence-evidence.json) · [contracts JSON](system-contracts.v1.json) |
| Method | Source and Git history on every relevant branch, the local branches and staging/deployment receipts on the developer machine, existing research evidence (PE/CLR metadata, pinned IL cross-references recorded by earlier audits), offline test runs. GTA was **not** launched. |

Evidence labels are used exactly as follows:

- **PROVEN**: read directly in current source, a pinned binary analysis already recorded with offsets, a Git object, a test run performed for this audit, or a deployment receipt.
- **STRONGLY SUPPORTED**: several consistent sources, but the deciding runtime behavior has not been observed.
- **INFERRED**: follows from proven facts, not observed.
- **PROPOSED**: the canonical design this report recommends.
- **UNKNOWN**: needs a GTA probe or evidence that does not exist yet.

Evidence references such as `E06` point into [system-convergence-evidence.json](system-convergence-evidence.json). Risk IDs such as `R-03` point into [system-convergence-risks.md](system-convergence-risks.md). Contract IDs such as `C-01` point into [system-contract-register.md](system-contract-register.md).

---

## 0. The answer

> If we build the complete current roadmap as presently designed, will all systems compose cleanly into a single safe architecture?

**Not as currently drawn, but close.** The core is sound and should be locked: Essential stays the only native executor, P0/P1/P2 give a correct identity and persistence spine, PS0–PS3 give a correct evidence pipeline, and ACT0–ACT2 give a correct execution lifecycle that dispatches only through Essential. Nothing requires replacing Essential, rewriting P2, or redesigning PS3 or ACT.

The roadmap does carry **ten convergence defects**. Each has a narrow fix, and most get much more expensive after the next feature wave:

1. **"The player spoke" has seven representations (five in code, two in plans) and no shared identifier.** Today the companion hands perception `receipt: null` (`E05`). One source-time utterance lifecycle with an `utteranceId` join is the most valuable missing contract (`C-01`, `R-01`).
2. **No epistemic firewall exists in the live prompt path.** Raw Essential context is serialized, P2's canon projection is already a second writer, and three more writers are planned (PS4, an ACT4 block, a radio projection). One turn-knowledge assembler with lanes must exist before any of the planned writers ships (`C-04`, `R-02`).
3. **There are three run-local anchor tables for the same peds** (PS `EntityAnchors`, ACT2's private capture table, P2 `Encounter`). ACT2 diverged from its own research, which named `EntityAnchors.Resolve`. Because of this, the Director cannot hand ACT a perceived entity (`C-02`, `R-03`).
4. **UX4 clears Essential's `PlayerConversationPed` at PTT release.** This is still true at `feature/ux4-talk-target-selector@3dadbcf`. It probably (**INFERRED**) changes what the F11 Current NPC page, P2 `current` commands, PS observer discovery and the CGE plan see while the NPC is still replying (`R-04`).
5. **Dialogue `DO` actions are published before playback, but assistant history commits only after playback.** If the reply is interrupted, the action has already executed and the NPC has no record of having agreed to it. There is also no receipt that joins dialogue actions to ACT or self-knowledge (`C-05`, `R-05`).
6. **PS3 records an entitlement as consumed at grant time** (`consumed = grant`). This is harmless in shadow mode. It is wrong once PS4 or PS6 consume decisions (`C-03`, `R-06`).
7. **Persistence is converging on the P2 profile store, but nothing owns timeline safety,** and three serial schema bumps are planned (PS5 v2, ACT7 v2 or v3, PS7 edges). Use one planned v2 envelope that carries timeline metadata, landed before PS5 (`C-07`, `C-08`, `R-07`).
8. **Directed interaction is claimed by both PS7 (Director admission) and ACT7 (capability).** In addition, P2 `Safe()` suspends any owned character that is in a directed interaction, so an LSA-initiated exchange would suspend its own character (`C-11`, `R-08`).
9. **The CGE plan ignores Essential's own conversation look behavior,** which leaves two gaze owners for the same ped (`R-09`).
10. **The PS1 action-callback vocabulary is wrong on `main`, and the fix lives only on the unmerged ACT0/1 branch.** The fix changes both the native emitter and the companion validator. If a reconciliation takes only one side, either every `followtarget`/`waithere` callback frame fails validation, or every action silently maps to `other` (`R-10`).

**The fundamental rule still holds on `main`.** Essential owns native GTA execution, and the LSA systems add identity, evidence, intelligence, planning and orchestration around it. The rule is **at risk in three planned designs**:

- UX4's clear-on-release, a second owner of Essential conversation state (§4.3).
- CGE gaze and CGE2 body turns alongside Essential's look behavior and ACT (§13).
- PS7 starting directed interactions outside ACT's physical arbitration (§13).

Section 20 lists the narrow corrections.

One premise of the brief does not match the repository:

> "PS3 deterministic salience has now been reconciled/merged into `main` and applied to the production GTA payload for shadow testing."

**PROVEN:** PS3 is reconciled and was **deployed in shadow mode** on 2026-10-05 from the local-only branch `stage/ps3-ready-20261004@101b212`. It is **not merged** to `origin/main` or to the local `main`. Its offline verification also skipped 60 tests without counting them as failures (section 1.3). As the brief instructs, this report analyses PS3 as if it were on `main`, while keeping the merge state explicit.

---

## 1. Pinned project state

### 1.1 Refs

All SHAs were re-fetched at 2026-10-05T14:13Z (`E01`).

| Ref | SHA | Relation to `origin/main` | Notes |
|---|---|---|---|
| `origin/main` | `8c63b20492fb` | — | Three docs commits on top of the runtime/code baseline |
| runtime/code baseline | `0c254049bc6e` (`merge/production-fixes-20261004`; also local `main`) | ancestor (main +3 docs commits) | UX0–UX3, input/Harmony fixes, PS2 |
| `stage/ps3-ready-20261004` (**local only**, not pushed) | `101b21246bda` | `8c63b20` + `88354cc` + `8518ed5` + `101b212` | PS3 re-applied on current main; the `salienceEngine.mjs` and test blobs are byte-identical to `origin/feature/ps3-deterministic-salience@9e61d89` (`E03`) |
| `feature/ps3-deterministic-salience` | `9e61d894c888` | behind 10, ahead 2 | Pushed source of PS3 |
| `feature/act0-act1-contracts-shadow-observer` | `5d11ee9a22b4` | behind 11, ahead 11 | Local copy `ff8c8be` is 10 commits behind origin |
| `feature/act2-player-assigned-basic-activities` | `138895436773` | behind 11, ahead 40 (stacked on ACT0/1) | Local copy `eb786c3` is 28 behind |
| `feature/ux4-talk-target-selector` | `3dadbcfb9cdd` (**moved during this audit**, 2026-10-05 09:43 −04:00) | behind 0, ahead 8 | Local copy `9c1736a` is 7 behind. New: `EssentialMicState`, native start gates, stop retry |
| `feature/radio-track-perception-r0-r2` | `41604c715ec1` | behind 0, ahead 4 | Raw radio facts only |
| `research/radio-public-catalog-v2-20261004` | `abce2b7cef67` | behind 0, ahead 11 | Includes R0–R2 |
| `research/ux4-talk-target-selector` | `2ddb8ae059ab` | behind 11, ahead 4 | T0A audit, architecture |
| `docs/conversation-gaze-engagement-plan` | `f20193f9318e` | behind 11, ahead 1 | CGE0–CGE3 plan |
| `research/radio-track-perception-20261004` | `7f6ad8e5e6b6` | — | Radio contracts and plan |
| `research/lsa-activities-goal-execution-20261004` | `ca952a07f549` | behind 13, ahead 1 | ACT research (N1–N21 corrections) |
| `research/essential-action-completion-audit-20261003` | `8e823310a41c` | — | Action audit (partly superseded) |
| `research/ps2-proximity-chat-speech-plan` | `e1d0bd1a5c4f` | — | PS/SD architecture plus speech plan (newest PS/SD text) |
| `research/perception-salience-scene-director` | `be6b56294894` | — | PS/SD architecture (older) |
| `research/session-identity-memory-architecture-20261002` | `ebc42bff7a11` | — | Identity/memory/timeline research |
| `research/remaining-native-context-audit` | `912ec129f084` | — | Native context audit |

No branch newer than those named in the brief exists, apart from the UX4 hardening commits above. Every local branch head on the developer machine is an ancestor of its `origin` counterpart, except `stage/ps3-ready-20261004`, which exists only locally (**PROVEN**, `E02`).

### 1.2 State ladder

The six states are kept separate on purpose. "Deployed" means hash-verified into the GTA install. "Validated" means a physical GTA acceptance record exists.

| System | Researched | Implemented | Merged to `main` | Built | Deployed | Physically GTA-validated |
|---|---|---|---|---|---|---|
| E1–E6 | ✔ | ✔ | ✔ | ✔ | ✔ (E5/E6 staged and installed with backups) | The dialogue path was exercised in GTA: the 2026-10-01 run sent 13/13 mic turns to native playback, with 3 interrupted and correctly not committed (`docs/E6-GTA-verification-2026-10-01.md`). **E5/E6 early-audio and multi-segment acceptance is still open** |
| P0 turn context | ✔ | ✔ | ✔ | ✔ | in production lineage | **pending** (ROADMAP) |
| P1 session identity | ✔ | ✔ | ✔ | ✔ | in lineage, default off | controlled checklist pending |
| P2 promoted characters | ✔ | ✔ | ✔ | ✔ | ✔ | **exercised in GTA** (ROADMAP). `README.md:58` still says "has not been validated in GTA", which is stale |
| UX0–UX3 | ✔ | ✔ | ✔ | ✔ | in lineage | pending |
| PS0/PS1 | ✔ | ✔ | ✔ | ✔ | ✔ (shadow) | pending |
| PS2 | ✔ | ✔ | ✔ | ✔ | ✔ (shadow, `5ea77f8` payload, then lineage) | pending; player-speech hearing disabled by design |
| **PS3** | ✔ | ✔ | **✘ (local stage only)** | ✔ (stage manifest) | **✔ shadow, 2026-10-05T13:28:34Z, 73/73 files hash-verified, `gtaRuntimeTest: false`** (`E02`) | **not run** |
| ACT0/ACT1 | ✔ | ✔ (shadow observer) | ✘ | branch only | ✘ | ✘ (probes Q1 etc. open) |
| ACT2 | ✔ | ✔ | ✘ (stacked) | branch only | ✘ | ✘ |
| UX4 | ✔ | ✔ (hardened `3dadbcf`) | ✘ | branch + CI run `37318850380` (reported in branch doc, not re-run here) | ✘ | ✘ |
| CGE | ✔ (plan) | ✘ | ✘ | ✘ | ✘ | ✘ |
| Radio R0–R2 | ✔ | ✔ (raw facts) | ✘ | branch only | ✘ | ✘ |
| Radio catalog v2 | ✔ | partial (research branch) | ✘ | ✘ | ✘ | ✘ |
| PS4–PS8, social routing, Scene Director | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| ACT3–ACT7 | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |

### 1.3 Offline test evidence gathered for this audit

| Tree | Result | Notes |
|---|---|---|
| `origin/main@8c63b20` | 370/370 pass | — |
| ACT0/1 `5d11ee9` | 370/370 | — |
| ACT2 `1388954` | 379/379 | — |
| UX4 `9c1736a` | 369/370, then 370/370 on two reruns | `tests/p1-session-identity.test.mjs:340`, `providerDeadline <= started + 5010`, is timing-sensitive (flaky under load, `R-24`). The hardening at `3dadbcf` changed only native and docs files |
| Radio R0–R2 `41604c7` / v2 `abce2b7` | 378/378 each | — |
| **PS3 stage (`101b212` = `9e61d89` blobs)** | runner printed `tests 322 / pass 322`, then an uncaught `SyntaxError: Identifier 'replay' has already been declared` | **PROVEN defect:** `tests/salience-engine.test.mjs` declares `const replay` twice in one scope (lines 252 and 270). The runner imports test files sequentially, so the import throws and every later test file is skipped. Renaming the second binding in a scratch copy (not committed) gave **382/382** passing, so **60 tests were never loaded** while the summary still read `pass 322 / fail 0`. The stage manifest (`offlineNodeSuite`) records the SyntaxError but classifies the run as `incomplete_environment_block` and blames `spawn EPERM`. The EPERM is a separate sandbox limitation of one child-process test; the SyntaxError is a code defect (`E04`, `R-11`) |

The deployed PS3 payload is therefore built from code whose own unit tests were partly unexecuted. The 60 tests pass once the test file is fixed, so no runtime defect is implied. The verification record is wrong, and the fix is one identifier.

---

## 2. Canonical layered architecture

### 2.1 Planes and their authority

The architecture is a stack of **planes**. Each plane has exclusive authority over a closed list of concerns. A plane may *request* things from the plane below it, but only through that plane's public seams. It may *observe* anything it is given. It never mutates another plane's state behind its back.

**Diagram 1 — End-to-end system with authority boundaries.** Double-line boxes are authorities. Arrows crossing a boundary are the only legal crossings.

```text
 ┌──────────────────────────────────────────────────────────────────────────────────────┐
 │ PLANE 5  PROVIDERS  (OpenAI STT · Responses "Luna" · TTS)            NO AUTHORITY    │
 │   stateless; called only by the companion turn pipeline; one STT per utterance       │
 └──────────────▲───────────────────────────────────────────────────────────────────────┘
                │ requests (bounded, deadline-scoped)
╔═══════════════╧═══════════════════════════════════════════════════════════════════════╗
║ PLANE 3  COMPANION  (Node · lsa-essential-e1-candidate)                               ║
║ AUTHORITY: durable identity (P1) · durable character canon/memory/commitments (P2)    ║
║            turn snapshot (P0) · dialogue history · model-visible knowledge (PS4)      ║
║            episodes/observations/salience (PS2/PS3) · activity plans (ACT engine)     ║
║            director policy (PS6/PS7: proposes, never executes)                        ║
║                                                                                       ║
║  ┌──────────────┐  ┌────────────────┐  ┌────────────────────┐  ┌──────────────────┐   ║
║  │ P1 registry  │  │ P2 ProfileStore│  │ PS pipeline        │  │ ACT engine       │   ║
║  │ + bindings   │  │ ONE durable    │  │ signals→episodes→  │  │ goal→activity→   │   ║
║  │ (CharacterId)│  │ character store│  │ observations→PS3   │  │ step requests    │   ║
║  └──────┬───────┘  └───────┬────────┘  └─────────┬──────────┘  └────────┬─────────┘   ║
║         │  E1 TURN PIPELINE: P0 snapshot → [PS4 TurnKnowledge assembler] → Luna →     ║
║         │  decision validator (P/V fences) → TTS → history commit after playback      ║
║         │                                        ┌──────────────────┐   │             ║
║         │                                        │ Director (PS6+)  │───┘ proposals   ║
║         │                                        │ speech tickets + │   (ActivityProp.)║
║         │                                        │ activity props   │                 ║
║         │                                        └──────────────────┘                 ║
╚═════════╪══════════════════╪══════════════════════════╪═══════════════════════════════╝
   owner  │ evidence   Essential bridge      LSA.Intelligence.v1      LSA.Activities.v1
   pipe   │ (P1)       (turn tuple, PCM,     (facts out; tickets      (step frames in,
          │            playback events)       in from PS6)            receipts/facts out)
╔═════════╧═════════════════════════════════════════════════════════════════════════════╗
║ PLANE 2  LSA NATIVE ADAPTERS  (Essential AppDomain, one RAGE host: RuntimeEntry)      ║
║ AUTHORITY: run-local anchors (captureRef) · owner evidence/incarnation ·              ║
║            source-time witness/acoustic sampling · step dispatch through Essential    ║
║            public APIs · physical evidence sampling · LSA-side primary-behavior token ║
║   P2 host (Encounter, Safe()/Scripted guards) · P1 owner facts · PS sensors+witness · ║
║   ACT StepRunner · UX4 talk commit · [CGE gaze overlay] · [radio sampler]             ║
╚═════════╤═════════════════════════════════════════════════════════════════════════════╝
          │ public Essential seams only: action queue/registry, NpcActions wrappers,
          │ NpcTargeting, InputController mic, special-turn scheduler, IIntegration
╔═════════╧═════════════════════════════════════════════════════════════════════════════╗
║ PLANE 1  ESSENTIAL  (Hotfix #3, source-pinned)          SOLE NATIVE EXECUTOR          ║
║   turn/session/generation allocation · mic core (one active mic Ped)                  ║
║   conversation partner (PlayerConversationPed) · playback auth/interrupt/complete     ║
║   action queue + executor (exclusive control) · reflexes · directed interactions      ║
║   special-turn scheduler · conversation look behavior · far release (100 m)           ║
╚═════════╤═════════════════════════════════════════════════════════════════════════════╝
          │ GTA tasks / natives
┌─────────┴─────────────────────────────────────────────────────────────────────────────┐
│ PLANE 0  GTA V ENGINE + SCRIPTS  ambient AI · missions · cutscenes · player switch ·  │
│          foreign RPH mods (e.g. Policing Redefined / LSPDFR)   HIGHEST PHYSICAL AUTH. │
└───────────────────────────────────────────────────────────────────────────────────────┘

 PLANE 4  UX LOADER DOMAIN (LSA.Enhanced): input router, gestures, F11 menu, HUD, settings.
          Talks to Plane 2 only through the DomainHost string bridge / LocalCommandQueue.
          Owns presentation and *proposals* (selection previews); owns NO game state.
```

**PROVEN** for planes 0–2 and 4 on `main` (`E07`, `E08`, `E29`) and for ACT on its branches (`E20`–`E22`). The Plane 3 boxes for PS4, the Director and the ACT engine are **PROPOSED**, following the settled research. The ACT engine exists on the ACT2 branch.

### 2.2 The spines

Four lifecycles cross planes. Each has exactly one owner.

| Spine | Owner | What every other system does |
|---|---|---|
| **Speech/turn**: utterance → turn → generation → playback → history | Essential allocates and authorizes. The companion turn pipeline is the only provider caller and the only history writer | Observe (PS), decorate (P0 snapshot, PS4 knowledge), request (Director tickets) |
| **Physical**: intent → activity → step → Essential command → receipt → completion | ACT owns the plan and the step lifecycle. Essential owns execution. GTA owns the outcome | P2 controls and dialogue `DO` are *player-direct sources* into the same arbitration; the Director is a *proposer* |
| **Knowledge**: engine fact → signal → episode → observation → salience → turn knowledge → memory | The PS pipeline owns facts through salience. PS4 owns the model-visible projection. PS5 is the only automatic memory writer | ACT and radio are *producers*. Luna is a *consumer* that never writes truth |
| **Identity/persistence**: authored ownership → CharacterId → incarnation → binding → profile | P1 for identity and voice. P2 for canon, memory and commitments | Everyone else references identity and never mints it |

The rest of this report fills in these four spines and checks where current or planned code crosses them illegally.

### 2.3 One owner per lifecycle (summary)

The full matrix, with flags and evidence, is in [system-ownership-matrix.md](system-ownership-matrix.md). It lists 10 duplicate authorities, 11 missing owners and 4 ambiguous concepts. The highlights:

- **Single clean owner (lock in):** turn identity (Essential); durable CharacterId (P1); runtime binding (P1 `RuntimeBindings` from fresh owner evidence); GTA tasking (Essential executor); playback completion (Essential `PlaybackEnded` + E1 commit rule); durable canon (P2); per-observer witness decision (PS2 native `WitnessPolicy`); ranking (PS3); physical step lifecycle (ACT `StepRunner`, on its branch).
- **Shared but intentionally layered:** ped lifetime (GTA, then Essential state, then LSA anchors); speech capture (Essential mic core; UX4 is an input *source*); gaze (Essential look behavior; CGE must be a yielding overlay); physical arbitration (Essential gates above ACT's lease).
- **Duplicate authority (fix):** run-local entity references (three tables); conversation-partner lifetime (Essential vs UX4 clear-on-release); model-visible context (stock JSON + P2 projection, plus three planned writers); directed interaction (PS7 vs ACT7); gaze and body orientation (Essential and ACT vs the CGE plan); clock/world-epoch detection (three clock detectors plus per-pipe epochs); action-callback vocabulary (PS1 vs ACT).
- **Missing owner:** social address and responder selection; timeline/save safety; utterance join; salience consumption; executor self-knowledge for dialogue actions; capability/health state.
- **Ambiguous:** relationships (narrative text vs future structured edges); commitments vs manual `promise` memories; the LSA-side primary-behavior token after `DETACHED`; typed-input targeting vs UX4 selection. Related: "Current NPC" loses meaning when UX4 clears the partner (§4.3).

---

## 3. Identity and reference taxonomy

The full per-identifier table, answering all ten questions for 30 identifiers, is in [system-contract-register.md §1](system-contract-register.md#1-identity--reference-taxonomy). This section gives the rules and the defects.

### 3.1 The ladder

**Diagram 2 — Identity and reference lifecycle.** Strength decreases downward. A reference may be *resolved upward*, for example from a turn tuple to its CharacterId through a live binding. A durable identity must **never be resolved downward** to "whatever ped currently has it" in order to route an effect.

```text
 DURABLE (disk)        worldProfileId ── [timelineId: MISSING, C-07]
 owner: P1 / P2           │
                          ├── source owner alias (comrade.authored / promoted.<uuid>) ──► CharacterId (P1 UUID)
                          │                                                                 │
                          │                       P2 profile (canon, memories[memoryId], relationships,
                          │                       future commitments) keyed by CharacterId ◄┘
 ═════════════════════════╪══════════════ effect routing may NEVER cross this line downward ════════════
 RUN (RAM, per host run)  │  nativeRun / adapterEpoch / streamId — minted separately per pipe (R-14)
 owner: Plane 2           │  encounterId (P2) · OwnershipToken (P2) · incarnationId (P1 registration)
                          │        │ fresh owner evidence (heartbeat 250 ms, lease 1.5 s)
                          │        ▼
 ENTITY INCARNATION       Ped wrapper + full handle + MemoryAddress (+ owner incarnation when owned)
 owner: GTA → Essential   │   ├── captureRef (PS EntityAnchors, run-local UUID)          ┐ three tables
 (validity) → LSA anchors │   ├── ACT capture id (ACT2 EssentialActivityWorld, own GUID)  │ for one concept
                          │   └── UX4 frozen ped (+address) / P2 Encounter.Address        ┘ (R-03, C-02)
 SESSION / TURN           pedId (Essential, handle string) + sessionNonce + turnId + generationId
 owner: Essential         │   RuntimeBindings (pedId, sessionNonce) → CharacterId  (P1, RAM)
 TURN-SCOPED              P### / V### reference map (P0 snapshot; time-of-use fence)
 WORK ITEMS (RAM)         utteranceId · transcriptRef · captureReceiptRef (PS2 contracts, producer gated)
                          signalId · episodeId · observationId+revision (PS) · decision (PS3, keyed by observation)
                          activityId · stepId · executionId · leaseId/leaseEpoch (ACT) · DirectorTicket (PS6, planned)
                          UX4 PTT generation · command id (LocalCommandQueue) · directed-interaction id (Essential)
```

### 3.2 Rules

These rules are **PROPOSED** for locking. Each is already honored by `main` unless a finding below says otherwise.

1. **An effect is addressed only by an Essential tuple or a native-retained anchor.** "Effect" means speech, an action or gaze. CharacterId, alias, `pedId` alone, `encounterId`, a name and a handle are never effect addresses (P1 rule; **PROVEN** in `essentialGlue`/`nativeDelivery` and in the ACT `ResumeToken` rules).
2. **Any reference that survives an `await` is revalidated against its incarnation at time of use.** This is P0's time-of-use fence, P1's retired-session rule, ACT's `SameIncarnation` and PS anchor `Resolve`.
3. **Durable records may store only durable identifiers.** They may hold run-local identifiers only as opaque provenance strings, never as something to resolve later. (PS5 `eventMetadata` must follow this. **PROPOSED**.)
4. **A backend identity is not recognition.** PS observations require `recognizedCharacterIds.length === 0` (**PROVEN** `E12`). Any later recognition must come from an observer-owned `SubjectBeliefRef` (identity research §5), never from a CharacterId join.
5. **One run-local anchor service per host run** (**PROPOSED** `C-02`). PS, ACT, UX4, CGE and the Director should all share the PS `EntityAnchors` table (wrapper + full handle + address + owner incarnation, with retirement on mismatch, nonexistence, revoke, expiry or clock regression). The ACT research already specified `EntityAnchors.Resolve(captureRef)` in §9.4. The ACT2 implementation built a private table instead (`E20`).

### 3.3 Identifiers currently treated as stronger than they are

| # | Where | What is over-trusted | Status | Consequence and fix |
|---|---|---|---|---|
| I-1 | PS research, Essential `SpecialGeminiTurnScheduler` delayed submission | The delayed closure re-resolves a **handle** (`FindPedByHandle`) before `SendNow`; there is no incarnation field | **PROVEN** (PS/SD research, Hotfix #3 offsets) | PS6 must use zero-delay submission with a native `DirectorTicket` (already planned). Keep this rule locked |
| I-2 | Each pipe mints its own `nativeRun`/`adapterEpoch`/`streamId` (`ActivityChannel.cs:32-33`, `IntelligenceChannel.cs:38`, `OwnerFactChannel.cs:48`) | Each subsystem assumes its own epoch marks a host restart, but no shared id ties them together | **PROVEN** | The companion cannot tell that PS frames and ACT frames come from the same host run. Add one `hostRunId` minted by `RuntimeEntry` to every hello (`C-13`, `R-14`) |
| I-3 | `GetPlayerConversationPed() ?? GetCurrentSpeakerPed()` used as "the selected NPC" by UX `CurrentPed` (`NativeCommands.cs:69`), P2 `capture`/current ops (`PromotedCharactersIntegration.cs:171,185`), PS discovery (`IntelligenceIntegration.cs:178`) and the CGE plan | An Essential *conversation-state* field is used as a stable selection | **PROVEN** | Fine while only Essential writes it. UX4's clear-on-release turns it into a PTT-scoped lease (§4) |
| I-4 | PS3 `situation.relationship/traits/memory` branches | They imply an observer→CharacterId join that does not exist. The live shadow passes only `activity:'idle'` (`shadowRuntime.mjs:91`) | **PROVEN** | Those branches are dead in live mode. They need `C-02` plus a recognition gate, not a direct CharacterId lookup |
| I-5 | ACT `Encounter.Mode` | Treated as "who owns the ped's primary behavior", but it is set to `idle` on every non-preempt ACT terminal, including `DETACHED` and `SUPERSEDED` by a dialogue `DO`, while the ped is still physically following or waiting (`StepRunner.cs:325-336` → `ActivityDispatch.cs:145-158`) | **PROVEN** (code path); UX impact **INFERRED** | Make the token record the residual Essential mode (`C-06`, `R-12`) |
| I-6 | Save/load | `worldProfileId` plus clock-regression resets are treated as sufficient timeline safety | **PROVEN** there is no save hook (`SESSION_IDENTITY-design-review.md` survival table) | A load without a GameTime regression leaves live anchors, receipts and tickets valid in a different world. Durable memories have no timeline at all (`C-07`, `R-07`) |
| I-7 | Action-callback names | PS1 treats the callback string as the semantic label `follow`/`wait`. ACT N5 proves it is the canonical registry token (`followtarget`/`waithere`) | **PROVEN** | PS1 maps every action to `other`. Fixed only on the ACT0/1 branch (`R-10`) |

---

## 4. Conversation targeting and UX targeting

### 4.1 What the target concepts really are

| Concept | Owner | Class | Notes |
|---|---|---|---|
| Essential current speaker (`GetCurrentSpeakerPed`) | Essential | **separate** (playback state) | The ped that is speaking now |
| `PlayerConversationPed` | **Essential** | **canonical conversation partner** | `SetPlayerConversationPed` has side effects: it registers interaction context, detaches a conflicting directed interaction, queues warmup and sets focus (**PROVEN**, UX4 T0 audit). Stock Talk and Text recompute `GetBestConversationPed` before setting it |
| UX Current NPC (F11) | UX (view) | **view of the partner** | `partner ?? speaker` (`NativeCommands.cs:69`) |
| UX4 highlighted target | UX4 (loader + native `TalkTargetPolicy`) | **proposal** that *commits into* the partner | Preview and cycle never call the setter. Only the committed PTT start does (**PROVEN**) |
| P2 promoted-character command target | P2 | **separate, fenced** | Addressed by `encounterId` with `expect.encounterId` → `target_changed` (**PROVEN**) |
| Follow/Wait target | P2 / ACT | **separate** | Currently always the player (ACT `Resolve` supports `player`/`here` only) |
| Activity target anchor | ACT | **separate** | ACT RefSlot anchor. Today it is a private capture table; it should be a shared `captureRef` (`C-02`) |
| Proximity-chat addressed listener | Social routing (missing) | **separate, per utterance** | Output of routing. Never a writer of the partner |
| Scene Director participant | Director | **separate, per scene** | Never a writer of the partner |
| CGE gaze target | CGE (plan) | **derived view** | Reads `partner ?? speaker`. Never writes |

**Result:** one canonical target, the **conversation partner** owned by Essential, has several views (F11, P2 `current`, PS discovery, CGE). UX4 selection is a legitimate separate *proposal*. Every other concept is legitimately separate. There is **one accidental duplication**: UX4 behaves as a second lifetime owner of the partner.

### 4.2 Canonical precedence (PROPOSED, deterministic)

1. **Only a committed player input** may set the partner. That means Essential's own Talk, Text and MarkedTalk paths, or UX4 at committed PTT start (`SetPlayerConversationPed(ped)` immediately before `SendMicStart(ped)`). There is **no other writer**: not P2, not ACT, not the Director, not social routing, not CGE.
2. **Only Essential's own lifecycle, or the next committed player input,** may clear or replace the partner. UX4 must release *its own PTT generation*, not the partner.
3. **The mic Ped is fixed for the life of an utterance.** A UX4 cycle during a hold applies to the next utterance only. Essential already enforces one active mic Ped; since `3dadbcf`, UX4 refuses to start while another mic is active (`mic_busy`) and never stops a newer stock mic (**PROVEN**).
4. **Hearing and addressing never mutate targeting.** They produce per-utterance facts (§5).
5. **Director speech uses special turns.** It may set `RequireCurrentPlayerConversation` only to describe the intended listener. It never calls the setter (PS/SD research §9, **PROPOSED** there and kept here).
6. **Typed input** follows Essential (`TextInputService` recomputes the best ped). UX4 must show that Text is not selection-aware until a typed-target follow-up exists (**PROVEN** limitation, documented in UX4).

**The brief's example.** UX4 highlights A, proximity speech is audible to A, B and C, F11 points at A, and the Director is considering B.

- `PlayerConversationPed` may be changed only by the player's committed input. If the player holds UX4 PTT, it is set to A at commit. F11 is a view. The hearing set {A, B, C} and the Director's interest in B write nothing.
- If the Director's B-warning is admitted, it plays as a special turn for B with `CancelIfPlayerStartsTurn=true`, and B does **not** become the partner.

### 4.3 Defect: UX4 clears the partner at PTT release

**PROVEN** at `feature/ux4-talk-target-selector@3dadbcf`. `TalkTargetSelector.Stop()` calls `ReleaseEssential()`, which calls `NpcTargeting.ClearPlayerConversationPed()` if the partner is still the ped UX4 set (`TalkTargetSelector.cs:118-131,289-297`). This happens at **mic release**, *before* STT, reasoning, TTS and the NPC's playback. The UX4 docs do not explain why. Stock Talk does not need it, because it always recomputes the best ped before setting it (T0 audit).

**INFERRED consequences** (GTA probe needed):

- During the reply, F11 Current NPC, P2 `current.*`, PS observer discovery and CGE fall back to `CurrentSpeakerPed` or to nothing.
- Any Essential logic that consults the partner during a special turn (`RequireCurrentPlayerConversation`) sees no partner.

**Fix (PROPOSED, before the UX4 merge):** remove the clear at stop and keep the generation fence. If the developer wants selection persistence to end, end the *UX4 highlight* only. Add a GTA acceptance item: "the NPC remains Current NPC through its reply" (`R-04`).

---

## 5. The canonical player-speech lifecycle

### 5.1 Today: seven representations of "the player spoke", no shared id

| # | Representation | Owner | Clock | Identity | Status |
|---|---|---|---|---|---|
| 1 | Essential mic window (`SendMicStart(ped)`/`SendMicStop()`, `BeginMicTurn`/`MarkMicReleased`, `StartPlayerMicLook`) | Essential | game | mic Ped, then turn tuple | **PROVEN** (API analysis). Not exposed to addons as an event |
| 2 | Companion capture window (`startRealtimeInput`/`endRealtimeInput`) | companion | `performance.now()` | the prepared turn tuple | **PROVEN** (`openaiConnection.mjs:156-210`). Metrics only |
| 3 | PS2 `SpeechCaptureReceipt` contract (`speechVersion 1`) | PS (native producer `player_mic`) | game ticks + monotonic | `utteranceId`, `captureReceiptRef`, `nativeRun` | Contract **PROVEN**. Producer gated `unsupported_capture_receipt` |
| 4 | PS2 accepted transcript (`SharedTranscriptStore`, `validateAcceptedTranscript`) | companion | monotonic | `utteranceId`, `transcriptRef` | **PROVEN**. Fed with `{text, receipt: null}` (`runSequentialTurn.mjs:187`) |
| 5 | UX4 PTT generation (`talk.ptt_start`/`stop`) | UX4 | loader monotonic | generation counter | **PROVEN** (branch) |
| 6 | CGE "player speech started/ended" | CGE plan | — | — | Plan says it is "not yet proven as a public native event" |
| 7 | Social-routing utterance | research | — | — | Planned |

**Gaps (PROVEN):**

- The capture receipt has **no turn join**: no `pedId`/`sessionNonce`/`turnId`/`generationId`.
- It has **no addressee**: no mic Ped `captureRef`.
- It has **no selection provenance**: no stock/marked/UX4/typed source.
- The transcript fed to PS carries no `utteranceId`.

Without these, every consumer would invent its own join, by time window or by "latest", which is exactly the failure the brief warns about.

### 5.2 Canonical flow (PROPOSED)

**Diagram 3 — Player speech and social-routing lifecycle.** Double-line boxes mark the authority that owns each stage.

```text
 PLAYER ── PTT (stock Talk | MarkedTalk | UX4 commit)          ── Text (typed)
             │                                                     │
 ╔═══════════▼════════════ ESSENTIAL (owner of capture & turn) ════▼══════════════════════╗
 ║ SetPlayerConversationPed(ped)  (only committed input; §4.2)                             ║
 ║ SendMicStart(ped) → mic core → BeginMicTurn(ped) → turn tuple allocated                 ║
 ║ StartPlayerMicLook(ped)  (Essential gaze during capture)                                ║
 ╚═══════╤══════════════════════════════════════════════════════════════════════╤══════════╝
         │ source-time start (hooked/pinned at mic core boundary)               │ typed: zero-length
 ╔═══════▼══════ LSA NATIVE (Plane 2): UtteranceLifecycle v1 (C-01) ════════════▼══════════╗
 ║ mint utteranceId; record {nativeRun/hostRunId, micPed captureRef, inputSource,           ║
 ║   selectionProvenance, startGameTick}; join key = (pedId, sessionNonce, turnId) once the ║
 ║   turn exists; sample observers' acoustic geometry during [start,end] (PS2 witness)      ║
 ║ end: endGameTick; terminal ∈ {captured, cancelled, empty, overflow}                      ║
 ╚═══════╤═══════════════════════╤══════════════════════════╤═══════════════════════════════╝
         │ PCM (existing bridge)  │ SpeechCaptureReceipt v2   │ start/end events
 ╔═══════▼═══════ COMPANION ══════▼═══════════════════╗      ▼
 ║ STT ONCE per utterance → accepted transcript       ║   CGE (listen/speak engagement;
 ║   {utteranceId, transcriptRef, text}               ║   yields to Essential look, §13)
 ║        │                                           ║
 ║        ├─► (1) direct turn: commitPlayerInput →    ║
 ║        │       P0 snapshot/PS4 knowledge → Luna → ║
 ║        │       validated decision → TTS → playback║
 ║        ├─► (2) PS2: speech_heard for observers    ║
 ║        │       whose receipt says heard (source-  ║
 ║        │       time geometry, never post-STT)     ║
 ║        ├─► (3) social routing: addressed /        ║
 ║        │       overheard / may-respond (PS7-era)  ║
 ║        │       → at most one extra responder via  ║
 ║        │       Director ticket (bounded)          ║
 ║        └─► (4) experiential event (PS5) only from ║
 ║                committed history + observations   ║
 ╚════════════════════════════════════════════════════╝
```

### 5.3 Answers to the brief's speech questions

| Question | Canonical answer | Label |
|---|---|---|
| Authoritative start/end signal | Essential's mic core boundary (`SendMicStart` → `BeginMicTurn` … `SendMicStop` → `MarkMicReleased`), surfaced to LSA as `UtteranceLifecycle` start/end by a source-pinned hook or IL-resolved state. UX4's `EssentialMicState` already resolves the single active-mic field from `SendMicStop` IL, which shows the seam is reachable | **PROPOSED** (hook). Field resolution **PROVEN** |
| Typed input | An utterance with `inputSource: typed`, zero duration and no acoustic evaluation. It is directed only to the partner: no overhearing, and no `speech_heard` for others | **PROPOSED** (conservative) |
| Source-time or post-STT hearing | **Source-time only.** Observers are sampled during [start, end]. Post-STT proximity is never evidence (ROADMAP and PS2, already settled) | **PROVEN** policy |
| When listener membership is frozen | The addressee (mic Ped) is frozen at start. The hearing set is the union of audible intervals over the capture window, frozen at end. Turn context (P0) is frozen at turn start | **PROPOSED**, consistent with P0 |
| Can UX4 change the target after start | **No.** The mic Ped is immutable per utterance. Selection changes apply to the next utterance | **PROPOSED**; UX4 fences already enforce one generation |
| Can CGE reuse the same event | **Yes, and it must.** CGE0 should consume `UtteranceLifecycle` instead of finding its own seam | **PROPOSED** |
| Can social routing reuse the transcript | **Yes.** It consumes `{utteranceId, transcriptRef}`. There is no second STT, and other responders speak only through bounded Director/PS7 tickets | **PROPOSED**, matches ROADMAP |
| How interruption is represented | Utterance terminal (`cancelled`/`empty`/`overflow`). Barge-in shows up as the *previous* turn's `PlaybackEnded{interrupted}`, with no assistant commit (**PROVEN** E1 rule). A new utterance supersedes the previous generation through Essential (**PROVEN**) | mixed |

**Turn-yield gap (MISSING, `C-12`):** when routing decides that an overhearer (B) was addressed while the mic Ped is A, nothing lets A's turn *yield* without speaking. Whether Essential handles a deliberately silent turn is **UNKNOWN**; a GTA probe is needed before PS7 social routing.

---

## 6. Knowledge flow and the epistemic firewall

### 6.1 Canonical transformation

**Diagram 4 — Perception → knowledge → memory lifecycle.** The firewall is the boundary between the evidence planes and anything Luna sees or anything durable memory stores.

```text
 GTA ENGINE FACT (truth, no observer)
      │  sampled by Plane 2 sensors on Essential Update (one shared snapshot per tick)
      ▼
 RAW SIGNAL  {signalId, producer, kind, source/target captureRef, gameTick, facts}      owner: PS native
      │  + per-observer WitnessReceipt from WitnessPolicy (visual/auditory/self; source-time geometry)
      ▼
 EPISODE (world-level incident, RAM, 30 s)                                              owner: PS2 correlator
      │  only observers with status witnessed|reported produce anything
      ▼
 OBSERVATION (per observer, immutable revision, ≤4 claims, certainty, recognizedCharacterIds=[])
      │
      ▼
 SALIENCE DECISION  {context: omit|candidate|must_include, memory: none|stage,
                     response: none|eligible|urgent, reasons≤4}   ranks, never adds facts   owner: PS3
 ╔════════════════════════════════ EPISTEMIC FIREWALL (PS4, C-04) ═══════════════════════════════════╗
 ║ TurnKnowledgeFrame assembled ONCE per turn, frozen with the P0 snapshot, from allowlisted lanes:    ║
 ║   SELF       own canon (P2), own identity facts, own activity/receipt facts with evidence strength  ║
 ║   PERCEIVED  this observer's admitted observations (PS3 order, budgeted), observer-qualified text   ║
 ║   CONVERSE   committed dialogue history + current transcript (+ qualified overheard speech)          ║
 ║   RECALLED   recognition-gated memories (PS5 era)                                                   ║
 ║   SITUATION  allowlisted world fields (time, weather, place name) — never raw blocks                ║
 ║ FORBIDDEN: raw Essential JSON, third-party records about others, CharacterIds, salience internals,  ║
 ║            other actors' receipts, radio metadata without auditory evidence, engine-only flags      ║
 ╚═══════════════════════════════════════════════╤═════════════════════════════════════════════════════╝
                                                 ▼
 LUNA  (proposes speech + at most one validated stock action / later a closed activity intent)
      │  output is a CLAIM: dialogue is "what I said", never world truth
      ▼
 DELIVERED SPEECH / ACTION  (speech: matching PlaybackEnded; action: ActionReceipt evidence)
      │
      ▼
 EXPERIENTIAL MEMORY (PS5: one writer into P2 profile; provenance + timeline; never raw prompts)
```

### 6.2 Bypass audit

| Possible bypass | Present? | Evidence | Fix |
|---|---|---|---|
| Raw engine facts entering Luna directly | **Yes, through the stock path.** `buildRequest` serializes the whole `actor`, `listener` and `world` objects into the system message (`essentialDecision.mjs:56-59`). Only LSA's own transport/identity blocks are stripped first (`modelActor`, `essentialGlue.mjs:48`). The actor context still carries third-party IntegrationBlocks such as Policing Redefined records | **PROVEN** (`E07`; native context audit) | The PS4 assembler replaces wholesale serialization with lanes. A transitional *compat lane* lists Essential fields explicitly (`C-04`) |
| Persistent profile bypassing recognition | Not today: P2 projects the actor's **own** canon only. It becomes a risk once memories or relationships mention `relatedCharacterIds` of people who are present | **PROVEN** (current); risk **INFERRED** | Retrieval is gated by an observer-owned `SubjectBeliefRef`, not CharacterId equality |
| Backend CharacterId implying recognition | No | **PROVEN** `contracts.mjs:53` | Lock |
| Salience introducing facts | No: decisions carry only the observation id/revision and closed enums | **PROVEN** `salienceEngine.mjs` (`DECISION_KEYS`) | Lock |
| Generated speech becoming truth | Not yet: no automatic memory writer exists, and history stores assistant text only after playback | **PROVEN** | PS5 stores speech as speech acts with the speaker, never as world facts |
| Handler acceptance becoming remembered completion | **Partly.** A dialogue `DO` becomes part of the assistant message. The model later sees "I agreed to X" with no knowledge of whether X happened, and an interrupted reply loses even that (§12, O-1) | **PROVEN** ordering (`runSequentialTurn.mjs:326` vs `:367`) | `C-05` DialogueActionReceipt → SELF lane |
| Radio metadata without auditory evidence | No: R0–R2 emits raw facts only, with no observation, memory or prompt | **PROVEN** (R0–R2 status) | R3 must witness through the auditory channel. The research's planned "radio knowledge projection selector" becomes a PS4 lane, not a separate selector |
| Hidden police/provider records through old prompt paths | **Possible** through IntegrationBlocks in actor/listener/world JSON | Blocks present **PROVEN**; hidden facts about *others* **INFERRED** | Compat-lane allowlist (`C-04`) |

**Conclusion.** The PS pipeline itself already has the right firewall properties: witnessing, closed claims and no recognition. The bypass is the **pre-existing stock context path**, plus four *planned* independent prompt writers (P2 canon projection in `characterService.prepareTurn`, PS4, the ACT4 `[CURRENT ACTIVITY]` block in `essentialDecision.mjs`, and the radio projection selector). **One assembler with lanes and budgets** (`C-04`) is the convergence fix. It belongs at the start of PS4, and ACT4 and radio R3 consume it rather than writing their own blocks (`R-02`).

---

## 7. PS3 into PS4–PS8

PS3 is treated here as implementation (stage `101b212` = `9e61d89` blobs).

| Question | Answer | Label |
|---|---|---|
| Do PS3 contracts match the PS4–PS8 research? | **Mostly.** The decision triple (context/memory/response) and the reason codes implement the research's "bounded turn knowledge + bounded initiative requests". Ordinal sort keys replace a numeric score, which is acceptable. The radio research still maps `radio_heard` to `context: "low"`, which is **not a PS3 value** (`omit\|candidate\|must_include`) | **PROVEN** |
| Are PS3 outputs sufficient for PS4? | As *input*, yes. PS4 also needs (a) a turn-actor ↔ observer join (the Essential turn's ped incarnation → that observer's `captureRef`), which does not exist; (b) a consumption acknowledgement; (c) a stable decision id/policy version | **PROVEN** gap |
| Does suppression/reaction state belong in PS3? | **Novelty** suppression ("was this incident already granted to this observer") belongs in PS3. **Speech budgets/cooldowns/reservations** belong to the Director (PS6), as the PS/SD research already says. Two ledgers are fine **only if** PS3 marks consumption on the Director's receipt, not at grant | **PROPOSED** |
| Do the relationship/memory hooks rely on missing seams? | **Yes.** The live shadow passes only `activity:'idle'` and no relationship, traits or profile revision (`shadowRuntime.mjs:91`). The ROADMAP already notes the missing `captureRef → CharacterId/profile` seam | **PROVEN** |
| Does ACT change PS8 assumptions? | **Yes.** (1) `action_observed` must be derived from *physical-outcome* signals that are witnessed, never from executor callbacks. (2) ACT completion adapters and PS8 producers sample the same physical state and should share one sampler. (3) ACT's `ActivityFact` is a new *self* producer, not a world event | **PROVEN** basis (`E11`, ACT research §6) / **PROPOSED** |
| Should action receipts feed PS observation directly? | **No for witnesses** (§9). For the acting character, yes: receipts feed the SELF lane through PS4 | **PROPOSED** |
| Will PS3's vocabulary survive PS5 and social routing? | Mostly. Social routing needs an addressed/overheard distinction on `speech_heard` (new claim kinds or reasons). PS5 needs an `eventType → memory category` mapping. The `activity` enum needs **one** producer mapping from ACT/P2/Essential modes, plus an `unknown` value so live mode stops claiming `idle` | **PROPOSED** |

**Minimum PS3 interface changes now** (small, before PS4/PS6; `C-03`):

1. Split `granted` from `consumed`. Today `consumed: Boolean(existing?.consumed) || grant` (`salienceEngine.mjs:393`). Add `acknowledge(decisionKey, consumer, outcome)`, where outcome is `delivered`/`rejected`/`expired`, and suppress repeats only after `delivered`.
2. Add a stable `decisionKey` (`observationId` + `revision` + `policyFingerprint`, all of which already exist) and a `policyVersion` to the decision.
3. Add `unknown` to the `activity` enum and use it in live shadow until the `ObserverSituation` provider exists.
4. Fix `tests/salience-engine.test.mjs` (duplicate `const replay`) so the verification record is true (`R-11`).

None of these changes PS3 behavior in shadow.

---

## 8. ACT, PS and the Scene Director

### 8.1 The boundary (PROPOSED, lock in)

**Diagram 5 — Intent → ACT → Essential → physical receipt.**

```text
 PROPOSERS (no execution authority)
   Player UX (F11/ACT menu) ─┐   Player turn (Luna DO / ACT5 intent) ─┐   Director (PS6 speech only;
   P2 direct controls ───────┤                                       │   ACT7 ActivityProposal) ──┐
                             ▼                                       ▼                            ▼
 ╔══════════════════ COMPANION ACT ENGINE (owner: plans, arbitration, lease grant) ═════════════════╗
 ║ closed ActivityIntent + typed slots (RefSlot = shared captureRef, C-02) → template → validator    ║
 ║ priority: player_direct > player_standing > director_urgent > director_routine > ambient         ║
 ║ one activity per actor; one paused max; ResumeToken (RAM) voids on epoch/incarnation change      ║
 ╚═══════════════════════════════════════╤═══════════════════════════════════════════════════════════╝
                                         │ step frame {executionId, leaseId, leaseEpoch, capability,...}
 ╔═══════════════════ NATIVE StepRunner (owner: one current step per actor) ════════════════════════╗
 ║ preflight (alive, owned, !scripted, !directed, !reflex, bubble...) → BeginOwnership (Mode token)  ║
 ║ dispatch ONLY via NpcActionQueue / public NpcActions wrappers / public stop APIs                  ║
 ╚═══════════════════════════════════════╤═══════════════════════════════════════════════════════════╝
                                         ▼
 ╔═══════════════════ ESSENTIAL (owner: execution) ══════════════════════════════════════════════════╗
 ║ queue gates (roles, state blocks, reflex locks, duplicate suppression) → modifiers → TryExecute → ║
 ║ executor (BumpBehaviorCommandGeneration, AcquireExclusiveControl) → GTA task                       ║
 ╚═══════════════╤═══════════════════════════════════════════════════════════════╤═══════════════════╝
                 │ OnNpcActionExecuted(canonical name, succeeded) / modifier phases│ GTA outcome
                 ▼                                                                 ▼
 StepRunner receipt: REQUESTED→VALIDATED→DISPATCHED→HANDLER_ACCEPTED→MODE_ESTABLISHED|PHYSICALLY_COMPLETED
                     terminals REJECTED|FAILED|CANCELLED|SUPERSEDED|TIMED_OUT|DETACHED
                 │                                   physical evidence sampled by completion adapters
                 ▼
 ACT engine (continue/retry/pause/cancel/finish) ──► ActivityFact ──► SELF lane (actor only, PS4)
                                                  └► NOT a witness event; witnesses learn only from
                                                     PS2-witnessed physical-outcome signals
```

### 8.2 Arbitration hierarchy (PROPOSED canonical; mostly already implemented on branches)

**Diagram 6 — Scene Director / ACT / PS arbitration.** A higher tier always wins over a lower one. Overlays never take the primary-behavior lease.

```text
 TIER 0  GTA engine, mission/cutscene/player switch/network, foreign script ownership
         → LSA suspends (P2 Safe()/Scripted(), NativeSafetyPolicy); never fights; no auto-rejoin
 TIER 1  Essential self-preservation: reflexes, death/injury handling, far release (100 m)
         → ACT pauses/fails (reflex detected via NpcState fields, N9); PS observes
 TIER 2  Essential directed interaction (foreign) → ACT preflight rejects; rising → pause explicit_only
         (LSA-initiated DI only via ACT7 capability with a P2 exemption token, C-11)
 TIER 3  PLAYER DIRECT — latest wins among: P2 control ops (Preempt), UX activity commands,
         dialogue DO accepted in the player's own turn (SUPERSEDED via callback). Never auto-resumed.
 TIER 4  PLAYER STANDING activities (ACT player_standing): resumable after interruptions
 TIER 5  DIRECTOR URGENT   (speech: PS6 warning ticket; physical: ACT7 director_urgent, e.g. take_cover)
 TIER 6  DIRECTOR ROUTINE
 TIER 7  AMBIENT (Essential ambient/resume_activity; Rockstar ambient AI)
 ───────────────────────────────────────────────────────────────────────────────────────────────
 OVERLAYS (no primary lease; must yield to every tier that owns the same channel)
   SPEECH:  Essential playback lifecycle > player input > active dialogue/directed exchange >
            Director urgent > Director routine   (Director: CancelIfPlayerStartsTurn, SkipIfSpeakerBusy)
   GAZE:    Essential look behavior (mic look; speaker look keyed to turnId/generationId) > CGE
   OBSERVATION: read-only, never arbitrated
```

### 8.3 The brief's ACT/PS/Director questions

| Question | Answer | Label |
|---|---|---|
| Does the Director ever call Essential directly? | **Speech:** only through Plane 2 admission (`DirectorTicket`) into Essential's special-turn scheduler with zero delay, which is a public seam. **Physical:** never. It submits ACT proposals. The older PS/SD text that starts directed interactions from `DirectorAdmission.cs` is superseded (§16, `C-11`) | **PROPOSED** (resolves a conflict) |
| Is PS6 initiative speech-only? | **Yes.** PS/SD research §PS6 and ACT7 sequencing agree | **PROVEN** (docs agree) |
| Where does PS8 end and ACT begin? | PS8 = new *verified sensors* (facts). ACT = *doing*, plus completion evidence for its own steps. One shared physical sampler serves both. Receipts never become world events | **PROPOSED** |
| Who owns activity priority? | The ACT engine, through the capability registry's `allowedPriority` and arbitration. The Director's priority is clamped | **PROVEN** (registry) / **PROPOSED** (engine on later phases) |
| Who owns the per-character physical lease? | The ACT StepRunner holds the lease (`leaseId`/`leaseEpoch`). P2 `Encounter.Mode` is the visible LSA-side token. P2 direct controls preempt | **PROVEN** on the ACT2 branch |
| How do reflexes preempt ACT? | The reflex always wins. ACT pauses (`auto`, resume after 3 s quiet within 60 s; a second reflex cancels) | **PROVEN** in research. GTA probe pending |
| How does conversation pause ACT? | It does not, unless native evidence shows disturbance (`player_turn` → pause, `auto_if_quiet`, ≥3 s after `PlaybackEnded`). A dialogue `DO` cancels, because it is a player command | **PROVEN** in research and ACT2 code for `DO` |
| Directed interaction vs ACT | A foreign DI blocks or pauses ACT. An LSA-initiated DI must be an ACT7 capability with an exemption token in P2 `Safe()`. Otherwise P2 suspends the character it is driving | **PROVEN** conflict (ACT research `DI1`, P2 `Safe()`) |
| Can CGE coexist without a lease? | **CGE0/1 (head/eyes) yes**, as a yielding overlay. **CGE2 body turns, no**: body orientation is ACT3 `stop_and_face` under the lease. CGE2 should request that capability or be dropped | **PROPOSED** (resolves a planned duplicate) |
| Player activity vs autonomous Director activity | The player tier always wins. A `director_*` activity is not resumable once a player source has touched the actor (ACT §9.4) | **PROVEN** in research |
| Can two systems command the same ped at once? | **Serialized** today: P2 control → `Preempt` on the owner fiber; dialogue `DO` and ACT both go through Essential's queue, and the foreign callback → `SUPERSEDED`. **Remaining paths:** CGE plan vs Essential look (R-09); PS7 DI vs ACT (R-08); third-party RPH mods tasking without mission-entity flags (**UNKNOWN**; ACT `superseded_external` detects it after the fact) | mixed |

---

## 9. ActionReceipt is not witness knowledge

The four layers are **PROPOSED** as canonical; the basis for each is labeled.

| Layer | Who knows | Source | Example | Basis |
|---|---|---|---|---|
| 1. Executor self-knowledge | The acting character only | ACT `ActionReceipt`/`ActivityFact` with evidence strength. Dialogue `DO` needs `C-05` | "I started following you" (`MODE_ESTABLISHED`) ≠ "I got in the car" (`PHYSICALLY_COMPLETED` by seat occupancy) | ACT receipts **PROVEN** on the branch; dialogue receipt **MISSING** |
| 2. Physical-world outcome | Nobody (engine truth) | Plane 2 samplers: seat occupancy, position bands, pose, `IS_PED_USING_SCENARIO`. Published as raw signals | Ped X now occupies seat 0 of vehicle V | PS1 producers **PROVEN** (`vehicle_transition`, `location_changed`, `activity_changed`) |
| 3. Witness observation | Each observer with a witnessed receipt | PS2 `WitnessPolicy` over layer-2 signals | "I saw someone get into the car" (no name unless recognized) | **PROVEN**. `VisualRange("action_callback") = 0` → callbacks never produce observations (`E11`) |
| 4. Memory | The character, durably | PS5 writer: committed speech acts + consumed observations with `memory:'stage'` + self facts at ≥ established strength. Provenance + timeline | "Yesterday Alex agreed to wait for me" | **PROPOSED** (PS5) |

ActionReceipts must never be broadcast as world knowledge. On `main` this already holds, because callbacks produce no witness receipts. Keep it as a **locked** rule, and do **not** "fix" `action_observed` by giving callbacks a visual range.

---

## 10. Persistence and timelines

### 10.1 Store audit

| Store / data | Location / owner | Schema state | Verdict |
|---|---|---|---|
| P1 identity registry (aliases, CharacterId, revisions, **voice assignment**) | `identity/characters.v1.json`, companion `CharacterRegistry` | versioned and validated | **Keep. Sole identity and voice authority** |
| P2 character profiles (biography, personality, relationship text, notes) | `characters/profiles.v1.json`, `ProfileStore` | `PROFILE_SCHEMA = 1`, `PROFILE_MIGRATIONS = new Map()` (empty) (`profileStore.mjs:7,11`) | **Keep. The single durable character store** |
| Manual memories (`memoryId`, category `note\|relationship\|promise\|event\|biography\|other`, `relatedCharacterIds ≤ 8`, `selectedForContext`) | inside P2 profile | v1 | Keep. Note that the existing `promise` and `relationship` categories overlap with planned commitments and edges (below) |
| Voice | P1 `voiceAssignment` (resolution: `voiceResolver.mjs:18`). P2 `profile.voiceReference` is set at promotion (`characterService.mjs:121`) and read only for display (`editorServer.mjs:32-33`, `currentDescribe.mjs:20`) | — | **Duplicate, display-only** (`R-21`). Derive the display value from P1 |
| PS5 experiential memories | planned in P2 (schema **v2**: nullable `eventMetadata`, bounded `memorySuppressions`; PS/SD research line 221) | planned | Correct home |
| Relationships | P2 text + `relationship` memories today. PS7 edges planned | planned | Edges belong in P2, as observer-owned views |
| Traits / personality | P2 free text. PS3 consumes a closed `traitPolicies` enum that **no store provides** | gap | Add a closed, editor-controlled `traitPolicies[]` to the same v2 envelope |
| Commitments, home anchor (ACT7) | planned in P2 (`commitments: []`, `homeAnchor: null`, "v2 with PS5, or v3"; ACT research line 1176) | planned | Correct home. Must ride the same v2 |
| Timeline / save information | **none** | — | **Missing owner** (`C-07`) |
| Configuration | `e1.config.json` (companion), `LSA.PromotedCharacters.json` (native), `LSA.Enhanced.json` (UX). `worldProfileId` and `intelligence.mode` are **duplicated** between native and companion configs, and radio requires "both intelligence configs" | — | Fragmentation (`R-15`) |
| Radio catalog | `data/radioTracks.v1.json`, static and bundled | versioned | Not character state. Fine |
| Telemetry / dialogue logs | JSONL with retention | — | Never a memory source (identity research: "no transcript/telemetry backfill"). Lock |

**Answer:** P2 is the correct durable authority for all future character state. Do not add a separate memory database (the identity research's `CharacterMemoryService` journal is superseded, §16), a commitments database or a relationships database. Never store runtime handles. Never restore active tasks: commitments are descriptive, and summon/reload never auto-executes them. The ACT7 rule is already settled; lock it.

### 10.2 One controlled migration (PROPOSED, `C-08`)

There are three serial bumps on the roadmap: PS5 → v2, ACT7 → v2 or v3, and PS7 edges → v3 or v4. Replace them with **one v2 envelope landed before PS5**. All new fields are empty or nullable, so the migration is a pure, lossless function. A v1 backup is kept, there is no automatic downgrade, and v2 readers accept partially empty data.

```text
profiles.v2.json
 store: { schemaVersion: 2, worldProfileId, timelines: [{timelineId, label, createdUtc, checkpoint?}],
          activeTimelinePolicy: "explicit" }                              ← C-07
 profile[CharacterId]: {
   canon: biography, personality, relationshipText, notes      (timeline-agnostic, editor-owned)
   traitPolicies: []                                           (closed set; PS3 input)
   memories[]: { …v1 fields…, timelineId?: null, eventMetadata?: null }   (PS5 fills)
   memorySuppressions: []                                      (PS5)
   relationshipEdges: []  { subject: SubjectRef, timelineId, stance, provenance }  (PS7)
   commitments: []        { commitmentId, timelineId, status, provenance }          (ACT7)
   homeAnchor: null       { placeRef (named location id | coordinates), timelineId? } (ACT7)
   revision }
 SubjectRef = { kind: "character", characterId } | { kind: "protagonist", key } | { kind: "local", ref }
```

`SubjectRef.protagonist` implements the identity research's still-open rule (line 216): "the player" is not one durable person in GTA V story mode. Relationships must not pool across protagonist switches (`C-15`).

### 10.3 How the identifiers relate

```text
worldProfileId (universe/mod setup; namespaces aliases)
   └─ timelineId (one playthrough/save lineage; durable experience is scoped to it)   ← MISSING today
        └─ CharacterId (P1; timeline-agnostic identity + voice)
             └─ profile revision (CAS on the whole profile)
                  ├─ canon (timeline-agnostic)
                  └─ timeline-scoped: memories(eventMetadata) · relationship edges · commitments
```

**Diagram 7 — Persistence, profile and timeline layout.**

```text
 ╔═════════════ P1 (owner: identity) ═════════════╗     ╔══════════ P2 ProfileStore (owner: character state) ═════════╗
 ║ characters.v1.json                              ║     ║ profiles.v2.json  (ONE file, ONE writer service)           ║
 ║  alias (worldProfileId, namespace, key)         ║     ║  canon (timeline-agnostic; editor)                          ║
 ║   → CharacterId  · voiceAssignment · revisions  ║◄────║  timeline-scoped: memories · edges · commitments · home     ║
 ╚══════════════════════╤══════════════════════════╝ ref ║  writers: editor (manual) · PS5 memory writer · ACT7 writer ║
                        │                                ╚══════════════════════╤══════════════════════════════════════╝
                        │ binding only from fresh owner proof                    │ reads filtered by ACTIVE timeline
                        ▼                                                        ▼
 ╔════ RAM ONLY (never persisted) ═══════════════════════════════════════════════════════════════════════╗
 ║ RuntimeBindings · incarnations · captureRefs · episodes/observations · PS3 ledger · ACT leases/tokens ║
 ║ dialogue history · DirectorTickets · UX4 generations — all void on host run / epoch / clock change    ║
 ╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝
 ╔════ TimelineGuard (C-07, MISSING) ════════════════════════════════════════════════════════════════════╗
 ║ active timeline is EXPLICIT (player-selected per save lineage); rollback suspicion (GameTime regression,║
 ║ candidate SP stat/date probes — UNKNOWN reliability) ⇒ fail closed: hide timeline-scoped records newer ║
 ║ than the checkpoint, never delete; canon unaffected                                                    ║
 ╚═══════════════════════════════════════════════════════════════════════════════════════════════════════╝
```

**Save rollback (scenario H).** Without a proven save hook (**PROVEN** absent), the only safe default is the identity research's: an **explicit** timeline selection, and failing closed on ambiguity. The candidate detection signals are **UNKNOWN** and need a probe: game-clock regression (already used), in-game calendar date, and monotonic story-mode stats such as total playing time. They are hints. None of them is proof.

---

## 11. Feature-state model

### 11.1 Today

| Layer | Mechanisms today | Label |
|---|---|---|
| Compiled | Build manifests, source-pinned Essential hooks (48 patches), `nativeSupport` pin files, ACT `pins` in `activity-capabilities.v1.json` | **PROVEN** |
| Configured | `enabled` booleans (P1, P2, input, ui); `mode` with different vocabularies (P1 `shadow\|voices`; intelligence `off\|shadow`; radio `shadow`; CGE plan `off\|shadow\|active`; PS/SD research `off\|shadow\|context\|memory\|initiative`); `quickCommands.ordinaryNpc ask\|direct\|off`; E6 flag pairs; ACT per-capability `capability_enabled` | **PROVEN** fragmentation |
| Runtime-supported | Per-pipe `hello.capabilities` (PS), ACT hello and diagnostics, P1 heartbeat lease, P2 request success, UX bridge availability, `playerSpeechGate: 'unsupported_capture_receipt'` | **PROVEN** (per subsystem) |
| Physically validated | Prose status docs only | **PROVEN** (no machine-readable record) |
| Active effect | Computed separately by each subsystem | **PROVEN** |

### 11.2 Canonical model (PROPOSED, `C-09`)

Every capability key, such as `ps.speech_heard`, `act.follow_person`, `ux4.ptt`, `cge.gaze` or `radio.facts`, has five independent facts. The **active** state is derived and never configured directly:

```text
active(cap) = compiled(cap) ∧ configured(cap) ∈ {shadow, active}
            ∧ runtimeSupported(cap, hostRunId) ∧ ¬suspended(cap)
            ∧ (validated(cap, payloadHash) ∨ configured(cap) == shadow ∨ experimentalOptIn(cap))
effect allowed only when active(cap) ∧ configured(cap) == active
```

Use **one mode vocabulary**: `off | shadow | active`, plus capability-specific sub-flags where research needs stages (PS `context/memory/initiative` become separate capability keys, not more modes). Add a **thin capability/health registry** in the companion, keyed by `hostRunId` (`C-13`). It is fed by every hello and diagnostics frame plus a machine-readable `validation.v1.json` committed with each acceptance session, and it is read by F11 Diagnostics, the editor, PS, ACT and the Director.

This is a *read model*. It does not take decisions away from the subsystems. Each subsystem still enforces its own gates, and the registry only stops each one inventing its own availability logic for **other** subsystems. Do not build more than this.

---

## 12. Interruption, cancellation and supersession

### 12.1 Cross-system matrix

Labels: **P** = PROVEN in code or pinned evidence; **S** = STRONGLY SUPPORTED (research or design, consistent); **X** = PROPOSED canonical behavior; **U** = UNKNOWN (GTA probe). "—" means unaffected.

**(a) Dialogue columns**

| Event ↓ / effect → | Model generation | Audio | Dialogue history |
|---|---|---|---|
| Normal player dialogue (new turn for N) | previous generation superseded; companion `abortTurn` (P) | previous playback interrupted (P) | previous assistant reply **not** committed; player input committed once (P) |
| Player PTT barge-in while N speaks | aborted (P) | `PlaybackEnded{interrupted}` (P) | no assistant commit; **an action already published stays executed** (P) → O-1 |
| NPC playback start/end | turn completes on matching end (P) | Essential owns (P) | assistant committed only on matching completed `PlaybackEnded` (P) |
| Reflex event | Essential may start its own reflex session (S); effect on an in-flight LSA turn **U** | **U** | E1 rule (P) |
| Damage / threat | no automatic turn; later a PS6 urgent ticket only if admitted (X) | **U** under reflex | — |
| ACT step dispatch/terminal | — (ACT4: next turn sees SELF facts) (X) | — | — |
| ACT activity pause/cancel | — (X: next turn knows why it stopped) | — | — |
| P2 Follow (direct) | — (the "ask" variant is a normal turn through `SendTextPrompt`) (P) | — | — / normal turn (P) |
| Vehicle entry | — | — | — |
| Driving | — | — | — |
| Combat | none LSA-initiated (X) | **U** | E1 rule (P) |
| Directed interaction (foreign) | Essential DI turns (P) | Essential (P) | E1 rule (P) |
| Director speech (PS6) | special turn when quiet; `CancelIfPlayerStartsTurn` (S research) | interruptible (P) | internal event never becomes fake player input (P) |
| Director physical proposal (ACT7) | none, or a paired speech ticket. Physical starts after speech completes unless urgent (X) | — | — |
| CGE gaze | — | — | — |
| Mission / cutscene | new UX4 PTT refused (`scripted_state`) (P); Essential's own behavior **U** | **U** | E1 rule |
| Player switch | UX4 refuses (P); **U** | **U** | — |
| Foreign script ownership | **U** | **U** | — |
| P2 dismissal | session no longer current; identity effects dropped (S) | **U** | session history ends; returning character gets fresh history (P) |
| Ped death | **U** | **U** | not committed unless playback completed (P) |
| Ped recreation | old tuple rejected (P) | cannot reach new ped (P) | fresh session/history (P) |
| Companion disconnect | provider work aborted; turn fails (S) | no authorization → no playback (S) | RAM history lost by design (P) |
| Addon / host reload | all sessions retired (S) | **U** | — |

**(b) Physical columns**

| Event ↓ / effect → | Physical step | Activity | Commitment | Owner binding |
|---|---|---|---|---|
| Normal player dialogue | unaffected unless the turn's `DO` dispatches → `SUPERSEDED` (P, ACT2) | modes continue; pause only on native disturbance (S) | — | unchanged (P) |
| PTT barge-in | `DO` already dispatched continues (P) | as above | — | — |
| NPC playback | Essential approach "act-then-speak" gate exists for approach only (P, N12) | `auto_if_quiet` timer runs from `PlaybackEnded` (S) | — | — |
| Reflex event | superseded; detected from `NpcState` (reflex variants bypass the executor, N9) (P) | pause `auto` (≥3 s quiet, ≤60 s; second reflex cancels) (S) | — | unchanged unless control is released (S) |
| Damage / threat | injury → cancel `actor_injured` (S) | injury cancel (S) | — | — |
| ACT step | executor bumps the command generation and takes exclusive control (P, N8) | continue/retry/finish (P) | progress only from ≥ established evidence (X) | **Mode token set to `idle` on every non-preempt terminal, even `DETACHED`** (P) → O-2 |
| ACT activity pause/cancel | stop API only if still ours, else `DETACHED` (P) | terminal, or paused with a RAM `ResumeToken` (P) | unchanged, descriptive (X) | lease released or kept per policy (S) |
| P2 Follow (direct) | `Preempt` → `EndOwnership(preempted)` (P) | `superseded_player`, never resumed (P/S) | — | `Mode=follow` (P) |
| Vehicle entry | executor policy per command (P, N9); seat adapter in ACT3 (S); order-dependent race with player entry (P, ROADMAP) | unplanned change → pause `auto_if_quiet` (S) | — | P2 seat flags disabled during activities and restored after (P) |
| Driving | `TASK_VEHICLE_DRIVE_WANDER` only; no drive-to (P, N4) | drive adapter (ACT3/ACT6) (S) | — | — |
| Combat | not an ACT capability (`never`) (P); Essential/GTA own it | reflex/injury rules (S) | — | — |
| Directed interaction (foreign) | preflight rejects (P) | pause `explicit_only` (S) | — | P2 `Suspended` via `Safe()` (P) |
| Director speech | none (X) | unaffected (X) | — | ticket bound to exact anchors, consumed once (S) |
| Director physical proposal | ACT arbitration below the player tiers (X) | new activity; not resumable after a player touch (S) | may fulfil (X) | lease plus `Mode=activity` (X) |
| CGE gaze | none: head-only, never `ClearPedTasks` (S plan) | — | — | — |
| Mission / cutscene | P2 suspends without task clearing (P); ACT pause `explicit_only` (S) | token 120 s (S) | descriptive (X) | `Suspended` (P) |
| Player switch | player anchors void (S) | cancel, never resume (S) | protagonist-scoped (X, `C-15`) | — |
| Foreign script ownership | P2 suspends (P); ACT `superseded_external` (S) | pause `auto_if_quiet` → `explicit_only` (S) | — | `Suspended` (P) |
| P2 dismissal | release control (P); ACT `actor_retired` (S) | cancel (S) | durable (X) | registration revoked; CharacterId kept (P) |
| Ped death | fail `actor_dead` (S) | goal fails (S) | kept; mortality is owner policy (P design) | dead-release → `OnPedControlChanged(false)` → P2 suspend (P, N19) |
| Ped recreation | old receipts → `StaleReceipts` (P) | old `ResumeToken` void (P) | retained; never auto-executed (S) | new incarnation; CharacterId and voice kept (P) |
| Companion disconnect | lease expiry → `cancel_if_current` or `detach` (P) | abandoned `lease_lost`/`epoch_changed` (P) | durable (P) | bindings empty; fresh proof needed (P) |
| Addon / host reload | shutdown → `control_released`, `DETACHED` (P) | abandoned (P) | durable | owner evidence revoked; new epochs (P) |

**(c) Knowledge and presentation columns**

| Event ↓ / effect → | Observation | Memory write | Gaze | Target selection |
|---|---|---|---|---|
| Normal player dialogue | N's playback → `speech_heard` for witnesses (P); player hearing gated (P) | none (P); PS5 only from committed history (X) | Essential mic look (P API); CGE through `UtteranceLifecycle` (X) | committed input sets the partner (P) |
| PTT barge-in | partial NPC speech heard (P) | PS5 records "interrupted", not unsaid text (X) | Essential switches (S) | same or new partner (P) |
| NPC playback | `speech_heard` (P) | speech act eligible after commit (X) | `ConversationLookBehavior.Start/Stop(turnId, generationId)` (P API); CGE yields (X) | **UX4 has already cleared the partner** (P) → O-3 |
| Reflex event | **no reflex producer in PS** (P) → O-5 | — | Essential reflex owns; CGE releases (X) | — |
| Damage / threat | episodes → witnessed observations; PS3 urgent/must_include (P shadow) | PS3 `memory:stage` only, no write (P) | CGE yields (X) | — |
| ACT step | physical-outcome signals witnessed (P); `ActivityFact` → SELF lane only (X) | none directly (X) | compatible (X) | — |
| ACT activity pause/cancel | SELF fact (X) | — | — | — |
| P2 Follow (direct) | callback mapped `other` on `main` (bug) and never observed (no witness range) (P) | — | `NpcFocus` set (P) | `encounterId` fence (P) |
| Vehicle entry | `vehicle_transition` witnessed ≤40 m (P) | — | CGE off during entry (X) | — |
| Driving | `vehicle_state`/impact; radio raw facts (player vehicle) (P) | — | **U** (look-at while driving) | — |
| Combat | firing/damage/death observations (P) | PS5 later (X) | CGE off (X) | — |
| Directed interaction (foreign) | `speech_heard` (P) | — | Essential (S) | player PTT on the ped detaches the DI (P, setter side effect) |
| Director speech | `speech_heard` (P) | PS3 acknowledgement `delivered`/`rejected` (X, `C-03`) | Essential speaker look (S) | never changes the partner (X) |
| Director physical proposal | outcome witnessed (P) | SELF fact (X) | — | — |
| CGE gaze | — | — | owner only while Essential look is inactive (X) | read-only (X) |
| Mission / cutscene | facts continue, qualified; initiative suspended (S) | — | CGE off (X) | — |
| Player switch | player `captureRef` re-minted; no merging across protagonists (S/X) | protagonist-scoped (X) | CGE off | **U** |
| Foreign script ownership | factual only (S) | — | CGE off (X) | — |
| P2 dismissal | observer leaves roster; anchors retire (S) | — | CGE releases (X) | partner may still be the ped (I) |
| Ped death | `death_seen` for witnesses (P) | PS5 later (X) | off | **U** |
| Ped recreation | old `captureRef`s retired; new tokens (P) | durable memories retained (P) | CGE epoch void (X) | old references invalid (S) |
| Companion disconnect | companion PS state dropped; native continues, bounded (S) | unflushed PS5 inbox volatile (X) | native continues (X) | native unchanged (P) |
| Addon / host reload | all anchors void (new `nativeRun`) (P) | — | stops (X) | UX4 releases its generation (P) |

### 12.2 Asymmetries and orphan-state risks

| ID | Orphan / asymmetry | Label | Fix |
|---|---|---|---|
| O-1 | A dialogue `DO` is published at `output_transcript` (`runSequentialTurn.mjs:326`) before TTS. Action-bearing turns are buffered until validation (E6), so the action is always published before any of that turn's audio plays. History commits only after playback (`:367`). An interrupted reply leaves an executed action that the NPC has no record of, and no receipt ever joins the action to the turn | **PROVEN** | `C-05` DialogueActionReceipt: join Essential's callback (canonical name, succeeded) to the publishing turn tuple. Record "I agreed to X / X is under way" in the SELF lane independently of history |
| O-2 | `Encounter.Mode` becomes `idle` after `DETACHED` (lease loss) or `SUPERSEDED` by a dialogue `DO`, while the Essential follow/wait mode continues | **PROVEN** | `C-06`: Mode records `essential:<mode>` from a sampled `NpcState`, or `unknown` |
| O-3 | UX4 clears the partner at PTT release, before the reply | **PROVEN** | Remove the clear (§4.3) |
| O-4 | PS3 marks a grant as consumed at decision time. A rejected or expired ticket suppresses the incident for 10 minutes | **PROVEN** code; impact **INFERRED** | `C-03` |
| O-5 | ACT detects reflexes (needed for pause), but PS has no reflex producer. The NPC cannot later "know" it panicked, and witnesses cannot see it | **PROVEN** | PS8 producer reading the same `NpcState` reflex fields (shared sampler) |
| O-6 | A save load without a GameTime regression leaves live anchors, receipts and tickets valid in a different world | **INFERRED** (no hook, **PROVEN**) | `C-07` plus a one-epoch signal (`C-13`) |
| O-7 | P2 Follow persists natively with no lease. ACT `follow_person` detaches on lease loss. The same physical behavior has two lifecycle semantics | **PROVEN** | Once ACT2 is GTA-validated, route P2 follow/wait through ACT as `player_direct` aliases (fold, §20) |
| O-8 | Clock-reset detection fires independently in P2, PS and ACT, so there is a window in which one table has reset and another has not | **PROVEN** (separate detectors) | `C-13` single world-epoch broadcast from the P2 host |
| O-9 | A Director ticket cancelled by player input must be acknowledged as `rejected`, not `delivered` | **PROPOSED** | `C-03` |
| O-10 | An LSA-initiated directed interaction triggers P2 `Safe()` suspension of the same character | **PROVEN** conflict (research `DI1`) | `C-11` exemption token |

**Diagram 8 — Interruption and supersession flow.** Who decides, and what each layer does.

```text
 interrupt source ──► classified ONCE by the owner of the detecting plane
   Essential (reflex, DI, death, far release, control change)  ──► P2 host: Suspend / ResetForClockDiscontinuity
   GTA/scripts (mission, cutscene, switch, foreign owner)      ──► P2 Safe()/Scripted()  (Tier 0)
   player input (PTT, Text, P2 control, UX activity, DO)       ──► Essential turn lifecycle / ACT Preempt / SUPERSEDED
   companion (lease/epoch loss, disconnect)                    ──► ACT engine (onLeaseLoss) / P1 revoke
            │
            ▼  per-layer consequences (each layer acts only on what it owns)
 ┌───────────────┬──────────────────────┬────────────────────────┬────────────────────────┬────────────────────┐
 │ SPEECH        │ PHYSICAL             │ KNOWLEDGE              │ PERSISTENCE            │ PRESENTATION       │
 │ Essential:    │ StepRunner: terminal │ PS: observations of    │ nothing durable is     │ CGE releases;      │
 │ interrupt/    │ (SUPERSEDED/FAILED/  │ outcomes; PS3 ack      │ written on interrupt;  │ UX shows reason;   │
 │ supersede gen │ CANCELLED/DETACHED)  │ rejected; SELF fact    │ commitments stay       │ partner untouched  │
 │ E1: no commit │ ACT: pause+token or  │ "why I stopped"        │ descriptive            │ except by Essential│
 │ w/o playback  │ cancel; Mode token   │                        │                        │                    │
 │               │ updated (C-06)       │                        │                        │                    │
 └───────────────┴──────────────────────┴────────────────────────┴────────────────────────┴────────────────────┘
   resume: ONLY ACT may resume, ONLY with a fresh preflight and a fresh execution; never re-resolve
           handles/aliases (ResumeToken voids on host run, epoch, incarnation, ownership change)
```

---

## 13. Physical-control authority for a promoted NPC

| Controller | Channel | Relationship to the LSA lease | Label |
|---|---|---|---|
| Rockstar mission script / cutscene / switch | primary (absolute) | LSA suspends and never fights | **PROVEN** (P2 guards) |
| Foreign RPH mods (PR, LSPDFR, others) | primary (foreign) | Guarded only for mission entities. Otherwise detected after the fact (`superseded_external`) | **PROVEN** guard; foreign tasking without the flag **UNKNOWN** |
| Essential reflexes | primary (preemptive) | Always wins; ACT pauses | **PROVEN** (N9) |
| Essential executor (dialogue `DO`, P2 controls, ACT steps) | primary | The **single funnel**. `AcquireExclusiveControl` and the command generation bump on each command (N8) | **PROVEN** |
| Essential directed interaction | primary + speech | Foreign: blocks ACT. LSA-initiated: must be an ACT7 capability (`C-11`) | **PROVEN** conflict |
| Essential follow/wait (`FollowBehavior`) | primary | Owned by whichever LSA source dispatched it; token in `Encounter.Mode` | **PROVEN** |
| Essential `UseScenario*` wrappers (ACT3) | primary | Bypass the executor: no callback and no generation bump. ACT samples `IS_PED_USING_SCENARIO` | **PROVEN** (N18) |
| Rockstar ambient AI | primary (default) | When nobody owns the ped; far release at 100 m without control intent | **PROVEN** (N13) |
| Essential conversation look / focus | gaze (+ focus) | Overlay | **PROVEN** API |
| CGE | gaze only (CGE0/1) | Overlay that yields; CGE2 body turns go through ACT `stop_and_face` | **PROPOSED** |
| Scene Director | none | Proposes only | **PROPOSED** (lock) |
| Speech (Essential playback) | speech | Independent of the physical lease | **PROVEN** |
| Perception | observation | Read-only | **PROVEN** |

**Invariant.** There must never be two independent systems that both believe they own the NPC's primary physical behavior.

- **On `main`: holds** (**PROVEN**). The only LSA primary path is P2 → Essential, under guards.
- **On the ACT2 branch: holds** (**PROVEN**). P2 controls preempt ACT on the owner fiber, and `DO` actions supersede ACT through Essential's queue order. The defect is the *opposite* failure: after `DETACHED`, **no LSA owner believes it owns** a ped that is still in an LSA-requested Essential mode (O-2).
- **In planned designs: violated in three places** (all **PROVEN** from the documents). UX4's clear-on-release is not on this list: it is a conflict over conversation state, not primary behavior (§4.3).
  1. PS7 `DirectorAdmission` starting directed interactions outside ACT (`R-08`).
  2. CGE2 body reorientation alongside ACT `stop_and_face` (`R-09`).
  3. The CGE gaze overlay running concurrently with Essential `ConversationLookBehavior` on the gaze channel (`R-09`). The CGE runtime contract never mentions `ConversationLookBehavior`.

---

## 14. Performance shape

No benchmark numbers are claimed. The project already measures native update cost (`updateMicros` in PS diagnostics, `updateMicrosP95` in ACT diagnostics), and E7 should gate on those.

| Item | Shape | Shared or duplicate | Label |
|---|---|---|---|
| Ped enumeration | PS discovery and the UX4 candidate scan **both reuse Essential's `PerceptionSystem.TryGetSnapshot`** (`IntelligenceIntegration.cs:206`, `TalkTargetSelector.cs:223`) | **Shared**. Lock: no new world scans | **PROVEN** |
| LOS checks | PS witness sampling: one `HAS_ENTITY_CLEAR_LOS_TO_ENTITY_IN_FRONT` per (signal × candidate observer ≤16) | Bounded. CGE and social routing must reuse witness receipts instead of their own LOS | **PROVEN** / **PROPOSED** |
| `NpcState` polling | P2 guards (per owned ped per tick), ACT `Sample` (per step), ACT `SampleActivityFacts` (500 ms per tracked encounter), PS activity producers, planned CGE | **Duplicate reads of the same fields.** One per-tick `OwnedPedState` sample in the P2 host could feed all of them | **PROVEN** duplication / **INFERRED** benefit |
| Radio sampler | 250 ms, edge-triggered output | Independent clock (fine) | **PROVEN** |
| IPC | P1 heartbeat 250 ms; ACT receipts throttled to 250 ms and facts to 500 ms; PS frames bounded | Four pipes plus the Essential bridge plus the DomainHost bridge plus the editor HTTP; separate epochs (`R-14`) | **PROVEN** |
| Model calls per utterance | 1 STT + 1 reasoning + 1 TTS (13/13/13 in the GTA run) | Must stay ≤1 STT. Social routing allows ≤1 primary responder plus ≤1 extra responder through a ticket | **PROVEN** / **PROPOSED** |
| Initiative | PS/SD research budgets: 32 tickets, **one global PS call in flight**, ≤4 attempted starts/min; PS7 ≤2 alternating turns, 40 s cap | Lock these numbers as defaults | **PROPOSED** (research) |
| PS5 summarization | Deterministic summaries in the research; **no model call** | Lock | **PROPOSED** (research) |

The amplification chain *utterance → N NPCs → N salience passes → N model calls → N TTS* is blocked by three things. Salience is per-observer but deterministic and local. Hearing reuses one receipt per utterance. Responders are arbitrated to one, plus at most one bounded extra. The architecture scales by **shared sensing, local deterministic filtering and bounded model calls**, provided that `C-01` (one utterance) and `C-12` (responder reservation) exist before social routing ships.

---

## 15. Adversarial scenarios

Each scenario lists the owner and identifiers at each step, then the result. ✔ means the step is handled by the canonical design, and the label says whether that handling exists today. ✘ means it is not handled.

### Scenario A — Ordinary conversation

The player selects promoted Alex with UX4 and holds PTT. Alex listens. Bea, 8 m away, overhears. Alex replies, "Sure, I'll follow you", and follows.

| # | Step | Owner | Identifiers | Result |
|---|---|---|---|---|
| 1 | `talk.select_first` previews Alex from Essential's `PerceptionSystem` snapshot | UX4 (proposal) | UX4 selection id; frozen `Ped` + `MemoryAddress` | ✔ no Essential side effects (**PROVEN**) |
| 2 | Hold → `talk.ptt_start(g)`: native gates, `mic.CanStart`, `expected encounterId` fence → `SetPlayerConversationPed(Alex)` → `SendMicStart(Alex)` | Essential (partner, mic) | generation `g`; Essential mic Ped | ✔ (**PROVEN** at `3dadbcf`) |
| 3 | `BeginMicTurn` → turn tuple; P1 binding from fresh owner proof; P0 snapshot frozen; companion `startRealtimeInput` | Essential / P1 / P0 | `(pedId, sessionNonce, turnId, generationId)`; `CharacterId(Alex)` via `incarnationId`; `P###/V###` | ✔ (**PROVEN**) |
| 4 | Alex looks at the player | Essential `StartPlayerMicLook` | — | ✔ API (**PROVEN**); CGE must yield (**PROPOSED**) |
| 5 | **Missing:** `utteranceId` and observer acoustic sampling during capture | — | (`C-01`) | ✘ today (`receipt: null`) |
| 6 | Release → `talk.ptt_stop(g)` → `SendMicStop` → **`ClearPlayerConversationPed`** | UX4 / Essential | — | ✘ defect (§4.3) |
| 7 | STT once → `finalInput` → `commitPlayerInput` | companion | transcript (no `transcriptRef` today) | ✔ (**PROVEN**) |
| 8 | Bea's hearing → `speech_heard` observation → PS3 decision for Bea | PS2 / PS3 | `captureRef(Bea)`, `observationId` | ✘ gated until `C-01` (**PROVEN** gate) |
| 9 | Knowledge → Luna → decision `{speech, DO followtarget → P001/player}` → `validateStockDecision` | companion | `P###` fence | ✔ (**PROVEN**). Knowledge is raw JSON today (§6) |
| 10 | Action published at `output_transcript` → Essential queue → `TryExecute` → `OnNpcActionExecuted('followtarget', true)` | Essential | canonical action name | ✔ execution; ✘ no receipt joined to the turn (`C-05`); PS1 maps it to `other` on `main` |
| 11 | TTS → playback auth → `ConversationLookBehavior.Start(Alex, player, turnId, generationId)` → `PlaybackEnded` → assistant commit | Essential / companion | tuple | ✔ (**PROVEN**) |
| 12 | Bea "sees" Alex start following | PS2 | only through physical-outcome signals within witness range | ✔ by design (callbacks are never witnessed) |

**Verdict:** the dialogue core is sound. The gaps are the utterance join, UX4's clear, and the dialogue-action receipt.

### Scenario B — Group conversation

Promoted A, B and C all hear one utterance. A is addressed (selected or named). B has a close relationship. C is a bystander.

- **One** utterance and **one** STT (`C-01`). The mic Ped is A, so **A responds** as the primary turn (**PROVEN** mechanism).
- Hearing: the receipt marks A, B and C as `heard`.
- Social routing (PS7-era, **PROPOSED**): A is `addressed`, B is `may_respond` (PS3 gives B `context:must_include`/`response:eligible` through the relationship branch, which needs `C-02` plus recognition), and C is `overheard`.
- B may speak **only after A's playback ends**, through one Director ticket (`CancelIfPlayerStartsTurn`, one PS call in flight). C never speaks.
- **Who remembers** (PS5, **PROPOSED**): A keeps first-person dialogue from committed history. B and C get "overheard" experiential records only if their decisions had `memory:'stage'` *and* the consumption was acknowledged.
- If the player said "Hey B" while A was the mic Ped, A needs a **turn-yield**. That does not exist, and Essential's handling of a deliberately silent turn is **UNKNOWN** (`C-12`).

### Scenario C — Interrupted activity

Alex is running ACT `follow_person` (`player_standing`, lease L, `Mode=activity`). The player talks to Alex. Gunfire starts, Alex reflexes, and the conversation ends.

1. The turn starts. The follow mode survives the turn, so there is no interrupt unless native evidence shows disturbance (**STRONGLY SUPPORTED**, probe U3).
2. Gunfire produces PS firing → episode → Alex's observation → PS3 `urgent` (shadow, **PROVEN**). The Essential reflex takes the primary channel (Tier 1).
3. StepRunner detects the reflex from `NpcState` → `SUPERSEDED (superseded_reflex)`. The activity pauses with a `ResumeToken` (**STRONGLY SUPPORTED**; **PROVEN** detection path on the branch). If the reflex interrupts playback, the reply is not committed (**PROVEN** rule). Whether a reflex interrupts LSA playback at all is **UNKNOWN**.
4. **Who decides what resumes:** only the ACT engine. **PROPOSED** rule: resume requires *all* active interrupt policies to be satisfied (reflex `auto` ≥3 s inactive, ≤60 s, and `player_turn` `auto_if_quiet` ≥3 s after `PlaybackEnded`), followed by a fresh preflight and a new `executionId`.
5. **What is cancelled:** a second reflex, an injury, or a player `DO` / P2 command during the conversation (`player_command` → cancel, never resumed).
6. PS6 (later) may issue one warning ticket after the reflex, but never during player input or playback. Essential's `LastReflexRequestedGeminiSession` suppresses duplicate warnings (PS/SD research).
7. Gap: PS has no reflex producer (O-5), so Alex cannot later "know" it reflexed.

### Scenario D — Vehicle race

ACT3 asks Alex to enter the passenger seat. Meanwhile the player enters the driver seat and Bea (also promoted) approaches the same passenger door.

- **Seat truth:** GTA. **Tasking:** Essential (`entertargetvehicle`, executor policy 3, immediate; N9). **Intent and evidence:** ACT (`enter_vehicle_seat` preflight `vehicle_valid`/`vehicle_not_moving`/`seat_free`; seat-occupancy adapter).
- `HANDLER_ACCEPTED` on the callback. `PHYSICALLY_COMPLETED` **only** when Alex occupies the requested seat (**STRONGLY SUPPORTED**, research).
- P2's standing seat flags are disabled during the activity and restored afterward (**PROVEN** on the ACT2 branch).
- **Gap 1:** no cross-actor seat claim exists. Two LSA-owned activities can target the same seat. **PROPOSED:** a RAM seat-claim table in the ACT engine keyed by (vehicle `captureRef`, seat index), applied to LSA-issued steps only.
- **Gap 2:** order-dependent entry (ROADMAP regression target) and Smart Vehicle Entry interference (research U5) are **UNKNOWN**.
- If Bea wins the seat, Alex's step fails with `seat_occupied`/`seat_unavailable` (one replan at most), and the receipt records it. Nobody claims completion.

### Scenario E — Scene Director proposal

The Director decides Alex should warn the player and then move to cover.

- **Speech owner:** Essential, through one `DirectorTicket` special turn (PS6). The Director owns only the reservation.
- **Physical owner:** ACT (`take_cover`, `director_urgent`, ACT3 capability, ACT7 proposal path) under the lease.
- **Can the step begin before speech completes?** **PROPOSED:**
  - For `urgent`, yes. Speech and locomotion are different channels, and Essential's approach playback gate is the precedent for coordinating them. The speech must describe intent, not completion ("Get down, I'm moving to cover").
  - For `routine`, no: speech first, then the activity after `PlaybackEnded`.
- **Player interrupts:** `CancelIfPlayerStartsTurn` cancels an unstarted ticket, and a playing warning is interrupted by Essential. The `take_cover` activity continues unless a player-tier command arrives. Once a player source touches Alex, the director activity is not resumable (ACT §9.4).
- PS3 receives `rejected` or `delivered` (`C-03`).
- **Gap:** the paired halves need a shared `directorIntentId`, so that cancelling one can cancel the other (`C-11`).

### Scenario F — NPC↔NPC exchange

Promoted A is talking to NPC B (PS7 exchange). The player approaches and starts PTT on A.

- **Exchange lifecycle:** the Director owns the script and budgets (≤2 alternating turns, 40 s). ACT7 owns the directed-interaction lease (`C-11`). Essential owns the DI and every turn. Each line has its own tuple and ticket, and the DI id comes from Essential.
- **Audience:** each line is heard per PS2 receipts. The player is one of the hearers.
- **Player PTT on A:** `SetPlayerConversationPed(A)` **detaches the conflicting DI** (**PROVEN** side effect = player takeover). Pending tickets are cancelled, and A's current line is interrupted with no commit. ACT ends the DI activity (`cancelled_by_player`). The exchange record says "interrupted by player".
- **Gaze:** Essential's DI look hands over to the player's mic look. CGE yields.
- **ACT suspension:** with `C-11`, P2 does not self-suspend A for an LSA-owned DI. Without it, A is suspended (**PROVEN** `Safe()` rule).
- **Social routing:** the player's utterance is heard by A and B. A is addressed.

### Scenario G — Identity recreation

Alex despawns and is later summoned.

| Requirement | Mechanism | Label |
|---|---|---|
| CharacterId survives | P1 registry plus P2 profile | **PROVEN** |
| Old `captureRef` does not | Anchor retired on nonexistence or address mismatch; new wrapper gets a new token | **PROVEN** |
| Old action receipt cannot complete | StepRunner compares `IncarnationId` → `StaleReceipts` | **PROVEN** (ACT2) |
| Old turn cannot publish | Old binding retired. `identityService.current` gates `hostFor`, and the Essential tuple differs | **PROVEN** |
| Old observation cannot target the new incarnation | Observations are per observer `captureRef`; retired anchors are rejected | **PROVEN** |
| Durable memories survive | Keyed by CharacterId | **PROVEN** |
| UX4 stale selection | `expected encounterId` → `target_changed`/`target_lost` | **PROVEN** |
| ACT non-player targets | Private table has address checks only, no owner-incarnation check | Gap until `C-02` |

### Scenario H — Save rollback

Alex gains a memory, a relationship change and a commitment. The player then loads an earlier save.

- **Today:** only manual memories exist, and they are canon by the player's choice. A GameTime regression resets RAM state in P2, PS and ACT (**PROVEN**). Durable records are untouched, and there is **no `timelineId`** (**PROVEN** gap).
- **With PS5, PS7 and ACT7 as planned:** future experience would leak backward (**INFERRED**).
- **Canonical (PROPOSED):** `C-07` TimelineGuard.
  - Every timeline-scoped record (memory `eventMetadata`, edge, commitment) carries `timelineId` and its formation point.
  - The active timeline is **explicit** (player-selected per save lineage).
  - A rollback suspicion fails closed: newer timeline-scoped records are hidden, never deleted. Canon is unaffected.
  - Automatic detection signals are **UNKNOWN** and need a probe.

### Scenario I — Mission / cutscene

Alex has an active ACT plan and enters a scripted state.

- P2 `Safe()`/`Scripted()` → `Suspend`. Only LSA flags are cleared. There is no task clearing and no exclusive-control release, because the PS/SD research notes that a release can clear tasks (**PROVEN**).
- ACT `scripted_state` → pause `explicit_only`, with the native step left `DETACHED` (**STRONGLY SUPPORTED**).
- PS facts continue, qualified. Initiative is suspended.
- The UX4 start gate refuses PTT (**PROVEN**). CGE is off.
- After the mission, **only an explicit player resume** is possible (token 120 s), with no automatic rejoin (**PROVEN** P2 policy, mirrored by ACT).
- **No task fight:** ✔, provided the Director's admission includes the mission guard (it does, per PS/SD research).

### Scenario J — Failure storm

The provider fails while Alex is taking damage. Alex's activity is superseded, the activity target disappears, and speech is interrupted.

| Lifecycle | Terminal | Label |
|---|---|---|
| Turn | E3 bounded retries (no TTS retry after the first PCM or on action turns) → `failTurn` → Essential terminal. Player input committed once, no assistant commit | **PROVEN** |
| Playback | `PlaybackEnded{interrupted}` → no commit | **PROVEN** |
| Step | `SUPERSEDED`, or `FAILED (actor_injured)` | **PROVEN** / **STRONGLY SUPPORTED** |
| Activity | paused with deadline ≤120 s → expires, or cancel; target lost → `target_retired`, with **no retargeting** | **STRONGLY SUPPORTED** |
| Observation | damage observed; target anchor retired → later signals about it are stale-rejected | **PROVEN** |
| PS3 decision | must be acknowledged `rejected`/`expired` | **PROPOSED** (`C-03`) |
| Director ticket | 2 s expiry; a timeout retires the reservation; late receipts cannot revive it | **STRONGLY SUPPORTED** (research) |
| UX4 generation | stop retried; no new hold until resolved | **PROVEN** (`3dadbcf`) |
| Utterance | `cancelled`/`empty` terminal | **PROPOSED** (`C-01`) |
| Orphan | an executed `DO` is unremembered (O-1) | **PROVEN** risk |

Every *implemented* lifecycle reaches a deterministic terminal state. The planned ones need `C-01`, `C-03` and `C-05` to do the same.

---

## 16. Superseded / corrected findings register

History is not rewritten. Each row records how understanding evolved.

| # | Earlier claim | Source | Newer evidence | Status | Canonical replacement |
|---|---|---|---|---|---|
| S-01 | Essential's activity queue (`CurrentActivity`, `ActivityInProgress`, `NpcActivityQueueItem.Started/Completed`) can report activity progress or completion | action-completion audit `8e82331` | ACT research N1/N2: fields written only by the ctor or the clear helper and never read | **Superseded** | No native activity completion. ACT completion adapters on physical evidence |
| S-02 | WalkTo/DriveTo destination state machinery is usable | action audit | N3/N4: destination flags only cleared; `DestinationResolver.TryResolve` has no callers; no navigation-to-coordinate tasks; `StartDriving` = wander | **Superseded** | ACT6 registered extensions (`lsawalkto`/`lsadriveto`) after probes |
| S-03 | `BridgeMessageRouter` has destination/activity special cases | action audit §3 | N6: only `approachperson` is routed specially; `0x6001523` is a parameter predicate | **Corrected** | Queue for everything except approach |
| S-04 | `TryExecute == true` means the action happened | early integration assumptions | action audit + ACT: handler acceptance ≠ completion | **Superseded** (already reflected in ROADMAP) | Receipt ladder (§8) |
| S-05 | PS1 action callbacks carry `follow`/`wait` | PS0/PS1 on `main` (`IntelligenceIntegration.cs:318`, `contracts.mjs:31`) | N5: `TryExecute` passes the **canonical** name; ACT0/1 changed both sides to `followtarget`/`waithere` | **Contradicted** (fix unmerged) | Canonical tokens. Contract test on both sides (`R-10`) |
| S-06 | Scene Director admission starts NPC↔NPC directed interactions natively | PS/SD research (`be6b562`/`e1d0bd1`, PS7, `DirectorAdmission.cs`) | ACT research (ACT7, registry `directed_interaction` "PS7 via ACT7"); P2 `Safe()` suspends during any DI | **Superseded / conflict** | Director proposes; ACT7 executes the DI with a P2 exemption token (`C-11`) |
| S-07 | A separate `CharacterMemoryService` journal and materialized views | identity research `ebc42bf` §memory | P2 ProfileStore implemented; PS/SD research PS5 writes into P2 schema v2 | **Superseded** | One P2 store (§10) |
| S-08 | Identity research phases "P0–P8" (including "P3 projection") | identity research | Current roadmap (P0–P2, PS0–PS8, ACT0–ACT7) | **Superseded naming** | Roadmap names |
| S-09 | Speech hearing can be decided after STT from current proximity | early speech assumptions (rejected in ROADMAP/PS2) | PS2 source-time receipt contract; ROADMAP "post-STT proximity is not accepted" | **Superseded** | Source-time `UtteranceLifecycle` + receipt (`C-01`) |
| S-10 | UX4 can pre-set `PlayerConversationPed` and synthesize the Talk key | UX4 initial design | T0A: stock Talk recomputes `GetBestConversationPed` | **Superseded** (by UX4 itself) | `SetPlayerConversationPed` + `SendMicStart(ped)` at commit |
| S-11 | UX4 stop may stop a newer stock mic; a failed stop clears ownership | UX4 `9c1736a` | `3dadbcf`: `EssentialMicState` ownership; retry; no new hold while unresolved | **Corrected** | Keep, after fixing the clear-on-release (§4.3) |
| S-12 | "P2 … has not been validated in GTA" | `README.md:58` | ROADMAP + P2 status: exercised in GTA | **Stale** | ROADMAP wording |
| S-13 | PS3 "not deployed", "unmerged on feature branch" | ROADMAP `8c63b20` | Deployment receipt 2026-10-05T13:28:34Z from local `stage/ps3-ready-20261004@101b212` | **Stale** (newer evidence) | "Reconciled locally, deployed shadow, not merged, GTA acceptance pending" |
| S-14 | PS3 stage verification: "321/322, environment block" | stage manifest `offlineNodeSuite` | This audit: test-file SyntaxError skipped 60 tests; 382/382 after a one-identifier fix | **Misleading** | Record as a test-code defect; fix and rerun before merge |
| S-15 | Radio `radio_heard` → PS3 `context: "low"` | radio research `7f6ad8e` §9 | PS3 enums are `omit\|candidate\|must_include` | **Contradicted** | `candidate` (or `omit`), `memory:none`, `response:none` |
| S-16 | Radio gets its own knowledge projection selector | radio research §10 | This audit `C-04` | **Superseded** (proposed) | A radio lane inside the PS4 assembler |
| S-17 | ACT resumes using `EntityAnchors.Resolve(captureRef)` | ACT research §9.4 | ACT2 builds a private capture table (`ActivityDispatch.cs:22-25,51-53`) | **Implementation drift** | Shared anchors (`C-02`) |
| S-18 | PS3 relationship/memory/trait salience is live | PS3 design / engine branches | `shadowRuntime.mjs:91` passes only `activity:'idle'` | **Needs narrower wording** | "Inactive until `C-02` + recognition"; live activity `unknown` |
| S-19 | `Encounter.Mode` = `follow\|wait` | P2 on `main` | ACT2 adds `activity\|idle`; dialogue `DO` not reflected; `idle` after `DETACHED` | **Needs narrower wording** | LSA-side primary-behavior token including residual Essential modes (`C-06`) |
| S-20 | The P2 16 KiB canon projection is the character's whole model knowledge budget | P2 status (projection limits) | PS4/ACT4/radio add lanes | **Still correct, needs narrowing** | P2 canon = SELF-lane cap inside the PS4 global budget; selected memories move to a recognition-gated RECALLED lane |
| S-21 | Runtime baseline `main@0c254049` | ROADMAP | `origin/main = 8c63b20` (docs only on top) | **Still correct, needs narrowing** | "Code baseline `0c25404`, docs head `8c63b20`" |
| S-22 | CGE target and player-speech signals can be found independently in CGE0 | CGE plan | This audit (§5, §13) | **Superseded** (proposed) | CGE consumes `C-01` and yields to `ConversationLookBehavior` |
| S-23 | Scene Director "executes" coordinated behavior (ROADMAP prose: "NPC speaks and/or acts") | ROADMAP Scene Director section | PS/SD + ACT research | **Needs narrower wording** | Director proposes; Essential/ACT execute |

---

## 17. Missing contracts

The full specifications (fields, owner and phase) are in [system-contract-register.md §3](system-contract-register.md#3-missing-contracts-proposed). Each entry below was confirmed missing in current code.

| ID | Contract | Why needed | Current workaround | Smallest interface | Phase |
|---|---|---|---|---|---|
| C-01 | **UtteranceLifecycle v1 + SpeechCaptureReceipt v2** | One "player spoke" for dialogue, PS2 hearing, social routing, CGE, UX4 HUD and memory | `receipt: null`; `playerSpeechGate` off; CGE plan to find its own seam | Native event `{utteranceId, hostRunId, micPed captureRef, inputSource, selectionProvenance, start/endGameTick, terminal}` + turn join `(pedId, sessionNonce, turnId)` + transcript annotation `utteranceId → transcriptRef` | Probe now; implement before PS2-speech, CGE0, social routing |
| C-02 | **Shared anchor service + observer identity index** | One `captureRef` namespace; Director→ACT RefSlots; PS3 relationship branches; PS4 actor↔observer join | Three tables; PS3 branches dead; ACT `player`/`here` only | `EntityAnchors` as a host-level service, with `Resolve/Retain/Retire`; companion index `captureRef → {encounterId, incarnationId}` → CharacterId via P1, gated by recognition | Before ACT3 and PS4 |
| C-03 | **SalienceConsumption acknowledgement** | Entitlement ≠ consumption | `consumed = grant` | `decisionKey`, `policyVersion`, `acknowledge(decisionKey, consumer, outcome)` | With the PS3 merge or before PS4/PS6 |
| C-04 | **TurnKnowledgeFrame (single assembler with lanes)** | Epistemic firewall; ends multiple prompt writers (one existing, three planned) | Raw JSON + P2 canon projection | Lanes SELF/PERCEIVED/CONVERSE/RECALLED/SITUATION/compat, frozen with P0, per-lane budgets, extended from P2's allowlist projection | PS4 (first) |
| C-05 | **DialogueActionReceipt** | Self-knowledge of dialogue `DO` actions; O-1 | none | Join `OnNpcActionExecuted(canonical, succeeded)` to the publishing tuple; emit a SELF fact; feed ACT supersession | Before ACT4/PS5 |
| C-06 | **Primary-behavior owner token** | Mode staleness (O-2); Director/ACT7 arbitration | `Encounter.Mode` `follow\|wait\|activity\|idle` | `{owner: p2\|act\|essential_residual\|none, mode, since, leaseId?}` derived from sampled `NpcState` on every terminal | ACT2 reconciliation |
| C-07 | **TimelineGuard** | Save-rollback safety | `worldProfileId` + clock resets | Explicit `timelineId` in store; record formation points; fail-closed filter on reads | Before PS5 |
| C-08 | **Profile v2 envelope** | One migration for PS5/ACT7/PS7/traits | serial bumps planned | §10.2 | Before PS5 |
| C-09 | **Capability/health read model** | Feature-state fragmentation | Per-subsystem logic | Five-fact model + `validation.v1.json` | With ACT0/1 merge (thin) |
| C-10 | **Conversation-partner policy** | Single writer/clearer for `PlayerConversationPed` | implicit | §4.2 rules, enforced in UX4 and documented for the Director and CGE | Now (docs + UX4 fix) |
| C-11 | **DirectorIntent / ActivityProposal + DI ownership** | Director→ACT boundary; DI ownership; P2 exemption; paired speech+action | Research conflict | `{directorIntentId, speechTicket?, activityProposal?}`; `directed_interaction` via ACT7 with an `lsaDirectedInteraction` token honored by `Safe()` | PS6/ACT7 |
| C-12 | **ResponderReservation / turn-yield** | Social routing without fan-out | none | `reserveResponder(utteranceId, captureRef)`; a "yield" decision outcome (Essential behavior **UNKNOWN**) | Probe before PS7 |
| C-13 | **hostRunId + WorldEpoch broadcast** | Cross-pipe correlation; clock/save/reload resets in one place | per-pipe GUIDs; three clock detectors | `RuntimeEntry` mints `hostRunId`; P2 host broadcasts `world_epoch{epoch, reason}` to PS/ACT/UX4/CGE | ACT0/1 reconciliation |
| C-14 | **ObserverSituation provider** | PS3 inputs (activity, relationship, traits) | hardcoded `idle` | One function mapping ACT/P2/Essential modes to the PS3 enum (+`unknown`) | With C-02 |
| C-15 | **Player/protagonist SubjectRef** | Relationships and memory across protagonist switches | none (identity research line 216) | `SubjectRef{kind: protagonist, key}` in v2 | Before PS5/PS7 |

---

## 18. Implementation order (summary)

The detailed graph, gates and Codex-ready task lists are in [system-convergence-dependency-graph.md](system-convergence-dependency-graph.md).

```text
NOW (cheap, before any new feature):
  M0  test-file fix + PS3 C-03 interface; UX4 clear-on-release fix; doc corrections
      (CGE/PS7/radio/README/ROADMAP)
  M1  PS3 → main (shadow) + the planned PS0–PS3 GTA shadow session
      (add UtteranceLifecycle feasibility probe to the same session)

THEN (prerequisites):
  M2  ACT0/1 reconcile + merge (shadow) WITH C-13 hostRunId/world-epoch, callback-vocabulary
      contract test, thin C-09 read model
      → ACT2 reconcile + merge WITH C-06 Mode token and C-02 shared anchors
  M3  C-01 UtteranceLifecycle native seam (parallel with M2; research → implementation)
  M4  PS4 = C-04 TurnKnowledgeFrame (+ C-05 DialogueActionReceipt, C-14, C-02 index)
      ACT4 consumes it; no separate prompt blocks
  M5  C-08 profile v2 + C-07 TimelineGuard (explicit timelines) + C-15 SubjectRef

PARALLEL after M2/M4:   ACT3 (shared anchors, seat claims)  ∥  PS5 (needs M5)
LATER:                  PS6 tickets (C-03 acks, C-11 intents) ∥ ACT5 proposals
                        → PS7 social routing + directed exchange via ACT7 (C-11, C-12)
                        → ACT6 navigation (probe-gated) · PS8 sensors (reflex producer) → E7
UX SIDE TRACK:          UX4 merge (after fix) · CGE0/1 (after C-01) · radio R0–R2 merge
                        (raw facts) · radio v2 catalog
```

**Recommended next implementation after PS3 GTA testing:** **M2**, the ACT0/ACT1 reconciliation and merge, carrying three cheap convergence corrections: the callback-vocabulary contract test, `hostRunId`/world-epoch, and the thin capability read model. ACT2 follows with the Mode token and shared anchors. Run the **C-01 speech-seam probe in parallel**, because it is the highest-risk unresolved seam.

---

## 19. Top 10 architecture risks

The full register is in [system-convergence-risks.md](system-convergence-risks.md).

| Rank | ID | Priority | Risk | Fix now? |
|---|---|---|---|---|
| 1 | R-01 | P0 | Fragmented speech lifecycle; no utterance join | Contract + probe now; implement before speech consumers |
| 2 | R-02 | P0 | No epistemic firewall; multiple prompt writers (one existing, three planned) | Lock `C-04` now; implement as PS4 |
| 3 | R-07 | P0 | No timeline safety; serial schema migrations | Design now; implement before PS5 |
| 4 | R-08 | P0 | Directed interaction double ownership + P2 self-suspension | Fix the docs now; implement in ACT7 |
| 5 | R-09 | P0 | CGE vs Essential look behavior / ACT body orientation | Fix the CGE plan before CGE0 |
| 6 | R-03 | P1 | Three anchor tables; Director cannot reference perceived entities | Before ACT3 |
| 7 | R-05 | P1 | Dialogue `DO` without receipts (executed but unremembered) | Before ACT4/PS5 |
| 8 | R-06 | P1 | PS3 entitlement ≡ consumption | With the PS3 merge |
| 9 | R-04 | P1 | UX4 clears the conversation partner | Before the UX4 merge |
| 10 | R-10 | P1 | Callback-vocabulary fix may be lost in the ACT0/1 reconciliation | During the ACT0/1 reconciliation |

---

## 20. Fix now · Lock in · Defer

### Fix now

These are small corrections to make before more feature growth.

1. **PS3 verification:** rename the duplicate `const replay` in `tests/salience-engine.test.mjs`, rerun (expect 382/382 on the stage tree), and correct the stage record. Add the `C-03` acknowledgement, `decisionKey`/`policyVersion` and the `unknown` activity value. None of these changes shadow behavior.
2. **UX4:** stop clearing `PlayerConversationPed` at PTT stop. Add GTA acceptance item "partner persists through the reply". Show in the HUD that Text is not selection-aware.
3. **ACT0/1 reconciliation:** keep the canonical callback vocabulary on **both** native and companion sides, add a cross-language enum contract test, and take PS2's diagnostics validator.
4. **ACT2:** replace `Mode = "idle"` on terminal with a residual-owner token (`C-06`).
5. **ACT2/ACT3 anchors:** decide now that ACT target anchors are `captureRef`s from the shared `EntityAnchors` service (`C-02`), before ACT3 adds non-player targets.
6. **Docs:**
   - CGE plan: yield to `ConversationLookBehavior`, consume `C-01`, move body turns to ACT.
   - PS/SD research: directed interactions go through ACT7 (`C-11`).
   - Radio research: PS3 mapping and the radio lane.
   - README: P2 GTA status line.
   - ROADMAP: the real PS3 deployment and merge state.
7. **Mint `hostRunId`** in `RuntimeEntry` and add it to every pipe hello; broadcast a single world epoch (`C-13`).

### Lock in

Stop redesigning these.

1. Essential is the sole native executor. Physical effects go only through the queue, public wrappers or public stop APIs. No raw task natives and no broad task clears (as ACT2 already does).
2. The E1 turn lifecycle: tuple identity, player input committed once, assistant commit only after matching `PlaybackEnded`, special events never become player input.
3. P0 immutable snapshots and time-of-use P/V fences.
4. P1 owner-authenticated identity. CharacterId is never an effect address. No fuzzy matching or auto-merge.
5. P2 as the **single** durable character store, with an allowlisted canon projection. Dismissal never erases a character.
6. PS contracts: signal → episode → per-observer immutable observation (≤4 claims, no recognition), source-time `WitnessPolicy`, the PS3 decision triple with closed reasons, shadow first. **Executor callbacks are never witnessed.**
7. The ACT receipt ladder and terminals. One step per actor. Handler acceptance ≠ completion. Resume never re-resolves. Player tiers outrank automation. Every pause has a deadline.
8. The Director proposes and never executes. PS6 is dialogue-only through zero-delay `DirectorTicket`s. Initiative budgets: 32 tickets, one PS call in flight, ≤4 starts/min.
9. Source-time hearing only, one STT per utterance, no responder fan-out.
10. Commitments are descriptive: never auto-executed on reload or summon, and handles or tasks are never persisted.
11. UX4's mic-ownership model (`EssentialMicState`, generation fence, stop retry), once fix 2 is applied.
12. Shared sensing through Essential's `PerceptionSystem` snapshot. No new world scans.

### Defer

These are real issues that do not justify delaying current work.

1. Anything beyond a *thin* capability/health read model.
2. Pipe consolidation. Keep four pipes; add only `hostRunId`.
3. Decomposing the P2 "god host" (P2 + PS + ACT + UX4 + future CGE and radio in one RAGE host). Essential contains per-integration exceptions (N17), and the CGE plan already requires fail-soft behavior.
4. **Folding P2 Follow/Wait into ACT** `player_direct` aliases, after ACT2 is GTA-validated (O-7). This is the one subsystem merge recommended.
5. Automatic save-rollback detection. Explicit timelines come first.
6. A PS reflex producer (PS8).
7. Detection of third-party mods (PR/LSPDFR) tasking promoted peds (E7 probe).
8. A cross-actor seat-claim table (ACT3).
9. Typed-input targeting for UX4.
10. Implementing turn-yield. Probe now; implement in PS7.
11. A shared per-tick `OwnedPedState` sample, if CGE/ACT3 polling grows.

**Delete or fold?** Nothing should be deleted. Fold three things:

- P2 direct follow/wait into ACT aliases (deferred until ACT2 is validated).
- The radio knowledge selector into the PS4 assembler.
- CGE2 body turns into ACT `stop_and_face`.

The identity research's separate memory service stays superseded.

---

## 21. Answers to the 25 required questions

1. **What is the canonical architecture of the complete LSA system?** It is a stack of planes with exclusive authority (§2). GTA and its scripts are on top for physical authority. Essential is the sole native executor (turns, mic, partner, playback, action execution, reflex, directed interactions). LSA native adapters inside Essential's AppDomain own run-local anchors, owner evidence, witness sampling and step dispatch through Essential's public seams. The companion owns durable identity (P1), the single durable character store (P2), turn snapshots, history, the PS knowledge pipeline, the future knowledge firewall (PS4), activity plans (ACT) and Director policy, which proposes and never executes. The UX loader owns only presentation and proposals. Four spines (speech/turn, physical, knowledge, identity/persistence) cross these planes, each with exactly one owner (§2.2).

2. **Does every important lifecycle have exactly one owner?** Mostly. Turn identity, CharacterId, binding, tasking, playback completion, canon, witness decisions, ranking and step lifecycle are clean. The ownership matrix lists 10 duplicate authorities (DA-1…DA-10), 11 missing owners and 4 ambiguous concepts; §2.3 summarizes the most consequential.
3. **Where do duplicate authorities exist?**
   - Run-local entity references (PS `EntityAnchors`, ACT2 capture table, P2 `Encounter`).
   - Conversation-partner lifetime (Essential vs UX4 clear-on-release).
   - Model-visible context (stock JSON, P2 canon projection, planned PS4, ACT4 and radio blocks).
   - Directed interaction (PS7 Director admission vs ACT7 capability).
   - Gaze (Essential `ConversationLookBehavior` vs CGE) and body orientation (CGE2 vs ACT3 `stop_and_face`).
   - Clock/world-epoch detection (three clock-regression detectors in P2, PS and ACT, plus separately minted per-pipe epochs).
   - Action-callback vocabulary (PS1 vs ACT).

4. **Which identifiers are safe at which layer?** Only Essential tuples and native-retained anchors may address effects. CharacterId and aliases may select data, never effects. Run-local ids (`captureRef`, `executionId`, `observationId`, tickets, generations) are RAM-only and die with their host run or epoch. Durable records store only durable ids, with run ids as opaque provenance (§3; per-identifier answers in the contract register).

5. **What is the single canonical player-speech lifecycle?** Essential's mic core is the source-time owner of start and end. LSA mints one `UtteranceLifecycle` with an `utteranceId` joined to the turn tuple, and observers are sampled during capture. STT runs once. The accepted transcript (`utteranceId → transcriptRef`) fans out to the direct turn, PS2 hearing, social routing and the experiential event. Typed input is a zero-duration utterance with no overhearing (§5, `C-01`).

6. **What is the single canonical conversation-target lifecycle?** The conversation partner is Essential's `PlayerConversationPed`. It is set only by a committed player input (stock Talk/Text/MarkedTalk, or a UX4 commit), and cleared or replaced only by Essential or the next committed input. Everything else (F11, P2 `current`, PS discovery, CGE) is a read-only view. UX4 selection is a proposal that commits into the partner (§4.2).

7. **Can UX4, proximity chat and normal dialogue coexist without target races?** Yes, with two corrections.
   - Already handled: Essential enforces one active mic Ped; UX4 now refuses `mic_busy` and never stops a newer stock mic (`3dadbcf`); hearing and routing never write the partner.
   - Remaining: UX4 must stop clearing the partner at release. Typed input stays non-selection-aware until a follow-up, and the HUD must say so.

8. **Does PS3 cleanly lead into PS4–PS8?** Yes, with four small interface changes: a consumption acknowledgement, a decision key and policy version, an `unknown` activity value, and the test fix. Two seams must also exist before its relationship and memory branches can be live: shared anchors with an observer identity index, and the `ObserverSituation` provider. Its vocabulary needs addressed/overheard semantics for social routing and an `eventType → memory category` mapping for PS5 (§7).

9. **Does ACT cleanly consume the action audit without competing with Essential?** Yes. ACT2 dispatches only through `NpcActionQueue`, public wrappers and public stop APIs; it treats handler acceptance as `HANDLER_ACCEPTED`, not completion; it detects supersession through callbacks, `NpcState` and command generations; and it already applies the ACT research's corrections of the audit (N1–N21). The gaps are integration gaps, not competition: the private anchor table, the stale Mode token, and dialogue `DO` actions that are not receipted (§8, §12).

10. **Does the Scene Director propose while ACT executes, or is that boundary still ambiguous?** It is settled in principle and ambiguous in one place. The older PS/SD text has the Director start directed interactions natively, while ACT research and the capability registry assign them to ACT7. Canonical answer: the Director proposes (speech tickets plus `ActivityProposal`s with a shared `directorIntentId`), and ACT executes DIs with a P2 exemption token (`C-11`).

11. **Can ActionReceipts feed memory without creating omniscient witness knowledge?** Yes, if the four layers are kept separate (§9). Receipts become **self** facts for the actor only. Witnesses learn only from PS2-witnessed physical-outcome signals; on `main`, callbacks already have no witness range. Memory takes self facts only at ≥ established evidence, and observations only after consumption.

12. **Are perception, memory, relationships and commitments using one coherent epistemic model?** Perception is coherent: per-observer, witnessed, no recognition. Memory, relationships and commitments do not exist yet beyond manual memories. They will be coherent if they follow §6 and §10: per-observer (owner-CharacterId) records, recognition-gated subjects (`SubjectRef`, `C-15`), timeline-scoped, written only from consumed observations, committed speech and established self facts.

13. **Is P2 the correct durable profile authority for all future character state?** Yes: canon, memories, relationships, traits, commitments and home anchor. P1 remains the identity and voice authority. P2's `voiceReference` should become a display derivation.

14. **Is the future schema/timeline strategy coherent?** Not yet. Three serial bumps are planned and no timeline exists. It becomes coherent with one v2 envelope (`C-08`), landed before PS5, carrying `timelineId` and formation points, plus an explicit-timeline TimelineGuard that fails closed (`C-07`).

15. **Can CGE coexist with locomotion, ACT and directed interaction without task theft?** Yes for head and eyes only, as a yielding overlay that defers to Essential's look behavior, reflexes, scenarios and vehicle entry, and that never clears tasks. CGE2 body turns should be ACT `stop_and_face` under the lease, not CGE's own logic (§8.3, §13).

16. **Are radio and other future sensors truly using the same PS pipeline?** Radio R0–R2 uses the same transport, anchors and signal contracts, and deliberately stops at raw facts (no observation, memory or prompt). Two research items diverge and are corrected here: the PS3 mapping (`context: "low"`) and a separate radio knowledge selector. Radio must enter knowledge only through PS2 auditory witnessing and a PS4 lane.

17. **Are feature flags and runtime modes becoming too fragmented?** Yes. There are at least six mode vocabularies, duplicated keys across native and companion configs, and no machine-readable validation state. Adopt the five-fact model with one `off|shadow|active` vocabulary and a thin capability/health read model keyed by `hostRunId` (§11). Do not build more than that.

18. **What happens to every subsystem on interruption, supersession, ped recreation and ownership loss?** See the three-part matrix and the orphan list O-1…O-10 (§12). Implemented lifecycles all terminate deterministically. The orphans are an executed-but-unremembered `DO`, a stale Mode token, the cleared partner, consumption-at-grant, the missing reflex fact, save-load without regression, divergent follow semantics, independent reset detectors, ticket acknowledgements and LSA-DI self-suspension.

19. **What older research should now be considered superseded?** See register S-01…S-23 (§16). In particular:
   - The audit's activity-queue and destination assumptions.
   - The PS1 callback names.
   - The Director starting DIs natively.
   - The separate memory journal.
   - Post-STT hearing.
   - UX4's original targeting assumption.
   - The radio PS3 mapping and selector.
   - The stale PS3 and P2 status lines.

20. **What missing cross-system contracts should be added now?** In order: `C-01` (utterance), `C-02` (shared anchors and observer index), `C-03` (consumption acknowledgement), `C-04` (turn knowledge), `C-06` (owner token), `C-13` (`hostRunId`/world epoch), `C-10` (partner policy). Then, before PS5: `C-07`, `C-08`, `C-15`. Before PS6/PS7: `C-11`, `C-12`.

21. **What should be implemented next after PS3 testing?** M2: the ACT0/1 reconciliation and merge (shadow) carrying the callback contract test, `hostRunId`/world epoch and a thin capability read model. ACT2 follows with the Mode token and shared anchors. The C-01 speech-seam probe runs in parallel (§18).

22. **What are the top 10 architecture risks?** See §19: R-01, R-02, R-07, R-08, R-09, R-03, R-05, R-06, R-04 and R-10.

23. **Which designs are mature enough to lock?** The twelve items in §20 "Lock in".

24. **Is there any subsystem to delete or fold before building further?** Delete nothing. Fold three things:
   - P2 direct follow/wait into ACT `player_direct` aliases, after ACT2 is GTA-validated.
   - The radio knowledge selector into the PS4 assembler.
   - CGE2 body turns into ACT `stop_and_face`.

   Keep the identity research's separate memory service superseded.

25. **Does the final architecture still preserve the fundamental rule?** **Yes, on `main` and in the canonical design** (**PROVEN** for `main`; **PROPOSED** for the target). Every physical effect funnels through Essential's queue, wrappers or scheduler. LSA adds identity (P1/P2), evidence (PS), intelligence (PS3/PS4/Luna), planning (ACT engine) and orchestration (Director proposals) without allocating turns or tasking peds. Three planned designs would violate the rule if built as written: UX4 clearing Essential's partner, CGE gaze and body turns competing with Essential's look behavior and ACT, and PS7 starting DIs outside ACT. The corrections in §20 restore it.

---

## 22. Definition-of-done crosswalk

| A new engineer must understand… | Where |
|---|---|
| who owns every major piece of state | §2.3, [ownership matrix](system-ownership-matrix.md) |
| which identifiers are valid where | §3, [contract register §1](system-contract-register.md) |
| how one player utterance moves through the system | §5 (Diagram 3), Scenario A |
| how one GTA event becomes observer knowledge | §6 (Diagram 4), §9 |
| how one autonomous intention becomes a safely executed physical action | §8 (Diagrams 5, 6), Scenario E |
| how completion becomes evidence and then memory | §9, §10 |
| how characters survive recreation without stale work following them | §3.2, Scenario G |
| how UX, dialogue, perception, activities and autonomy coexist | §4, §8.2, §13 |
| how interruption and arbitration work | §8.2, §12 (Diagram 8) |
| how persistence and timelines work | §10 (Diagram 7), Scenario H |
| which systems are already sound | §20 Lock in |
| which seams require correction | §17, §20 Fix now, [risks](system-convergence-risks.md) |
| what implementation sequence minimizes rework | §18, [dependency graph](system-convergence-dependency-graph.md) |

---

## Appendix A — Evidence index (selected)

All references are at the SHAs in §1.1 unless a branch is named. The complete machine-readable list is in [system-convergence-evidence.json](system-convergence-evidence.json).

| ID | Evidence |
|---|---|
| E01 | `git fetch` at 2026-10-05T14:13Z; ref table §1.1; local branch heads on the developer machine (read-only `--no-optional-locks`) |
| E02 | `lsa-production-staging/ps3-ready-20261004T194324/deployment-receipt.json`: `status: deployed_hash_verified`, `completedAtUtc 2026-10-05T13:28:34.3190765Z`, `candidateHead 101b2124…`, `sourceGitHubMain 8c63b204…`, `sourceRuntimeBaseline 0c254049…`, 73/73 installed files hash-verified, `effectiveIntelligenceMode: shadow`, `gtaRuntimeTest: false` |
| E03 | Blob identity: stage `101b212` `salienceEngine.mjs` = `ad9aaa98…` = `9e61d89`; test file `fd149b41…` both |
| E04 | `tests/salience-engine.test.mjs` lines 252 and 270 both `const replay` in one test; runner `tools/runTests.mjs` imports sequentially; manifest `offlineNodeSuite: {status: incomplete_environment_block, tests: 322, passed: 321, …, additionalRunnerError: "SyntaxError: Identifier replay has already been declared"}`; scratch rerun 382/382 |
| E05 | `runSequentialTurn.mjs:187` `acceptPlayerTranscript({ text: finalInput, receipt: null })`; `:197` `commitPlayerInput`; `:326` `emit output_transcript` (action published); `:367` `acceptPlaybackResult` (history commit) |
| E06 | `speechContract.mjs` `validateCaptureReceipt` fields (no turn tuple, no addressee, no input source); `validateAcceptedTranscript` |
| E07 | `essentialDecision.mjs:56-59` raw `actor/listener/world` JSON; `essentialGlue.mjs:48` `modelActor` strips only LSA transport/identity |
| E08 | `IntelligenceIntegration.cs:178` discovery `GetPlayerConversationPed() ?? GetCurrentSpeakerPed()`; `:318` `follow`/`wait` mapping; `:321` `EnrichActor` empty |
| E09 | ACT research N5 (canonical name to `NotifyNpcActionExecuted`), N1–N4, N6–N9, N13, N17–N19 |
| E10 | ACT0/1 + ACT2 branches: `followtarget`/`waithere` in both native and `contracts.mjs:31` |
| E11 | `WitnessPolicy.cs` `VisualRange` has no `action_callback` case (0) → sound path → `unknown` |
| E12 | `contracts.mjs:53` `recognizedCharacterIds.length!==0` rejects |
| E13 | `shadowRuntime.mjs:91` live salience situation (`activity:'idle'`, no relationship/traits/profile) |
| E14 | `salienceEngine.mjs:16-27` bounds and enums; `:245-289` ledger; `:393` `consumed: … \|\| grant` |
| E15 | `openaiConnection.mjs:156-210` local capture window only |
| E16 | UX4 `3dadbcf`: `TalkTargetSelector.cs:118-131,289-297` (`ClearPlayerConversationPed` on stop); `EssentialMicState.cs` (IL-resolved active mic Ped) |
| E17 | UX4 T0 audit: `SetPlayerConversationPed` side effects; stock Talk/Text recompute `GetBestConversationPed` |
| E18 | CGE `runtime-contract.md` §1–§3: target precedence; no mention of `ConversationLookBehavior`; player-speech seam unproven |
| E19 | Hotfix #3 API analysis: `ConversationLookBehavior.StartPlayerMicLook/Start(speaker, listener, turnId, generationId)`; `ConversationHydrationCoordinator.BeginMicTurn/MarkMicReleased`; `InputController.SendMicStart/SendMicStop/SendTextPrompt` |
| E20 | ACT2 `ActivityDispatch.cs` (private captures; `Resolve` `player`/`here` only; `BeginOwnership` `Mode=activity`; `EndOwnership` `Mode=idle`) |
| E21 | ACT2 `StepRunner.cs:85-110` (lease loss, `Preempt`), `:325-336` (`Finish` → `EndOwnership(false)`), `OnCallback` foreign → `SUPERSEDED`; `ActivityCommands.cs:55-64` P2 control → `Preempt` |
| E22 | `contracts/activity-capabilities.v1.json` (sha256 `31ed6e6d…`): `directed_interaction` phase ACT7 `registry_only`; `scene_director` source on 6 capabilities |
| E23 | PS/SD research (`e1d0bd1`) lines 61, 221, 271-301, 322, 343, 363 |
| E24 | ACT research (`ca952a0`) §9.1–9.4 interrupt matrix and resume rules; line 1176 (ACT7 v2/v3) |
| E25 | Identity research (`ebc42bf`) lines 214, 216, 245, 267 |
| E26 | `SESSION_IDENTITY-design-review.md` survival table: no proven save/world-reset hook |
| E27 | `profileStore.mjs:7,11,30`; `sessionProfiles.mjs:68`; P2 status (limits, 16 KiB projection) |
| E28 | Radio research `7f6ad8e` §9 (`context: "low"`), §10; R0–R2 status (raw facts only) |
| E29 | `PromotedCharactersIntegration.cs:104-131` (`ResetForClockDiscontinuity`), `:171,185` (partner reads), `:278` `EnrichActor`, `:284` callback no-op |
| E30 | Per-pipe epochs: `ActivityChannel.cs:32-33` (ACT2), `IntelligenceChannel.cs:38`, `OwnerFactChannel.cs:48` |
| E31 | Configs: `LSA.PromotedCharacters.example.json` and `e1.config.example.json` both carry `worldProfileId` and `intelligence.mode`; P1 `mode shadow\|voices` (`identityContract.mjs:62-63`) |
| E32 | `PerceptionSystem.TryGetSnapshot` reused: `IntelligenceIntegration.cs:206`, UX4 `TalkTargetSelector.cs:223`; LOS `IntelligenceIntegration.cs:274` |
| E33 | Test runs listed in §1.3 |
