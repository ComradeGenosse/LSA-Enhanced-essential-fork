# E0 pre-shot smoke attempt — 2026-10-19

## Outcome

The verified lab DLL and safe pre-shot configuration were staged in the local GTA V Enhanced Plugins directory. RAGE Plugin Hook was launched, but its process terminated immediately with CLR exception code `0xE0434352`. Windows Error Reporting recorded a `CLR20r3` event for `RAGEPluginHook.exe` 1.132.1428.17748, fault module `System` 4.8.9340.0, exception signature `System.ComponentModel.Win32` (P7 3010, P8 29b). No new RPH log was written. The existing root RPH log remained dated 2026-10-18.

The session did not reach GTA single-player free roam and did not load the lab plugin. **E0.0, E0.1, E0.2, and E0.3: NOT RUN.** There is no JSONL output or suite manifest from this attempt. E0.2/E0.3 are not labeled BLOCKED because their prerequisite evaluation never ran.

## Build provenance and fingerprints

- Successful Windows workflow: [run 39240965340](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/39240965340), branch `experiment/physics-e0-native-capability-census`, commit `f5740c662ffd9a250da32dad5e8a97ca38d72337`.
- Workflow artifact: `E0-Research-Lab-UNVERIFIED-IN-GTA`, artifact ID `12181496567`, GitHub SHA-256 digest `d89bf23d68b45e4bb670a4192799f1805d1b978d46a313e6965def48e4e98157`.
- Supplied local ZIP SHA-256: `4b4ead5a80bf870ff7a08ae72cc4cc92c6ff827f63fee5b3bc0b490ffc26faa4`. This does **not** match the GitHub artifact digest, so the ZIP bytes themselves are not verified as the exact downloaded workflow artifact.
- Embedded build receipt pins `LSA.WPS.Lab.dll` SHA-256 `9fbdb4c7082bd8341ed2149f25fe0c58447b0770d707923dcb564d15793daf46`; the DLL extracted from the supplied ZIP matched this hash.
- Installed configuration SHA-256: `362972034bc6201abababd20c1d9e8e6f749f7aff987596b655882d8f6d01752`.
- Configuration: `enabled=true`, `autoRunPreShot=true`; `permitExplosion`, `permitBullet`, `permitIpl`, `permitHide`, and `permitTimeScale` are all false. Other values use the package example defaults because no existing lab config was present.

## Evidence available

This report records deployment fingerprints, launch attempt, and the sanitized Windows Error Reporting signature. No RPH startup/error log from the attempt, lab JSONL, or suite manifest exists because RPH exited before writing a fresh log. No unrelated logs or personal filesystem paths are included.

## Next step

Resolve the RAGE Plugin Hook launch failure, then relaunch interactively through RPH and confirm single-player free roam. Recheck the downloaded artifact against GitHub's published digest before treating its archive provenance as exact. Only after runtime starts can the auto-run suite produce E0 verdicts; missing CodeWalker reference data should then be recorded by the suite as BLOCKED for E0.2/E0.3.