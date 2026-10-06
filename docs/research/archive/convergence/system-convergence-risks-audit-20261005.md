# System convergence risk register

> **Corpus status note:** Risk IDs and failure-mode analysis are preserved as architectural provenance. Some "fix now" items have since been implemented or amended. Use [CURRENT.md](CURRENT.md), [DECISIONS.md](DECISIONS.md), and [../ROADMAP.md](../ROADMAP.md) for current resolution/implementation status.


Part of the [system convergence architecture](system-convergence-architecture.md) research package. Research only.

**Priority scale (from the brief)**

- **P0:** architectural correctness risk
- **P1:** likely expensive future migration
- **P2:** localized integration issue
- **P3:** cleanup / maintainability

Evidence labels: PROVEN · STRONGLY SUPPORTED · INFERRED · PROPOSED · UNKNOWN.

> **What should we fix while the architecture is still cheap to change?**
>
> 1. **R-01:** define the utterance contract and run its probe.
> 2. **R-02:** lock the single knowledge assembler before PS4/ACT4/radio R3.
> 3. **R-07:** land one profile v2 envelope with a timeline before PS5.
> 4. **R-08/R-09:** amend the PS7 and CGE designs before anyone builds them.
> 5. **R-04, R-06, R-10, R-11, R-12:** small code fixes that ride the merges already queued.

---

## Top 10

| Rank | ID | P | Title | Fix now / defer |
|---|---|---|---|---|
| 1 | R-01 | P0 | Speech lifecycle fragmented; no utterance join | **Fix now** (contract + probe) |
| 2 | R-02 | P0 | No epistemic firewall; multiple prompt writers (one existing, three planned) | **Fix now** (lock design); implement as PS4 |
| 3 | R-07 | P0 | No timeline/save safety; serial schema migrations | **Design now**; implement before PS5 |
| 4 | R-08 | P0 | Directed interaction double ownership + P2 self-suspension | **Fix docs now**; implement in ACT7 |
| 5 | R-09 | P0 | CGE vs Essential look behavior; CGE2 vs ACT body orientation | **Fix plan now** (before CGE0) |
| 6 | R-03 | P1 | Three anchor tables; Director cannot reference perceived entities | **Fix before ACT3** |
| 7 | R-05 | P1 | Dialogue `DO` without receipts (executed but unremembered) | Before ACT4/PS5 |
| 8 | R-06 | P1 | PS3 entitlement ≡ consumption | **Fix with PS3 merge** |
| 9 | R-04 | P1 | UX4 clears Essential's conversation partner | **Fix before UX4 merge** |
| 10 | R-10 | P1 | Callback-vocabulary fix can be lost in ACT0/1 reconciliation | **Fix during reconciliation** |

---

## Register

### R-01 · P0 · Speech lifecycle fragmented; no utterance join

- **Systems:** Essential mic core, companion turn pipeline, PS2 speech contracts, UX4, CGE, social routing, PS5.
- **Evidence:**
  - Seven representations of "the player spoke" (five in code, two in plans) with no shared id (main report §5.1, **PROVEN**).
  - `acceptPlayerTranscript({ text, receipt: null })` (`runSequentialTurn.mjs:187`, **PROVEN**).
  - The capture receipt lacks a turn join, addressee and input source (`speechContract.mjs`, **PROVEN**).
  - The CGE plan intends to find its own speech seam (**PROVEN**, docs).
- **Failure mode:** each consumer joins by time window or "latest". The results are wrong overhearers, gaze tied to the wrong utterance, memories tied to the wrong transcript, double STT, or responders fanning out.
- **When it becomes expensive:** as soon as a second consumer (CGE0, PS2 speech, social routing) ships its own join.
- **Smallest mitigation:** `C-01`. Mint `utteranceId` natively at the mic boundary, join it to the turn tuple, and have one receipt and one transcript annotation.
- **Fix now?** Contract and probe **now**, during the PS0–PS3 GTA session. Implement before any speech consumer.

### R-02 · P0 · No epistemic firewall; multiple prompt writers

