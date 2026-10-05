# System convergence dependency graph and implementation order

> **Corpus status note:** Dependency edges and prerequisite relationships remain authoritative unless superseded by a later contract/decision. Milestone completion shown in this graph reflects the convergence-audit snapshot; use [../ROADMAP.md](../ROADMAP.md) for current completion state.


Part of the [system convergence architecture](system-convergence-architecture.md) research package. Research only.

**Historical starting point** (PROVEN at research time, 2026-10-05). Current implementation status has advanced; use [../ROADMAP.md](../ROADMAP.md) for today's merged/deployed state:

- `origin/main@8c63b20` (code baseline `0c25404`).
- PS3 was at that time on `stage/ps3-ready-20261004@101b212`; it has since been corrected, merged to `main`, deployed in shadow and live telemetry/evaluation verified.
- ACT0/1 (`5d11ee9`) and ACT2 (`1388954`) unmerged and behind `main`.
- UX4 was hardened on the research branch at `3dadbcf`; it has since been merged to current `main`, including later shared-Talk and direct-talk/explicit-selector refinements.
- Radio R0–R2 (`41604c7`) unmerged.
- CGE, social routing, PS4–PS8 and ACT3–ACT7 not implemented.

**Labels:** the order below is **PROPOSED**. Each dependency cites the contract (`C-xx`) or risk (`R-xx`) that justifies it.

---

## 1. Graph

```text
                         ┌───────────────────────────────────────────────────────────┐
                         │ M0  HYGIENE (no runtime change)                            │
                         │  PS3 test fix+rerun · status docs · CGE/PS7/radio doc      │
                         │  amendments · UX4 clear-on-release fix (branch)            │
                         └───────────────┬───────────────────────────────────────────┘
                                         ▼
                ┌────────────────────────────────────────────────────────────┐
                │ M1  PS3 → main (shadow) + C-03 interface + 'unknown'       │
                │     PS0–PS3 GTA shadow session  ⊕  C-01 feasibility probe   │
                └──────────┬───────────────────────────────┬─────────────────┘
                           ▼                               ▼
   ┌───────────────────────────────────────────┐   ┌───────────────────────────────────┐
   │ M2  ACT0/1 reconcile+merge (shadow)       │   │ M3  C-01 UtteranceLifecycle       │
   │     + R-10 contract test, C-13 hostRunId/ │   │     native seam + receipt v2 +    │
   │     world_epoch, thin C-09                │   │     transcript annotation         │
   │  → ACT2 reconcile+merge + C-06 owner      │   │     (PS2 speech_heard in shadow)  │
   │     token + C-02 shared anchors + C-14    │   └──────┬─────────────┬──────────────┘
   └──────────────┬────────────────────────────┘          │             │
                  │                                       │             ▼
                  │                                       │   (side) CGE0/1 head-only overlay
                  ▼                                       ▼
   ┌───────────────────────────────────────────────────────────────────┐   ┌────────────────────────────┐
   │ M4  PS4 = C-04 TurnKnowledgeFrame (firewall)                      │   │ M5  C-08 profile v2 +       │
   │     SELF lane: ACT facts + C-05 DialogueActionReceipt             │   │     C-07 TimelineGuard +    │
   │     PERCEIVED lane: PS3 + C-03 acks · CONVERSE: utteranceId       │   │     C-15 SubjectRef         │
   │     COMPAT allowlist · ACT4 delivered as lane items               │   │     (migration only)        │
   └──────────────┬────────────────────────────────────────────────────┘   └─────────────┬──────────────┘
                  ├──────────────────────────────┬───────────────────────────────────────┤
                  ▼                              ▼                                       ▼
   ┌──────────────────────────────┐  ┌────────────────────────────────┐   (side) radio R3: auditory witness
   │ M6  ACT3 rich short-range    │  │ M7  PS5 experiential memory     │          + PS4 radio lane
   │     (captureRef RefSlots,    │  │     (one writer into P2 v2;     │
   │     seat claims, stop_and_   │  │     consumed observations,      │
   │     face; probes V1–V3, S1)  │  │     committed speech, SELF ≥    │
   └──────────────┬───────────────┘  │     established; timeline-tagged)│
                  │                  └───────────────┬────────────────┘
                  ▼                                  ▼
   ┌──────────────────────────────┐  ┌────────────────────────────────┐
   │ M8b ACT5 model-proposed      │  │ M8a PS6 passive initiative      │
   │     activities (closed       │  │     (DirectorTicket zero-delay, │
   │     intents, P0 fences)      │  │     C-11 speech part, C-03 acks)│
   └──────────────┬───────────────┘  └───────────────┬────────────────┘
                  └───────────────────┬──────────────┘
                                      ▼
              ┌───────────────────────────────────────────────────────────────┐
              │ M9  PS7 social routing + directed exchange  ⇄  ACT7           │
              │     C-12 turn-yield (probe first) · C-11 DI via ACT7 + P2     │
              │     exemption · commitments/home anchor in P2 v2 (from M5)    │
              └──────────────────────────────┬────────────────────────────────┘
                                             ▼
              ┌───────────────────────────────────────────────────────────────┐
              │ M10 ACT6 navigation (probe-gated)  ∥  PS8 verified sensors    │
              │     (reflex producer, shared physical sampler)                │
              └──────────────────────────────┬────────────────────────────────┘
                                             ▼
                              M11 E7 integrated acceptance (validation.v1.json registry)

 UX SIDE TRACK (any time after its prerequisite):
   UX4 merge (after M0 fix; GTA acceptance adds "partner persists through reply")
   CGE0/1 (after M3; head/eye only; yields to Essential look)  ·  CGE2 → dropped/folded into ACT3
   Radio R0–R2 merge (raw facts; any time)  ·  radio catalog v2  ·  radio R3 (after M4)
   UX4 typed-target follow-up (after M3)
```

