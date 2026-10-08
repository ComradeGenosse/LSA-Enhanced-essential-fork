# System contract register

> **Corpus status note (October 8, 2026):** Contract definitions in this register are the forward architectural authority. Remaining implementation phases are mapped in the [unified master plan](UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md); this reconciliation changes status/sequencing references, not contract definitions. Implementation status can advance independently; use [CURRENT.md](CURRENT.md) and [../ROADMAP.md](../ROADMAP.md) to see what has actually landed or been validated.


Part of the [system convergence architecture](system-convergence-architecture.md) package. Section 3 originated as proposed interfaces; some contracts have since landed. Each entry states its implementation status. Use the roadmap for deployment/GTA truth.

Contents:

1. Identity / reference taxonomy
2. Existing contracts to lock
3. Missing contracts (proposed)
4. Contract evolution rules

Machine-readable form: [system-contracts.v1.json](system-contracts.v1.json).

---

## 1. Identity / reference taxonomy

**Legend**

- ✔ = safe
- ✘ = unsafe
- ◐ = conditionally safe (see note)

**Columns**

- **Action addr.:** may be used to address a native effect (speech, action, gaze).
- **Memory id.:** may be stored as the identity of a durable memory subject or owner.
- **Recreation:** still means the same thing after despawn/summon.
- **Save/load:** still means the same thing after loading a GTA save.
- **Async:** may be held across an `await`/fiber hop without revalidation.
- **Private state:** may be used to retrieve private character state.

