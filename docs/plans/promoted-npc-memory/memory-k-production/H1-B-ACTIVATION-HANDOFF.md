# H1-B — independent SQLite journal activation handoff

**Integration:** PR #175 stacked on H1-A #172 (base SHA `e94f073323530df3327c63a104e6c0fb0122959a`). Future integration destination: #138. No merge, native changes or deployment.

## Behavior before and after

| Mode | Before on H1-A | After H1-B |
|---|---|---|
| Explicit `memory.journalContext=on`, M2 on, M4/M5/M8 off | Combined-memory gate suppresses H1 contribution | Original D01/D03 accepted player turn calls H1-A directly, PS4 projects verified CONVERSE |
| Explicit H1 off | Combined memory gate off | No H1 reader/model work, persistent SQLite characters never use stale RAM history |
| Explicit H1 shadow | Descriptive policy only | Requested mode reported as unsupported, no model contribution |
| No explicit map | Existing combined WS6 path | Same combined preparation, model-frame assembly and privacy/retry fences |
| H1 off / M4 requested on | Not yet independently activated | H1 does not gate it; M4 still needs separate H2 activation/integrator work |
| Source invalid/missing | Denial / no RAM substitution | Same denial, with independent H1 prep/revalidation diagnostics |

## Valid H1-only configuration

```json
{
  "memoryK": {
    "capabilities": {
      "memory.dialogue.player": "on",
      "memory.dialogue.npc": "on",
      "memory.journalContext": "on",
      "memory.recall": "off",
      "memory.commands": "off",
      "memory.interpretation": "off",
      "memory.events": "off",
      "memory.coverage": "off"
    }
  }
}
```

M2 accepted-player recording is required: `memory.journalContext` depends on `memory.dialogue.player`. Unspecified sibling capabilities stay off. H1-A owns `prepareH1ConversationHistory` and its source proof, suppression, corrections, P2 bounded reads, and `verifyPrepared/sendCurrent`. Neither its H1-A module nor the H2 module was modified.

## Foreground path

1. Original typed/final STT input is accepted through D01; M2/D03 persist exactly the accepted player line.
2. The original `runSequentialTurn` calls `services.prepareLiveTurnMemory` only when D03 returned a durable receipt. Missing receipt updates denial diagnostics without opening the optional reader.
3. With explicit H1 on, `essentialGlue` calls the extracted H1-A one-call adapter, **not** the coupled M4/M5/M8 bundle. With off/shadow the reader is not invoked.
4. The existing one PS4 `renderKnowledge` call receives the validated P2 CONVERSE recent/labelled archive structure and uses the existing history and whole-frame budgets. Current accepted input stays the sole current message. P2 persistent conversations never fall back to RAM history.
5. Before every provider attempt and the actual request boundary, existing `knowledgeDelivery` awaits H1-A `verifyPrepared` and checks the last synchronous `sendCurrent` fence. Before first send, invalid optional history is pruned to the safe base. An invalidation after a request already went out aborts stale retries rather than sending a changed body under the original request identity.
6. Diagnostics preserve requested/effective mode, status/reason, last preparation and last validation result, and model-contribution flag. The flag is set only at validated request admission when prior journal dialogue survived PS4 budgeting; no transcript bytes are logged.

## Scoped validation

- `lsa-essential-e1-candidate/tests/memory/h1IndependentActivation.test.mjs`: H1-only original runner, H1 off/no optional work, H1 off/M4 requested independence boundary, protagonist continuity, missing durable authority, source reader denial, pre-send forget, retry/revocation and unsupported shadow.
- Existing H1-A and unmodified original WS6, D01/D03, E2 and M2/composition regressions, Linux and Windows.
- `.github/workflows/memory-k-h1b-activation.yml` runs the scoped matrix, compares original tests against the exact stacked H1-A base via a separate CI worktree, and uploads TAP logs.
- GitHub Actions status must be read after jobs actually finish. Neither a created workflow nor passing focused H1 tests establishes physical GTA, native packaging, or full S01-S10 acceptance.
- The inherited 10,000-write Windows source-starvation stress limitation remains **informational** and unchanged; no original assertion was edited.

## Limitations and coordination

- **H2 is separate**: an explicit `memory.recall=on` request with H1 off does not yet produce independently activated M4 PS4 recall. The H2 owner/integrator must wire PR #173; do not misreport this as complete H2 acceptance.
- A validated H1 history that loses source authority after its first model send cannot be silently used on retry. The existing request identity/revision guarantee causes safe cancellation; a fresh accepted turn can continue without stale history.
- `shadow` is explicitly unavailable.
- H1-C owns exhaustive replay/privacy adversarial testing and should review every fence.
- Offline native socket, provider and speech stubs are *not* a real GTA deployment receipt.
- Worktree isolation was performed by the CI parity job; implementation commits were written to the isolated feature branch using GitHub APIs, not a local shell worktree.

## Integration handoff

After #172 merges into #138, let the #138 integrator rebase/retarget #175. Resolve any shared-seam drift on the latest original runner. Review H1-C and H2 separately. Run both Windows/Linux original-runner, WS6, M2/D03, E2, PS4 and parity gates, then native GTA compile/package and physical gameplay tests at #138 release acceptance. **Do not merge #175 automatically.**
