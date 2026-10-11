# Standalone LSA — source-backed architecture hardening and delivery plan

**Date:** 2026-10-11  
**Status:** proposed implementation plan; **documentation only / no code enabled**  
**Plan source base:** standalone PR [#50](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/50), head `9c35f04ba72cb25657543e71885f03981e065025` (stacked on #48/#44/#43/#42/#40/#38).  
**Related independent memory stack:** [#49](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/49) → [#51](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/51) → [#52](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/52), M1 head `08c7e94cd28a17e5521d5be28f6b84603e2cf986`. These two stacks are **not** a common branch; this document does not silently integrate them.  
**Input:** independent October 11 architecture review (Qwen; 18 findings F1–F18, throughput simulations, 10 proposed GTA experiments). Every accepted recommendation below is traced to repository source and a falsifiable acceptance gate; the review's hypothetical failure predictions are **not** asserted as observed GTA failures.

> **Decision requested:** retain the independent Essential replacement, its validated safety core and our memory design, while hardening the *current* future product around **one AI/memory brain, a thin GTA body, independent real-time voice, and a bidirectional event/command protocol**. Do **not** make multi-host portability or indefinite Essential support a product goal. No big-bang rewrite.

## 0. Authority, applicability and truth labels

Read [AGENTS.md](../../AGENTS.md), [current roadmap](../ROADMAP.md), [CURRENT](../research/CURRENT.md), [DECISIONS](../research/DECISIONS.md), [system contract register](../research/system-contract-register.md), [standalone roadmap](roadmap.md), [speech status](phase-4-status.md) and [feature parity matrix](feature-parity-matrix.md) before implementing.

- The **active, Essential-based `main`** still follows locked D-001 (Essential physical executor), D-012 (conversation-partner lifetime) and D-016 (playback/history). **Do not edit or silently supersede those locks in this planning PR**. The standalone branch is an *isolated candidate* whose replacement authority activates only in an Essential-free deployment after accepted tests and an explicit cutover ADR.
- Preserve cross-host *semantic* locks: D-002 CharacterId never authorizes a physical effect; D-003 one P2 profile/memory store; D-004 world evidence ≠ NPC knowledge; D-007 grant ≠ acknowledged consumption; D-008 PS4 single knowledge writer; D-011 timelines and SubjectRef; D-017 no replay of already-published side effects.
- M0/M1 are under development, **not deployed memory**. M1 SQLite/FTS5 is currently additive and unused by the live P2 service; no production switchover was claimed in #52.
- Evidence vocabulary: **SRC** (verified code), **SIM** (Qwen simulation/probe, not independent GTA telemetry), **HYP** (requires real GTA), **GTA** (hash-matched game trace). `PASS/FAIL/BLOCKED/UNTESTED` must identify which one; a green CI job cannot imply physical acceptance.
- The planning source snapshot is pinned above. **Every implementation PR must refresh the source/head inventory** and explicitly reconcile changed interfaces, especially PR #39 Qwen TTS, #37 C-01/STT, and the memory stack.

## 1. The four retained architectural choices

| Component | Permanent responsibility | Explicitly *not* its responsibility |
| --- | --- | --- |
| **Brain** — one shared Node implementation | Luna/provider requests; P1/P2 identity and **one SQLite character/memory store**; PS2/PS3 reasoning and PS4 typed knowledge; dialogue/turn-taking; PS6 Director; actions as *proposals*; spontaneous/NPC↔NPC speech scheduling; committed history derived from receipts | GTA native calls, RPH fibers, holding PCM device buffers or pretending unplayed speech happened |
| **Body** — one independently authored RPH GTA plugin | Run-local ActorRef/incarnation and lease authority; sampled verified GTA facts; source-time input/utterance identity; push events; engage/gaze/actions/tasks with postcondition receipts; ped ownership, world epoch, game pause, camera/speaker poses; combat/mission yielding | Model prompts/text storage, AI inference, durable memory, TTS PCM chunk forwarding on its game fiber |
| **Voice** — separately scheduled audio engine **outside the GTA fiber** | Provider-neutral OpenAI/Qwen TTS; bounded sample buffers; device-clock mixing/playback; per-speaker spatialisation/volume/pause; exact completed-segment receipts and mouth envelopes; later microphone acquisition + VAD/STT (cloud OpenAI and opt-in local Parakeet) | Allocating game ped authority, inventing world observations or writing memory directly |
| **Protocol v2** — explicit control/event/data planes | Bounded, versioned, authenticated local IPC; **body→brain event push**, **brain→body lease/command requests**, body→voice poses/capabilities, brain→voice speech, voice→brain receipt, voice→body mouth envelope | One blocking request per PCM fragment, unbounded queues, unacknowledged replay after disconnect |

**Implementation choice:** Voice may initially be a separate worker/module in the **same Node companion process** if it has its own real-time scheduling/device worker and proves independence from GTA ticks. A distinct process is allowed when measurement or mic/echo-cancellation isolation justifies it. **Neither means a second LLM, memory store or curator.** Prefer a Windows WASAPI-class backend for production; retain waveOut as a short-lived diagnostic baseline, not as the final quality target. Direct GTA audio injection is **out of scope**, not a prerequisite.

**Single brain means single logical implementation, not two permanent companions.** A small *temporary* Essential bridge may feed that same brain while the body is being replaced, but no investment in hypothetical ScriptHookV/SHVDN host portability. Retire the temporary adapter after parity and the explicit cutover gate. Preserve existing standalone `NativeAuthority` and playback ledger; move responsibility at module seams instead of discarding them.

### 1.1 Ownership decisions to formalize at implementation time

Create a **standalone-only versioned ADR** (provisional SR-01 through SR-05, do not reuse D-018–D-020 already allocated to memory) before writing protocol v2:
- **SR-01:** body grants/revokes all game-effect rights; brain only proposes; voice can render *only* a valid, currently allowed speech lease.
- **SR-02:** exactly one P2 character database and one memory/history writer; `CharacterId` durable, `ActorRef` run-local; authenticated binding from live body owner evidence, no ped-handle/name guessing.
- **SR-03:** body events are source-qualified; PS4 composes the sole model-facing knowledge frame; spontaneity requires brain-initiated *requests* reauthorized by body, never unsolicited native playback.
- **SR-04:** voice completion uses actual device-played sentence-prefix receipts, not queued PCM/EOS; interruption commits only that truthful delivered prefix.
- **SR-05:** single live physical owner per GTA instance. During migration Essential and standalone must **never** control the same world. The Essential adapter is transitional; cutover explicitly supersedes D-001/D-012/D-016 for the accepted standalone runtime, not current `main`.

## 2. Source evidence and review disposition

All source URLs below are pinned to **the reviewed #50 head** unless another head is identified. Lines identify the specific claim, not a universal diagnosis.

| ID | Evidence / exact source seam | Disposition → required work | Proof |
| --- | --- | --- | --- |
| **F1** | **SRC+SIM:** [pipe one request, blocking owner dispatch](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/StandalonePipeServer.cs#L342-L410); [50 ms owner sleep](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/EntryPoint.cs#L112-L129); [3,000-byte chunks, 480 cap](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/lsa-standalone-companion/src/audio/nativePcm.mjs#L4-L10). Qwen's production-code simulation showed sustained underruns under some 58–100 ms fiber cadences; **not a GTA recording**. | **Architectural must-fix:** audio data plane never waits one GTA tick per chunk. Worker-fed per-speaker buffers, nonblocking bounded audio transport, credit and receipt accounting off fiber. | A 20-second known WAV and generated TTS play at normal duration without starvation at measured 30–40 *rendered* FPS; test cold/warm provider frames, pause/alt-tab, and >=2 speakers. |
| **F2** | **SRC+HYP:** [host reads launcher environment](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/EntryPoint.cs#L68-L105); [PowerShell sets vars before RPH launch](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/tools/standalone-gta-smoke/Start-Standalone-Test.ps1#L42-L70). Launcher inheritance is **unverified on the user's machine**. | Versioned, safe `Plugins/LSA.Standalone.json` for native opt-in; effective mode logged; fail on handshake disagreement, not silent fallback. Keep secrets out of config. | RPH/Steam/launcher launch + attach diagnostic accurately reports expected mode and capability pair. |
| **F3** | **SRC+HYP:** [DECOR_REGISTER/readback and required cookie](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/RageWorldAdapters.cs#L65-L124). GTA registration lock is plausible, **not demonstrated**. | Stage-1 native probe first. If unavailable, *design and independently test* handle/reuse-counter + address/model + continuity identity fallback, revoke after observation gap. Do not remove safety fences or use memory patch decorator unlockers. | Actual ambient-ped probe/churn/reload produces unique live incarnation and rejects reused/retired handles; no adoptions on ambiguity. |
| **F4** | **SRC:** [typed command resolves nearest ped again, 4 m](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/StandaloneTypedCommands.cs#L195-L276). No engagement hold. | Minimal `engage(actor)` and `release` with owner-limited face/look/hold, suppress overlapping ambient speech where safe; do not seize mission peds. Arm freezes exact actor ID, not a new nearest search. | Walk-by ped remains identifiable while user types; target cannot silently switch; disengage restores behavior and respects combat/mission scripts. |
| **F5** | **SRC:** [native turn offers polled by Node](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/lsa-standalone-companion/service.mjs#L58-L70). Native turn ledger also carries conversation text. | Body grants a **lease**, brain owns turn/historical text; brain `speech.request` for Director/NPC↔NPC, under body arbitration. | Player turn, Director turn and NPC-NPC scene exercise same lease fences. |
| **F6** | **SRC:** standalone providers under [`lsa-standalone-companion`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/tree/9c35f04ba72cb25657543e71885f03981e065025/lsa-standalone-companion), while M1 [`sqliteFoundation.mjs`](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/08c7e94cd28a17e5521d5be28f6b84603e2cf986/lsa-essential-e1-candidate/src/characters/sqliteFoundation.mjs) is presently in Essential-companion source. | Extract **one brain package** by *moving/re-exporting* tested modules; keep P2 store and M0 `contracts/memory.v1.json` intact; no parallel voice registry/database. | Same policy/replay fixtures pass against temporary Essential adapter and standalone fake body. |
| **F7** | **SRC:** [`PendingDialogue` has no commit](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/lsa-standalone-companion/src/conversation/typedTurn.js.mjs#L1-L63); [device segment receipt](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/lsa-standalone-companion/src/audio/physicalPlayback.mjs#L45-L87). | Typed multi-turn **history commit on acknowledged played prefix**; accepted player line only once; memory M2 receives identical canonical receipt. | Interrupted second sentence cannot be recalled as heard; same NPC remembers previous reply, restart durable only after M2. |
| **F8** | **SRC:** [standalone request builder](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/lsa-standalone-companion/src/conversation/responsesProvider.mjs#L25-L45) uses 350 max tokens and no explicit reasoning effort, unlike Essential's configured provider. | Reuse current validated Luna request/settings and per-character persona; distinguish reasoning/token budget provider failure from TTS delays. | Matched fixture / measured incomplete rate, first segment, final tokens and cancellation. |
| **F9** | **SRC+SIM:** [audio 480-chunk cap](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/lsa-standalone-companion/src/audio/nativePcm.mjs#L4-L10); [sequential segment slicing](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/lsa-standalone-companion/src/conversation/segmentPipeline.mjs#L25-L62). | One explicit per-reply duration/byte budget; coalesce arbitrary provider chunks; progress-based renewable leases; first-byte and idle vs total deadlines. | Boundary tests for 1 KiB/4 KiB/32 KiB frames, long replies, disconnect, timeout, no half-heard full-history commit. |
| **F10** | **SRC+SIM:** [one segment's TTS consumed fully before next is requested](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/lsa-standalone-companion/src/conversation/segmentPipeline.mjs#L65-L107). | Bounded one-sentence TTS look-ahead, ordering/abort caps; no action speech until complete validation. | Four-sentence fixture has no avoidable synthesis gap; safety tests preserve E3/E5 gates. |
| **F11** | **SRC:** [server request/response command set, no unsolicited events](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/StandalonePipeServer.cs#L355-L410). | Protocol v2 adds owner-queued push events, brain-to-body speech lease and bounded per-type QoS; no PCM JSON/base64 round trips through owner dispatcher. | Burst event/reconnect/expiry tests plus live spontaneous grant/playback gate. |
| **F12** | **SRC:** [spatial gain/pan uses player position/right vector](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/WaveOutSpatialOutput.cs#L300-L334). | Camera listener pose, per-buffer interpolation and bounded smoothing in voice engine; upgrade Windows backend after test. | Orbit camera, vehicle/interior, pause/device switch; no stale location or stale speaker gain. |
| **F13** | **SRC:** [single launcher voice default](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/tools/standalone-gta-smoke/Start-Standalone-Test.ps1#L1-L13). | Per-character verified P2 voice binding; temporary per-incarnation gender/archetype pools, fallback for absent evidence. | Two known promoted actors preserve distinct voices across respawn, no actor mix-up. |
| **F14** | **SRC+HYP:** [facial presenter](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/RageLipSyncPresenter.cs); specific visual quality untested. | Compare `mic_chatter` vs held talking facial and deterministic cleanup/ownership. | Male/female/MP NPC stop mouth within 300ms after speech and yield under combat. |
| **F15** | **SRC+HYP:** [legacy filename isolation](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/EntryPoint.cs#L166-L199). | Manifest inventory + runtime AppDomain/loaded module signal, fail-closed if uncertain; avoid arbitrary renaming bypass. | Isolated launch refuses renamed Essential and restores original install with exact hashes. |
| **F16** | **SRC:** [C# hand-validated fields](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/StandalonePipeServer.cs#L419-L475). | Canonical schema and codegen or shared fixtures; explicit `v2` capability negotiation; binary audio transport. | Same valid/invalid corpus passes Node + C#, unknown version/capabilities fail closed. |
| **F17** | **SRC+HYP:** 1.5s native dispatch wait in [pipe](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/StandalonePipeServer.cs#L399-L409); real focus/pause behavior not measured. | Distinct `paused` state, audio suspend, lease hold/fence and resume handshake; disconnect never replays effects. | In-game pause, alt-tab, loading screen, device reset, no stale audio or memory claims. |
| **F18** | **SRC/HYP mix:** [internal command class](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/native/standalone-host/StandaloneTypedCommands.cs#L9-L18), [launcher Qwen port 8765](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/9c35f04ba72cb25657543e71885f03981e065025/tools/standalone-gta-smoke/Start-Standalone-Test.ps1#L1-L13), build manifest/console docs. | Make command discovery verifiable, fix quoted command example & single default port, bundle immutable source SHA + config hashes, isolate host-loop errors. | Commands appear in RPH; tested manifest matches bytes; failed module does not silently leave permissions active. |

**Priority meaning:** F1 is an architectural blocker; F2/F3/F4 block meaningful typed GTA acceptance until empirically resolved; F5/F6/F7/F11 drive the final architecture. F12–F18 are scoped fixes and proofs, not justifications for a new runtime rewrite.

## 3. Concrete architecture contracts (design sketch, not claimed code)

### 3.1 Identity, lifecycle and data owner

- **Body-side `ActorLease`**: `{hostRunId,worldEpoch,actorIncarnationId,leaseId,generation,expiresAtMonotonic,ownerKind}` with a local-only native `ActorRef` mapping. Explicit issue/revoke/renew; CAS supersession, mission/pause/combat disallow conditions, no unbounded expiration extension. Leases are opaque to brain/voice, validated *again* on every native effect and upon resume.
- **Brain-side `CharacterBinding`**: `{worldProfileId,characterId,ownerAlias,encounterId,actorIncarnationId,hostRunId,worldEpoch,claimRevision}`; binding is authorized only by verified P1/P2 owner proof. Anonymous NPCs get **ephemeral run-scoped context only**, never another promoted NPC's SQLite state. On death/despawn/ownership loss: revoke actor lease immediately but preserve legitimate durable CharacterId data.
- **`UtteranceLifecycle`**: C-01 source-time `utterance.started/ended` and `utteranceId`, whether typed or microphone; one STT finalization and observer hearing receipts. **Typed input never masquerades as acoustic speech.**
- **`DeliveryReceipt`** shared between existing Essential and new standalone body/voice: `{hostRunId,turnId,actorIncarnationId,streamId,receiptSeq,terminal,markedSegments,completedSegments,devicePlayedBytes,ackedAtMonotonic}`; native-side receipt proves device progress (not biological hearing). Map the less precise legacy `PlaybackEnded` explicitly, with a labeled coarse-grain limitation; no false per-sentence reconstruction.
- **Memory commit**: accepted player source text exactly once; NPC segments only on an authenticated corresponding receipt; interruption writes only proven completed prefix with explicit partial/unknown status. Receipt ack and journal write idempotency/retry are distinct; journal transaction keys use `{worldProfileId,characterId,timelineId,hostRunId,turnId,segmentIndex}`, with exact schema finalized in M2. Never let CharacterId alone authorize audio or GTA tasks.

### 3.2 Minimal protocol v2 shape

These are **example message families**, not final shipping schema or an invitation to drop existing native guards:

```text
body→brain: hello/ready + capability snapshot; actor.bound|actor.retired
body→brain: perception.event {eventId, source, observerRef, actorRef, gameTime, worldEpoch, fact/evidence}
body→brain: player.utterance {utteranceId, inputSource, selectedActor, acceptedTranscriptRef}
brain→body: actor.lease.request {actorRef, reason, priority, expectedEpoch}
body→brain: actor.lease.granted|denied|revoked {leaseId, generation, expiry, reason}
brain→body: actor.command {leaseId, typedIntent, params, requestId}
body→brain: actor.command.receipt {requestId, handlerAccepted, physicalPostcondition, terminal}
body→voice: listener.pose + speaker.pose + pause/focus + permitted stream set (sampled)
brain→voice: speak {turnId, leaseId, speaker, voice, validatedSegments, ordered}
voice→brain: playback.started|segment.completed|interrupted|ended {exact device progress}
voice→body: mouth.envelope {leaseId, actorRef, sampleTime, level} (never bypasses native gate)
```

- **Control plane:** bounded, versioned, low-rate typed frames; only GTA owner-fiber executes native operations; body→brain push may be produced off fiber from immutable snapshots. Prioritize revocations, player input and cancellation above ambience.
- **Event plane:** bounded batches, monotonic seq + source identifiers; drop/aggregate **redundant raw ambience**, not durable accepted promoted-character memory facts. Mark gaps/coverage loss so no NPC claims witnessing; replay idempotently only facts whose source/run/timeline fences remain valid. **No stale commands or completed actions replayed** after reconnect.
- **Audio data plane:** binary PCM16LE mono 24 kHz *at provider boundary*; conversion/mixing within voice; bounded buffer/stream memory and a separate audio clock. Per-speaker voice position updated independently of PCM. Shared backpressure credits and an explicit `buffered/playing/completed/interrupted` distinction. Audio/mouth are dropped immediately when lease invalidated.
- **Version/capability handshake:** fail closed if schema, PCM capability, privacy mode, physical sink, pause support, memory contract or actor proof cannot be agreed; log only safe status codes and hashes, not text, keys, audio or private identity labels.
- **Critical isolation:** the only path to RPH native effects is body owner-fiber command queue and live native lease. An external Windows playback worker does not become a second ped-control owner.

### 3.3 Memory stays the *same product*

The approved memory design in [#49](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/49), M0 [#51](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/51) and additive M1 [#52](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/52) remains normative:
- Promoted NPC owners **only**, one P2 SQLite + FTS5 file; preserve original JSON profiles/manual notes through backed-up reversible migration and editor parity.
- M0 schema `contracts/memory.v1.json` is **companion-level**, not native protocol v2; do not cram full journals through game fibers.
- Maintain recent exact accepted text, source-qualified observer events, timeline/SubjectRef boundaries, a generous user-controlled dialogue archive, and accurate deterministic recall through one PS4 C-04 knowledge contributor.
- **Off-turn existing cloud Luna curation**, no additional resident local model, GPU embedding model or VRAM budget. Luna outage cannot block capture/retrieval. Personality and humor modify interpretation, **not immutable source facts**.
- Memory M1 may continue to finish **storage safety / editor parity** in its current branch. Freeze new Essential-specific integrations after M1; before M2 playback commit, extract/re-export P2 and provider/policy modules into one host-neutral `brain` package using adapters. Prefer `git mv`-style movements and preserved tests, not a second store or reimplementation. M2 and M3 can then advance without making M10 a rescue port.
- **Explicit convergence gate:** bring #52 into the unified brain branch only through a reviewed merge/cherry-pick plan after its #49/#51 dependencies resolve; compare migrations, tests and schemas. Never cherry-pick from an unreviewed mixed working tree or interpret two passing branch CIs as an integrated green build.

## 4. Revised delivery sequence — narrow PRs and exit criteria

A **probe first, shared architecture second, gameplay value continuously** strategy. These are work packages, **not** dates or claims of implementation.

| Package | Deliverable and candidate code owner | Required offline/CI proof | Required GTA proof / exit |
| --- | --- | --- | --- |
| **R0-A Diagnostic bootstrap** | On #50 descendant: native config read/validation, capability/health log, tick distribution (p50/p95/p99), actor-observation cost, reload/console command probe; diagnostic-only build with **no actor adoption or speech authority**. `EntryPoint.cs`, smoke scripts. | Config/handshake/unknown-mode/fail-closed tests; signed/hashed source/build manifest and rollback fixture. | E1/E2/E3/E4/E10 raw observations on exact installed Enhanced/RPH profile. If decorator or launch hypothesis fails, record evidence before redesign. |
| **R0-B Physical feasibility** | Small gated test commands: WAV device clock, pause/alt-tab, two ped engagement/release, RPH facial comparison; *not* a replacement runtime. | Fake ped lease/engage/release, no mission ped seizure; no leaked handle/audio thread. | E5/E6/E7/E8. Capture host build+game/RPH version, FPS cadence, audio output, error codes. Decide WASAPI backend and incarnation proof based on results. |
| **R1-A Contract/ADR** | SR-01..05 standalone ADR, `contracts/standalone-v2` canonical shapes/fixtures, behavior/ack/deadline tests, source/target capability negotiation, bounded event push and brain-requested lease. | Both C#/Node validators reject bad schema/ABA/replay/overflow, reconnect and revoked lease; scriptable simulated game event stream with ordering and provenance checks. | Diagnostic reconnect/pause acceptance; no PCM on game fiber. |
| **R1-B Brain convergence** | Extract one shared provider/identity/memory/PS4/Director policy package. Thin temporary Essential bridge and new standalone adapter; consolidate voice identity with P2. Use M1 code from #52 only after stack reconciliation. | Same deterministic source/evidence/recall and conversation fixtures against each adapter; Node 24 Windows bundle `node:sqlite` + FTS5; migration copies byte-for-byte backups. | Existing Essential behavior unchanged in current installed profile. Standalone remains isolated/test-only. |
| **R2-A Independent voice MVP** | Real audio worker/process, camera listener, bounded PCM and look-ahead, device-clock receipts, volume, output hot-swap/pause; replace 1/tick PCM dispatch. `nativePcm.mjs`/`segmentPipeline.mjs` become provider adapters, not game-fiber senders. | 1KiB/4KiB/32KiB streamed PCM, network jitter, EOS, interruption, 20–30s replies, generation supersession, >=2 simultaneous voices, no leaked device buffers; 30–40 FPS timing simulation must **not** gate PCM consumption. | 20s uninterrupted known speech at representative game load with device-reported progress; camera orbit correct, pause/resume, player/NPC speech prioritization. |
| **R2-B Typed engagement slice** | Actor incarnation without decorator dependency *only if R0 justifies*, identity-pinned `engage`, face/hold/release, correct Luna effort/persona, exact turn history receipt. | Moving NPC, new nearer ped, despawn, combat, mission ownership, late model reply, interrupted second sentence; server retries cannot cause duplicate speech/action/memory. | **Milestone A:** at least two NPCs across walk/stop/restart, audible typed Luna reply, correct face/speaker, played-prefix receipt, rollback restores pre-test files. |
| **R3-A Memory + microphone input** | M2/M3/M4 on shared brain using approved M0/M1, one source-time C-01 identity, opt-in Parakeet/OpenAI STT via voice pipeline (no required GPU residency), P2 promoted actor binding. | Exact 200-line/restart quote matrix, fabricated-source negative cases, timeline split, STT uncertainty, Luna-offline journaling and 10k-event bounded replay. | Promoted NPC remembers exact real conversation and witnessed facts after GTA restart; no cross-character or no-witness leak. |
| **R3-B Spontaneous Director** | Brain-initiated speech requests against body leases; PS3 grant/consume receipts, player speech priority, cancellation, cool-down, memory callback. | Deterministic safety/priority/observer replay; no speech before physical permission; two competing proposals never double-use actor. | Actual event→PS2→PS3→PS4/Director→spoken NPC line with matching lease and receipt; no spamming under gunfire. |
| **R4 Perception and NPC↔NPC scenes** | Port PS0/PS1 event producers, PS2 evidence/PS3 salience, event burst priorities, floor control, voice mixing, C-01 hearing rights; no world-fact shortcuts. | 2–3 NPC scene simulator, wrong speaker/identity/loss-of-coverage tests, robust backpressure and prompt provenance budgets. | Scripted 2–3-character in-GTA scene (including combat/radio) with source-qualified reactions, no unintended overlapping dialogue or echo. |
| **R5 Actions, UX parity and cutover** | ACT typed commands with physical postconditions; UX4/controller, P2 summon, follow/wait/vehicles, menu/keybind/volume parity; manifest conversion, E7 soak and Essential retirement ADR. | All retained features in [parity matrix](feature-parity-matrix.md), contract regression, replay denial, rollback and profile preservation. | Four-hour multi-character session, combat/vehicle/missions, pause/reload and controller regression. Independent owner only, verified uninstall/backups; **explicit** cutover approval before retirement. |

**Ordering nuance:** R0 is intentionally diagnostic; do **not** make a full GTA conversation the diagnostic acceptance test. R1 provider/brain extraction can be developed in parallel with bounded R0 probes. R2 voice MVP may reuse short-lived native waveOut only for controlled proof, but no shipping architecture may depend on one request per frame. Memory M1 safety work does **not** need to stop while R0 runs.

## 5. Probe workbook and decision triggers

| Experiment | Scenario / instrumentation | Decision rule |
| --- | --- | --- |
| **E1** host lifecycle | Enhanced RPH load→reload→unload; list console commands, inspect effective native configuration, lock release | A missing command/mode is a **FAIL**, not a reason to force actor adoption; fix F2/F18. |
| **E2** game-fiber budget | `Stopwatch` tick p50/p95/p99 while rendering at **actual native 30–40 FPS** (ignore Lossless Scaling generated FPS); 1,000 actor observations cost | Record before/after native cost; no PCM pacing tied to tick; if owner work spikes, further shrink owner queue. |
| **E3** decorators | `DECOR_REGISTER/IS_REGISTERED/SET/GET` on 5 ambient peds | If unavailable, choose conditional proof fallback without cookies; do not assert until E4. |
| **E4** incarnation reuse | Ped spawn/despawn/churn, handles/reuse counters/addresses, world reset and missed fiber windows | Any ambiguous identity → immediate revoke. |
| **E5** physical audio | Fixed 20s PCM played through old waveOut and new voice backend; compare elapsed device position, pause/alt-tab/reset | Stable uninterrupted play, bounded shutdown; timing data picks output design. |
| **E6** spatial | Orbit player camera around still NPC, first-person, car/interior | Camera-relative sound remains attached to NPC (not player heading). |
| **E7** facial | Compare current `mic_chatter` vs held talking override on multiple archetypes; interrupt/combat | Lips cease promptly (target ≤300ms) and never steal combat animation ownership. |
| **E8** engage | Scenario ped and walking ped; face/look/hold then release over 60s | Same ActorRef remains selected; normal movement resumes without global task clears. |
| **E9** provider latency/GPU | Matched text/voice, Luna effort, Qwen warm/cold, OpenAI TTS, with GTA closed/idle/combat | Record first safe segment, first *audible* PCM, response-to-speech gap, GPU contention; choose measured budget, never optimize against generated FPS. |
| **E10** launcher/profile | Steam/Rockstar/RPH attach and direct launch variants on user's install; isolated manifest and original backup | Effective mode/ownership consistent and rollback hash-verified. |

Each E# produces a minimal receipt: `{experiment,gameVersion,rphVersion,hostCommit,bundleSha256,configHash,mode,environment,measurements,status,limitations,logRefs}`. Logs redact text, voice references and credentials. A source-only `UNTESTED` is not a physical `PASS`.

## 6. Hardened negative-test matrix

A phase cannot close without a *newly executed* CI run on **the exact PR head** and a reproducible test fixture for every relevant row:

| Gate | Mandatory failing case | Success condition |
| --- | --- | --- |
| Authority/isolation | Essential loaded/renamed, duplicate plugin, actor reuse, mission ped, retired generation | No GTA effect, no voice render, no stale lease; safe rollback |
| Wire/schema | Wrong `hostRunId`, wrong epoch, old protocol, duplicate or reordered seq, malformed binary, oversize message | Fail-closed protocol error; bounded memory; recovery requires new handshake |
| Event provenance | 10k event burst, missing observer/actor proof, no-witness gunshot, replay after reset, two promoted NPCs | No false knowledge; gaps declared; durable qualified writes idempotent |
| Conversation | Model timeout, late SSE segment, interrupted reply, player's follow-up, two simultaneous offers | No nonexistent NPC history; completed prefix commits once; player always wins arbitration |
| Audio | Small arbitrary TTS chunks, slow GTA fiber, voice device change, buffer underflow, pause, client disconnect, volume 0 | Real-time independent playback; no zombie voices, no double play or false completed receipt |
| Memory | SQLite corruption, partial migration, profile schema unknown, timeline rollback, STT correction, quoted profanity, deletion | Old profile intact; correct quote retrieval; unknown stays unknown; explicit consent on timeline |
| Native behavior | Engage/disengage, death/despawn, seat/follow task failure, mission-script override, world reload | Native effect only with permission; receipt distinguishes handler vs actual result |
| Packaging | Missing files, wrong source SHA, tampered backup, interrupted install, essential coexistence | No partial activation and exact byte restoration; otherwise manual safety stop |

**Measurement targets (targets, not present evidence):** no PCM underrun during fixed 20-second tests at measured low game FPS; audio duration matches the expected 20 seconds within device-clock measurement uncertainty; no committed unplayed segments; no accepted unauthorized task/actor; every rejected event/command has a stable non-content diagnostic code; bounded memory under 10k signal bursts. Latency p50/p95/p99 and native frame cost must be **reported**, then budgeted based on real E2/E9 runs rather than invented SLA numbers.

## 7. Files/PR boundaries and explicit non-goals

**Immediate planning PR** (this document + index only): no SDK/runtime changes; no feature activated; no existing branch force-push/rebase; no merge of independent #50/#52; no deletion of baseline documentation.

**Implementation PR slices** (one concern per branch, preferably stacked against the exact standalone integration head while it is unmerged):
1. `R0/config-and-fiber-probes` — native config, telemetry, status, manifest.
2. `R0/actor-device-probes` — decorator/churn, engage, playback and face experiments, safe diagnostic only.
3. `R1/protocol-v2-contracts` — schema, push events, lease requests, generated/fixture validators.
4. `R1/one-brain-memory-convergence` — reconcile #49/#51/#52, shared brain, temporary Essential adapter, one P2 store, Node24.
5. `R2/voice-engine` — independent clock/buffers, device playback, positions and receipts; no PCM on fiber.
6. `R2/standalone-typed-slice` — real body engagement and gameplay acceptance.
7. R3/R4/R5 branches gated by evidence in §4.

Before each PR: pin parent SHA, inventory changed files, enumerate existing tests, state new tests and negative cases, update exact branch-specific status doc, link CI and physical artifacts. For any test not run, write **UNTESTED**, not `PASS`. Cross-stack merges require a dedicated reconciliation PR that verifies M1 migration and one-store invariants.

**Explicit non-goals:** preserving Essential as a permanent second engine; supporting SHVDN/ScriptHookV without a demonstrated need; direct reverse-engineered GTA audio-engine injection; new resident curator LLM/embedding GPU model; redesigning promoted-character memory; overriding source-qualified perception with generic model guesswork; wholesale rewrite of `NativeAuthority`; treating Lossless Scaling displayed FPS as native RPH fiber cadence.

## 8. Cutover and rollback policy

- **Before R0** freeze installed-game file/hash manifest, exact RPH/Enhanced versions, current known-good Essential setup, selected profile data, and original user settings.
- **During R0–R4** run only one native controller in a physical GTA instance. `main` and the Essential profile remain the user's existing gameplay path; standalone is isolated, opt-in, reversible, and non-authoritative by default. Temporary shared-brain bridge is not an excuse to load two bodies in one game.
- **Before R5 retirement** physically pass the explicit user-visible parity inventory (keybinds, UX4 targeting, P2 summon, voice profiles and volume, follow/wait/vehicles, PS4/Director, C-01 STT, actions, memory and editor). Allow consciously documented deferrals only with explicit approval.
- **Cutover ADR** changes D-001/D-012/D-016 *for the standalone product* after successful tests, with migration and rollback procedure; no direct silent edits to the active Essential decisions.
- **Rollback** restores original file hashes and profile/SQLite backups while preventing unreviewed backward database migration. If reverse migration isn't safe, revert runtime while retaining an untouched compatibility backup/read-only store until user-approved reconciliation.

## 9. Handoff checklist / what counts as done

- [ ] R0-A exact source-gated diagnostic patch PR; no gameplay claims.
- [ ] E1–E4/E10 signed baseline + host results; HYP findings confirmed or rejected with evidence.
- [ ] E5/E8 proves audio-engine and engagement strategy.
- [ ] SR-01..05 ADR ratified alongside D-001/D-016 compatibility notes and protocol v2 conformance fixtures.
- [ ] Unified brain and single P2 SQLite tested with reconciled #49/#51/#52; Node24 FTS5 runtime proven.
- [ ] PCM fully decoupled from RPH tick; output-clock segment/history receipts; 20s/2-speaker acceptance.
- [ ] R2 Milestone A in isolated GTA on exact manifest with rollback.
- [ ] M2+M3+M4 consistent across restart; accurate no-witness and verbatim recall.
- [ ] Brain-initiated Director and NPC↔NPC events physically accepted.
- [ ] Parity/soak/cutover approved explicitly; Essential removed only then.

**Next allowed implementation action:** R0-A diagnostics/config; the **current PR #50 stage-1 diagnostic test can be run as a probe**, but not treated as evidence that its typed stage-2 path is accepted. This document makes *no* claim that any implementation R0–R5 work has been completed.

---
### Evidence index / provenance

- [Standalone stack #50](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/50) (reviewed head 9c35f04), [phase-2 implementation](phase-2-implementation-status.md), [phase-4 status](phase-4-status.md), [standalone roadmap](roadmap.md), [speech architecture upgrade](speech-architecture-upgrade.md), [feature parity matrix](feature-parity-matrix.md).
- [Memory architecture/decisions #49](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/49); [M0 contracts #51](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/51); [M1 SQLite source #52](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/52); memory [implementation roadmap at #52](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/08c7e94cd28a17e5521d5be28f6b84603e2cf986/docs/plans/promoted-npc-memory/implementation-roadmap.md) and [M0 handoff](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/08c7e94cd28a17e5521d5be28f6b84603e2cf986/docs/plans/promoted-npc-memory/M0-contract-and-handoff.md).
- Original independent October 11 Qwen review: F1–F18, E1–E10 and revised R0–R5 are **review inputs**, with simulation numbers not direct GTA observations. This hardening plan intentionally differs by *not* treating dual GTA hosts or long-term host portability as a product requirement and by allowing M1 safe storage work to continue during convergence.
