# H1 + H2 foreground MVP activation checkpoint

**Target:** PR #138 integration branch only. **Not:** main, GTA deployment, whole Memory K acceptance.

## Implemented activation

One original accepted typed/final STT turn enters the D01/D03/M2 durable P2 line. The existing sole PS4 model frame independently receives:

- H1 conversationJournal when `memory.journalContext=on`.
- H2 factual recall `preparedRecall` when `memory.recall=on`, even if H1 is off.
- Both when both are requested and the independently verified source stamps agree.

The unrelated M5 command processor, M8 interpretation, M6/M7 workers and PS3 salience do not run on the explicit H1/H2 path. The empty/absent memoryK capability map retains the legacy combined WS6 path.

Before first body composition, `runSequentialTurn` awaits the optional foreground source verification. Before each send or retry, the existing HTTP/PS4 knowledge-delivery gate awaits verification again and uses one synchronous source/read-fence check immediately at request submission. A failed proof discards optional memory before initial send or denies stale retries; it never switches to unverified RAM history.

## GTA-testable H1 + H2 configuration

```json
{
  "memoryK": {
    "capabilities": {
      "memory.dialogue.player": "on",
      "memory.dialogue.npc": "on",
      "memory.journalContext": "on",
      "memory.recall": "on",
      "memory.commands": "off",
      "memory.interpretation": "off",
      "memory.events": "off",
      "memory.coverage": "off"
    }
  }
}
```

For H2-only, use `memory.journalContext=off`. For H1-only, use `memory.recall=off`. Both off is inert for optional memory; `shadow` is unsupported and reports `shadow_not_supported` rather than claiming a working shadow mode.

## MVP readiness gates (required before physical GTA deployment)

1. Original D01/D03/D02 accepted line (not a synthetic user-created receipt) persists in the one P2 SQLite writer and is successfully projected through PS4 for H1-only, H2-only and both combined. Verify the actual outgoing provider request contains the relevant grounded source.
2. A previous utterance remains available after host restart and when switching among Franklin/Michael/Trevor, without leaking another promoted NPC's conversation.
3. Forget, correction, denial, suppression, disconnect, owner swap, timeline change and retry never expose stale memory; diagnostics distinguish ready, abstained, unavailable and blocked.
4. An empty capability map remains legacy-compatible, H2/H1 off stays inert, and explicitly disabled M5/M8 stay off. Accepted current input appears exactly once.
5. Windows/Linux original-runner/WS6/D01/D03 and relevant privacy tests are green, with any inherited failures documented without weakening conditions. Test inventory and native net481 build/package also pass.
6. Install in a reversible GTA test environment, verify actual NPC dialogue/recall and source diagnostics during gameplay, and capture latency/log evidence. **Do not deploy automatically** or mark original S01–S10 release acceptance complete from offline fixtures.

## Scoped CI

`.github/workflows/memory-k-h2-foreground-activation.yml` exercises independent H1, H2, combined original runner and revocation/forget on Windows and Linux. These are scripted native/provider boundaries: no physical GTA playtest is claimed. PR CI can be queued or red even when focused tests pass; inspect steps and raw logs on the exact commit.

## Important existing limitation

The original 10,000-write Windows heartbeat starvation is an accepted personal-mod stress limitation, not an ordinary-turn functional gate. It remains recorded and unchanged; do not relabel a failure as a pass.