| # | Identifier | Identifies | Allocator | Lifetime | Persisted | Action addr. | Memory id. | Recreation | Save/load | Async | Private state |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `Ped` wrapper / Rage PoolHandle | A GTA entity slot (handle with reuse counter) | GTA / RPH | until deletion; slot reused | RAM | ✘ (only inside an Essential tuple or native anchor) | ✘ | ✘ | ✘ | ✘ | ✘ |
| 2 | `MemoryAddress` + full handle (+ owner `incarnationId`) | One physical incarnation | GTA (address); P1/P2 (owner incarnation) | entity lifetime | RAM | ◐ inside a native anchor revalidated at use | ✘ | ✘ | ✘ | ◐ revalidate | ✘ |
| 3 | `pedId` | Essential's turn ped id (handle-derived string) | Essential | session | RAM | ◐ only as part of the full tuple | ✘ | ✘ | ✘ | ◐ with the full tuple | ✘ |
| 4 | `sessionNonce` | An Essential conversation session | Essential | session | RAM | ◐ tuple member | ✘ | ✘ | ✘ | ✔ as tuple member | ◐ via P1 binding with fresh owner evidence |
| 5 | `turnId` | One turn | Essential | turn | RAM | ◐ tuple member | ✘ | ✘ | ✘ | ✔ as tuple member | ✘ |
| 6 | `generationId` | One generation (exact interruption) | Essential | generation | RAM | ◐ tuple member | ✘ | ✘ | ✘ | ✔ as tuple member | ✘ |
| 7 | `captureRef` | Run-local reference to a retained wrapper/handle/address/owner lifetime | PS native `EntityAnchors` (canonical per `C-02`) | until retired (mismatch, nonexistence, revoke, expiry, clock regression) or host run end | RAM (opaque provenance only, if stored) | ◐ as a *target*, resolved natively at use | ✘ | ✘ | ✘ | ✔ (resolve at use) | ◐ only via the `C-02` index **and** recognition |
| 8 | `CharacterId` | A durable character | P1 | permanent | disk | ✘ **never** | ✔ | ✔ | ✔ identity (experience needs `timelineId`) | ✔ data selection | ✔ for that character's own data; never implies another observer's recognition |
| 9 | `worldProfileId` | A world/mod-setup namespace for aliases | user config (native + companion) | durable | config | ✘ | namespace only | ✔ | ✘ **not a timeline** | ✔ | ✘ |
| 10 | `timelineId` (**missing**) | One playthrough / save lineage | TimelineGuard (`C-07`) | durable | disk | ✘ | scope for experience | ✔ | ✔ by design | ✔ | gates retrieval |
| 11 | Source owner alias (`comrade.authored`, `promoted.<uuid>`) | The authored-owner key for a character | P2 owner + P1 registry | durable | disk | ✘ | ✘ (maps to CharacterId) | ✔ | ✔ | ✔ | ◐ through P1 with fresh owner proof only |
| 12 | `encounterId` | A P2 encounter | P2 host | until release/despawn | RAM | ◐ as a P2 command target with an `expect.encounterId` fence | ✘ | ✘ | ✘ | ◐ fenced | ◐ ephemeral session profile only (`sessionProfiles` `encounterKey`) |
| 13 | `OwnershipToken` / `incarnationId` / `claimRevision` | Ownership proof of one incarnation | P2 / P1 | incarnation | RAM | ✘ | ✘ | ✘ | ✘ | ✔ as a fence | ✘ |
| 14 | `nativeRun` / `adapterEpoch` / `streamId` (+ proposed `hostRunId`) | Host run / pipe connection | each channel (`hostRunId`: `RuntimeEntry`) | run / connection | RAM | ✘ | ✘ | — | ✘ | ✔ as a voiding fence | ✘ |
| 15 | UX selected target (UX4 `SelectionId` + frozen `Ped` + address) | A highlighted candidate | UX4 policy | ≤ selection timeout / retention radius | RAM | ◐ only through a committed PTT with native revalidation | ✘ | ✘ | ✘ | ✘ | ✘ |
| 16 | UX4 PTT generation | One hold | loader + native | one hold | RAM | ✘ | ✘ | ✘ | ✘ | ✔ as a fence | ✘ |
| 17 | `P###` / `V###` | A reasoning-time person/vehicle reference | P0 snapshot | one turn | RAM | ◐ only through `validateStockDecision` within the same turn (time-of-use fence) | ✘ | ✘ | ✘ | ◐ turn-scoped | ✘ |
| 18 | Activity target anchor | A RefSlot target | ACT2 private table today → shared `captureRef` (`C-02`) | step / activity (`ResumeToken` ≤120 s) | RAM | ◐ `AnchorLive` at use | ✘ | ✘ | ✘ | ◐ incarnation check | ✘ |
| 19 | `executionId` / `activityId` / `stepId` / `leaseId` / `leaseEpoch` / `requestId` | One ACT step, plan or lease | ACT engine / StepRunner | execution / activity | RAM | addresses the *step*, not the ped | provenance only | ✘ | ✘ | ✔ (stale receipts rejected) | ✘ |
| 20 | `observationId` + `revision` | One observer's immutable observation | PS2 correlator | observation TTL | RAM (PS5: opaque provenance) | ✘ | provenance only | ✘ | ✘ | ✔ immutable | ✘ |
| 21 | `episodeId` | A world-level incident | PS2 correlator | 30 s window | RAM | ✘ | provenance only | ✘ | ✘ | ✔ | ✘ |
| 22 | `signalId` / `producerSequence` | One raw signal | PS native | run | RAM | ✘ | ✘ | ✘ | ✘ | dedupe only | ✘ |
| 23 | Salience decision key (`observationId`+`revision`+policy) | One ranking decision | PS3 | ledger TTL 10 min | RAM | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ |
| 24 | `utteranceId` / `transcriptRef` / `captureReceiptRef` | One player utterance / transcript / capture | proposed native (`C-01`) / companion | ≤30 s | RAM | ✘ | provenance only | ✘ | ✘ | ✔ | ✘ |
| 25 | `conversationRef` (**missing**) | A multi-party conversation | social routing (PS7) | conversation | RAM | ✘ | provenance only | ✘ | ✘ | ✔ | ✘ |
| 26 | Directed-interaction id | One Essential DI | Essential `DirectedInteractionManager` | interaction | RAM | ◐ cancel-by-exact-id only | ✘ | ✘ | ✘ | ✔ exact | ✘ |
| 27 | `DirectorTicket` UUID (`ps:<uuid>` `DedupeKey`) | One admission request | native admission (PS6) | ≤2 s pre-admission, then mapped to a tuple | RAM | ◐ admission only (ticket → tuple), consumed once | ✘ | ✘ | ✘ | ✔ | ✘ |
| 28 | `memoryId` | One durable memory | P2 | durable | disk | ✘ | ✔ record id | ✔ | ◐ needs `timelineId` (`C-07`) | ✔ | ✔ (it *is* owner-private state) |
| 29 | Profile revision / store revision | CAS counter | P2 | durable | disk | ✘ | CAS only | ✔ | timeline-agnostic | ✔ (CAS) | ✘ |
| 30 | `CommandEnvelope` id (UX bridge) | One UX command | loader / `LocalCommandQueue` | command | RAM | ◐ with an `expect.encounterId` fence | ✘ | ✘ | ✘ | ✔ | ✘ |

