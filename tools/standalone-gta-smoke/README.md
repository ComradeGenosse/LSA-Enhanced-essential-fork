# LSA independent GTA Enhanced — progressive standalone test package

**Default: safe host/IPC diagnostics only.** Select -Stage host, probe, typed,
tts, audio, lipsync or streaming with Start-Standalone-Test.ps1. Physical audio
and facial effects require **-ConfirmPhysicalEffects**. Every stage uses the
same DLLs/companion; close and relaunch GTA/RPH between stages, without rebuilding
or changing installed files. No stage grants NPC control without in-game probe
and (for typed/voice) manual Arm.

**Read [modular activation and per-stage GTA acceptance](modular-activation-testing.md)
first.** The model and TTS are only required at their respective stages.
Offline CI does not prove RPH loading, NPC identity reuse, audio audibility
or lip-sync. A correctly refused startup is a safe outcome.

## Before touching the game

1. You can test with either **a separate isolated GTA V Enhanced/RPH profile** (`-IsolatedProfile`) or **your existing GTA installation after manually moving legacy LSA controllers out** (`-ExistingInstallation`). Both require `GTA5_Enhanced.exe` and `RAGEPluginHook.exe`. In either mode, **no Essential controller or its dependent loaders/bridges may be loaded**. The installer and launcher check known paths; you must also inspect the RPH plugin load list for renamed/unrecognized copies. Never rename an Essential DLL to bypass exclusion. RPH must be authorized/licensed separately.
2. On the PR GitHub Actions page, download the `standalone-gta-smoke-<SHA>` artifact and extract its ZIP to a non-game folder such as `C:\LSAStandaloneSmoke`. The ZIP contains **our two DLLs**, independent Node companion and `Install`, `Start`, `Undo` scripts; **no** RAGE/Essential files, voice models, game binaries or API secrets.
3. Install Node.js 22. Host/probe testing requires no OpenAI model or key. When advancing to typed mode, verify your OpenAI Responses API model ID; when advancing to TTS, also verify your PCM TTS model. The in-app ChatGPT model name does **not** establish an API model ID; put an API-accessible Luna/model ID into `-Model`. Obtain an OpenAI API key yourself and set it only in the terminal session: `$env:OPENAI_API_KEY='...'`. Do not commit or screenshot it. Local Qwen instead of OpenAI TTS is optional and requires your separate sidecar to be running.

## Same GTA installation: temporarily remove only the LSA controller

**This is an opt-in manual procedure, not a second GTA copy or an automatic uninstaller.** Neither the installer nor the standalone rollback touches your existing LSA files. Close GTA, RPH and the original LSA Node server first.

1. **Back up outside the GTA tree** your current `Plugins/LosSantosAlive.dll` and any installed optional native addon/bridge files listed below. Also separately preserve `Plugins/LosSantosAliveServer/` (including private `.env` and possible SQLite data), `Plugins/LosSantosAlive/`, any `Plugins/NPCGeminiFiles/`, P2 profiles/memory files at their configured locations, and relevant `%LOCALAPPDATA%/LSA Enhanced/` user state. Backups may contain secrets; keep them private. Check that the copies open and hashes match before moving anything. Neither the old server/config directory nor unrelated game mods need to be removed.
2. **Move (do not rename inside the game)** the active legacy owner binaries into that off-game backup: `Plugins/LosSantosAlive.dll` (or an actual root `LosSantosAlive.dll`), plus whichever of these exist: `Plugins/LSA.PromotedCharacters.dll`, `Plugins/LSA.PromotedCharacters/` (native runtime and identity files), `Plugins/LSA.PromotedCharacters.json`, root `Plugins/LSA.SessionIdentity.dll` or `Plugins/LSA.Intelligence.dll`, and `Plugins/LSPDFR/LosSantosAlive.Interop.dll` / `LosSantosAlive.PRBridge.dll`. The preflight also checks alternate known loader names. Do not move generic RPH or unrelated mod dependencies.
3. Confirm the active RPH loader configuration won't load any other Essential/LSA controller (including a renamed copy). Leave your ordinary GTA mods and original LSA server/config/data folders in place. Then run:

```powershell
.\Install-Standalone.ps1 -GamePath 'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced' -ExistingInstallation
```

4. Use `-Stage host`, then `-Stage probe` with the same `-GamePath`; proceed to `-Stage typed` only after the GTA native actor checks actually pass. The standalone companion runs from this extracted bundle, not `LosSantosAliveServer`.

**To return to original LSA:** exit GTA/RPH and stop the standalone companion. First run `.\Undo-Standalone.ps1 -GamePath '<same GTA path>'`, which checks and removes only its own three managed plugin files. **Then** restore the moved original LSA binaries/bridges/config from your off-game backup to their exact previous paths and verify their hashes. Never enable both controllers together; do not overwrite newer player profiles or SQLite data when restoring. The rollback script intentionally does **not** restore legacy files for you.

**Native startup configuration:** The launcher writes a short-lived, secret-free `.LSAStandaloneSmoke/native-activation.json` immediately before starting RPH. The real GTA-hosted DLL validates the stage, complete set of seven effect switches, file age and the still-running PowerShell launcher before enabling IPC or actor probing. This avoids relying on environment inheritance from RPH to GTA. `-PreflightOnly` never writes this file. The launcher removes it on exit; `Undo-Standalone.ps1` also handles a recognized stale file after a crash. Never launch the standalone DLL directly through RPH without its launcher. Keep the launcher running for the game session; a stale or unrecognized configuration fails closed. The JSON never contains API keys, model names or dialogue.

**Safety boundary:** This code can't inspect your actual installed directory or RPH load list remotely. Incomplete backups, unknown third-party bridges, inaccessible Node process enumeration, or ambiguous plugin ownership must be resolved before live testing. CI exercises only synthetic game folders, not an in-game run.

## Install and live diagnostics

From PowerShell, in the extracted bundle folder:

```powershell
.\Install-Standalone.ps1 -GamePath 'D:\GTA-Enhanced-Standalone-Isolated' -IsolatedProfile

# First boot: safe host/IPC diagnostic, no API key or model needed.
.\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced-Standalone-Isolated'
# Next launch after exiting GTA/RPH: probe without adoption
.\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced-Standalone-Isolated' -Stage probe
```

Start GTA Enhanced through the isolated RPH launcher. Load the independent `LSA.Standalone.RageHost.dll` under RPH as required by **your RPH loader settings**, not Essential. Check for `[LSA-S3] started actor_adoption=locked_until_live_probe` in RPH logs. Do not infer plugin auto-load from presence of a DLL. Open the RPH console, stand within ~4 meters **in front of an ordinary, non-mission pedestrian**, then run:

```text
LSAStandaloneStatus
LSAStandaloneProbe
LSAStandaloneStatus
```

Keep that NPC alive and in front for at least 1 second. A successful probe reports `decorators=registered`, `probe_ready_stable`, `frames >= 8`, `cookie_readback=ok`, `adoption=closed`. A probe DOES write two temporary unique entity decorators; it does not take control of NPC tasks. If the entity disappears, is replaced, or decorator/address changes, the probe is invalidated and reported. Test this intentionally **without violence** by letting the pedestrian despawn/walking out of range, then confirm adoption stays closed. A real same-handle reuse occurrence is not guaranteed in one live test: preserve the logs rather than claiming it was observed.

If the probe stage works, exit game and RPH completely. Relaunch with the independently selected typed stage (set your OPENAI_API_KEY in the terminal):

```powershell
.\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced-Standalone-Isolated' `
  -Stage typed -Model '<verified API model id>'
