# M0 — Memory boundary contracts and implementation handoff

**Status:** first M0 contract baseline; no new memory behavior enabled. Stacked on architecture PR #49. The accepted decisions and Luna-first policy in [approved-decisions.md](approved-decisions.md) are authoritative over historic source-report local-curator assumptions.

## Grounded existing seams (current main 3ef6c52, October 11, 2026)

| Area | Existing code or decision | M0 handoff |
| --- | --- | --- |
| P2 profile owner | `lsa-essential-e1-candidate/src/characters/profileStore.mjs` currently writes profile v1 JSON, with durable UUID `CharacterId`, `promotion.ownerAlias`, 128 manual memories and an 8 MiB cap. | M1 migrates P2 to a single SQLite store; preserve profile backups, existing notes and editor behavior. |
| Dialogue | `src/memory/dialogueHistory.mjs` holds a 12-message per-session RAM history; `commitPlayerInput` currently trims and truncates input. `acceptPlaybackResult` admits NPC speech only after matching successful playback. | M2 records exact **accepted** input before Luna, with origin and STT uncertainty, and journals NPC lines with verified delivery status. Define original-transcript vs normalized-input distinction before coding. |
| PS2 | `src/perception/contracts.mjs` validates observations, native evidence and receipts; `observationStore.mjs` expires or retires observations within 120 seconds. | M3 records all attributed, qualified promoted-observer observations at acceptance, without a PS3 salience threshold and before expiry/retirement. |
| Observer binding | Native observer index, P2 owner alias, encounter, incarnation, run and epoch are independently checked pieces of evidence. | M3 joins these only when fresh/current and never attributes silently by proximity or memory of an old ped handle. |
| PS4 | `src/context/knowledgeSelector.mjs` and `knowledgeRenderer.mjs` own the single model-facing `TurnKnowledgeFrame`. | M4 inserts one bounded typed recall contributor into `RECALLED` and earlier `CONVERSE`, not parallel Luna system instructions. |
| C-01 and standalone | Speech utterance work (#37) and standalone host work (#38/#40/#42–#44) were unmerged at research audit. | Optional utterance ID until merged. Memory remains companion-host neutral, not bound to Essential-only session lifetimes; recheck latest code when wiring. |
| Curator | Existing Luna provider does chat; no memory-curation implementation yet. | M7 uses **Luna cloud calls off the turn path**, with cost/rate caps, durable retry, grounded structured proposals and deterministic fallback. No extra locally hosted LLM, embedding runtime or VRAM reservation. |

## Version 1 logical envelopes

The machine-readable Draft 2020-12 JSON Schema is [`contracts/memory.v1.json`](../../../contracts/memory.v1.json). These are **companion-level interfaces**, not deployed native wire formats:

1. `journal_event`: immutable qualified source observation, per-character verified observer/owner/run/epoch proof, evidence claims and source hash.
2. `dialogue_line`: player/NPC source, exact committed words (including profanity and fictional mature dialogue), optional STT provenance, turn hash and explicit delivery receipt.
3. `recall_query`: character/timeline-bound intent and a 14 KiB maximum byte budget.
4. `recall_bundle`: evidence-linked recent/permanent facts and quotes, separation of opinion from verified fact, explicit matched/not-recorded/unavailable coverage.
5. `memory_action`: remember, correct, forget, clarify, failed or pending; a successful action requires a real durable transaction, never merely model text.
6. `curation_proposal`: asynchronous Luna-or-deterministic rating and fun/personality interpretation with linked source IDs; proposed descriptions can never create observed GTA facts.

Every record carries `characterId`, `worldProfileId` and `timelineId`; only promoted NPCs are journal owners. Unverified ambient NPCs cannot own permanent memory. `CharacterId` cannot authorize game-native physical actions.

**Enforcement note:** schema fields/types alone cannot prove identity joins, cross-record references, evidence hashes, correct source modality, saved commit ordering or a faithful verbatim quote. M1–M4 implement strict production validators, database identity constraints, receipt checks, exact quote comparisons and idempotent writes. The fixture tests use an intentionally small schema subset, not a production schema engine. Timeline ambiguity freezes timeline-scoped writes pending explicit user confirmation.

**Privacy and game experience:** source game-state dialogue is content-neutral and retained exactly as accepted. STT transcripts reflect what the recognizer returned, and correction is linked rather than rewriting provenance. Raw content is not emitted in diagnostic telemetry. Automatic selection is fun-first but a soft budget; explicit remember-this bypasses it. Human-feeling spontaneous recall coexists with deterministic exact on-demand lookup.

## M0 offline test and scenario evidence

- `lsa-essential-e1-candidate/tests/memory-contract-v1.test.mjs` is auto-discovered by the repository's Node test runner, using six accepted and nine deliberately rejected boundary examples.
- `tools/memory-sim/scenarios.v0.json` identifies ten **future acceptance scenarios**: exact quote/reconnect, mundane recent observation, no-witness isolation, explicit memory, Luna outage, personality differences, timeline rollback, promotion import, STT correction and Director-gated callback. All remain marked not implemented.
- The scenario list is a **test plan**, not simulated passing GTA output or end-to-end PS5 coverage.

## Dependencies and phase gates

**M0 → M1**: verify `node:sqlite` and FTS5 with the bundled Node 24 before SQLite feature assumptions; implement one backed-up, reversible P2 import and timeline/subject identification (C-07/C-08/C-15). Keep current profiles intact on failure.

**M2**: hook accepted input and actual playback receipt; ensure at least last 200 utterances plus current/previous session remain in free recall, and preserve a generous user-controlled long-lived archive. M2 can fix session amnesia without AI curation.

**M3/M4**: source-time promoted-observer attribution, durable event journal and PS4 typed, budgeted retrieval. No observation means 'I did not see/record that', not 'it never happened'. Avoid query-specific regex memory filters.

**M5/M6**: explicit memory commands and deterministic, evidence-frozen notability/consolidation. ~6 new memorable episodes/hour is a soft target, not a reason to discard exceptional events.

**M7**: Luna cloud appraisal only when configured, asynchronous batches, retry/backoff/spending budget; recording and exact retrieval must succeed while curator is offline.

**M8–M10**: personality, funny callbacks, verified crash/other fun-event producers, Director priority and future standalone-host adapters. Existing C-04 and D-016 remain authoritative until separately amended in their own implementation PRs.

## Scope and remaining proof

M0 adds contracts, code-facing integration notes and executable fixture checks. It **does not** assert working SQLite migration, actual memory durability, Luna curator availability, factual recall success in GTA, or native ownership integration. Those belong to their respective phases.
