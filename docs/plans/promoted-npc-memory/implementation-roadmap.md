# PS5 promoted-NPC memory: implementation roadmap

**Status: approved design proposal, not implemented.** [Accepted decisions](approved-decisions.md) are normative for this initiative; [research report](architecture-study-20261011.md) provides audit, schemas, examples and risks. Never treat source design, merged code, locally installed code and GTA acceptance as interchangeable.

**Scope:** promoted NPCs only. Build one host-agnostic memory package owned by P2, fed by source-qualified PS2 evidence and accepted conversation commits; PS4 remains the single writer of Luna's knowledge frame. No new local curator / embeddings process; **Luna is the off-path cloud curator**, with deterministic offline fallback. The design must survive eventual standalone RAGE hosting without taking native authority from the current owner prematurely.

## Architecture / data flow

```text
GTA verified signals / C-01 player utterance
        |              |
 PS2 observer-qualified | accepted turn + playback receipts
        |              |
        +----- P2 MemoryRuntime / CharacterId & TimelineGuard -----+
                    |
           transactional SQLite (single store)
                    |
      +-------------+----------------------------+
      |             |                            |
 recent event /   permanent records            durable curation queue
 dialogue journal  and personal beliefs              |
      |             ^                            batch Luna calls
      |             |                                 |
      |             +---- evidence-validated proposals+
      |
 structured/time/entity/FTS5 recall (CPU; no mandatory embedding)
                    |
          typed C-04 / PS4 RecallBundle
                    |
     Luna dialogue / PS6 Director-approved callbacks
```

## Phased work (M0–M10)

| Phase | Scope | Acceptance gate / notes |
| --- | --- | --- |
| **M0 — decisions & contracts** | Ratify D-018–D-020 as revised, C-04 recall contributor contract; `contracts/memory.v1.json` for events, lines, recall bundles and explicit commands; corpus of mundane and fun scenarios. | Contract validators and version compatibility; no deployed behavior implied. |
| **M1 — P2 storage / identity / timelines** | One SQLite store; v1 profile backup/import/recovery; C-07 timeline, C-08 schema migration, C-15 subject keys; editor migration parity. | Corruption and rollback fail closed; existing profiles, notes, editor survive intact; unknown protagonists not conflated. |
| **M2 — verbatim conversation journal** | Journal typed/STT text as accepted, with exact line bytes and source; NPC utterances only after acknowledged playback; continuity across Essential session / bridge reconnect / GTA restart. | Test last 200 lines and cross-session questions; deterministic unambiguous quote retrieval is 100% exact. No local model. |
| **M3 — high-fidelity recent event journal** | Durable per-promoted-observer PS2 observations, session-free ownership proofs, participant identities, timestamps/scenes, coverage and no-witness results; optional two-minute promotion grace. | Pause/restart/retire cannot erase committed recent evidence; no cross-character leaks; unsupported facts remain unknown. No AI required. |
| **M4 — recall engine** | Structured factual lookup, entity/time matching, FTS5 lexical search, topic/follow-up handling and bounded C-04/PS4 RecallBundle; cache-friendly prompt ordering. | Recall even non-notable recent events; abstain on missing evidence; budgeted latency (initial target p95 <=40 ms before optional semantic extensions). No embedding required. |
| **M5 — explicit remember / correct / forget** | Rules-first command parsing, referent resolution, typed statuses; Luna parsing may assist only when needed; memory inspector, delete/export and repair. | Durable save must precede acknowledgement; ambiguous `remember this` clarifies; deletion respected; instructions override notability quota. |
| **M6 — deterministic permanent memory (PS5)** | Scene candidates, evidence-frozen episodic records, factual digests, notability signals, duplicate merging, queue durable acknowledgements and soft capacity targets. | Interesting events retained without invented details; exceptional sessions may exceed target six/hour; queued events never silently lost. Works without Luna curation. |
| **M7 — Luna cloud curation (replaces proposed local AI)** | Provider abstraction using **existing Luna integration**. Queue / batch / rate-limit / retry; humorous scene appraisal, surprising details, evidence-grounded summaries, personality relevance; optional additional targeted semantic lookup only if justified by recall tests. | No new local LLM, GPU allocation or VRAM; low-priority remote calls outside dialogue path; unavailability leaves journaling/recall operational; no fabricated evidence admitted. |
| **M8 — personality, relationships and running jokes** | Character-specific interpretations, evolving opinions and preferences, social echoes, joke evolution, limits on repetition. Luna-curated derived state always linked to factual sources. | Replay identical evidence through different personalities and get varied takes but invariant facts; user-approved canon remains authoritative. |
| **M9 — memorable GTA events & spontaneous callbacks** | Optional richer, qualified event producers for crashes, rollovers, airborne/water mishaps, wanted levels, Wasted/Busted; PS6 memory cue/Director admission. | Every claim validated by native evidence; no spamming, false witnessing or interruption of player speech; fun-factor playtests. |
| **M10 — standalone integration / soak** | Adapter into standalone companion and future native host; resilience, identity fencing, backups and multi-companion soak. | Four-hour / three-companion scenario, rollback and reconnect, no cross-character leakage, no uncontrolled storage growth; preserve latency and normal dialogue. |