```

In the game repeat `LSAStandaloneProbe` and wait until `probe_ready_stable`. Only then run `LSAStandaloneArm` and `LSAStandaloneStatus`. You should see `armed_exact_actor_only`. The experimental mode by itself **never** arms adoption; the probe must pass in the *same GTA session*. Probe a different ped to disarm the former ped. All game-facing actions recheck native lease, decorator, address and incarnation.

## Typed response smoke test

Facing the same probed and armed NPC (no missions, cutscenes, online or combat):

```text
LSAStandaloneCompose
```

Use GTA's onscreen keyboard, submit a simple question, e.g. `Hello! Who are you?` (256-character UI limit). Alternatively enter `LSAStandaloneAsk Hello there` in the RPH console (1024-character native cap). A native offer should appear in the RPH console; at the typed stage the independent Node service requests a Responses API answer and stages a typed reply **without** TTS. Advance to the `tts` stage to generate native PCM escrow without physical audio. Advance to `audio -ConfirmPhysicalEffects` to test waveOut, or `lipsync -ConfirmPhysicalEffects` to test facial animation. If `LSA_STANDALONE_PLAYBACK_CONFIRM=enabled`, Node awaits an actual driver-progress completion receipt. Spoken audio, facial `mic_chatter`, pan/distance, and completion must **all be heard/seen and logged in GTA** before marking them accepted. Other NPCs, stale actor cookies, or a competing Essential installation must not receive speech.

After testing any typed or higher stage, run `LSAStandaloneDisarm`. Do not treat audio EOS or a model reply as an audible or durable NPC-memory event; this slice deliberately doesn't commit assistant replies to persistent history. Early streaming is an independent `-Stage streaming` test, without physical audio or facial effects unless explicitly combined through advanced overrides. To use existing local Qwen TTS instead of OpenAI TTS, launch with `-TtsProvider faster-qwen3-tts -Voice '<registered Qwen voice>' -QwenUrl 'http://127.0.0.1:8765/v1'`; the separate local sidecar and model are NOT in this ZIP.

## Rollback and emergency stop

- In the live session: `LSAStandaloneDisarm` (or exit GTA/RPH). If unsafe behavior appears, exit GTA/RPH without retrying.
- After closing GTA/RPH: `.\Undo-Standalone.ps1 -GamePath 'D:\GTA-Enhanced-Standalone-Isolated'`. This verifies the exact SHA256 of **all three managed files** before deleting any, and refuses partial removal if any was altered.
- The installer is **create-only** in both modes. It refuses an existing target file or manifest; it never removes/modifies an Essential file, private data, or third-party mod. The rollback deletes only its own host DLL, core DLL and `LSA.Standalone.enabled` sentinel. In `-ExistingInstallation` mode, restore your manually moved legacy binaries **only after** Undo completes. The independent test package outside the game directory can be deleted afterward.

## Acceptance checklist / blocking limitations

1. RPH plugin entry/startup/exit genuinely works on GTA Enhanced and no Essential code is running.
2. DECOR registration reports correct type; repeated physical handle, memory address and per-entity cookie remain stable for eight checks spanning at least 750ms. On actual despawn/reuse, the lease and probe MUST be revoked. A simulated ABA test is **not live reuse evidence**.
3. Manual per-session arm cannot precede the successful probe. Only the exact probed NPC responds to `Ask`/`Compose`. Re-arm is necessary on restart and after changing target.
4. Genuine cloud Luna answer reaches NPC playback; speech is audible, and independent facial clip is compatible with that NPC. Repeat with the NPC moving away; check interruption, world resets, device failure and no wrong-NPC voice.
5. Return to Essential either by launching your preserved separate installation, or in existing-install mode by performing standalone Undo **before** restoring your original backed-up LSA binaries. Never load the two controllers together.

**No GTA tests can be performed by GitHub Actions.** Offline CI compiles against the approved official RPH reference and tests the protocol, native authority and PowerShell installer/rollback in synthetic environments only. Do not mark GTA acceptance PASS until logs from an actual run are reviewed.