**Over-trust findings:** see main report §3.3 (I-1…I-7). In summary:

- Delayed special-turn submission re-resolves handles.
- Pipe epochs are not shared.
- `PlayerConversationPed` is used as a stable selection.
- PS3 relationship branches assume a CharacterId join that does not exist.
- `Encounter.Mode` is used as an owner token although it goes stale.
- `worldProfileId` is used as if it were a timeline.
- PS1 treats callback names as semantic labels.

---

## 2. Existing contracts to lock

| Contract | Version / pin | Owner | Status | Lock note |
|---|---|---|---|---|
| Essential turn tuple and lifecycle (auth, tagged PCM, stream end, `PlaybackStarted/Ended`) | source-pinned hooks (48 pinned patches) | Essential / E1 | merged | **Lock** |
| E1 history commit rule | — | companion | merged; GTA-observed 2026-10-01 | **Lock** |
| P0 `TurnSnapshot` (actor/listener/world/`referenceMap`, revision) + time-of-use fence | `turnSnapshot.mjs`, `decisionValidator.mjs` | companion | merged | **Lock** |
| P1 claim key + `LSA.SessionIdentity.v1` (hello/proof/revoke/heartbeat, `schemaVersion 1`) | `OwnerFactChannel.cs`; identity pins | P1 | merged | **Lock** |
| P2 `LSA.PromotedCharacters.v1` ops; `EnrichActor` `{version:1, encounterId}` | `PromotedCharactersIntegration.cs` | P2 | merged | **Lock** (add `C-06` field) |
| P2 `ProfileStore` schema 1 | `profileStore.mjs` (`PROFILE_SCHEMA = 1`) | P2 | merged | Superseded by one v2 envelope (`C-08`) |
| UX `commands.v1.json` + `CommandEnvelope v1` + DomainHost bridge | sha256 `2ec82281…` | UX | merged | **Lock** |
| ACT `commands.v2.json` | sha256 `07e0ad83…` (merged ACT2) | UX/ACT | merged through PR #18 | Lock; current native/companion hash tests remain required |
| PS `LSA.Intelligence.v1` frames (hello/anchors/retire/retire_batch/signal/diagnostics…) | `contracts.mjs` | PS | merged | **Lock** (add `hostRunId` in hello, `C-13`) |
| PS Observation v1 (≤4 claims, `recognizedCharacterIds = []`) / Episode v1 | `contracts.mjs`, `episodeCorrelator.mjs` | PS | merged | **Lock** |
| PS `SpeechCaptureReceipt` v1 + `AcceptedTranscript` | `speechContract.mjs` | PS | merged (gated) | Extend to v2 (`C-01`) |
| PS3 `SalienceDecision` (context/memory/response + ≤4 reasons, `decisionKey`, `policyVersion`) | current `main` | PS3 | merged; deployed shadow; live evaluation/telemetry exercised | **Lock**; C-03 acknowledgement is implemented |
| ACT `LSA.Activities.v1` frames; `ActionReceipt` states; `ResumeToken` rules | merged ACT0–ACT2 | ACT | merged through PR #18; recorded installed/smoke-tested | Lock; focused capability probes remain open |
| ACT capability registry | `activity-capabilities.v1.json` sha256 `31ed6e6d…` (merged ACT0–ACT2) | ACT | merged | Lock (`directed_interaction` stays ACT7) |
| Radio raw signals `radio_changed`/`radio_stopped`; `radioTracks.v1.json` | R0–R5/v2 unmerged stack | PS | unmerged; v2 tests/build/GTA/provenance gates open | Raw facts only; R5 must contribute through C-04 |
| CGE runtime contract | current plan | CGE | plan | **Reconciled**: yield to `ConversationLookBehavior`; consume C-01; body turns belong to ACT3 |
| PS6 `DirectorTicket` (research) | PS/SD research §9 | Director | research | Lock the shape; extend with `directorIntentId` (`C-11`) |