- **Systems:** E1 `essentialDecision`, P2 canon projection, PS4, ACT4, radio R3.
- **Evidence:**
  - Raw `actor`/`listener`/`world` JSON goes into the system message (`essentialDecision.mjs:56-59`). Only LSA's own blocks are stripped (`essentialGlue.mjs:48`) (**PROVEN**).
  - Third-party IntegrationBlocks (PR) are present in the actor context (native context audit, **PROVEN**).
  - Planned writers: ACT4 `[CURRENT ACTIVITY]` block (ACT research file table) and the radio projection selector (radio research §10) (**PROVEN**, docs).
- **Failure mode:** hidden facts leak to Luna, budgets fight, ordering is nondeterministic, recognition is bypassed, and every new feature edits the prompt builder.
- **When it becomes expensive:** at the first of PS4, ACT4 or radio R3.
- **Smallest mitigation:** `C-04` `TurnKnowledgeFrame` with lanes, extending P2's allowlist projection. A transitional COMPAT lane allowlists Essential fields.
- **Fix now?** **Lock the design now.** Implement as the first part of PS4. ACT4 and radio must consume it.

### R-07 · P0 · No timeline/save safety; serial schema migrations

- **Systems:** P1, P2, PS5, PS7, ACT7, editor.
- **Evidence:**
  - No save/world-reset hook (`SESSION_IDENTITY-design-review.md`, **PROVEN**).
  - `PROFILE_MIGRATIONS` is empty; schema 1 (**PROVEN**).
  - PS5 plans v2 (PS/SD research line 221), ACT7 plans v2 or v3 (ACT research line 1176), and PS7 edges are planned (**PROVEN**, docs).
  - No `timelineId` anywhere in code (**PROVEN**).
- **Failure mode:** after loading an earlier save, characters remember future events, relationships and commitments. Three migrations multiply editor and validator churn.
- **When it becomes expensive:** at the first automatic durable write (PS5). Retro-tagging untagged memories is impossible.
- **Smallest mitigation:** `C-08` one v2 envelope, plus `C-07` TimelineGuard with explicit timeline selection and a fail-closed read filter, plus `C-15` protagonist `SubjectRef`.
- **Fix now?** Design now. Implement before PS5. Automatic rollback detection is deferred (**UNKNOWN** signals).

### R-08 · P0 · Directed interaction double ownership + P2 self-suspension

- **Systems:** PS7 Director admission, ACT7, P2 `Safe()`, Essential DI manager.
- **Evidence:**
  - The PS/SD research has `DirectorAdmission.cs` start DIs (lines 322, 380).
  - The ACT registry `directed_interaction` says "PS7 via ACT7"; ACT research DI1 notes that P2 suspends the encounter (**PROVEN**, docs).
  - P2 `Safe()` includes `InDirectedInteraction` (**PROVEN**).
- **Failure mode:** two primary-behavior owners for the same ped. An LSA-started exchange suspends its own character. Lease and priority are bypassed.
- **When it becomes expensive:** once either PS7 or ACT7 implements its version.
- **Smallest mitigation:** `C-11`. ACT7 executes DIs under the lease, the Director only proposes, and P2 honors an `lsaDirectedInteraction` exemption token.
- **Fix now?** **Docs now** (record the decision). Implement in ACT7/PS7.

### R-09 · P0 · CGE vs Essential look; CGE2 vs ACT body orientation

- **Systems:** CGE (plan), Essential `ConversationLookBehavior`, ACT3 `stop_and_face`.
- **Evidence:**
  - The CGE runtime contract resolves its own target and plans its own speech seam. It never mentions `ConversationLookBehavior.StartPlayerMicLook`/`Start(speaker, listener, turnId, generationId)` (**PROVEN**, docs/API).
  - CGE2 plans "short body-turn requests" while ACT3 has `stop_and_face` (**PROVEN**, docs).
