# LSA independent GTA Enhanced — first typed conversation smoke-test package

**Purpose:** a *first live acceptance candidate*, not a proven replacement for Essential. Build/test on the stacked standalone S3 branch. Source passes offline; the host, decorator registration, exact actor reuse, animation dictionary, Windows sound and GTA launch **must** be checked in the target game. A plugin refusing to start or refusing to adopt is a correct fail-closed outcome.

## Before touching the game

1. Preserve your current working GTA+Essential installation. Prepare a **separate isolated GTA V Enhanced/RAGE Plugin Hook profile** containing `GTA5_Enhanced.exe`, `RAGEPluginHook.exe` and a `Plugins` directory. RPH must be authorized/licensed separately. **No Essential DLLs or its promoted-character companion plugins** may be loaded in the isolated profile; this package refuses the known filenames and requires a manual review of the remaining mod loader roster. Never rename an Essential DLL to bypass exclusion.
2. On the PR GitHub Actions page, download the `standalone-gta-smoke-<SHA>` artifact and extract its ZIP to a non-game folder such as `C:\LSAStandaloneSmoke`. The ZIP contains **our two DLLs**, independent Node companion and `Install`, `Start`, `Undo` scripts; **no** RAGE/Essential files, voice models, game binaries or API secrets.
3. Install a current Node.js 22, and verify your OpenAI Responses API model ID and PCM TTS model. The in-app ChatGPT model name does **not** establish an API model ID; put an API-accessible Luna/model ID into `-Model`. Obtain an OpenAI API key yourself and set it only in the terminal session: `$env:OPENAI_API_KEY='...'`. Do not commit or screenshot it. Local Qwen instead of OpenAI TTS is optional and requires your separate sidecar to be running.

## Install and live diagnostics

From PowerShell, in the extracted bundle folder:

```powershell
.\Install-Standalone.ps1 -GamePath 'D:\GTA-Enhanced-Standalone-Isolated' -IsolatedProfile

# First boot: diagnostics-only (cannot arm an NPC or start a conversation).
.\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced-Standalone-Isolated' `
  -Model '<your verified OpenAI Responses API Luna model id>' `
  -TtsModel '<supported PCM OpenAI speech model>' -ActorMode diagnostic
```

Start GTA Enhanced through the isolated RPH launcher. Load the independent `LSA.Standalone.RageHost.dll` under RPH as required by **your RPH loader settings**, not Essential. Check for `[LSA-S3] started actor_adoption=locked_until_live_probe` in RPH logs. Do not infer plugin auto-load from presence of a DLL. Open the RPH console, stand within ~4 meters **in front of an ordinary, non-mission pedestrian**, then run:

```text
LSAStandaloneStatus
LSAStandaloneProbe
LSAStandaloneStatus
```

Keep that NPC alive and in front for at least 1 second. A successful probe reports `decorators=registered`, `probe_ready_stable`, `frames >= 8`, `cookie_readback=ok`, `adoption=closed`. A probe DOES write two temporary unique entity decorators; it does not take control of NPC tasks. If the entity disappears, is replaced, or decorator/address changes, the probe is invalidated and reported. Test this intentionally **without violence** by letting the pedestrian despawn/walking out of range, then confirm adoption stays closed. A real same-handle reuse occurrence is not guaranteed in one live test: preserve the logs rather than claiming it was observed.

If the diagnostic stage works, exit game and RPH completely. Relaunch in explicitly experimental mode:

```powershell
.\Start-Standalone-Test.ps1 -GamePath 'D:\GTA-Enhanced-Standalone-Isolated' `
  -Model '<verified API model id>' -TtsModel '<supported PCM speech model>' `
  -ActorMode experimental
```

In the game repeat `LSAStandaloneProbe` and wait until `probe_ready_stable`. Only then run `LSAStandaloneArm` and `LSAStandaloneStatus`. You should see `armed_exact_actor_only`. The experimental mode by itself **never** arms adoption; the probe must pass in the *same GTA session*. Probe a different ped to disarm the former ped. All game-facing actions recheck native lease, decorator, address and incarnation.

## Typed response smoke test

Facing the same probed and armed NPC (no missions, cutscenes, online or combat):

```text
LSAStandaloneCompose
```

Use GTA's onscreen keyboard, submit a simple question, e.g. `Hello! Who are you?` (256-character UI limit). Alternatively enter `LSAStandaloneAsk Hello there` in the RPH console (1024-character native cap). A native offer should appear in the RPH console; the independent Node service requests a Luna Responses API answer, runs its configured PCM TTS, and feeds an exact leased NPC stream to the experimental Windows waveOut stereo output. If `LSA_STANDALONE_PLAYBACK_CONFIRM=enabled`, Node awaits an actual driver-progress completion receipt. Spoken audio, facial `mic_chatter`, pan/distance, and completion must **all be heard/seen and logged in GTA** before marking them accepted. Other NPCs, stale actor cookies, or a competing Essential installation must not receive speech.

After testing, run `LSAStandaloneDisarm`. Do not treat audio EOS or a model reply as an audible or durable NPC-memory event; this slice deliberately doesn't commit assistant replies to persistent history. Early streamed Luna speech can be compared with the `-EarlySpeech` launcher flag, but is **off by default** for the first acceptance session. To use existing local Qwen TTS instead of OpenAI TTS, launch with `-TtsProvider faster-qwen3-tts -Voice '<registered Qwen voice>' -QwenUrl 'http://127.0.0.1:8765/v1'`; the separate local sidecar and model are NOT in this ZIP.

## Rollback and emergency stop

- In the live session: `LSAStandaloneDisarm` (or exit GTA/RPH). If unsafe behavior appears, exit GTA/RPH without retrying.
- After closing GTA/RPH: `.\Undo-Standalone.ps1 -GamePath 'D:\GTA-Enhanced-Standalone-Isolated'`. This verifies the exact SHA256 of **all three managed files** before deleting any, and refuses partial removal if any was altered.
- The installer is **create-only**. It refuses an existing target file or manifest; it never removes/modifies an Essential file or a third-party mod. The rollback deletes only its own host DLL, core DLL and `LSA.Standalone.enabled` sentinel. The independent test package outside the game directory can be deleted afterward.

## Acceptance checklist / blocking limitations

1. RPH plugin entry/startup/exit genuinely works on GTA Enhanced and no Essential code is running.
2. DECOR registration reports correct type; repeated physical handle, memory address and per-entity cookie remain stable for eight checks spanning at least 750ms. On actual despawn/reuse, the lease and probe MUST be revoked. A simulated ABA test is **not live reuse evidence**.
3. Manual per-session arm cannot precede the successful probe. Only the exact probed NPC responds to `Ask`/`Compose`. Re-arm is necessary on restart and after changing target.
4. Genuine cloud Luna answer reaches NPC playback; speech is audible, and independent facial clip is compatible with that NPC. Repeat with the NPC moving away; check interruption, world resets, device failure and no wrong-NPC voice.
5. Return to your Essential game by **launching the preserved original installation**, not enabling Essential inside the isolated profile.

**No GTA tests can be performed by GitHub Actions.** Offline CI compiles against the approved official RPH reference and tests the protocol, native authority and PowerShell installer/rollback in synthetic environments only. Do not mark GTA acceptance PASS until logs from an actual run are reviewed.