---

## 3. Missing contracts (proposed)

Each entry gives: **why**, **current workaround**, **smallest interface**, **owner**, **consumers** and **phase**. The field lists are minimal sketches for the implementing branch to refine.

### C-01 UtteranceLifecycle v1 + SpeechCaptureReceipt v2

- **Why:** there are seven representations of "the player spoke" (five in code, two in plans) and no shared id (main report §5). PS2 hearing, social routing, CGE, UX4 HUD and PS5 all need the same utterance.
- **Workaround today:** `acceptPlayerTranscript({text, receipt: null})`; `playerSpeechGate = unsupported_capture_receipt`; the CGE plan proposes to find its own seam.
- **Owner:** Plane 2 (P2 host), sourced at Essential's mic core boundary.
  - Hook candidates: `BeginMicTurn`/`MarkMicReleased`, or the IL-resolved active-mic field that UX4 already uses.
  - Feasibility is **UNKNOWN**: it needs the planned source-time mic probe.
- **Interface:**

```text
utterance.started  { utteranceId: uuid, hostRunId: uuid, inputSource: stock_talk|marked_talk|ux4_ptt|typed,
                     micPed: { captureRef }, selectionProvenance: { uxGeneration?: int, selectionId?: string },
                     startGameTick: u32, startMonotonicMs }
utterance.turn     { utteranceId, pedId, sessionNonce, turnId }          // join, emitted once the turn exists
utterance.ended    { utteranceId, endGameTick, endMonotonicMs,
                     terminal: captured|cancelled|empty|overflow }
SpeechCaptureReceipt v2 = v1 fields + { utteranceId (already), turnJoin?, inputSource, micPed }
AcceptedTranscript v2   = v1 fields + { utteranceId (already) } populated from the turn join
```

- **Rules:**
  - Typed input produces `started` and `ended` with zero duration and no observers.
  - Hearing is evaluated only over the window `[start, end]`.
  - One STT per utterance.
- **Consumers:** companion turn pipeline (annotation), PS2, social routing, CGE, UX4 HUD, PS5.
- **Phase:** probe in the PS0–PS3 GTA session. Implement before PS2 player-speech, CGE player-listening/source-time probe (master 10b), and social routing. Playback-only CGE (10a) consumes existing Essential events without fabricating C-01 evidence; its mechanism/ownership probe remains mandatory.

### C-02 Shared anchor service + observer identity index

- **Why:** there are three run-local reference tables (PS, ACT2, P2). The Director cannot hand ACT a perceived entity. PS3 relationship branches are dead. PS4 needs a join between the turn actor and the observer.
- **Workaround today:** ACT `Resolve` supports only `player`/`here`; PS3 passes `activity:'unknown'` until C-14 supplies stronger evidence; no join exists.
- **Owner:** Plane 2. Promote PS `EntityAnchors` to a host-level service owned by `RuntimeEntry` (ACT research §9.4 already assumed this).
- **Interface:**

```text
native:  Retain(ped, reason, ownerLifetime?) -> captureRef ; Resolve(captureRef) -> Ped|null ; Retire(captureRef, reason)
         (same retirement rules as PS0/PS1; one table; per-consumer quotas)
pipes:   ACT RefSlot { slotKind, captureRef } ; PS frames unchanged
companion index (RAM): captureRef -> { kind, encounterId?, incarnationId?, owned: bool }
         + CharacterId lookup ONLY for owned anchors via P1 binding of that incarnation
         + recognition gate (SubjectBeliefRef) before any model-visible use
```

- **Phase:** before ACT3 (non-player targets) and PS4.

