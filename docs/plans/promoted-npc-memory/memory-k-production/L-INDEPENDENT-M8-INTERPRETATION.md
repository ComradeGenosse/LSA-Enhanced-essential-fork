# L — independently activatable M8 personality interpretation

**Target:** PR #138 integration branch only. **Not:** `main`, GTA deployment, S01–S10 acceptance, or physical validation. Offline tests only; nothing here is a GTA receipt, and this slice does not claim M8 has been exercised in a live game.

## What L does

`memory.interpretation: "on"` now runs the **existing** M8 capability in the real foreground turn with **M4 recall (H2), H1 history, M5 commands, M6 and M7 all off**. NPCs can carry grounded opinions, relationship impressions and running-joke interpretations of what they actually experienced into a model request, as a typed section of the one existing PS4 frame.

Nothing was rebuilt. L reuses:

* `createP2M8ProductionReader` / `readAuthorizedM8Snapshot` (`p2M8ProductionRead.mjs`) — authenticated P2 SQLite history, suppression/correction overlays, source-linked evidence, sealed re-read;
* `evaluateM8` / `preparePs4M8` / `verifyPs4M8Current` — the unchanged shared-brain evaluation engine;
* `projectPreparedM8` and `renderKnowledge` — the unchanged PS4 projection into `RECALLED.characterOpinions | runningJokes | relationshipInterpretation`;
* `openH1ConversationSource` — only as the authenticated accepted-line **source opener** (D01/D02/D03 readback). H1 history is not prepared.

There is no new database, writer, LLM worker, personality system or prompt assembler.

## Flow for one accepted player turn (`prepareLiveTurnMemory`, explicit capability map only)

1. M5 (if on) commits any remember/forget/correct first, exactly as before.
2. H1 / H2 (if on) prepare as before.
3. `prepareIndependentM8` (new, `m8IndependentInterpretation.mjs`) opens the authenticated accepted-line source, takes the native-verified owner/turn identity from `turn.m2Capture.memoryIdentity()`, and asks the P2 M8 reader for a projection. It runs **after M5**, so a durable forget/correction is already committed and a pre-command interpretation is never sent.
4. `composeIndependentForegroundMemory` carries the M8 result beside the others with its **own** stamp and **own** verification latch.
5. PS4 (`finalizeKnowledgeFrame`) admits M8 into the existing frame when it is ready. It no longer requires M4 to have produced a recall frame.
6. On every model attempt and at the final-send fence `verifyPrepared()` re-reads P2 (suppression, correction overlays, source bytes/sidecars, the whole-history seal) and re-checks the live native identity and the P2 read fence. Any failure latches M8 invalid for that request; nothing falls back to RAM or cached interpretations.

An absent/empty `memoryK.capabilities` map keeps the inherited combined WS6 path unchanged, where M8 stays coupled to M4. `memory.interpretation` modes are `off|on`; `shadow` is reported `shadow_not_supported` and reads nothing.

## GTA-testable configuration (M8 only)

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

* `memory.dialogue.player` must be `on`. It supplies the accepted-player-line identity M8's reader needs (the same prerequisite H1, H2 and M5 have). Without it `memory.interpretation` reports `blocked` with `dependency_not_requested_or_available:memory.dialogue.player` and reads nothing. `memory.dialogue.npc: "on"` lets the NPC's *completed* replies count as evidence; it is not a prerequisite.
* To combine with other consumers, switch `memory.journalContext`, `memory.recall` and/or `memory.commands` to `on`. Each contributes independently.
* Set `memory.interpretation` to `"off"` (or omit it from an explicit map) to keep M8 completely stopped: no M8 P2 read, no frame section. M2 recording and every other consumer are unaffected.
* Restart-required, like the other Memory K switches. `memory.events: "on"` additionally lets witnessed in-world events (crashes, rescues, music) become interpretable evidence; it is optional.

## How NPCs differ: approved personality, not a new personality system

P2 stores personality as `{description, traits[]}` only. M8's evaluator reads structured inputs (humor style, caution, loyalty, nostalgia, bravado, interests). Before this slice the production reader passed the P2 object straight through, so **every NPC silently received M8's defaults** and two NPCs could never interpret the same facts differently.

`m8PersonalityCanon.mjs` is a small, closed, exact-match mapping from the **editor-approved `traits`** to those inputs. Free-text `description`, model output and relationship guesses are never parsed; unknown traits are ignored; nothing is written back to canon.

| Approved trait(s) (case-insensitive, exact) | M8 input |
| --- | --- |
| `goofy`, `sarcastic`, `dry`, `dark`, `wholesome` (first listed wins) | `humor.style` |
| `teasing` | `humor.teasing = 0.7` |
| `cautious` / `reckless` | `caution = 0.85` / `0.15` |
| `loyal` | `loyalty = 0.9` |
| `nostalgic` | `nostalgia = 0.9` |
| `bold` / `timid` | `bravado = 0.85` / `0.15` |
| `cars`, `music`, `food`, `travel` | `interests` |

