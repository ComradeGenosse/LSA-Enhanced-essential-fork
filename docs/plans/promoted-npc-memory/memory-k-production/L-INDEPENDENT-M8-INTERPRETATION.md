# L — independently activatable M8 personality interpretation

**Target:** PR #138 integration branch only. **Not:** `main`, GTA deployment, S01–S10 acceptance, or physical validation. Draft, do not merge.

## What L does

`memory.interpretation: "on"` now lets a promoted NPC form grounded opinions, a relationship impression and running-joke interpretations from its persistent P2 history in the real foreground turn, with **H1, H2/M4, M5, M6 and M7 cloud curation all off**. Nothing new is stored or generated: it reuses the existing M8 evaluator (`evaluateM8`), `p2M8ProductionRead.mjs` (authenticated P2 SQLite history, per-source integrity proof, suppression/correction exclusion), `projectPreparedM8` and the single PS4 assembler. No new database, LLM worker, personality system or prompt assembler.

Flow for one accepted player turn (explicit `memoryK.capabilities` map only):

1. `prepareIndependentM8` (new, `src/memory/m8IndependentInterpretation.mjs`) opens the same authenticated accepted-player source as H1/H2 (`openH1ConversationSource`, D01/D02/D03 — a source opener only; no history is assembled). M8 runs **after** M5/H1/H2 so a same-turn remember/forget/correct is already durable.
2. `createP2M8ProductionReader` reads P2 inside one serialized read, bound by a seal over every source byte and the durable history rollups. Failed/interrupted NPC speech and unsupported witnessed events are never evidence.
3. `composeIndependentForegroundMemory` accepts M8 as one more optional contributor under the shared accepted-line stamp.
4. `finalizeKnowledgeFrame` admits `preparedM8` on its own `m8Ready` gate (no longer tied to M4 `recallReady`). PS4 projects it only into `RECALLED.characterOpinions / runningJokes / relationshipInterpretation`; each entry carries `epistemicStatus: "character_opinion"`, `verifiedWorldFact: false` and its `sourceEvidenceIds`. Facts remain M4's lane. The existing grounding text already tells the model an opinion is subjective and never a verified fact; running jokes never authorize spontaneous speech.
5. On every model attempt and the final-send fence the reader re-reads P2: a new forget/correction, a deleted or changed source, host renewal, owner/timeline change or a newly accepted source invalidates the seal. **M8's failure removes only the opinion frame** — it never poisons H1/H2/M5. Any failure latches for that turn.

Canon is authoritative and unchanged: SELF canon, relationship state and the NPC profile are never written by M8 (`canonRelationshipUnchanged: true`).

## Configuration (M8 only)

```json
{
  "memoryK": {
    "capabilities": {
      "memory.dialogue.player": "on",
      "memory.dialogue.npc": "on",
      "memory.journalContext": "off",
      "memory.recall": "off",
      "memory.commands": "off",
      "memory.interpretation": "on",
      "memory.events": "off",
      "memory.coverage": "off"
    }
  }
}
```

`memory.dialogue.player` must be `on` (it is now also a declared dependency of `memory.interpretation`). `memory.interpretation: "off"` runs no M8 read at all and leaves M2/H1/H2/M5/M6 untouched. `shadow` is reported as `shadow_not_supported`. An absent/empty capability map keeps the inherited combined path unchanged.

## How different NPCs differ

The evaluator reads structured inputs (`humor.style`, `caution`, `loyalty`, `interests`) but the P2 profile schema only allows `personality.description` and `personality.traits`, so before L every NPC fell back to defaults. `deriveM8PersonalityFromCanon` is a small deterministic whole-word map from the editor-approved **traits** to exactly those existing inputs (for example `sarcastic`→style, `cautious`→caution 0.9, `loyal`→loyalty 0.9, `music`→interest). It never reads free prose, never calls a model, and a structured value already on the canon wins. An NPC with no recognised trait keeps the evaluator's defaults. It is opt-in per reader (`personalityFor`), so the legacy WS-6 path output is unchanged. Same player line, three NPCs: `sarcastic` → "I find that joke deliciously dry.", `cautious` → "I am not sure that joke is funny.", default → "I find that funny."

## Diagnostics

`services.memoryInterpretationDiagnostics()` (also under `memory.interpretation` in the runtime diagnostics) returns `state`, `reason`, `lastPreparation/lastValidation`, `contributedToModelRequest`. It never contains player text, opinion text, identifiers or exception messages. `abstained` means no source-linked interpretation exists yet.

## Small shared changes

* `p2M8ProductionRead.mjs`: optional `personalityFor` (default identity).
* `independentForegroundMemory.mjs`: optional `interpretation` contributor; `interpretationPrepared`, M8-only `opinionCurrent`.
* `runtimeComposition.mjs`: `memoryKM8Activation`. `essentialGlue.mjs`: prepare/diagnostics and an `m8Ready` gate. `bootstrap.mjs`: diagnostics registration. `capabilityPolicy.mjs`: dependency on `memory.dialogue.player`.

## Not in this slice

Personality *evolution*, M7-sourced appraisal in the live turn, callback/Director admission of jokes, and any structured-personality editor field (the trait map above is the interim bridge). Nothing here was validated in GTA.
