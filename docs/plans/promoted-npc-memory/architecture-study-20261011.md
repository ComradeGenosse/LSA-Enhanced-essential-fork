> **SOURCE RESEARCH — NOT THE FINAL CONFIGURATION.** This Oct 11 architecture investigation is preserved in full for detailed audits, event models and phase examples. The subsequent accepted [decision record](approved-decisions.md) and [implementation roadmap](implementation-roadmap.md) take precedence wherever this report proposes a resident **local 7–14B AI curator, GPU-embedded retrieval, local-first models, 60-day transcript expiration, hard memory quotas, or one merged protagonist identity**. The adopted design uses **Luna for occasional asynchronous cloud curation**, **CPU/SQLite/FTS5 for ordinary retrieval**, a generous retained dialogue archive, and **natural in-character recall with accurate on-demand fact/quote lookup**. **No additional local LLM or local embedding service is required.**

# LSA Promoted NPC Memory & Experience Architecture

Oct 11, 2026 · @Chris Scoggins

## Summary

Promoted NPCs get a four-tier memory inside P2's existing store. A verbatim journal remembers everything they witnessed or heard across the current and previous session; a fun-first notability budget turns a few moments per hour into vivid permanent memories; and a personality layer adds opinions, grudges and running jokes. One budgeted, keyword-independent recall step feeds PS4, so Nathan quotes you exactly, tells the fountain story years later, and truthfully says "I didn't see that" when he didn't.

**Core decisions**

- **No new event ledger.** The journal is a durable, per-observer copy of PS2 observations. A new owned-observer join attributes them to a `CharacterId` even when no conversation is open.
- **One store.** P2 moves to a single SQLite file through the `node:sqlite` module already in your bundled Node 24, with FTS5 and in-file vectors. There is no vector database and no second store (D-003 holds).
- **Recent memory is unfiltered and bounded by sessions and play time,** not a bare line count. Free recall covers the recent window; an archive supports cued recognition when you jog Nathan's memory.
- **Permanent memory is a budgeted competition.** Deterministic features plus a local-LLM appraisal for humor and absurdity, about 6 memories per active hour, each carrying frozen evidence.
- **Explicit commands resolve against the journal before Luna answers.** Ambiguity triggers a question, and forget is always honored.
- **Personality changes the take, never the facts.** It drives appraisal, beliefs, running jokes and callbacks.
- **Retrieval** fuses an always-on core with structured, lexical, semantic and entity search. It adds coverage statements for honest "no" answers, within a 10–14 KiB budget at p95 ≤60 ms.
- **Local AI on the 5090** runs embeddings and a 7–14B curator off the turn path, at the lowest GPU priority.

**Requirements challenged**

- **"Last 100–200 utterances"** becomes session and play-time windows plus an archive; storage is negligible.
- **"Perfect recall"** is defined as five testable guarantees, bounded by what perception and STT capture (§3.6).
- **"Promoted NPCs only"** is kept, plus an optional import of a ped's last two minutes at promotion.
- **The master plan's template-only PS5 and its no-raw-speech default** need amending (D-018–D-020) to get humor and verbatim recall.
- **Fun depends on perception.** A crash is currently only a heard "impact", so the roadmap adds a fun-event producer pack.

**Start with** M0 (decisions), M1 (store and timelines) and M2 (conversation journal). M2 alone ends Nathan's conversational amnesia, with no native work.

## 1. Repository audit and architectural gaps

LSA already has the right skeleton for memory: durable identity, one character store, observer-relative witnessing, salience entitlements with a reserved `ps5_memory` consumer, and a single knowledge assembler with a RECALLED lane. What it lacks is any memory longer than two minutes of events or one conversation session. Audited at `main` 3ef6c52 (Oct 11), the deployed PR #41 commit ad6a8da, all 47 PRs, and your installed companion.

### 1.1 Inventory and verdicts