- **Failure mode:** look-at commands fight (jitter, task churn), body turns compete with ACT steps, and the invariant of one primary owner breaks.
- **When it becomes expensive:** at CGE0/CGE1 implementation.
- **Smallest mitigation:**
  - Amend the CGE plan: yield whenever Essential's look behavior is active, consume `C-01` for speech start/end, and keep CGE head/eye-only.
  - Move body orientation to ACT3 `stop_and_face`.
- **Fix now?** **Yes (docs).**

### R-03 · P1 · Three anchor tables; perceived entities not addressable by ACT

- **Systems:** PS `EntityAnchors`, ACT2 `EssentialActivityWorld`, P2 `Encounter`, Director, PS3/PS4.
- **Evidence:**
  - ACT2 keeps private `captures`/`addresses` dictionaries (`ActivityDispatch.cs:22-25,51-53`). ACT research §9.4 had specified `EntityAnchors.Resolve` (**PROVEN**).
  - `Resolve` supports only `player`/`here` (**PROVEN**).
- **Failure mode:** inconsistent retirement between tables, Director proposals cannot name a perceived target, and duplicate incarnation logic.
- **When it becomes expensive:** at ACT3 (non-player targets) and PS6/ACT7 (Director proposals).
- **Smallest mitigation:** `C-02` host-level anchor service. ACT RefSlots carry `captureRef`.
- **Fix now?** Decide now; implement in the ACT2 reconciliation or at the start of ACT3.

### R-05 · P1 · Dialogue `DO` actions without receipts

- **Systems:** E1 turn pipeline, Essential queue, ACT, PS4 SELF lane, PS5.
- **Evidence:** the action is published at `output_transcript` (`runSequentialTurn.mjs:326`) before TTS; history commits after playback (`:367`). P2's `OnNpcActionExecuted` is a no-op on `main` (**PROVEN**).
- **Failure mode:**
  - An interrupted reply leaves an executed action the NPC does not remember (O-1).
  - The NPC may claim completion it never verified.
  - Memory may later record "agreed" as "did".
- **When it becomes expensive:** at ACT4 (activity awareness) and PS5 (memory).
- **Smallest mitigation:** `C-05` DialogueActionReceipt into the SELF lane.
- **Fix now?** Defer to before ACT4/PS5. Design now.

### R-06 · P1 · PS3 entitlement ≡ consumption

- **Systems:** PS3, PS4, PS6 Director.
- **Evidence:** `consumed: Boolean(existing?.consumed) || grant` (`salienceEngine.mjs:393`) (**PROVEN**).
- **Failure mode:** a rejected or expired initiative or context grant suppresses the incident for 10 minutes, so the NPC "forgets" to react.
- **When it becomes expensive:** at PS4/PS6.
- **Smallest mitigation:** `C-03` (`decisionKey`, `policyVersion`, `acknowledge`).
- **Fix now?** **Yes, with the PS3 merge** (no shadow behavior change).

### R-04 · P1 · UX4 clears the conversation partner at PTT release

- **Systems:** UX4, Essential targeting, F11, P2 `current`, PS discovery, CGE.
- **Evidence:** `TalkTargetSelector.Stop` → `ReleaseEssential` → `ClearPlayerConversationPed` (`3dadbcf`, lines 118-131, 289-297) (**PROVEN**). The impact during the reply is **INFERRED**.
- **Failure mode:** during the NPC's reply, F11 shows no Current NPC, P2 `current.*` targets a different ped or none, PS drops the observer, CGE loses its target, and Essential partner-dependent behavior changes (**UNKNOWN**).
- **When it becomes expensive:** after the UX4 merge, once other features depend on it.
- **Smallest mitigation:** remove the clear (keep the generation fence). Add a GTA acceptance item.
- **Fix now?** **Yes, before the UX4 merge.**

### R-10 · P1 · Callback vocabulary fix can be lost in reconciliation

