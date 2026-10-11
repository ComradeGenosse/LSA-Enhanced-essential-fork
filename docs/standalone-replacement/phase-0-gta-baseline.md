# Phase 0 — exact installed GTA baseline and safe first-deployment capture

**State: pre-deployment gate, not executed here.** Source repository and supplied Essential DLL do not reveal the exact currently installed GTA executable, RAGE version, native add-on binaries, effective settings, speakers/audio device or live playback. An installer/backup manifest must be captured *locally* before the first standalone GTA experiment. This gate does not block Phase 1 source implementation.

## Passive fingerprint capture (read-only)

Use the repository's `tools/standalone/capture-installed-baseline.ps1` on Windows PowerShell 5.1 or later:

```powershell
powershell -NoProfile -File .\tools\standalone\capture-installed-baseline.ps1 -GameRoot "C:\path\to\Grand Theft Auto V Enhanced"
```

This prints JSON with **relative paths and SHA-256 fingerprints only** for `GTA5_Enhanced.exe`, RAGE executable/DLL, Essential core and selected P2 binaries. Missing files appear as `present:false`. It deliberately **does not open configs, profiles, keys, logs or audio captures**, and it never alters the game. Optional `-OutputPath` writes the JSON to a **new** local file in an existing directory; existing files are never overwritten. The game-root absolute path is not included in the JSON. Review any generated evidence before sharing it.

The script is staged on GitHub and **has not been run against the user's GTA installation**. No observed file fingerprint should be invented.

## Runtime baseline scenarios (must use exact same installed manifest)

Save a local copy/rollback plan for the existing installation and preserve encrypted/private config and character profiles **locally**. Document relative file paths, SHA-256, config feature flags without credentials, GTA version, RPH version, plugin versions and the output device/sample rate.

| ID | Scenario | Matching evidence for later standalone comparison |
| --- | --- | --- |
| E-01 | New typed turn to selected NPC | source=player_text, actual target/owner, fresh tuple, one player history entry, matched playback terminal |
| E-02 | Voice PTT Talk/UX4 | one source-time press/release; one native mic and STT; exact turn and target; no duplicate result |
| E-03 | One long/segmented spoken NPC answer | authorization before PCM; chunk order, one EOS, audible start/end, committed assistant history exactly once |
| E-04 | Player interrupts NPC, then speaks again | correct old-generation cancel, no stale chunks/history/actions, new input accepted |
| E-05 | Two nearby promoted characters / summon | stable character profiles but distinct actor incarnation/session; one targeted answer at a time |
| E-06 | Follow/wait and vehicle seat entry | actual movement and seat occupancy, no false dispatch=completion |
| E-07 | Gunfire/combat interruption and gaze | actual physical yielding, continued safety/ownership, no unauthorized head/task clear |
| E-08 | World reset, restart, disconnected Node | old run/world turn retires, no late action/audio/memory commit |
| E-09 | Director/spontaneous speech when enabled | bounded admitted proposal, exact playback, no fake player speech and no action side effects |
| E-10 | Radio/proximity/ballistics if a given branch is actually installed | qualified sensor and witness receipts; absence of evidence remains unknown rather than invented |

Capture game/RPH/companion diagnostic lines with **run/turn correlation IDs**, timestamps, hashes, permitted actor-ref descriptions, pass/fail and reasons. Trim/redact raw transcripts, personal files, API keys and unrelated mods. Do not upload game binaries or the original Essential assets into the PR.

## Rollback checklist for the first GTA experiment

- Two **mutually exclusive install profiles**: old Essential-based working setup vs new standalone candidate; never allow both plugin controllers to drive the same game session.
- Verify backup restore by checking hashes of the old core + patched Node bundle and local profile metadata. Do not overwrite P2 character data during migration tests.
- Standalone installer initially deploys to a distinct plugin/companion directory and uses an explicit opt-in. Detection of Essential's active runtime should refuse startup before any NPC ownership acquisition.
- On failure, terminate GTA safely, restore the old complete profile, and verify its hashes/settings against the baseline.
- Acceptance remains open until the **actual** standalone RAGE plugin is tested in GTA; offline mocks and simulated audio cannot close it.

## Capture ownership and scheduling

The user/operator with the actual GTA installation must generate the installed manifest and physical traces when preparing the first standalone deployment (Stage 5). This is an **external integration gate**, not an unresolved question about the feasibility architecture. The Phase 1 branch can proceed before these real-game artifacts are collected, but a deployment PR must state they are missing until supplied.

See [Phase 0 acceptance register](phase-0-acceptance.md) and [audio/host feasibility](phase-0-audio-host-licensing.md).