---

## 2. Classification

### Must happen before later work (architectural prerequisites)

| Prerequisite | Blocks | Why |
|---|---|---|
| M0 PS3 test fix | M1 merge | The verification record must be true (`R-11`) |
| C-03 consumption acks (M1) | PS4 context use, PS6 tickets, PS5 staging | Entitlement ≠ consumption (`R-06`) |
| C-13 `hostRunId` + world epoch (M2) | Capability read model, ACT/PS correlation, TimelineGuard hints | One run identity and one reset signal (`R-13`, `R-14`) |
| R-10 contract test (M2) | Any ACT0/1 merge | Silent frame rejection otherwise |
| C-06 owner token (M2) | ACT5/ACT7/Director arbitration | Truthful primary-behavior owner (`R-12`) |
| C-02 shared anchors (M2/M6) | ACT3 non-player targets, Director proposals, PS3 relationship branches, PS4 actor↔observer join | One reference namespace (`R-03`) |
| C-01 utterance seam (M3) | PS2 `speech_heard`, CGE0, social routing, PS5 conversation memory | One "player spoke" (`R-01`) |
| C-04 assembler (M4) | ACT4, radio R3, PS5 retrieval lane, any new prompt content | Epistemic firewall (`R-02`) |
| C-05 dialogue-action receipt (M4) | ACT4 self-awareness, PS5 | No executed-but-unremembered actions (`R-05`) |
| C-08 + C-07 + C-15 (M5) | PS5, ACT7 commitments, PS7 edges | One migration and timeline safety (`R-07`, `R-17`) |
| C-12 probe | PS7 social routing | Turn-yield feasibility is **UNKNOWN** (`R-16`) |
| C-11 decision (docs now) | PS7, ACT7 | DI ownership (`R-08`) |

### Can proceed in parallel (clean independent seams)

- **M2 ∥ M3:** ACT reconciliation vs the native speech seam (different files and owners).
- **M4 ∥ M5:** knowledge assembly vs store migration (M5 is migration only).
- **M6 (ACT3) ∥ M7 (PS5)** once M4 and M5 are in.
- **M8a (PS6) ∥ M8b (ACT5).**
- **Radio R0–R2 merge** at any time (raw facts only; shadow).
- **UX4 merge** after the M0 fix.

### Should wait (would create rework if done now)

| Item | Wait for | Rework avoided |
|---|---|---|
| ACT4 `[CURRENT ACTIVITY]` prompt block | M4 | A second prompt writer |
| Radio knowledge selector / R3 | M4 | A third prompt writer; radio must be witnessed |
| PS5 writer | M5 | Untimelined memories (cannot be retro-tagged) |
| ACT7 commitments, PS7 edges | M5 | Serial schema bumps |
| CGE0 | M3 + plan amendment | A private speech detector; a gaze fight |
| CGE2 body turns | never (fold into ACT3 `stop_and_face`) | Two body-orientation owners |
| PS6 initiative | C-03 | Suppression orphans |
| PS7 directed exchange from the Director | C-11 via ACT7 | Two DI owners; P2 self-suspension |
| ACT3 non-player targets | C-02 | A second anchor namespace |
| Folding P2 follow/wait into ACT | ACT2 GTA validation | Regressing a GTA-validated path |

### Optional UX side track

UX4 (merge after the fix), CGE0/1, the UX4 typed-target follow-up, the radio catalog v2, and F11 diagnostics backed by the `C-09` read model.

---

## 3. What to hand to Luna/Codex next

Each brief below is self-contained. **Global non-goals:** do not change Essential behavior, do not add a scheduler or identity service or memory store, and keep features default-off or shadow.

### Next 1 — M1: PS3 merge (shadow) + consumption interface

