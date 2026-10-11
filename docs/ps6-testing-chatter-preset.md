# PS6 spontaneous speech — testing chatter preset

The Director's behavioral pacing is now a **strict opt-in testing preset**. It is not a change to the normal production limits.

## Enable 12 attempts/minute

Both the companion and the native C# host enforce a separate minute budget. After installing a **rebuilt native DLL and companion** containing this patch, configure **both** files before launching GTA.

1. Your existing `plugins/LosSantosAliveServer/e1.config.json`:

```json
"spontaneousSpeech": {
  "mode": "experimental",
  "preset": "testing"
}
```

Keep `intelligence.mode` set to `shadow`, along with all existing identity, voice, and knowledge settings.

2. Your existing **`plugins/LSA.PromotedCharacters.json`**, inside its `intelligence` object:

```json
"intelligence": {
  "mode": "shadow",
  "pipeName": "LSA.Intelligence.v1",
  "directorMode": "experimental",
  "directorAttemptPreset": "testing"
}
```

Preserve the rest of that native file, notably `enabled`, `worldProfileId`, `pipeName`, `identityPipeName`, `activities`, and any other installed fields. Restart **GTA/RAGE and companion/server**, since the native preset is read during GTA startup. The RAGE log should include `[PS] director_native_attempt_limit=12` when active. Missing or invalid native preset, or a nonexperimental native Director mode, retains a four-attempt cap even if the companion requests twelve.

| Limit | `normal` | `testing` |
| --- | ---: | ---: |
| Routine speaker cooldown | 20 seconds | 5 seconds |
| Urgent speaker cooldown | 5 seconds | 2 seconds |
| Scene-wide gap | 8 seconds | 2 seconds |
| Companion maximum attempts per minute | 4 | 12 |
| Native maximum reserve attempts per minute | 4 | 12 |

Only *one* original Essential speech turn may be reserved at a time. The native 12 cap counts unsafe attempts too. Not all 12 requests will produce speech. PS2 observation TTLs, PS3 same-incident suppression, one-shot ticket lease, world/owner/player identity, C-06, native Core playback receipts, and other safety checks are **unchanged**.

To restore normal mode, change both presets to `normal` (or omit them) and restart GTA and the companion. The shipped example files remain disabled by default with normal limits.