### C-03 Salience consumption acknowledgement

- **Status:** **implemented on current `main`.** PS3 now separates grant from consumption and requires explicit acknowledgement.
- **Historical defect:** the earlier implementation used `consumed = grant`; that behavior is retained only in the archived convergence audit.
- **Interface:**

```text
SalienceDecision += { decisionKey: string, policyVersion: int }
acknowledge(decisionKey, consumer: ps4_context|ps6_ticket|ps5_memory, outcome: delivered|rejected|expired) -> bool
ledger: granted (entitlement) and consumed (delivered) tracked separately
```

- **Phase:** **implemented with the PS3 merge**; PS4/PS5/PS6 consumers must use the acknowledgement contract.

### C-04 TurnKnowledgeFrame (single knowledge assembler)

- **Why:** this is the epistemic firewall. Without it, the raw stock context, P2's existing canon projection and three planned writers (PS4, ACT4, radio) would each write to the same prompt.
- **Owner:** companion (PS4). Built by extending P2's existing allowlisted canon projection (16 KiB deterministic budget).
- **Interface:**

```text
TurnKnowledgeFrame { frameVersion, turn: {pedId, sessionNonce, turnId, generationId}, frozenAt (with P0),
  lanes: {
    SELF:       { canon (P2 allowlist), selfFacts[] (ACT receipts/C-05 with strength) },
    PERCEIVED:  { observations[] (PS3 order; context≠omit; budget) },
    CONVERSE:   { committed history, current transcript (+utteranceId), overheard[] },
    RECALLED:   { memories[] (recognition-gated; timeline-filtered) },
    SITUATION:  { allowlisted world fields },
    COMPAT:     { explicitly allowlisted Essential actor/listener/world fields }   // transitional
  }, budgets: { totalBytes, perLane } }
```

- **Rules:**
  - No raw Essential JSON is serialized.
  - CharacterIds never appear.
  - Each lane has a single producer.
  - ACT4 and radio contribute *lane items*, never their own prompt blocks.
- **Phase:** PS4, which is also the next core PS implementation.

### C-05 DialogueActionReceipt

- **Why:** an executed `DO` is not remembered when the reply is interrupted (O-1). Dialogue actions have no self-knowledge.
- **Interface:**

```text
on output_transcript(action): pending { tuple, canonicalAction, publishedAtMs }
on OnNpcActionExecuted(ped, canonicalName, succeeded) for that ped within window:
   receipt { tuple, canonicalAction, state: HANDLER_ACCEPTED|FAILED, atGameTick }
then optional physical evidence via the same ACT adapters (follow_mode/hold_mode…)
→ SELF lane fact ("I agreed to follow; following is established") independent of history commit
```

- **Phase:** before ACT4/PS5. Reuses the ACT StepRunner callback ring.

### C-06 Primary-behavior owner token

- **Why:** `Encounter.Mode` becomes `idle` after `DETACHED`/`SUPERSEDED` while an Essential mode continues (O-2). Director and ACT7 arbitration need a truthful owner.
- **Interface:**

```text
Encounter.Owner { owner: p2|act|essential_residual|none, mode: follow|wait|sit|activity|unknown|idle,
                  leaseId?, since: gameMs }
set on every P2 control, ACT BeginOwnership/EndOwnership; on ACT terminal derive mode from sampled NpcState
(FollowPlayerOnFoot, FollowPaused, SitOnGroundMode, …) instead of writing "idle"
```

- **Phase:** remaining integration after merged ACT2; unified master phase 6. No owner truth is inferred from merge/deployment.

### C-07 TimelineGuard

- **Why:** save-rollback safety. No save hook exists (**PROVEN**).
- **Interface:**

```text
store.timelines[]; activeTimelineId selected EXPLICITLY (editor/F11) per save lineage;
every timeline-scoped record carries {timelineId, formedAt: {utc, gameClock?}};
reads filter by activeTimelineId; on rollback suspicion (GameTime regression + probe-validated hints) → fail closed:
hide records newer than the last checkpoint (never delete); canon is timeline-agnostic
```