- **Scope:**
  - Fix the duplicate `const replay` (`tests/salience-engine.test.mjs:270` → `replayFull`) and make the runner count import failures as test failures.
  - Merge PS3 (`stage/ps3-ready-20261004`) to `main`.
  - Add to `SalienceDecision`: `decisionKey`, `policyVersion`, `acknowledge()`, a separate `granted`/`consumed` ledger, and `unknown` in `ACTIVITIES` (live shadow uses `unknown`).
- **Tests:** the existing 382, plus acknowledgement paths (delivered/rejected/expired), plus "grant without delivery is re-grantable after policy change".
- **Acceptance:** shadow behavior is unchanged except the `unknown` activity. The PS0–PS3 GTA session follows the ROADMAP plan.
- **Probe add-on (research only):** log Essential mic-boundary timing (game ticks at `SendMicStart`/`BeginMicTurn`/`MarkMicReleased`), turn tuple allocation order, and whether an IL-pinned hook or the active-mic field can mint `utteranceId` before PCM flows. This settles `C-01` feasibility.

### Next 2 — M2: ACT0/1 → ACT2 reconciliation with convergence corrections

- **Scope (ACT0/1):**
  - Reconcile onto `main`. Keep PS2's diagnostics validator and the canonical callback enum on both sides.
  - Add a cross-language enum contract test.
  - Mint `hostRunId` in `RuntimeEntry`; add it to the P1, PS and ACT hellos.
  - P2 host emits `world_epoch`; PS and ACT subscribe instead of running their own detectors (keep the old detectors as asserts during the transition).
  - Add a thin `C-09` read model for diagnostics.
- **Scope (ACT2):**
  - Add the `C-06` owner token (derive the residual mode from sampled `NpcState` on every terminal).
  - Make ACT target anchors `EntityAnchors` `captureRef`s via a host-level anchor service (`C-02`). Today only `player`/`here` exist, so the change is small.
  - Add the `C-14` mapping for the PS3 activity input.
- **Tests:** the full Node/.NET matrix; stale-receipt, lease-loss and epoch-change tests; the owner-token truth table.
- **GTA:** ACT probes Q1/F1 (callback names, counts, threading) in shadow.

### Next 3 — M3: UtteranceLifecycle (C-01)

- **Scope:**
  - Native `utterance.started/turn/ended` events from the mic boundary (per the M1 probe result).
  - `SpeechCaptureReceipt v2` with observer sampling over the window.
  - Companion annotation `utteranceId → transcriptRef`.
  - `acceptPlayerTranscript` receives the real receipt.
  - `playerSpeechGate` opens in **shadow only**.
- **Tests:** stock/marked/UX4/typed sources; cancelled/empty/overflow terminals; a late receipt; host run change; one STT per utterance.
- **Consumers enabled:** PS2 `speech_heard` (shadow), UX4 HUD, CGE0.

### Next 4 — M4: PS4 TurnKnowledgeFrame (C-04) + DialogueActionReceipt (C-05)

- **Scope:**
  - A single assembler that extends P2's allowlisted projection, with lanes SELF/PERCEIVED/CONVERSE/RECALLED(empty)/SITUATION/COMPAT and per-lane budgets.
  - `buildRequest` consumes the frame and no longer serializes raw objects. The COMPAT allowlist starts as an exact list of today's used Essential fields.
  - Dialogue `DO` receipts are joined to the tuple.
  - ACT4 is delivered as SELF-lane items.
  - PS3 decisions are consumed with acknowledgements.
- **Tests:** a golden-prompt diff showing only intended changes; forbidden-field tests (no CharacterId, no raw IntegrationBlocks unless allowlisted); budget determinism; an interrupted reply keeps the SELF action fact.
- **Mode:** `context` capability key, default off; shadow renders the frame and logs hashes only.

### Next 5 — M5: Profile v2 + TimelineGuard + SubjectRef (C-07, C-08, C-15)

- **Scope:**
  - Pure v1→v2 migration with all new fields empty, a backup and no downgrade.
  - Explicit active-timeline selection in the editor and F11.
  - Fail-closed read filter.
  - `SubjectRef` with protagonist keys.
  - Editor support for `traitPolicies`.
- **Tests:** round-trip migration; corrupt/partial v2; timeline switch hides newer timeline-scoped records; canon unaffected; protagonist separation.
- **No automatic writes** (that is PS5).

After these, M6 (ACT3) and M7 (PS5) run in parallel, then PS6 ∥ ACT5, then PS7 ⇄ ACT7.

---

## 4. Gates and acceptance records

Every milestone that touches the GTA runtime ends with a `validation.v1.json` entry (`C-09`): `{payloadHash, capabilities validated, date, session log ids}`. A capability counts as *physically validated* only through such an entry. This keeps "built", "deployed" and "validated" separate, as the ROADMAP requires.