- **Systems:** PS1 native (`IntelligenceIntegration.cs:318`), companion `contracts.mjs:31`, ACT0/1.
- **Evidence:** `main` maps `follow`/`wait`. ACT0/1 and ACT2 change **both** sides to `followtarget`/`waithere`. N5 proves canonical names (**PROVEN**).
- **Failure mode:** a reconciliation that keeps the native fix but `main`'s validator rejects every `followtarget`/`waithere` callback frame (`other` still passes). The opposite combination silently maps everything to `other`.
- **When it becomes expensive:** at the ACT0/1 merge; the failure is silent.
- **Smallest mitigation:** a cross-language contract test (native enum = companion enum), plus taking PS2's diagnostics validator.
- **Fix now?** **During the ACT0/1 reconciliation.**

### R-11 · P2 · PS3 verification record wrong; 60 tests skipped

- **Evidence:** duplicate `const replay` (lines 252 and 270) → SyntaxError → sequential import aborts. The manifest says `incomplete_environment_block`. The scratch rename gives 382/382 (**PROVEN**).
- **Failure mode:** the deployed payload's verification overstates coverage, and future regressions in later test files go unnoticed.
- **Mitigation:** rename, rerun, and correct the record. Make the runner count an import failure as a failed test: today it exits 1, but its summary still prints `pass 322 / fail 0`, followed by the uncaught `SyntaxError`.
- **Fix now?** **Yes.**

### R-12 · P2 · `Encounter.Mode` stale after ACT terminals

- **Evidence:** `Finish` → `EndOwnership(false)` → `Mode = "idle"` for every terminal except a P2 preempt (which runs `EndOwnership(preempted=true)` first), including `DETACHED`/`SUPERSEDED` (ACT2 `StepRunner.cs:325-336`, `ActivityDispatch.cs:145-158`) (**PROVEN**).
- **Failure mode:** the UX shows Idle while the ped follows. Future arbitration treats the ped as free.
- **Mitigation:** `C-06`.
- **Fix now?** With the ACT2 reconciliation.

### R-13 · P2 · Clock/world-epoch detection fragmented

- **Evidence:** separate detectors in P2 (`ResetForClockDiscontinuity`), PS (`clock_reset`) and ACT (`ClockReset`) (**PROVEN**).
- **Failure mode:** a one-tick window of cross-table inconsistency. A save load without a regression is undetected by all of them.
- **Mitigation:** `C-13` world-epoch broadcast.
- **Fix now?** With the ACT0/1 reconciliation.

### R-14 · P2 · Pipe epochs not shared

- **Evidence:** ACT `nativeRun`/`adapterEpoch` GUIDs, PS `adapterEpoch` + per-connection `streamId`, and the P1 epoch are minted separately (**PROVEN**).
- **Failure mode:** the companion cannot correlate PS and ACT frames to the same host run. The health model fragments.
- **Mitigation:** `hostRunId` in every hello (`C-13`).
- **Fix now?** With the ACT0/1 reconciliation.

### R-15 · P2 · Feature-state and config fragmentation

- **Evidence:** six mode vocabularies; `worldProfileId` and `intelligence.mode` duplicated in native and companion configs; radio requires "both intelligence configs" (**PROVEN**).
- **Failure mode:** mismatched configs give half-enabled features, combinatorial QA, and diagnostics that disagree.
- **Mitigation:** `C-09` thin read model with one `off|shadow|active` vocabulary; one source per key.
- **Fix now?** Thin version with the ACT0/1 merge.

### R-16 · P1 · Social-routing turn-yield undefined

- **Evidence:** no contract exists. Essential's behavior on a deliberately silent turn is **UNKNOWN**.
- **Failure mode:** routing cannot hand the response to an overhearer without either speaking twice (fan-out) or failing a turn.
- **Mitigation:** `C-12` + probe.
- **Fix now?** Probe early; implement in PS7.

### R-17 · P1 · Player/protagonist identity undefined

- **Evidence:** identity research line 216 (open). No implementation (**PROVEN** absence).
- **Failure mode:** relationships and memories pool across Michael, Franklin and Trevor.
- **Mitigation:** `C-15` in v2.
- **Fix now?** Design with `C-08`.

### R-18 · P2 · No reflex producer in PS