## Critical delivery rules

1. **M2 is the first major player win:** Nathan remembers actual dialogue across short session closes. M3 + M4 then address `what just happened?` regardless of significance. M5/M6 introduce durable opt-in and automatically selected memories; M7/M8 make them increasingly engaging.
2. **Do not block on M7.** The SQLite recorder and deterministic curation must be useful with no cloud access and no local model. Asynchronous Luna appraisal enhances memory quality.
3. **Capture-first guarantees:** exact retained typed/STT strings, source-qualified observations, character/timeline fences, idempotent replay, atomic commits, no silent filtering of mature/profane in-game roleplay. STT mismatch and missing native observability must be labeled, never fabricated away.
4. **No hard curation quota:** ~6 memories/co-present-hour is a tunable heuristic, not a reason to discard an exceptional memory cluster. Manual `remember this` bypasses ranking.
5. **Recall UX:** natural/spontaneous character behavior but precise on-demand retrieval from evidence, with exact quotes as data. A model reply is evaluated separately from deterministic store/query correctness.
6. **Archive policy:** recent free-recall window spans >=200 committed player lines or recent sessions; older verbatim records remain on disk until user-requested deletion or explicit quota-driven action. Archive recognition must be optically clear in dialog context: do not present archives as active conversation turns.
7. **Cloud use:** batching, API spend ceilings, retries/backoff and ability to disable Luna appraisal. Sending evidence to Luna follows existing cloud-data boundary; local SQLite capture always continues.
8. **QA:** replay harness (including rude language, STT corrections, false memories, 10k observation bursts, timeline rollback, duplicated events, two observers, session interruptions); unit/contract tests; selective GTA acceptance after each phase.
9. **Research code status:** the original Oct 11 audit captured open PRs #35/#37/#38–#47 and a specific `main` SHA. Recheck current merges before implementation; design notes are not deployment receipts.

## Dependencies & parallelization

- M0 -> M1 -> M2 / M3 (parallel) -> M4.
- M1 + journal evidence -> M5 and M6 (partially parallel).
- M6 -> M7 (optional enhancement), then M8. The native fun-event producer investigation can proceed separately, but integrate through PS2 ownership and PS4 retrieval.
- M9 requires PS6 Director contracts; M10 depends on standalone P2 / PS migration acceptance.

**Success definition:** promoted companions remember ordinary recent facts and exact utterances accurately; selectively retain genuinely entertaining personal memories across GTA restarts; use different personalities to create believable jokes, opinions and relationships; and need **no extra local AI model** to do any of it.
