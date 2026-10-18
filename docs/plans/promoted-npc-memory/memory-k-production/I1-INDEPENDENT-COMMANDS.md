# I1 — independently activatable M5 conversational memory commands

**Target:** PR #138 integration branch only. **Not:** `main`, GTA deployment, S01–S10 acceptance, or physical validation.

## What I1 does

`memory.commands: "on"` now runs the **existing** M5 coordinator in the real foreground turn with **H1, H2, M8, M6/M7 and M3 all off**. Nothing was rebuilt: it reuses `createM5RuntimeCoordinator`, the explicit-command parser, `createM5SqliteServices().bindCommands()` (serialized P2 ports, verified readback, durable clarification, atomic two-command batch) and the authenticated accepted-line source opener (`openH1ConversationSource`, the D01/D02/D03 source check — it is only a source opener; H1 history is not prepared).

Flow for one accepted player turn (`prepareLiveTurnMemory`, explicit capability map only):

1. `mayBeM5PlayerInput` (exported from the M5 coordinator, also now used by the legacy path) decides — with **no store access** — whether the exact accepted bytes could be a command or a durable-clarification reply. Ordinary conversation and casual "remember when…" never reach SQLite.
2. M5 opens the authenticated source, runs the coordinator, and commits through the P2 command port. **M5 runs before H1/H2 prepare**, so any remember/forget/correct is durable before H1/H2 read; a pre-command snapshot is never sent.
3. Only the coordinator's verified statuses (`saved|forgotten|corrected|clarify|failed`, `durableCommit`) become `SELF.memoryAction` in the single PS4 frame. This no longer depends on H2 recall being ready.
4. On every model attempt and at the final-send fence, `verifyPrepared()` re-reads each claimed success from durable SQLite (`verifyCommand`) and re-checks the source and the P2 read fence. Any failure drops all optional memory (including H1/H2) and denies stale retries; it never falls back to unverified RAM.

An absent/empty `memoryK.capabilities` map keeps the inherited combined WS6 path unchanged. `memory.commands` modes are `off|on` (shadow is rejected at config load).

## GTA-testable configuration (M5 only)

```json
{
  "memoryK": {
    "capabilities": {
      "memory.dialogue.player": "on",
      "memory.dialogue.npc": "on",
      "memory.journalContext": "off",
      "memory.recall": "off",
      "memory.commands": "on",
      "memory.interpretation": "off",
      "memory.events": "off",
      "memory.coverage": "off"
    }
  }
}
```

M5 together with H1/H2: set `memory.journalContext` and/or `memory.recall` to `on`. `memory.dialogue.player` must be `on` (otherwise `memory.commands` reports `blocked`/`missing_dependency`).

## Diagnostics

`services.memoryCommandDiagnostics()` (also published under `memory.commands` in the runtime diagnostics) returns `state`, `reason`, `lastPreparation/lastValidation`, `contributedToModelRequest`, and a closed `code`:

| `code` | Meaning |
| --- | --- |
| `disabled_by_configuration` | `memory.commands` is off |
| `missing_dependency` | player-dialogue prerequisite, P2 SQLite or provider unavailable |
| `source_unavailable` | accepted-line / owner / timeline / host authority missing or revoked |
| `command_not_recognized` | ordinary conversation (no command) |
| `clarification_required` | durable clarification opened, nothing destructive written |
| `durable_command_success` | verified SQLite readback |
| `command_failure` | commit or readback failed |
| `private_editor_required` | inspect/export request: contents never enter speech or PS4 |

Diagnostics never contain player text, memory content, identifiers or exception messages.

## Small shared changes

* `m5RuntimeCoordinator.mjs`: export `mayBeM5PlayerInput` (the same gate the legacy path used inline).
* `recallEvidencePolicy.verifyReferenceVisibility`: also recognises an M5 **correction** record (`memory_corrections`, content-hash checked, still subject to suppression/supersession) as a retained derivative, like `memory_records`. Before this, H2 recalling a corrected statement failed its own source verification and the composer then discarded H1 as well. Found by I1 test 6.
* `independentForegroundMemory.mjs`: composes an optional M5 contributor with H1/H2 under the same source-stamp rule.
* `bootstrap.mjs`: `memory.commands` registration now reflects the real M5 diagnostics seam.

## Known limits (be honest at the smoke test)

* **Parser surface is the existing M5 parser.** "Actually, I meant that …" (leading "Actually,") is **not** recognised and flows as ordinary dialogue with no write (documented by test 14). Recognised correction forms include "No, I said …", "I meant …", "Correct that to …".
* **Transcript corrections ("No, I said …") only target a player line that came from the microphone (STT).** For a typed line use "Correct that to …" (counter-claim), which may ask which memory you mean because recent NPC replies are also candidates.
* **Forget matching requires all content words of the topic to appear in the target.** "Forget that I told you about my old job." matches an earlier line that contains "told", "old" and "job". "Forget what I said about my old job." matches an earlier line containing "old" and "job".
* **Source unavailable ⇒ no `memoryAction`.** If the accepted-line authority is missing the model gets no command status at all (as in the legacy path), so dialogue can still sound agreeable; nothing durable is written or claimed.
* Forgetting an NPC reply also suppresses identical-content NPC replies (existing M5 closure behavior).

## GTA smoke test (reversible; do not deploy automatically)

1. Back up the plugin folder and `profiles.v2.sqlite`; apply the M5-only configuration above; restart the companion.
2. Check `memoryCommandDiagnostics()`: `state:"waiting"` until the first accepted turn.
3. Promote an NPC. Say (mic or typed): **"Remember that I prefer black coffee."** Expect the NPC to confirm and diagnostics `code:"durable_command_success"`, `contributedToModelRequest:true`.
4. Say normal chatter and **"Remember when we robbed the bank?"** Expect an ordinary reply and `code:"command_not_recognized"`.
5. Say by **mic**: "My favorite color is blue." then "No, I said my favorite color is green." Expect a corrected acknowledgement.
6. Say by mic or typed: "I told you about my old job at the lumber yard." then **"Forget that I told you about my old job."** Expect a forgotten acknowledgement; restart the game/companion and confirm the NPC does not know it.
7. Say **"Forget that"** with two similar recent lines to see a clarification, then "the first one".
8. Say **"Export my memories."** Expect no memory contents in speech.
9. Switch Franklin → Michael and repeat step 3 with a different fact; it should be remembered once, attributed to the avatar that said it.
10. Enable `memory.journalContext`/`memory.recall` and repeat 5–6; forgotten/superseded text must not appear in the NPC's answers.
11. Roll back by restoring the backup and removing the capability map.

No GTA validation is claimed by this document or by the offline tests.