- **Evidence:** the PS1 signal kinds have no reflex kind. ACT detects reflexes from `NpcState` (**PROVEN**).
- **Failure mode:** self-knowledge and witness gaps ("why did you put your hands up?").
- **Mitigation:** a PS8 producer from the same shared sampler.
- **Fix now?** Defer (PS8).

### R-19 · P2 · Third-party mods tasking promoted peds (PR/LSPDFR)

- **Evidence:** P2 guards cover mission entities. ACT detects `superseded_external` after the fact. Non-flagged foreign tasking is **UNKNOWN**.
- **Mitigation:** an E7 probe; keep after-the-fact detection.
- **Fix now?** Defer.

### R-20 · P2 · Cross-actor vehicle seat races

- **Evidence:** `seat_free` is a per-step precondition only. The ROADMAP notes order-dependent entry (**PROVEN**). Smart Vehicle Entry is **UNKNOWN** (U5).
- **Mitigation:** an ACT3 seat-claim table plus probes V1–V3.
- **Fix now?** Defer (ACT3).

### R-21 · P3 · `voiceReference` display duplicate

- **Evidence:** set at promotion and used only for display; P1 is the authority (**PROVEN**).
- **Mitigation:** derive the display value.
- **Fix now?** Cleanup.

### R-22 · P3 · Stale status docs

- **Evidence:** `README.md:58` says P2 is "not validated in GTA". The ROADMAP PS3 row says "not deployed" (**PROVEN**).
- **Mitigation:** edit the docs.
- **Fix now?** Yes (docs only).

### R-23 · P2 · Branch drift in shared contract files

- **Evidence:** ACT0/1 changes `contracts.mjs` (action enum) on top of a pre-PS2 diagnostics validator. ACT2 is 40 commits ahead and 11 behind (**PROVEN**).
- **Mitigation:** reconcile ACT0/1 first and keep PS2's diagnostics. Run the cross-language contract tests.
- **Fix now?** During the reconciliation.

### R-24 · P3 · Timing-sensitive P1 test

- **Evidence:** `tests/p1-session-identity.test.mjs:340` (`providerDeadline <= started + 5010`) failed once, then passed on two reruns (**PROVEN**).
- **Mitigation:** fake clock.
- **Fix now?** Cleanup.

### R-25 · P2 · P2 RAGE host aggregates every native integration

- **Evidence:** P2, PS, ACT and UX4 (and the planned CGE and radio) all live in one host (`RuntimeEntry`). Essential contains integration exceptions (N17) (**PROVEN**).
- **Failure mode:** an initialization-order or shutdown fault in one feature affects the others. The CGE plan already requires fail-soft behavior.
- **Mitigation:** keep per-feature construct/teardown isolation and per-feature health keys (`C-09`). Do not split hosts yet.
- **Fix now?** Defer.

### R-26 · P2 · Manual `promise`/`relationship` memories overlap planned commitments and edges

- **Evidence:** the P2 memory categories include `promise` and `relationship` (`profileStore.mjs:30`) (**PROVEN**).
- **Failure mode:** two representations of the same obligation or relationship.
- **Mitigation:** in v2, define manual categories as narrative and the structured records (`commitments[]`, `relationshipEdges[]`) as authoritative for behavior, with editor linking.
- **Fix now?** With `C-08`.

### R-27 · P2 · Activity vocabularies diverge

- **Evidence:** the PS3 `ACTIVITIES` enum, ACT capability ids, `Encounter.Mode` values and Essential activity text all differ (**PROVEN**).
- **Mitigation:** one mapping in `C-14` (plus an `unknown` value).
- **Fix now?** With the PS3 merge (add `unknown`); the mapping comes with ACT2.

### R-28 · P3 · Typed input ignores UX4 selection

- **Evidence:** documented in UX4 (stock Text recomputes the best ped) (**PROVEN**).
- **Mitigation:** HUD disclosure; a typed-target follow-up.
- **Fix now?** Disclosure now; the rest is deferred.
