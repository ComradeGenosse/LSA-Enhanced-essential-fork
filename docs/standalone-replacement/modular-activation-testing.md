# Standalone GTA modular runtime activation

Integration target: draft PR #50, feature/standalone-gta-typed-smoke-gate. This
is a GTA *test candidate*, not Essential parity or physical GTA acceptance.

## Select one stage without rebuilding

Install the CI smoke ZIP once with Install-Standalone.ps1, following the
existing create-only, backup, legacy exclusion and rollback instructions in
tools/standalone-gta-smoke/README.md. Each test stage runs with the same native
DLLs and companion source. Close GTA and RPH completely before changing stages
and relaunch; this is NOT a live hot-toggle of NPC leases.

| -Stage | Activated by configuration | Manual GTA test |
| --- | --- | --- |
| host (default) | Native host, IPC, diagnostics only | Check RPH native startup and Node pipe handshake; no actor probe or API keys |
| probe | Host + NPC actor probing | Probe; check decorator/address/cookie and 8 stable observations in 750ms; cannot arm |
| typed | Probe + typed model conversation, NO TTS | Fresh same-session Probe, Arm, then Ask/Compose |
| tts | Typed + TTS/PCM escrow, NO physical output | Check PCM sealed/buffered_not_played; no audibility claim |
| audio | TTS + experimental waveOut physical output | Requires -ConfirmPhysicalEffects; physically hear GTA sound |
| lipsync | Audio + experimental facial gesture | Requires -ConfirmPhysicalEffects; see correct NPC mouth |
| streaming | TTS + early streamed segments, WITHOUT waveOut/lip-sync | Compare segmentation and interruption separately |

Host and native diagnostics are invariant safety/health capabilities.
Selectable capabilities are actor_probing, typed_conversation, tts,
physical_audio, lip_sync, and early_speech. The registry and prerequisite
graph are in lsa-standalone-companion/src/activation/capabilities.mjs.

### PowerShell examples (in extracted ZIP folder)

    .\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced'
    .\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced' -Stage probe

Host and probe stages require NO AI model, TTS model or API credentials.
For typed and higher, set OPENAI_API_KEY in the current terminal (never
save in the ZIP), and pass actual API-accessible model IDs:

    .\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced' -Stage typed -Model '<Responses API model ID>'
    .\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced' -Stage tts -Model '<API model>' -TtsModel '<PCM speech model>'
    .\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced' -Stage audio -Model '<API model>' -TtsModel '<PCM speech model>' -ConfirmPhysicalEffects
    .\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced' -Stage lipsync -Model '<API model>' -TtsModel '<PCM speech model>' -ConfirmPhysicalEffects
    .\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced' -Stage streaming -Model '<API model>' -TtsModel '<PCM speech model>'

Early speech and lip-sync are independent controls, not tied together.
Optional deliberate combination, AFTER testing them alone:

    .\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced' -Stage streaming -Model '<API model>' -TtsModel '<PCM model>' -EnableCapability physical_audio -ConfirmPhysicalEffects

- EnableCapability and DisableCapability take the names above. Missing
prerequisites fail preflight (they are not implicitly switched on). For
example typed + physical_audio fails because TTS was not enabled, as does
audio -DisableCapability tts. Host diagnostics may not be disabled.
- Legacy -EarlySpeech is an alias for enabling early_speech. Legacy
-ActorMode, if explicitly supplied, must match the stage-derived native mode.
- Faster Qwen3 TTS still supports -TtsProvider faster-qwen3-tts, -Voice
and -QwenUrl with a separately running local sidecar. It is NOT shipped here.
- The launcher explicitly sets ALL original native/companion feature
switches, clearing stale inherited feature state. Native independently
validates the switches even if the launcher is bypassed. The default is
no actor adoption and no physical effects.
- Model credentials and model IDs are only required once typed processing
is selected. The RPH native actor adoption gate STILL requires a successful
same-session manual Probe and Arm; flags alone never grant ownership.
- Physical effects cannot initialize through the supplied launcher
without the -ConfirmPhysicalEffects switch. Only the native game fiber
may use active actor leases; address/cookie/incarnation, generation,
cancellation and world checks remain enforced.

## Diagnostic status and evidence definitions

The launcher preflight prints configured requested capabilities but does
not start native objects. Companion activation_capability records contain:
configured, available (implementation included, NOT device availability),
configurationReady, activated (observed local adapter or pipe condition),
blocked, operational (what evidence actually occurred), and gtaValidated.
All offline-produced gtaValidated fields MUST remain false.

The real native RPH logger writes [LSA-ACTIVATION] with initialized IPC,
typed admission, waveOut adapter and facial presenter status. The game
console LSAStandaloneStatus also prints the actual probe state and
adoption status. A successful Node pipe handshake may be from a harness,
not GTA. A native playback receipt proves device progress, not that a
listener heard it. PCM EOS is NOT physical playback; a facial presenter
constructed is NOT proof of working mouth motion.

## Live GTA acceptance ledger (one row per stage and test session)

Record the following in a local test note for each capability:

| Field | Evidence to capture |
| --- | --- |
| Artifact | Exact CI SHA and ZIP checksum, GTA Enhanced build and RPH version |
| Isolation | Actual RPH plugin load list with Essential/legacy controllers absent |
| Stage | Selected stage and overrides, provider/model identifiers without secrets |
| Native | [LSA-ACTIVATION], LSAStandaloneStatus, probe status, same-session Arm/Disarm, despawn/reuse results |
| Companion | activation_capability events, native connect/disconnect, staged typed/PCM/stream/audio receipts |
| Physical GTA | Intended NPC output, mouth, audibility, disarm cancellation, device interruption, PASS/FAIL/NOT TESTED separately |
| Return to Essential | GTA/RPH exited, Undo checked all hashes, then off-game backups restored |

Test host first, then probe, typed without speech, sealed PCM, physical
sound, lip-sync, and separately streaming. For every later GTA session,
repeat the in-game probe/arm and inspect actor identity. Preserve full
timestamped but redacted logs. Never mark GTA acceptance PASS based
only on GitHub Actions.

Run Undo-Standalone.ps1 after GTA/RPH exit to remove ONLY the three
manifest-owned files. Restore legacy controllers from your verified
off-game backup ONLY after successful Undo. Install/Undo do not touch
original LSA configurations, saves, SQLite data or unrelated mods.

## CI and future registration

Offline Node tests cover preset isolation, dependencies, invalid direct
environment flags, credential gating, stale-effect clearing and
preflight output. Windows CI compiles host/native authority, exercises
fake IPC and audio receipts, packages preflight with the same ZIP and
tests create-only install and rollback. None of it proves GTA behavior.

Future microphone/STT, promoted-character memory, actions, perception
and spontaneous speech may be added to the capability graph with their
own prerequisites, environment/native binding, and runtime evidence;
they are NOT implemented or selectable here. A registered capability
must never bypass actual native actor authorization.