- **Phase:** with C-08, before PS5. Automatic detection is deferred (**UNKNOWN** signals).

### C-08 Profile v2 envelope (one migration)

- **Why:** PS5 (v2), ACT7 (v2/v3) and PS7 edges each plan their own bump. Traits have no structured field.
- **Interface:** main report §10.2. All new fields are empty or nullable, so `v1 → v2` is a pure function. A v1 backup is kept and there is no automatic downgrade.
- **Phase:** before PS5.

### C-09 Capability / health read model

- **Why:** six mode vocabularies, duplicated config keys, and no machine-readable validation state.
- **Interface:**

```text
capability key (e.g. ps.speech_heard, act.follow_person, ux4.ptt, cge.gaze, radio.facts) →
  { compiled, configured: off|shadow|active, runtimeSupported (by hostRunId), validated (payloadHash list),
    suspended, active (derived) }
validation.v1.json committed per GTA acceptance session
```

- **Rule:** read model only. Subsystems still enforce their own gates.
- **Phase:** remaining thin read-model integration against merged ACT0–ACT2; unified master phase 5.

### C-10 Conversation-partner policy

- Writers: committed player input only. Clearers: Essential or the next committed input. Readers: everyone else (main report §4.2).
- **Phase:** C-10's UX4 ownership fix is implemented on `main`; future input/targeting consumers must preserve the same ownership rule.

### C-11 DirectorIntent + ActivityProposal + DI ownership

```text
DirectorIntent { directorIntentId, observerCaptureRef, salienceDecisionKey, priority: director_urgent|director_routine,
                 speech?: DirectorTicket, activity?: ActivityProposal, pairing: speech_first|concurrent }
ActivityProposal { capability, slots { RefSlot{captureRef} … }, priority (clamped), source: scene_director }
directed_interaction executed only as an ACT7 capability; P2 Safe() honors
  lsaDirectedInteraction { interactionId, leaseId } instead of suspending
```

- **Phase:** PS6 (speech part); ACT7/PS7 (activity and DI).

### C-12 ResponderReservation / turn-yield

```text
reserveResponder(utteranceId, captureRef, role: primary|secondary) → reservationId | rejected
decision outcome "yield" for the mic Ped's turn (Essential handling of a silent turn: UNKNOWN → probe)
```

- **Phase:** probe before PS7; implement in PS7.

### C-13 hostRunId + WorldEpoch broadcast

```text
RuntimeEntry mints hostRunId at Initialize; every pipe hello carries it.
P2 host owns the single clock/world discontinuity detector and broadcasts
world_epoch { epoch, reason: clock_regression|host_reload|timeline_change } to PS, ACT, UX4, CGE.
```

- **Phase:** next shared-host integration against merged ACT0–ACT2; unified master phase 1.

### C-14 ObserverSituation provider

```text
situationFor(observerCaptureRef) → { activity: idle|driving|passenger|in_vehicle|conversation|following|waiting|unknown,
                                      relationship?, traitPolicies?, profileRevision? }   // recognition-gated
```

One mapping from ACT/P2/Essential modes. Use `unknown` until it is implemented.

### C-15 Player / protagonist SubjectRef

```text
SubjectRef = { kind: character, characterId } | { kind: protagonist, key } | { kind: local, ref }
```

No pooling of relationships or memories across protagonist switches (identity research line 216).

- **Phase:** in C-08, before PS5/PS7.

---

## 4. Contract evolution rules

These rules are **PROPOSED**, to be adopted with the next merge.

1. **Every cross-plane contract change ships a contract test on both sides.** Example: native enum = companion validator (the ACT0/1 callback vocabulary).
2. **Every pipe hello carries `hostRunId` and a contract version.** Unknown versions fail closed for that capability only.
3. **Each durable schema has exactly one migration owner** (P1 for identity, P2 for profiles). No other subsystem writes its own files.
4. **Prompt-visible content enters only through `C-04` lanes.**
5. **Run-local ids may appear in durable records only as opaque provenance strings.** They are never resolved again.
6. **A contract that names Essential behavior cites the pinned evidence** (offset or patch id). It is labeled UNKNOWN until a probe proves it.