Example (same two recorded lines, different approved canon): a `sarcastic` NPC says *"I find that joke deliciously dry."*; a `cautious` NPC says *"I am not sure that joke is funny."*; an NPC with none of these traits says *"I find that funny."*

This vocabulary is a **proposal** the owner may reshape; the evaluator's behavior per input is unchanged.

## Authoritative canon and facts stay separate

* Canon (`SELF.canon`), witnessed facts and recalled evidence keep their lanes. Interpretations live in their own typed lane, every item is `epistemicStatus: "character_opinion"`, `verifiedWorldFact: false`, and carries `sourceEvidenceIds`; the relationship block reports `canonRelationshipUnchanged: true` and never edits `relationship.state` or personality.
* Running jokes carry `callbackOptInRequired: true`; L adds no callback path. PS6/Director remains the only callback authority.
* Suppression, correction, source revocation, identity, timeline and final-send verification are the existing M8 reader's, re-run per attempt (see flow step 6).

## Isolation guarantees (tested)

* M8 off ⇒ the M8 snapshot SQL is never executed; the same mid-request forget/boundary hooks that abort an M8-on turn leave an M8-off turn untouched.
* An M8 failure drops only the opinion lane. It never invalidates H1, H2 or M5, and a failing H1/H2/M5 contributor does not remove an otherwise current M8 lane (each has its own authority and latch). Inconsistent H1/H2 stamps no longer discard M8.
* A source revoked between preparation and send aborts before any provider HTTP request.

## Diagnostics

`services.memoryInterpretationDiagnostics()` (published under `memory.interpretation` in the runtime diagnostics, replacing the previous "wiring pending" placeholder) returns `requestedMode`, `state` (`ready | waiting | blocked | unavailable | stopped`), `reason`, `lastPreparation/lastValidation`, `contributedToModelRequest` and `requestAttempted`. It never contains player text, interpretation content, identifiers or exception messages. In the legacy combined path it reports `waiting` / `coupled_to_m4_recall_legacy_path`.

## Shared changes outside the new files

* `lsa-shared-brain/src/memory/m8Interpretation.mjs` — **bug fix found by the new tests.** `trimProjection` trimmed against a 1-digit `totalBytes` placeholder; when trimming stopped within a few bytes of the cap, the final multi-digit total exceeded `maxBytes` and `preparePs4M8` dropped the entire projection as `invalid_p2_projection` (the opinion lane silently vanished for that turn). It now trims against a worst-case-width placeholder. This also affects the legacy combined path. Regression test: budget-boundary sweep in `m8IndependentInterpretation.test.mjs` (fails without the fix).
* `capabilityPolicy.mjs` — `memory.interpretation` now declares its real dependency on `memory.dialogue.player`.
* `knowledgeDelivery.mjs` — the awaited `verifyPrepared()` also runs for frames that carry an `opinionStamp`, not only a `memoryStamp`; otherwise an M8-only frame would never be re-verified before the request.
* `independentForegroundMemory.mjs` — optional M8 contributor with an independent latch.
* `p2M8ProductionRead.mjs` — personality canon mapped as above.
* `bootstrap.mjs` — registration and operational state come from the real M8 diagnostics seam.

## Known limits

* **Evidence breadth.** M8 interprets what its categories recognise (gratitude, "inside/running joke", crash/rescue/blunder/music events). Ordinary conversation produces no interpretation and no frame section; this is a deterministic classifier, not open-ended understanding. Witnessed-event categories need `memory.events` (M3) to have recorded them.
* **Jokes need a recurring motif** (two or more matching lines). A single joke line yields an opinion but no running joke.
* **Personality vocabulary is intentionally small** (table above). Richer personality evolution is explicitly out of scope for this slice.
* **Requires the M2 accepted-line identity.** It cannot run on stock Gemini or without `memory.dialogue.player`.
* **Budget.** The projection is capped at 2048 bytes inside the shared PS4 frame budget; with a lot of evidence the oldest/lowest-priority items are trimmed, never truncated mid-item.
* **200 ms reader deadline (inherited).** `preparePs4M8` drops the optional frame if the P2 read exceeds 200 ms (`unavailable_or_deadline`); that turn proceeds with the base frame and the diagnostics show `unavailable`. The scan is bounded (128 recent lines/events plus source-linked memories) but was not load-tested for L on a very large retained history.
* **Original scenario S06 remains an intentional source-blocked gate** (`assert.fail('SOURCE_BLOCKED_S06…')` until original native receipts exist). L adds offline same-facts/different-personality coverage; it does not close S06 or any of the 10 original scenarios.
* **Not GTA-validated.** No live-game run was performed for this change.
