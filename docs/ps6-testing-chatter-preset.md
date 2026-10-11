# PS6 spontaneous speech — testing chatter preset

The Director's pacing thresholds are implemented in JavaScript, not currently editable individual values in `e1.config.json`. This patch introduces a **named preset** selected in the config that is loaded when the companion starts.

For an **already deployed experimental Director installation**, change only its existing `spontaneousSpeech` object:

```json
"spontaneousSpeech": {
  "mode": "experimental",
  "preset": "testing"
}
```

Leave `intelligence.mode` set to `shadow` and preserve the other existing deployment settings. Restart the companion/server after editing `e1.config.json`.

| Limit | `normal` (default) | `testing` |
| --- | ---: | ---: |
| Routine speaker cooldown | 20 seconds | 5 seconds |
| Urgent speaker cooldown | 5 seconds | 2 seconds |
| Scene-wide gap | 8 seconds | 2 seconds |
| Companion attempts per minute | 4 | 4 (**native C# maximum**) |

**Scope and safety:** The independent native C# `DirectorAdmission.MaxAttempts=4` is unchanged; this preset therefore cannot produce more than four native reserve attempts per minute. PS3 same-event suppression, event age/TTL, native one-shot lease, actor/player ownership and arbitration, and all audio-delivery checks are unchanged. This is for testing responsiveness to multiple *distinct supported observations*, not a promise that every gunshot gets a reaction.

To restore original behavior, change `"preset": "normal"` (or omit it) and restart. If a higher-than-four native attempt rate is desirable, that needs a separate, explicitly gated native change, rebuilt DLL and GTA acceptance.