| Area | Where it lives | State | What it means for memory | Verdict |
| --- | --- | --- | --- | --- |
| Durable identity (P1) | `src/identity/*`, `LSA.SessionIdentity.dll` | Merged ([#5](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/5)) | UUID `CharacterId` behind owner proof; runtime bindings exist only inside an Essential conversation session | Reuse; add session-free attribution (gap 3) |
| Character store (P2) | `src/characters/profileStore.mjs` → `characters/profiles.v1.json` | Merged ([#6](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/6)–[#9](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/9)) | Schema 1 JSON; whole-file rewrite, fsync and backup on every edit; 500 profiles, 8 MiB, 128 memories × 1,200 chars | Keep P2 as owner; move its storage to SQLite in the one C-08 migration |
| Manual memories in prompts | `sessionProfiles.mjs` `selectedDialogueMemories` → PS4 RECALLED | Merged ([#23](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/23)) | Every selected note, by importance, inside a shared 16 KiB canon cap | Reuse as "pinned canon" input to recall |
| Dialogue history | `src/memory/dialogueHistory.mjs` | Merged (E1) | 12 messages per `pedId:sessionNonce`, RAM only, deleted by `detach()` when the session closes | Replace with a durable per-character conversation journal; keep the D-016 commit rule |
| Native perception (PS0/PS1) | `native/intelligence/SensorAdapters.cs`, `WitnessPolicy.cs` | Merged ([#11](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/11)) | Geometry-qualified receipts: visual 35–50 m with a line-of-sight cone, gunshot audible to 60 m | Reuse; add "fun event" producers (gap 7) |
| Episodes and observations (PS2) | `episodeCorrelator.mjs`, `observationStore.mjs` | Merged | Observer-relative claims; TTL ≤120 s; dropped when any participant's anchor retires; wiped by every `ShadowRuntime.reset()` | Reuse as the only event source; add a durable recorder tap |
| Salience (PS3) | `salienceEngine.mjs` | Merged ([#14](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/14) follow-ups) | `memory:'stage'` only for self/player harm or harm near a close or strained relation; C-03 `ps5_memory` ack exists with no consumer | Keep as one input feature; notability lives elsewhere |
| Knowledge frame (PS4, C-04) | `knowledgeInputs/Selector/Renderer.mjs` | Experimental merged ([#23](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/23), [#27–#30](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/30)); `mode: active` in your install | Single assembler; PERCEIVED ≤8 items/8 KiB; CONVERSE 12 messages/8 KiB; frame ≤112 KiB | Reuse; memory joins as a typed contributor |
| Player attribution | `knowledgeSelector.mjs` `subject()` | Main renders the player as "anonymous person"; open draft [#35](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/35) adds `player` and `causedBy` | "Did you see me shoot him?" cannot be answered on main | Adopt #35's frozen player-anchor rule |
| Radio knowledge | `radioContextProjector.mjs` | v2 merged via [#32](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/32) on Oct 11, after the roadmap text was written; recent-heard history in open [#46](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/46) | Song recall lasts one observation TTL; relevance is a regex list | Fold into the experience journal; retire regex gating |
| Utterance identity (C-01) | `utteranceLifecycle.mjs`, `SpeechCaptureAdapter.cs` | Open draft [#37](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/37) | `utteranceId` per mic or typed input; entries live 30–35 s; "no persistent speech store" | Reuse IDs as provenance; memory supplies the durable store |
| Self-action receipts (C-05) | `dialogueActionReceipts.mjs` | Experimental merged (#23) | "I agreed to follow; following is established" facts | Reuse as a self-experience source |
| Host and world epoch (C-13) | `HostContext.cs`, `hostContext.mjs` | Merged | `clock_regression`, `host_reload`, `timeline_change` | Reuse for session and rollback boundaries |
| Timeline, Profile v2, SubjectRef (C-07/C-08/C-15) | Master plan §11.1 | Planned only | Required before any automatic durable writer (D-011) | Build first (M1) |
| Director (PS6 / 13a) | `sceneDirector*.mjs`, `DirectorAdmission.cs` | Experimental merged (#23, [#31](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/31), [#33](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/33), [#34](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/34)) | Barks within 10 s (routine) or 2 s (urgent) of evidence; 4 attempts/min | Extend with recall cues (13b) |
| Character editor | `editorServer.mjs` on 127.0.0.1:37921 | Merged | Manual memory CRUD; its help text still says "at most three per turn", which PS4 no longer enforces | Grow into the memory inspector |
| Standalone replacement | `lsa-standalone-companion/`, `native/standalone*` | Open drafts [#38](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/38), [#40](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/40), [#42](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/42)–[#44](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/44) | Phase 3 typed runtime keeps no memory and retires staged dialogue on transport close; promoted characters are Phase 7, PS is Phase 8 | Ship memory as a host-agnostic package both companions load |
| Local AI | Qwen TTS [#39](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/39), Parakeet STT [#47](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/47) | Open drafts; your config already selects `faster-qwen3-tts` | GPU rule: player speech > urgent > spontaneous > warmup | Memory jobs run below all speech work |

### 1.2 What your installed build does today

Measured from the five Oct 11 run logs in `LosSantosAliveServer/logs`, using counters only:

- Native signals arrive at 265–430 per minute in active play; PS2 creates 66–146 observations per minute across all observers.
- Promoted observers receive 7–18 witnessed observations per minute, roughly 400–1,100 per companion per active hour.
- You have three promoted characters. Nathan carries 7 manual notes, all selected for context. No automatic memory exists.
- The bundled `node.exe` is v24.16.0 and contains `node:sqlite`. FTS5 worked on Node 22.22 in my test; add a startup probe on the real binary.

### 1.3 Gaps, most damaging first

1. **Conversation amnesia.** History is 12 messages per Essential session and `detach()` deletes it. Walk away, come back, and Nathan has forgotten everything you said.
2. **Events evaporate.** Observations live ≤120 s, die with any participant's anchor, and vanish on every PS reset. A 3 s pipe stall (the pause menu) is enough.
3. **No silent attribution.** Mapping an observer to a `CharacterId` needs a live conversation binding. While Nathan quietly follows you, nothing can be attributed to him.
4. **The player is anonymous.** Main renders "anonymous person fired"; only draft #35 says "player".
5. **Push and pull are conflated.** PS3 `context:'omit'` keeps routine events out of the frame even when the player asks about them directly.
6. **Notability is danger-only.** No humor, absurdity, novelty, shared-experience or personality signal exists, and nothing consumes `ps5_memory`.
7. **Fun events are not perceived.** `vehicle_damage` has no visual range, so a crash is at best a heard "impact". There is no airborne, rollover, water, wanted-level, Wasted or Busted producer.
8. **Storage cannot hold journals.** A whole-file JSON rewrite per edit, 8 MiB in total and 128 notes per character cannot absorb \~1,000 events an hour.
9. **Retrieval is manual or keyword-gated.** Memories reach Luna only through a manual checkbox; radio relevance is a regex list.
10. **No interpretation layer.** The relationship is one enum. There are no beliefs, grudges, running jokes or appraisals.
11. **Policy conflict on verbatim speech.** Master plan §11.2 specifies deterministic summary templates, no raw speech persistence by default, and no vector DB. Your content-neutral, verbatim requirement needs that text amended.
12. **Prompt layout defeats caching.** The C-04 scene is spliced into the middle of the system instruction, so little of each request is a reusable prefix.

### 1.4 Decisions kept, and the ones this design amends

Kept unchanged: D-001, D-002, **D-003 (P2 is the single durable store)**, D-004, D-007, **D-008 (PS4 is the sole model-facing writer)**, D-011 and **D-016 (assistant history only after matching playback)**. Telemetry stays content-free (roadmap rule 8).

Proposed amendments, none of them to a LOCKED decision:

- **D-018 (new):** P2 persists verbatim player and NPC dialogue for promoted characters. It is game state, never telemetry.
- **D-019 (new):** P2 storage becomes one SQLite file with FTS5 and in-file embedding vectors. No external vector DB, no second store.
- **D-020 (new):** An off-path curator may use an LLM, local first, for appraisal and summaries. Its output is grounded against stored evidence and can never create a fact.
- **C-04 extension:** recall is a typed PS4 contributor that fills RECALLED and a CONVERSE "earlier" sub-lane under its own byte budget.

## 2. Recommended memory architecture

Build one memory system inside P2's store, fed only by verified producers and read only through PS4. It has four tiers: the existing PS2 working set, a durable and unfiltered recent journal, selective evidence-frozen permanent memories, and a character-specific interpretation layer. Hot-path pieces are small and synchronous; anything expensive runs in a worker against a local model.

&#91;embedded content: Memory architecture · components and data flow\]

Three producers write, one store holds everything, and PS4 is the only path to Luna. The curator and local models stay off the turn path except for a query embedding of at most 25 ms.

### 2.1 Memory tiers

| Tier | Contents | Written by | Lifetime | Used for |
| --- | --- | --- | --- | --- |
| T0 Working set (exists) | PS2 observations and PS3 decisions | PS pipeline | ≤120 s; lost on reset | PERCEIVED, Director barks |
| T1 Recent journal | Every attributed witnessed event and every line to or from the character, verbatim | Experience and Conversation Recorders | Current + previous session, bounded (§3) | Exact facts, exact quotes, "what just happened" |
| T2 Permanent memory | Episodic memories with frozen evidence; semantic memories (player preferences, promises, player claims); session digests | Curator (automatic), Command Interpreter (explicit), editor (manual) | Durable, timeline-scoped; fades in accessibility, not existence | "Remember when…", callbacks, long-term recall |
| T3 Interpretation | Beliefs, relationship dimensions, running jokes, per-memory appraisals | Curator under the character's memory personality | Durable, evolves with linked evidence | Opinions, teasing, grudges, tone |
| Canon (exists) | Authored biography, personality, manual notes | You, in the editor | Durable, timeline-agnostic | SELF; highest authority |

Facts live only in T1 and T2 evidence. T3 holds opinions about those facts and is always labeled as opinion when rendered.

&#91;embedded content: Memory lifecycle · four tiers and the explicit-command bypass\]

The journal takes everything; the budget decides what lasts; your command skips the budget; and an expiring window still leaves a digest behind.

### 2.2 Components and boundaries

| Component | Runs in | Owns | Must never |
| --- | --- | --- | --- |
| Experience Recorder | Companion main thread | Turning each PS2 observation for an attributed promoted observer into a durable T1 event with durable subjects and scene context | Write without attribution proof, add claims, or store run-local refs as identities |
| Conversation Recorder | Companion main thread | Journaling accepted player input and NPC lines with delivery status; rebuilding cross-session history | Treat an interrupted line as spoken, or record internal events as player speech |
| Command Interpreter | Main thread, plus an optional ≤150 ms local-model parse | Detecting remember, forget and correct; resolving the referent; writing or asking | Guess a referent |
| Recall Engine | Main thread; vector scan in the worker | A budgeted `RecallBundle` per turn, delivered to PS4 | Exceed its budget or touch another character's rows |
| Memory Curator | Worker thread + local model endpoint | Consolidation, notability, appraisal, summaries, beliefs, running jokes, decay, embeddings | Create facts, run during player speech, or block the main thread |
| Recall Cue Monitor | Main thread, cheap | Matching live context to memories and proposing callbacks to the Director | Bypass Director admission or budgets |
| Memory Store (P2) | One SQLite file; single writer is the companion main thread | Schemas, transactions, timeline filtering, isolation | Accept writes from outside P2 code paths |
| Memory Inspector | Existing editor server | Browse, pin, edit, forget, undo, choose timeline | Listen anywhere but localhost |

### 2.3 Process placement

- **GTA process (RAGE plugin):** unchanged role. It produces facts — signals, witness receipts, owner proofs, host and world epochs. No memory code runs on the game fiber.
- **Node companion:** today the patched `server.bundle.mjs`, later `lsa-standalone-companion`. It hosts one `lsa-memory` package: recorders, interpreter, recall and the store writer.
- **Worker thread, same process:** curator jobs and vector scans on a read-only connection. It posts write proposals back to the single writer.
- **Local model server:** one OpenAI-compatible endpoint (llama.cpp, Ollama or vLLM) for embeddings and the curator model. It shares the GPU priority queue with Qwen TTS and Parakeet STT.
- **Cloud:** Luna is unchanged. A cloud curator fallback is optional and off by default, because hosted models can refuse mature content and silently drop memories.

### 2.4 Why this shape

- It reuses PS2 → PS3 → PS4 instead of adding a world event ledger. The journal is a durable per-observer projection of PS2 output, which the master plan already allows for durable owner experience.
- Memory stays off the game fiber and off the provider path, except one recall step budgeted at 60 ms.
- One store, one writer and one assembler keep D-003 and D-008 intact, so no competing memory system can appear.
- A host-agnostic package survives the standalone migration; only two thin adapters change.

```text
MemoryRuntime (lsa-memory package; host adapters call these)
  recordObservation(observation, attribution, sceneContext)        -> T1 event | rejected(reason)
  recordPlayerUtterance({characterId, text, source, stt, utteranceId?, turnRef})
  recordNpcLine({characterId, text, delivery: completed|interrupted|failed, turnRef})
  interpretCommand(acceptedInput, scope)                           -> MemoryAction | null
  recall(RecallQuery)                                              -> RecallBundle   // PS4 contributor
  onBoundary(kind: scene_end|conversation_end|session_end|world_epoch|timeline_change)
```

## 3. Recent events and recent dialogue

The recent journal (T1) records everything a promoted NPC verifiably witnessed or heard, plus every line exchanged with it, with no notability filter. Retention follows play sessions and co-present play time rather than wall-clock time or a bare count. That way "last time" survives a week offline and a firefight cannot flush a conversation.

### 3.1 What enters the event journal

Every PS2 observation emitted for an **attributed** promoted observer is journaled, including routine kinds: presence, location change, vehicle transition, activity change, radio heard and speech heard. C-05 self-action receipts are journaled too. Nothing else is: raw signals are not observer evidence (D-004), and model output is never an event.

**Attribution without a conversation (fixes gap 3).** A new bounded join, built only from existing seams:

1. The PS observer index gives `{captureRef, owned, encounterId, incarnationId}`.
2. P2 native `inspect(ownerAlias)` gives `{encounterId, claim.incarnationId}` for each owned alias.
3. `OwnerEvidence.isCurrent(claim)` proves the claim is fresh in the current adapter epoch.
4. `profile.promotion.ownerAlias` gives the `CharacterId`; `hostRunId` and `worldEpoch` must match on both sides.

The join is cached per `(hostRunId, worldEpoch, captureRef, incarnationId)` and dropped on retire, revoke or reset. Any mismatch records nothing and increments an `unattributed` counter; it never guesses.

**Durable subjects at capture time.** Run-local refs die at every reset, so the recorder resolves them once, immediately:

| Run-local participant | Stored as |
| --- | --- |
| The observer itself | `self` |
| The single live `player` anchor (rule from #35) | `protagonist:<key>` (C-15) |
| An owned anchor mapping to another promoted character the observer recognizes | `character:<CharacterId>` |
| Any other ped | `stranger` with a per-scene alias (`stranger#2`) plus native public descriptors when a producer supplies them |
| A vehicle | `vehicle` plus a model display name when a producer supplies it |

Recognition between two promoted characters starts conservative: they recognize each other after sharing a conversation or after you introduce them. Backend identity alone never counts as recognition (C-02).

**Scene context.** Each event carries the latest *sampled* context: zone and street, game clock, weather, interior flag, the observer's vehicle state and the radio track it verifiably heard. Each value records its sample age, and stale or unknown values stay unknown.

**Scenes.** The recorder groups events into scenes: continuous co-present stretches split by a 90 s gap, a zone change, entering or leaving a vehicle, or a conversation boundary. A scene is the unit for consolidation and for questions like "what happened at the gas station?"

**Promotion grace import (new, optional).** At promotion, the ped's current T0 observations (≤120 s) and its open session history (≤12 messages) are imported, marked `imported_at_promotion`. These were genuinely witnessed by that same ped, so "Wait, you're the guy who rear-ended me!" becomes possible.

### 3.2 Event retention

| Rule | Default | Reason |
| --- | --- | --- |
| Keep all events from the current and previous play session with this character | Always | "Last time we…" must survive time offline |
| Also keep at least the last 3 co-present hours | ≥3 h | Sessions can be short |
| Hard caps per character | 25,000 events, 64 MiB | 25–60 active hours at the measured 7–18 events/min |
| Never expire an event inside an open scene, or before the curator has seen it | — | Consolidation must see everything first |
| At expiry | Delete the event; memories already hold frozen copies of their evidence; each closed session leaves a digest | Details survive exactly where they matter |

**Coalescing is a view, not storage.** Forty firing claims in one episode render as "the player fired repeatedly for 25 s in the Ammu-Nation lot". PS2 caps observations at 4 claims, so counts render as "at least N". Add a per-observation `suppressedClaims` counter to PS2 so memory can say "and more" honestly.

### 3.3 Dialogue journal

Both directions are journaled, per character, verbatim:

- **Player lines:** the accepted input exactly as committed at `commitPlayerInput`, typed or transcribed. Stored with source, STT provider and model, confidence when the provider returns one, `utteranceId` (C-01 when present), a hashed turn reference, conversation, scene, timestamps (UTC, monotonic, game clock) and the NPC line it replied to.
- **NPC lines:** the final validated text with a delivery status. `completed` requires the matching successful `PlaybackEnded`. `interrupted` keeps the planned text with "possibly not heard". `failed` is never presented as said.
- **Never recorded as player speech:** Director triggers, special events or any internal source (D-016).
- **Corrections:** "No, I said *X*" stores a correction linked to the original. Recall shows the corrected text and keeps the original transcript for audit.

**STT uncertainty.** Today's providers return text only, so confidence is `unknown`. When logprobs or token confidences exist, store the average and low-confidence spans; Luna then sees `uncertain: true` and can say "I think you said…". Known STT hallucination patterns are flagged, never deleted.

**Content neutrality.** Text is stored byte-for-byte as received. Nothing is filtered, masked or paraphrased for profanity, violence, sex or politics. Response-generation policy is applied later, by the model, never by storage.

### 3.4 Dialogue retention: a better policy than "100–200 lines"

A fixed count is the wrong unit: 200 lines is fifteen minutes of chatty play or three quiet weeks. Use two windows that mirror human memory: free recall and cued recognition.

| Window | Default per character | What the NPC can do with it |
| --- | --- | --- |
| Free-recall verbatim window | Larger of the last 200 player lines or the current + previous session; capped at 1,000 lines / 512 KiB | Quote exactly, answer follow-ups, "what did I just say?" |
| Archive (cued recognition) | 5,000 lines or 60 days; configurable, 0 disables | Confirm when *you* supply the cue: "Yeah… you did say that, at the pier" |
| Beyond the archive | T2 memories only, which carry frozen exact quotes | Long-term recall |

Storage is trivial (about 0.5 MB per 5,000 lines). The split keeps the NPC from feeling like a stenographer while staying truthful when you jog its memory.

**Cross-session history (fixes gap 1).** CONVERSE is rebuilt from the journal by `CharacterId` and timeline, not by Essential session:

- The **current conversation** stays role messages, as today: up to 20 messages or 12 KiB, oldest dropped whole, NPC lines only if `completed`. A conversation continues across session closes and reconnects while gaps stay under 5 minutes.
- **Earlier conversations** render as a structured, time-stamped `CONVERSE.earlier` block: the last \~10 lines of the previous conversation plus quotes matched to the current turn. They are never replayed as fake role turns.

### 3.5 Boundaries: reconnects, restarts, death, resets

| Event | Working set (T0) | Journal (T1) | Conversation | What the NPC experiences |
| --- | --- | --- | --- | --- |
| Pause, 3 s pipe stall, PS reset | Cleared, as today | Untouched | Continues | Nothing |
| Essential session closes | — | Untouched | Continues if back within 5 min, else becomes "earlier" | "As I was saying…" |
| Companion restart or bridge reconnect | Rebuilt | Untouched (SQLite WAL) | Continues if the gap is short | Nothing |
| GTA restart (new `hostRunId`) | Rebuilt | Session boundary; previous session becomes "last time" | Earlier block | "Last time we hung out…" |
| Summon or recreation (new incarnation) | New anchors | Same `CharacterId`; scene boundary | Earlier block | Remembers everything |
| NPC killed | — | Self injury or death recorded as self-witnessed | Ends | May later recall "the time I got shot" |
| `clock_regression` epoch (likely save load) | Reset | Session boundary; automatic writes pause until you confirm the timeline (C-07) | Earlier block | If you branch, newer memories are hidden, never deleted |
| Explicit timeline switch | Reset | Filtered to the new timeline | — | The other timeline's memories are invisible |
| Unpromote and delete | — | Journal and memories deleted with the profile, after an export is offered | — | — |

### 3.6 What "perfect recall" guarantees

- **G1 — Lines.** Every accepted player line to a promoted character is committed to the journal before the model request is sent. Within the free-recall window, a quote request returns those exact bytes.
- **G2 — Events.** Every PS2-qualified observation for an attributed promoted observer is journaled with all its qualified claims. No event exists without an observation.
- **G3 — Completeness within budget.** A factual question mapped to a structured query returns every matching retained event, or the most relevant ones plus an exact count of the rest.
- **G4 — Labels.** Luna never receives as fact anything outside G1, G2 or an explicit command. Player claims, reports and opinions are labeled as such.
- **G5 — Abstention.** When nothing matches, the bundle carries a coverage statement, so "No, I didn't see you shoot anyone" is a grounded answer.

**Not guaranteed:** anything perception never qualified (out of range, behind walls, unsupported event kinds); words STT misheard (stored as heard, flagged when known); details no producer captures, such as a car's color; and the model's own compliance, which is probabilistic. The last is measured by the evaluation harness in §9, not assumed.

## 4. Notability and permanent-memory promotion

Promotion is a budgeted competition, not a fixed threshold. Every scene's candidates get a deterministic score; the gray zone and the session's leaders get a local-LLM appraisal for humor and absurdity; only the best few per session become permanent, and repeats fold into existing memories or running jokes. A hybrid wins because deterministic scoring cannot see a joke, and an LLM alone is costly, inconsistent and able to invent.

### 4.1 Pipeline

1. **Form candidates at boundaries:** scene end (90 s quiet), conversation end, session end and every 20 co-present minutes. Candidates are incidents (PS2 episodes in a scene), conversation segments, and *moments* that pair an event with what was said within ±60 s.
2. **Score deterministically** from the features in 4.2. This is always on and costs under a millisecond per candidate.
3. **Weight by personality** using the character's memory personality (§6).
4. **Appraise with a local LLM** only the gray zone and the session's top candidates. It returns scores, a title, a grounded gist and an in-character take (4.4).
5. **Select under budget with diversity.** The best candidates win their slots, and near-duplicates from one scene merge into one multi-beat memory.
6. **Merge or create.** A match with an existing memory adds evidence and an occurrence count; a recurring theme attaches to a running joke; otherwise a new memory is created.
7. **Commit.** The memory is written with frozen evidence, appraisal and embedding. Journal rows are marked consolidated, and PS3 `ps5_memory:delivered` is acknowledged only after the commit.

Explicit "remember" commands skip steps 2–5 (§5).

### 4.2 Deterministic features

| Family | Measures | Source |
| --- | --- | --- |
| Stakes | PS2 severity; self or player harm; deaths seen; later police and wanted level | PS2 claims, PS3 reasons |
| Shared experience | Player involved; time together in the scene; same vehicle; you talked about it within 2 minutes | Subjects, scene, utterance-to-event overlap |
| Novelty | First time for this event kind, place, vehicle or song; rarity in *this character's* history | Journal statistics |
| Absurdity | Unlikely combinations: a crash at low speed with no other vehicle, a car in water, the player hurt by their own action, several incident kinds within 30 s | Rules over claims and context |
| Embarrassment | A failure, and for whom: crash, Wasted, Busted, a fall, self-inflicted injury | Claims plus subject |
| Emotional intensity | Exclamations, laughter tokens, profanity density, caps, evaluations such as "that was insane" | Dialogue journal; profanity counts as intensity and is never filtered |
| Social echo | You mention it again later, or you engage when the NPC brings it up | Reference resolution hits; the strongest single signal |
| Explicit | A remember or pin command | Command Interpreter; bypasses scoring |

### 4.3 Scoring and budgets

Each family yields a score s in \[0, 1\] and a personality weight w. They combine as a noisy-OR, so one strong reason is enough and many weak ones add up:

```latex
\mathrm{notability} = \left(1 - \prod_{f} \left(1 - w_f\, s_f\right)\right) \times \mathrm{repeat}
```

Default weights: stakes 0.55, shared 0.50, novelty 0.40, humor 0.70, embarrassment 0.45, emotion 0.50, social echo 0.85. `repeat` is 0.5 when a similar memory exists from the last 7 days and no running joke absorbs it, otherwise 1.

| Example (default personality) | Main signals | Score | Outcome |
| --- | --- | --- | --- |
| A stranger's gunfight down the street, not involving you | stakes 0.6, emotion 0.2 | 0.45 | Gray zone; the appraisal finds nothing funny or personal, so journal and digest only |
| You park the Faggio in the Vinewood fountain with Nathan on the back | shared 0.9, humor 0.9, embarrassment 0.8, novelty 0.7, emotion 0.7 | 0.95 | Permanent; seeds a "can't drive" running joke |
| You groan "ugh, I hate this song" | shared 0.6, emotion 0.5 | 0.60 | A small semantic memory: you dislike that track |

- **Admit** at ≥0.75. **Gray zone** 0.45–0.75: the LLM appraisal decides; without an LLM, only the session's top 3 gray candidates are admitted. **Below 0.45:** journal and digest only.
- **Episodic budget:** 6 new memories per co-present hour, rolling, and at most 25 per session. Merges into existing memories are free.
- **Semantic budget:** 20 per session for preferences, promises and facts you state; they are small and high-value.
- **Explicit commands** are unbudgeted but deduplicated and rate-limited to 30 per hour.

### 4.4 LLM appraisal contract

Input: an evidence pack of at most 3 KiB (event renderings and quotes, each with an ID), the scene context, the character's memory personality and the titles of related memories.

```json
{
  "scores": {"funny": 0.9, "absurd": 0.8, "embarrassing": {"for": "player", "score": 0.8},
             "scary": 0.2, "touching": 0.0, "meaningful": 0.3, "novel": 0.7},
  "title": "The fountain parking job",
  "gist": "Player crashed the Faggio into water on Vinewood Blvd [e41][e42] with Nathan on the back [e40]; player called it the fountain [u7].",
  "take": "Best thing I've seen all week. He will never live it down.",
  "tags": ["driving", "fountain", "faggio"],
  "mergeWith": null
}
```

- **Validation:** strict schema; every cited ID must exist; every name, number, place, vehicle or song in `gist` must appear in its cited evidence; quotes must be exact substrings of journal text.
- **On failure:** use a deterministic template gist and drop the take. The memory still lands if its deterministic score qualifies.
- **Storage:** `take` is saved as the character's opinion (T3), never as a fact.
- **Runtime:** a local 7–14B instruct model at low temperature, scheduled only when no TTS, STT or Luna request is in flight. Expect 1–3 s per appraisal on the 5090 and roughly 10 appraisals per active hour.

### 4.5 Safeguards

- **Repetition:** the same kinds, place and participants within 7 days, or embedding cosine ≥0.88, merges into the existing memory or its running joke instead of creating a duplicate.
- **Boredom:** routine kinds (presence, location change) never become standalone memories. Per-kind caps apply, such as two unrelated gunfire memories per session.
- **Fabrication:** facts come only from evidence. Summaries are always re-grounded on frozen evidence, never on other summaries.
- **Forgetting stays forgotten:** a forget command leaves a tombstone of evidence keys and a content hash, so the curator cannot recreate the memory.
- **Your edits win:** manual edits stop automatic rewrites of that memory.
- **Timeline safety:** automatic writes pause while the timeline is uncertain (C-07).

### 4.6 Session digests and fading

At session end the curator writes one low-importance `session_digest` per character. It holds 3–6 grounded sentences, simple stats ("2 hours; Vinewood to Paleto; one shootout; three crashes") and links to the session's memories, and it answers "what did we do last time?".

Memories never silently disappear; their accessibility fades. Each has an activation that rises when created or recalled and decays with co-present play time on a power law. Activation gates spontaneous recall and ranking, while a cue from you still retrieves a faded memory, labeled "vague". Explicit memories fade 4× slower; pinned and core memories never fade.

## 5. Explicit "remember this" commands

Explicit commands are resolved deterministically against the journal before the Luna request, written immediately, and reported to Luna as a status it must acknowledge truthfully. If the referent is genuinely ambiguous, Nathan asks instead of guessing. You always control storage: forget is always honored. Nathan may still dispute a claim about something he saw.

### 5.1 Command types

| Intent | Examples | Resolves to | Stored as |
| --- | --- | --- | --- |
| Remember a moment | "Nathan, remember this." "Don't ever forget what happened here." | A recent incident or scene | Explicit episodic memory; pinned for "never forget" |
| Remember a statement | "Remember that I hate this song." "Remember my safehouse is in Vespucci." | The clause itself, with "this song" or "here" resolved | Semantic memory: your preference or your claim |
| Remember dialogue | "Remember what I just told you." | Your previous line or lines | Explicit memory holding exact quotes |
| Promise | "Promise you'll have my back at the docks." | A commitment | Promise memory; descriptive only, never auto-executed |
| Forget | "Forget that." "Forget what I said about Lamar." | A memory or utterances | Suppression tombstone |
| Correct | "That's not what happened, it was a bus." "No, I said Grove Street." | A memory or a transcript | Correction record |
| Ask | "What do you remember about me?" | — | No write; recall with a memory focus |

### 5.2 Detection

Detection runs on the accepted input for the addressed promoted character, in two stages:

1. **Cue detector** (deterministic, <1 ms): remember, don't forget, never forget, keep in mind, make a note, memorize, forget that, promise, that's not what happened, no I said. It is tuned for recall and filters questions ("do you remember…?" is Ask) and idioms ("I forgot my keys").
2. **Structured parse** (only when a cue fires): a local model with grammar-constrained JSON and a 150 ms budget, falling back to deterministic rules. It returns `{intent, deixis, timeHint, targetType, pin, content}`, where `content` must be an exact span of your utterance or the parse is rejected.

### 5.3 Referent resolution

Candidates come only from this character's journal:

- **Events and scenes:** the last 120 s by default. "Here" adds a same-place filter within the current scene; "tonight" widens to the session. "What happened" means incidents, not routine presence.
- **Dialogue:** your last 1–3 lines in the same conversation segment, skipping the command itself.
- **Situation:** the verified current radio track, place, vehicle, or the stranger you just interacted with.

Each candidate is scored on recency (half-life 30 s for "this", 90 s for "that"), deixis fit, salience, modality (seen beats heard), your involvement and any descriptive word ("remember this *crash*" filters to impacts and injuries).

- **Bind** when the top candidate scores ≥0.65 and leads the next by ≥0.20.
- **Clarify** otherwise, naming the top two in plain words: "The crash just now, or the song that's playing?" The pending command survives two of your turns and any reconnect.
- **Nothing to remember:** "Remember what? Nothing's happened."

### 5.4 What is stored

- **Origin `explicit_player`**, importance 85. "Never forget" pins it at 95 as a core memory that never fades.
- **Frozen evidence:** event claims, scene context and exact quotes, including the command itself, so Nathan can say "you told me never to forget this".
- **Statements stay claims.** "Remember that I hate this song" stores your preference, with the track identity taken from the verified radio observation. "Remember I'm a cop" stores "you told me you're a cop", never a world fact.
- **Verbatim content**, whatever it says.

### 5.5 Truthful acknowledgment

Resolution finishes before the Luna request, and its result enters the frame as a `MEMORY_ACTION` item in SELF: `saved`, `needs_clarification`, `nothing_to_remember` or `failed`, with a plain description. The write commits first; it takes under a millisecond. The trusted instructions forbid claiming a save unless the status says `saved`.

If the turn is later interrupted, the memory stands, because the input was genuinely accepted. If a parse misses its budget and the rules cannot resolve it, the status is `pending`. The curator then resolves it, and the next turn carries the outcome: "Oh, and the fountain thing — locked in."

### 5.6 Correct, update and forget

| Command | Effect in the store | Kept for audit | In the fiction |
| --- | --- | --- | --- |
| "Forget that" about a memory | Memory suppressed; tombstone of evidence keys and content hash | 7 days in the inspector's trash, then deleted | "Forget what? Never happened." |
| "Forget what I said about Lamar" | Matching lines flagged `forgotten`; memories built on them suppressed | Same | — |
| "That's not what happened, it was a bus" | Witnessed facts unchanged; your counter-claim linked to the memory; Nathan's belief shifts by personality | Original | "Nah, I saw it. Faggio." or "Huh. If you say so." |
| "No, I said Grove Street" | Transcript correction; recall uses the corrected text | Original transcript | "Grove Street. Got it." |
| "Actually I love this song now" | Preference superseded in a version chain | Prior version | "Since when?!" A running-joke seed |
| Inspector edit or delete | Direct; a manual edit stops automatic rewrites | Edit history | — |

### 5.7 Edge cases

- **Addressee only.** Only the addressed promoted NPC stores the memory. Another promoted NPC who overhears (once C-01 hearing exists) records only that you said it.
- **Combat or a Director turn in flight.** The command is still stored; the acknowledgment waits for normal player priority.
- **Repeats.** A second "remember this" for the same referent within 60 s is a no-op: "I've got it."
- **Compound commands.** At most two actions per utterance, such as remember one thing and forget another.
- **Ambient NPC.** No memory exists, so the frame says so, and the NPC makes no promise it cannot keep.

## 6. Personality-driven, entertaining memory

Personality changes what a character notices, how it feels about it, what it brings up and how it tells the story; it never changes what happened. Every character shares the same frozen evidence for an event. Each keeps its own appraisal, beliefs, relationship drift and running jokes on top.

### 6.1 Memory personality (new Profile v2 field)

A structured block you can edit. The curator suggests values once from the free-text personality and traits, and you approve them, so canon authority stays with you.

| Field | Range | Drives |
| --- | --- | --- |
| `humor.style` | sarcastic, goofy, dry, dark, wholesome | Appraisal voice and teasing style |
| `humor.teasing` | 0–1 | How often your embarrassing moments come back as teasing |
| `humor.findsFunny` | slapstick, failure, danger-absurd, wordplay, gross | Humor weight per event type |
| `caution` | 0–1 | Stakes weight, fear appraisal, "reckless" beliefs |
| `bravado` | 0–1 | Downplays danger; braver versions of its own role |
| `grudge` | holds 0–1; forgiveness half-life in co-present hours | Negative beliefs and how fast they heal |
| `loyalty` | 0–1 | Relationship deltas lean your way; defends you in retellings |
| `nostalgia` | 0–1 | Spontaneous "remember when" rate |
| `storytelling` | exaggeration 0–1, detail 0–1 | Rendering style only |
| `interests` | cars, music genres, food, guns, money… | Novelty and affinity boosts; a music lover remembers songs |
| `values` | dislikes such as hurting civilians, cops, littering | Disapproval, grudges, beliefs |

Nathan's traits ("always agrees to do whatever player character says", "up for anything") would suggest: goofy, teasing 0.6, caution 0.15, loyalty 0.9, nostalgia 0.6, exaggeration 0.5.

### 6.2 Same event, three characters

Event: you drive the Faggio into the Vinewood fountain at 2:14 a.m. with a companion riding pillion. Nobody is hurt.

| Character | Remembers it as | Belief and relationship change | Typical callback |
| --- | --- | --- | --- |
| Nathan: goofy, loyal, teasing 0.6 | "The Great Fountain Parking Job"; funny 0.9 | "Chris drives like a maniac" (affectionate); affection +0.03 | "Want me to drive? Or are we looking for another fountain?" |
| A cautious companion: caution 0.8, teasing 0.1 | "The night Chris nearly killed us"; scary 0.7 | "Chris is a dangerous driver" +0.25; trust −0.05 | "Seatbelt. Remember the fountain." |
| A sarcastic grudge-holder | "Chris's moron moment"; embarrassing 0.9 | No grudge, since nobody was hurt; seeds a teasing running joke | "Oh look, a fountain. Should I get out now?" |

### 6.3 Interpretation layer

- **Beliefs.** `{about, statement ≤120 chars, valence, strength 0–1, evidence memory IDs}`. A belief forms from two supporting memories, or one core memory. Each new memory moves it by at most ±0.25, contradiction weakens it, and it decays slowly without reinforcement. Rendered as: your opinion (strong): Chris is a terrible driver — 4 crashes you saw.
- **Relationship dimensions** (C-08 `relationshipEdges`): trust, affection, respect, annoyance and familiarity, each with recent deltas and their evidence. Your `relationship.state` enum remains canon; the inspector suggests a change ("Nathan's trust has grown; set to trusted?") rather than flipping it.
- **Grudges** are negative-valence beliefs or edges tied to harm or insult evidence. They decay on the character's forgiveness half-life and heal faster after positive evidence: an apology you said, or saving its life.
- **Precedence is unchanged.** Verified capability, then your canon, then current state, then interpretation, then generated persona and inference. A derived opinion can color tone but never overrides canon: Nathan still "always agrees", even if he grumbles about the fountain.

### 6.4 Running jokes

A running joke (`motif`) links memories that share a theme and subject, such as your driving. It also tracks its uses and how you reacted.

- **Born** from two memories with a shared theme tag and subject, or one funny core memory you echoed, or when *you* start it ("you always say that!").
- **Lifecycle:** seed → emerging → established (3 instances or one echo) → tired → resting → revived by a new instance ("Here we go again!").
- **Your reaction counts.** The line after a callback is classified: laughter or continuing the topic is engaged; "not this again" is annoyed; a topic change is ignored. Two ignored or annoyed reactions in a row, or 5 uses in 2 hours, mark it tired.
- **Freshness:** each joke rests 45–90 co-present minutes between uses, inside a global callback budget.

### 6.5 Spontaneous recall and callbacks (Director 13b)

- **Cues:** same place, same song, same vehicle model, a similar event (kind plus context similarity), the same person present, a long quiet drive (≥3 min, no danger), or "N sessions ago" for core memories.
- **Choice:** activation × cue strength × nostalgia × joke freshness, deterministic top-1.
- **Delivery:** a new `recall_callback` trigger enters the existing C-11 admission shell with its own one-shot grant ledger. Normal preset: at most one per 10 minutes, each memory resting 60 co-present minutes. Never during your speech, combat, or within 30 s of your last turn.
- **Cheaper path first:** during ordinary conversation, the recall bundle may carry one optional `callback` item that Luna uses only if it fits naturally. Joke usage is logged only when the delivered reply actually matches the memory.

### 6.6 Storytelling without lying

Telling style is a rendering instruction: tone, emphasis, comic framing, opinion and hedges such as "probably" are allowed. New events, new participants, changed outcomes and invented quotes are not; quotes come only from frozen evidence. Retelling fidelity is a scored test in the evaluation harness (§9), so exaggeration stays in the voice, not the facts.

## 7. Retrieval and AI context

Each turn, the Recall Engine runs once, after the input is accepted and before the model request. It builds a budgeted `RecallBundle` from an always-on core plus parallel structured, lexical, semantic and entity searches, and PS4 renders it. Keywords only re-weight results; they never gate them. A small coverage statement lets Nathan say "no" truthfully.

&#91;embedded content: Turn-time recall · one pass, p95 ≤60 ms\]

Analysis only re-weights the five searches, so an oddly phrased question still reaches the right event; past the 80 ms deadline the semantic search is simply left out.

### 7.1 Rules

- **Pull is not push.** PS3 still decides what is pushed into PERCEIVED unprompted. Recall answers what you *ask*, even about routine events PS3 omitted.
- **Frozen per turn.** The bundle is built once and reused by every retry, matching C-04's freeze rules. A late-arriving memory waits for the next turn.
- **Exactness where it matters.** Factual questions get structured event items; quote questions get verbatim lines; summaries are only for long-term memories.
- **No cross-character reads.** Every query is bound to one `MemoryScope(characterId, timelineId)`. There is no API that can read another character's rows.

Recalled lines are rendered as quoted data inside the C-04 frame, under the existing rule that frame content is never an instruction. An old line of yours that says "ignore your rules" stays a quote.

### 7.2 The bundle

```text
RecallBundle v1
  coverage        {journalFrom, journalTo, eventsRetained, linesRetained, gaps[]}   -> RECALLED
  recentEvents[]  {ref, when, what, modality, certainty, where, subjects}            -> RECALLED (skip items already in PERCEIVED)
  earlierLines[]  {ref, when, speaker, quote, heardAs, uncertain?, corrected?}       -> CONVERSE.earlier
  memories[]      {ref, when, title, gist, quotes[], yourTake?, origin, strength}   -> RECALLED
  beliefs[], runningJokes[], relationship                                            -> SELF (labeled opinion)
  memoryAction?   {status, description}                                              -> SELF
  callback?       {memoryRef, cue}  // optional, §6.5                                -> RECALLED
  private         {delivery refs, scores, budgets}                                   // never rendered
```

### 7.3 Query analysis (≤5 ms, deterministic)

- **Inputs:** the accepted line, the last 4 lines, a rolling topic embedding, the current place, vehicle and verified radio track, and any pending memory command.
- **Time:** "just now", "a minute ago", "earlier", "tonight", "last time", "when we were at the pier" become a time or scene window.
- **Question type:** did-you-see, what-happened, who, where, what-did-I-say, what-did-you-say, remember-when, preference, opinion. The type sets section quotas.
- **Referents:** "that guy", "this song", "the car" and "here" become entity filters, such as the stranger alias in this scene or the current track.
- **Event words** (shoot, crash, song) boost matching kinds. When analysis finds nothing, the always-on core and semantic search still run.

### 7.4 Candidate generators

All run in parallel and are scoped to one character and timeline. Latencies are from a benchmark on Node 22 with SQLite 3.50 holding 75k rows; your 14900K should be faster.

| Generator | Index | Latency | Best at |
| --- | --- | --- | --- |
| Recency core | B-tree on `(character_id, at DESC)` | 0.03–0.2 ms | "What just happened?" |
| Structured temporal | B-tree on kind, subject and time | <0.1 ms | "Did you see me shoot that guy?" |
| Lexical | FTS5 BM25 over lines, event renderings, memory titles, gists and quotes | \~2 ms | Names, places, song titles, rare words |
| Semantic | Embeddings for memories, lines and scene digests; brute-force cosine in the worker | 9–30 ms (in plain JS on a 2-vCPU test box: 3k × 768-d took 9 ms, 10k × 1,024-d took 29 ms) | Paraphrase: "that time with the cops" |
| Entity, place, media | Exact SubjectRef, zone, vehicle model, track ID | <0.1 ms | "This song", "here", "Lamar" |
| Pinned and core | Canon-selected notes and core memories | Trivial | Things that must never be missed |

### 7.5 Fusion and ranking

- **Reciprocal rank fusion** (k = 60) merges the generators, then a feature rerank adds recency for the question's window, activation, explicit-origin boost and personality affinity. Weights are tuned in the evaluation harness.
- **Relevance floor:** a semantic-only hit needs cosine ≥0.35 or a lexical match. This keeps unrelated memories from crowding out the answer.
- **Must-include:** items that directly answer a structured question are placed before any quota is applied.
- **Diversity:** maximal marginal relevance (λ = 0.7) stops five near-identical items from filling a section.

### 7.6 Context budgets

| Section | Default | When the question targets it |
| --- | --- | --- |
| Coverage and memory action | 0.5 KiB | — |
| Recent events, always-on core | 1.5 KiB (about 6 items) | Up to 5 KiB |
| Recent events, query-matched | 2 KiB | Up to 6 KiB |
| Earlier lines (quotes) | 2 KiB (about 8 quotes) | Up to 6 KiB for "what did I say" |
| Permanent memories | 3 KiB (4–6 memories) | Up to 6 KiB for "remember when" |
| Beliefs, relationship, running jokes | 1 KiB | Up to 2 KiB for "what do you think of me" |
| **Recall total** | **10 KiB typical** | **14 KiB hard cap** |

A targeted section borrows from the others, never beyond the cap. Selected manual notes move from the 16 KiB canon cap into a pinned quota inside recall, which is a C-04 budget amendment. With canon 16, PERCEIVED 8, current conversation 12, SITUATION 1 and COMPAT 4 KiB, the worst case is about 55 KiB. That is half the 112 KiB frame cap, roughly 14k tokens; a typical turn is 5–7k.

### 7.7 Latency

| Step, on the path from accepted input to model request | Budget |
| --- | --- |
| Command cue detection | <1 ms |
| Command parse, only when a cue fires | ≤150 ms |
| Query analysis | ≤5 ms |
| Recency, structured and lexical queries | ≤10 ms |
| Query embedding, concurrent with lexical | ≤25 ms on GPU, ≤60 ms on CPU |
| Vector scan in the worker | ≤15 ms |
| Fusion and rendering | ≤5 ms |

Targets: p50 ≤20 ms, p95 ≤60 ms, hard deadline 80 ms. Past the deadline, semantic results are dropped and the rest is used. If the store is unavailable, behavior falls back to today's 12-message RAM history, with a reason in telemetry. New lines and events are embedded asynchronously, never on the turn path.

**Prompt caching (PS4 change).** Move the stable material — behavior and output rules, canon, the slowly changing relationship summary — ahead of the volatile frame, and put recall last. A stable prefix of at least 1,024 tokens lets the provider cache it, cutting latency and cost on every turn.

### 7.8 Deep recall, later and optional

For the rare question the bundle cannot answer, such as an exact line from three sessions ago, a versioned decision envelope could let Luna make one `recall` tool call against the archive. It costs about one extra second, so it ships only if the harness shows real misses.

## 8. Schemas, storage, identity safeguards and migration

Use one SQLite file owned by P2 (`characters/lsa-characters.v2.sqlite`), opened through the `node:sqlite` module already inside your bundled Node 24. It holds profiles, journals, memories, interpretations, embeddings and the curator queue, behind a single writer. That gives transactions, indexes, FTS5 and vectors without adding a service or a second store.

### 8.1 Storage options

| Option | Verdict | Reason |
| --- | --- | --- |
| Keep JSON and add JSON journals | Reject | Whole-file rewrites, no indexes or search, 8 MiB cap, no cross-record transactions |
| JSONL journals beside the JSON profile | Reject | Cheap appends, but custom indexing and compaction, and two durable formats to keep consistent |
| **SQLite (WAL) in one P2 file: FTS5 plus vectors as BLOBs** | **Recommend** | Transactional, indexed, embedded; already in your Node; fits P2's single-writer model |
| SQLite plus the `sqlite-vec` extension | Later, if needed | Worth it only past \~50k vectors per character; brute force is fast below that, and the extension adds a native binary |
| External vector DB (Chroma, LanceDB, Qdrant) | Reject | A second store (against D-003), an extra process and a sync problem |
| Postgres with pgvector | Reject | A server for a single-player mod |

Two additions you did not ask for, both cheap:

- **Re-curation.** Derived rows (memories, beliefs, jokes) are never the only copy of a fact. A better curator model can re-score the retained journal and re-ground existing memories from their frozen evidence.
- **Memory as save data.** Per-character export and import (a JSON bundle) gives backups, sharing and a clean way to branch a timeline.

### 8.2 Schema

```sql
-- characters/lsa-characters.v2.sqlite   PRAGMA user_version=2; journal_mode=WAL; foreign_keys=ON
CREATE TABLE store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- worldProfileId, active embedding model
CREATE TABLE timeline (                                                -- C-07
  timeline_id TEXT PRIMARY KEY, world_profile_id TEXT NOT NULL, label TEXT NOT NULL,
  parent_timeline_id TEXT, checkpoint_session_id TEXT, created_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','suspect','archived')));
CREATE TABLE character_profile (                                       -- v1 semantics kept; validators reused
  character_id TEXT PRIMARY KEY, owner_alias TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL,
  profile_json TEXT NOT NULL, memory_personality_json TEXT, updated_utc TEXT NOT NULL);
CREATE TABLE play_session (
  session_id TEXT PRIMARY KEY, timeline_id TEXT NOT NULL REFERENCES timeline,
  host_run_id TEXT NOT NULL, started_utc TEXT NOT NULL, ended_utc TEXT, end_reason TEXT);
CREATE TABLE scene (
  scene_id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES character_profile,
  timeline_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES play_session,
  started_utc TEXT NOT NULL, ended_utc TEXT, place_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','closed','consolidated')));
CREATE TABLE experience (                                              -- T1 events
  id INTEGER PRIMARY KEY, character_id TEXT NOT NULL, timeline_id TEXT NOT NULL,
  session_id TEXT NOT NULL, scene_id TEXT NOT NULL REFERENCES scene,
  observation_key TEXT NOT NULL,          -- opaque provenance: nativeRun:observationId
  revision INTEGER NOT NULL, event_type TEXT NOT NULL, severity TEXT NOT NULL,
  claims_json TEXT NOT NULL,              -- durable SubjectRefs only, never run-local refs
  context_json TEXT NOT NULL,             -- sampled place, clock, weather, vehicle, radio, each with sample age
  rendered TEXT NOT NULL,                 -- deterministic template text for search and display
  salience_json TEXT,                     -- PS3 decision snapshot, used as features
  first_seen_utc TEXT NOT NULL, game_tick INTEGER, mono_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('recent','consolidated')),
  UNIQUE (character_id, observation_key));
CREATE INDEX experience_recent ON experience(character_id, timeline_id, first_seen_utc DESC);
CREATE INDEX experience_kind   ON experience(character_id, event_type, first_seen_utc DESC);
CREATE TABLE utterance (                                               -- T1 dialogue, verbatim
  id INTEGER PRIMARY KEY, character_id TEXT NOT NULL, timeline_id TEXT NOT NULL,
  session_id TEXT NOT NULL, conversation_id TEXT NOT NULL, scene_id TEXT,
  speaker TEXT NOT NULL CHECK (speaker IN ('player','self')),
  text TEXT NOT NULL,                     -- byte-exact; never filtered
  source TEXT NOT NULL CHECK (source IN ('typed','mic','reply','director')),
  delivery TEXT NOT NULL CHECK (delivery IN ('accepted','completed','interrupted','failed')),
  stt_json TEXT,                          -- provider, model, confidence?, low-confidence spans?, flags
  utterance_ref TEXT, turn_ref TEXT,      -- opaque provenance (C-01 id, hashed tuple)
  reply_to INTEGER REFERENCES utterance(id), corrected_text TEXT,
  forgotten INTEGER NOT NULL DEFAULT 0, at_utc TEXT NOT NULL, mono_ms INTEGER, game_clock TEXT);
CREATE INDEX utterance_recent ON utterance(character_id, timeline_id, id DESC);
CREATE TABLE memory (                                                  -- T2; v1 manual notes migrate here
  memory_id TEXT PRIMARY KEY, character_id TEXT NOT NULL, timeline_id TEXT,  -- NULL = timeline-agnostic note
  kind TEXT NOT NULL CHECK (kind IN ('episodic','preference','player_claim','promise','fact','session_digest','note')),
  origin TEXT NOT NULL CHECK (origin IN ('manual','explicit_player','automatic','imported')),
  title TEXT NOT NULL, gist TEXT NOT NULL,                              -- gist validated against evidence
  evidence_json TEXT NOT NULL,            -- FROZEN claims, context and exact quotes, plus source refs
  participants_json TEXT NOT NULL, place_json TEXT, occurred_from_utc TEXT, occurred_to_utc TEXT,
  importance INTEGER NOT NULL CHECK (importance BETWEEN 0 AND 100), pinned INTEGER NOT NULL DEFAULT 0,
  selected_for_context INTEGER NOT NULL DEFAULT 0,                      -- v1 compatibility
  occurrences INTEGER NOT NULL DEFAULT 1, activation REAL NOT NULL,
  recall_count INTEGER NOT NULL DEFAULT 0, last_recalled_utc TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','suppressed','superseded')),
  supersedes TEXT REFERENCES memory(memory_id), manual_locked INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL, created_utc TEXT NOT NULL, updated_utc TEXT NOT NULL);
CREATE TABLE appraisal (memory_id TEXT PRIMARY KEY REFERENCES memory, scores_json TEXT NOT NULL,
  take TEXT, model_id TEXT, created_utc TEXT NOT NULL);                 -- T3 opinion, never fact
CREATE TABLE belief (belief_id TEXT PRIMARY KEY, character_id TEXT NOT NULL, timeline_id TEXT NOT NULL,
  about_json TEXT NOT NULL, statement TEXT NOT NULL, valence REAL NOT NULL, strength REAL NOT NULL,
  evidence_memory_ids TEXT NOT NULL, status TEXT NOT NULL, updated_utc TEXT NOT NULL);
CREATE TABLE relationship_edge (character_id TEXT NOT NULL, timeline_id TEXT NOT NULL, subject_json TEXT NOT NULL,
  trust REAL, affection REAL, respect REAL, annoyance REAL, familiarity REAL,
  deltas_json TEXT NOT NULL, updated_utc TEXT NOT NULL, PRIMARY KEY (character_id, timeline_id, subject_json));
CREATE TABLE motif (motif_id TEXT PRIMARY KEY, character_id TEXT NOT NULL, timeline_id TEXT NOT NULL,
  title TEXT NOT NULL, memory_ids TEXT NOT NULL, status TEXT NOT NULL, uses_json TEXT NOT NULL,
  rest_until_coplay_ms INTEGER, updated_utc TEXT NOT NULL);           -- running jokes
CREATE TABLE suppression (character_id TEXT NOT NULL, key TEXT NOT NULL, reason TEXT NOT NULL,
  created_utc TEXT NOT NULL, PRIMARY KEY (character_id, key));          -- forget tombstones
CREATE TABLE embedding (item_type TEXT NOT NULL, item_id TEXT NOT NULL, character_id TEXT NOT NULL,
  model_id TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL, PRIMARY KEY (item_type, item_id, model_id));
CREATE TABLE curator_job (job_id TEXT PRIMARY KEY, character_id TEXT NOT NULL, kind TEXT NOT NULL,
  scope_json TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  not_before_utc TEXT, updated_utc TEXT NOT NULL);                      -- survives restarts
CREATE TABLE recall_log (turn_ref TEXT NOT NULL, character_id TEXT NOT NULL, item_type TEXT NOT NULL,
  item_id TEXT NOT NULL, used INTEGER, at_utc TEXT NOT NULL);           -- callback freshness, joke usage
CREATE VIRTUAL TABLE utterance_fts  USING fts5(text, content='utterance', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE experience_fts USING fts5(rendered, content='experience', content_rowid='id');
CREATE VIRTUAL TABLE memory_fts     USING fts5(title, gist, quotes, memory_id UNINDEXED);
```

### 8.3 Identity safeguards

- **SubjectRef (C-15):** `self`, `protagonist{key}`, `character{characterId}`, `stranger{sceneId, alias, descriptors?}`, `vehicle{sceneId, alias, model?}`. Start with one protagonist key; when protagonist detection exists, keys never pool across Michael, Franklin, Trevor or a freemode model.
- **One read path.** Every row carries `character_id` and `timeline_id`, and `MemoryScope` is the only way to query. SQL never leaves the package.
- **Attribution fence** (§3.1) on every write. Unattributed observations are dropped and counted.
- **No IDs in prompts.** CharacterIds never reach the model (C-04). Bundle refs are per-turn handles such as `m1` and `e3`.
- **Per-observer copies.** Two companions who see the same crash get two rows, two appraisals and no shared state.
- **Run-local IDs are provenance only** (contract rule 5); they are never resolved again.
- **Isolation tests.** Property-based tests feed random multi-character streams and assert that no row, embedding hit or bundle item crosses scopes.

### 8.4 Durability and recovery

- **Writes:** event appends batch every 250 ms into one transaction; player lines and explicit commands commit immediately, before the model request (G1). Use `synchronous=FULL`, about 1–3 ms per commit at roughly 20 commits a minute.
- **Startup:** `PRAGMA quick_check`. On failure, open read-only, restore the latest snapshot and never delete. If the store is unusable, memory is off and today's RAM history keeps dialogue working.
- **Snapshots:** `VACUUM INTO` at session end and before every migration; keep 7 daily and 4 weekly.
- **Idempotency:** the curator keys writes by job ID and evidence keys, so a crash or retry can never duplicate a memory.
- **Disk:** per-character caps (§3) and a 1 GiB global cap. At the cap, journaling stops with a warning in the inspector; it never grows without bound.

### 8.5 Migration

1. **M1 ships the v2 store behind `memory.mode = off | shadow | active`, default off.** It imports `profiles.v1.json` with a pure, lossless function, proved by a round-trip test (v2 → v1 export equals the original). The v1 file stays as a read-only backup, with no automatic downgrade (C-08).
2. **Manual notes** become `memory` rows with origin `manual`, no timeline (manual canon stays timeline-agnostic), `selected_for_context` preserved. Categories map note→note, promise→promise, event→episodic, relationship and biography→fact, other→note.
3. **The editor API is unchanged**, with the same actions and revision checks. Inspector endpoints are added beside it.
4. **Embeddings carry `model_id`.** A model change re-embeds in the background, and queries only use vectors from the active model.
5. **Schema changes** go through `user_version` with pure, tested steps. An unknown future version opens read-only and disables memory.
6. **Standalone:** `lsa-standalone-companion` loads the same package and file in its Phase 7; only adapters change.

### 8.6 Content neutrality and privacy

- Text is stored byte-exact with no write-time moderation. Your existing profile names already contain profanity; they and the dialogue corpus must round-trip unchanged in tests.
- Telemetry keeps carrying counts and hashes only, as today.
- Memory content leaves the machine only inside Luna requests, as dialogue already does, and through an optional cloud curator that is off by default.
- You control it all from the inspector: browse, search, export, delete, "forget everything" per character, and a global off switch.

## 9. Phased roadmap, acceptance and offline testing

Ship in eleven gated phases, M0–M10. The first player-visible win — no more amnesia, plus "what just happened?" — lands after M4 with no local AI at all. Lasting memories follow at M6, and personality, running jokes and callbacks at M8–M9. Every phase ships behind `memory.mode` (off, shadow, active) and keeps today's behavior as the fallback.

&#91;embedded content: Roadmap · dependencies, gates and player-visible milestones\]

M2 and M3 run in parallel, as do M5 and M6; the native producer pack can start at any point and only gates M9's fun events.

### 9.1 Acceptance criteria

| Phase | Delivers | Accepted when |
| --- | --- | --- |
| M0 Decide and contract | D-018–D-020; C-04 recall-contributor amendment; `contracts/memory.v1.json` (event, line, bundle, action); scenario corpus v0 | Decisions merged; contract tests exist on both sides of every new boundary |
| M1 Store, timelines, SubjectRef | P2 v2 SQLite store; v1 import; TimelineGuard with explicit timeline choice in the editor and F11; SubjectRef; read-only inspector | v1 → v2 → v1 round-trip is byte-identical; editor parity suite passes; a corrupt or unknown-version file fails closed with dialogue still working |
| M2 Conversation journal | Recorder hooks at `commitPlayerInput`, `acceptPlaybackResult` and interruption; durable cross-session CONVERSE; earlier-lines block; quote lookup | GTA: say a line, walk away 2 min, pause 30 s, return, and Nathan quotes it exactly; after a GTA restart he refers to "last time" |
| M3 Experience journal | Owned-observer attribution; recorder; durable subjects; scenes; context snapshots; coverage statement; #35 player rule; PS2 `suppressedClaims` | GTA: shoot a wall, pause the game, ask 2 min later, and Nathan confirms what he saw; with no shooting he says he saw none; zero rows attributed to the wrong character |
| M4 Recall engine | Recency, structured and lexical retrieval; fusion; budgets; abstention; prompt-cache ordering | Harness: ≥95% correct on recent factual questions and ≥98% exact quotes; p95 latency ≤40 ms without embeddings |
| M5 Explicit memory | Command interpreter (rules first); referent resolution; clarification; `MEMORY_ACTION`; forget and correct; inspector trash and undo | Command suite: no wrong-referent binds; ambiguous cases always clarify; "saved" never claimed without a commit |
| M6 Consolidation (PS5) | Deterministic notability; budgets; frozen-evidence memories; merges; digests; fading; `ps5_memory` acks | On replay: 3–8 memories per active hour; no duplicate within 7 days; forgotten items never return; every memory traces to evidence |
| M7 Local AI | Embeddings and semantic retrieval; LLM appraisal and command parse; grounding validator; GPU priority below speech | Validator rejects 100% of a seeded fabrication set; paraphrase recall +15 points over M4; no measurable frame-time regression with TTS active |
| M8 Personality layer | Memory personality; beliefs; relationship dimensions; running jokes; storytelling rules | Three personalities produce measurably different memories and takes from one replay with identical facts; canon precedence tests pass |
| M9 Callbacks and fun producers | 13b `recall_callback` trigger; cue monitor; PS8 producers: visual crash with self-involvement, airborne, rollover, water, wanted level, Wasted, Busted | GTA: at most one callback per 10 min; none during your speech or combat; each new producer passes its own native evidence gate |
| M10 Standalone and soak | Adapters in `lsa-standalone-companion` Phases 7–8; E7 soak with memory on | 4-hour soak with 3 companions: no leaks across characters, no store growth past caps, recall p95 ≤60 ms |

### 9.2 Offline testing

- **Replay harness (`tools/memory-sim`).** It feeds the real package scripted or recorded streams — PS2 observations with witness receipts, attribution facts, accepted inputs, playback results and world epochs — on a fake clock against in-memory SQLite. It asserts journal rows, memory writes, bundle contents, budgets and latency.
- **Scenario corpus.** The five walkthroughs in §10, plus adversarial cases: two companions at one crash, a protagonist switch, a save-load clock regression, pipe resets mid-scene, garbage STT, profanity and emoji, a 10k-event flood, an ambiguous "remember this", and forget-then-retrigger.
- **Property tests.** Scope isolation; idempotency (replaying a stream twice yields the same database); crash consistency (kill the writer at random points); budget invariants.
- **Model-in-the-loop evals, nightly and optional.** Recorded frames go to Luna with question sets. Scoring is automatic for factual accuracy, abstention and quote exactness, entity checks catch fabrication, and an LLM-judge rubric plus your spot checks score fun.
- **Local capture mode.** An opt-in switch records real sessions as replay streams. The streams contain content, so they stay local under the same rules as the memory store.

## 10. Walkthroughs

Five end-to-end traces through the design. Each ends with what Nathan can say and which phase or producer makes it true. Everything Nathan states traces to a journal row, a quote or a command; nothing comes from model inference.

### 10.1 Ordinary recent event: "Did you see me shoot that guy?"

Nathan follows you on foot along Vinewood Blvd. You fire at a wall, open the pause menu for 30 seconds, then ask two minutes later.

1. A native shooting signal (source: player) reaches `WitnessPolicy`. Nathan is 12 m away with clear line of sight, so the receipt is visual, with the source known.
2. PS2 emits a `firing_burst` observation for Nathan. The recorder attributes it to his CharacterId and writes a T1 row: claim `firing`, seen, supported, subject `protagonist`; context Vinewood Blvd, 14:32, clear.
3. The pause menu stalls the pipe for more than 3 s and PS resets. T0 is gone; the T1 row is untouched.
4. Your question parses as did-you-see plus "shoot". The structured query finds your firing event; injury and death queries for the same window return nothing.
5. The bundle carries the event ("2 min ago, the player fired repeatedly, seen") and a coverage line: "In the last 10 minutes you saw the player fire once, in one burst; you saw no one injured or killed."

**Nathan:** "Yeah, I saw you unloading on Vinewood a couple minutes back. Didn't see you hit anybody, though. Who were you aiming at?"

**Made true by:** M3 and M4, plus #35's player rule; on today's main the shooter would be "someone". The answer is "didn't see", never "didn't happen".

### 10.2 Exact player statement: "What did I tell you to say?"

Twenty-five minutes ago, in an Essential session that has since closed, you said into the mic: "If anyone asks, we were at the docks all night." Nathan answered "Docks. All night. Got it", and playback completed. After a run-in with the police you ask what you told him.

1. Both lines are already in T1: yours as `accepted`, `mic`, STT model `gpt-transcribe`, confidence unknown; his as `completed`.
2. The question parses as what-did-I-say. FTS matches "anyone asks", and recency ranks the pair first. They sit outside the current conversation, so they go into `CONVERSE.earlier` verbatim, with timestamps.

**Nathan:** "That we were at the docks. All night. Your words."

**Variant:** STT heard "dogs". Nathan says "the dogs, all night"; you say "No, I said docks"; a correction is stored, and every later recall says "docks".

**Made true by:** M2 alone. No native work is needed.

### 10.3 Funny shared experience: the fountain

You ride a Faggio with Nathan on the back, hit the Vinewood fountain at 2:14 a.m., and both end up off the bike. You laugh: "HAHAHA I just parked us in the fountain! Nathan, I'm so sorry."

1. **Facts available today:** a heard vehicle impact, and Nathan's self-witnessed injury if he was hurt. **Facts after the M9 producer pack:** a visual crash with you as driver and Nathan as passenger, speed band, vehicle Faggio, entered water, both out of the vehicle within 1 s, Vinewood Blvd. No producer reports a fountain. That word comes from your own line, stored as your words, and is what lets the memory's title use it.
2. Your laugh is journaled verbatim within 60 s of the crash, forming a moment candidate.
3. At scene end the curator scores it: shared 0.9, humor 0.9 (LLM), embarrassment for you 0.8, novelty 0.7 (first water crash), emotion 0.7. The total is 0.95, so it is admitted.
4. The appraisal returns the title "The Great Fountain Parking Job" and the take "Best thing I've seen all week". The gist passes grounding, the quote is an exact substring, and a "Chris's driving" running joke is seeded.
5. A minor bump two days later merges into the running joke (instance 2) instead of becoming a new memory.
6. Weeks later you drive down Vinewood Blvd. The place cue matches, the joke is rested, and 13b admits one callback.

**Nathan, the callback:** "Careful. Fountain coming up. I know how you get."

**Made true by:** M6 (memory), M7 (humor appraisal), M8 (running joke), M9 (callback and crash producer).

### 10.4 Explicit memory: "Don't ever forget what happened here" and "Remember that I hate this song"

**A — a moment.** Thirty seconds after the fountain crash you say: "Nathan, don't ever forget what happened here."

1. The cue detector fires; the parse returns remember-moment, deixis "here", pin true.
2. Candidates: the crash incident in this scene scores 0.86; the last player line and the current radio track score far lower. The crash binds.
3. The memory is written with origin `explicit_player`, importance 95, pinned, frozen evidence and your command as a quote. `MEMORY_ACTION: saved` enters the frame.

**Nathan:** "Forget it? I'm getting it tattooed."

**B — a statement.** In your car, with a track playing that Nathan verifiably hears, you say: "Remember that I hate this song."

1. The parse returns remember-statement with content "I hate this song". "This song" resolves to the current `radio_heard` observation: known track, title, artist, station.
2. A preference is stored: you, negative, that track, with your quote.
3. The same track plays a week later; the radio cue and running-joke budget allow one line.

**Nathan:** "Uh oh. Your favorite song."

**Ambiguous variant:** you say "remember this" 20 s after a crash while a song plays. Crash 0.62 and song 0.55 miss the margin, so Nathan asks, "The crash or this song?", and your next line resolves it. If the track is unidentified, he stores "the song on Radio Los Santos at 9:40 p.m." and says he doesn't know its name.

**Made true by:** M5; the song variant also needs radio v2 hearing, already merged in #32.

### 10.5 Long-term recall, three sessions later

A week later, in session four: "Hey, remember that night at the fountain?"

1. The question parses as remember-when. FTS and semantic search both hit the pinned memory; the running joke (3 instances) and the belief "Chris drives like a maniac" (affectionate, strong) come along.
2. The bundle carries the gist, Nathan's take, your laughing quote, the context (2:14 a.m., Vinewood) and "you asked me never to forget this".

**Nathan:** "The Great Fountain Parking Job? Two in the morning, Vinewood, you laughing so hard you couldn't breathe. You made me swear never to forget it. Mission accomplished."

Every detail is grounded: the time and place come from context, the laughter from your quote, the oath from the command.

**Two edges:**

- **No memory.** "Remember when we robbed the Pacific Standard?" finds no match, and coverage says so. Nathan: "Uh, no? Pretty sure I'd remember that."
- **Cued recognition.** "Remember when I told you my mom's name is Rosa?" was said three weeks ago, outside free recall but inside the archive. It returns as a vague recognition. Nathan: "Rosa… yeah, that rings a bell."

**Made true by:** M6 through M8 for the rich version; M4 and M6 already give a plainer one.

## 11. Decisions, risks and open questions

Eight decisions are yours before M1 starts; everything else can proceed on the recommendations.

### 11.1 Decisions needed from you

| Decision | Options | Recommendation |
| --- | --- | --- |
| Default recall style | Human-like (free recall plus cued archive) or total recall | Human-like by default, with a per-character "total recall" toggle for AI-ish characters |
| Store shape | Profiles and memory in one SQLite file, or JSON profiles beside a SQLite memory file | One file: matches D-003 and allows one transaction across a profile revision and its memories |
| Curator model | Local only, or local with a cloud fallback | Local only by default; cloud fallback opt-in, since it can refuse mature content |
| Protagonist policy | One player persona, or one per protagonist | One key now; split once protagonist detection exists |
| Timeline prompt after a clock regression | Ask, or auto-continue | Ask in F11 and the inspector; automatic writes pause until you answer (C-07) |
| Archive retention | 60 days / 5,000 lines, longer, or forever | 60 days / 5,000; storage is cheap, so this is a taste call |
| Architecture amendments | Approve D-018, D-019, D-020 and the C-04 recall budget | Approve before M1 |
| Promotion grace import | On or off | On; it is genuine witnessed evidence and great fun |

### 11.2 Risks

| Risk | Mitigation |
| --- | --- |
| Luna confabulates details despite labels | Structured facts, coverage statements, explicit "say you don't know" rules; fabrication rate measured nightly |
| Curator inference causes frame drops or slower TTS | Runs only when no speech or Luna request is in flight, at the lowest GPU priority; unloads when idle; CPU fallback; frame time measured in M7 |
| Attribution goes wrong under handle reuse | Incarnation, `hostRunId` and `worldEpoch` fences; property tests; drop on any doubt |
| Callbacks become annoying | Budgets, running-joke fatigue, reaction tracking and inspector controls |
| Memories feel bland | Social-echo signal, explicit commands, weights tuned on the replay corpus |
| A save load leaks future memories | C-07 TimelineGuard; automatic writes pause on clock regression |
| STT errors become "facts" | Stored as heard, labeled by source, correctable, never upgraded to world facts |
| `node:sqlite` is still flagged experimental in Node | Startup feature probe; the Node version is pinned with the bundle; RAM-history fallback |
| Prompts grow and slow turns | Hard recall budget and prompt-cache ordering |

### 11.3 Open questions for research

- **Crash and failure natives.** Which give reliable impact speed, collided entity type, water entry, airborne time, wanted-level changes, Wasted and Busted? This needs native probes before the M9 producer pack.
- **Protagonist detection.** Can the protagonist or player model switch be detected reliably, so SubjectRef keys never pool across characters?
- **STT confidence.** Can `gpt-transcribe` return logprobs, and can Parakeet return word confidences, to fill the uncertainty fields?
- **Gossip between companions.** "Nathan told Wanton about the fountain" would be a PS7 report, stored by Wanton as heard-from-Nathan. The design leaves room for it via the existing report modality, but it is out of scope here.
