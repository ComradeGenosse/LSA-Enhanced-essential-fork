# E1.1 installation receipt — 2026-10-01

The active installation is the hardened Essential Hotfix #3 E1.1 companion at:

`C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced`

The old/custom Alpha 2.1 server, native DLL, NPCGeminiFiles configuration, and existing shared files affected by this replacement are preserved under:

`C:\Users\Chris.COMRADE\Documents\Codex\2026-09-30\downloaded-both-files-to-your-workspace\deployment\backups\old-custom-LSA-2.1-2026-10-01T17-54-49-986Z`

All 1,096 backed-up files were checked against the original SHA256 values before modification and rechecked after deployment. Directory copies retain data, attributes, and timestamps. `rollback-manifest.json` records original files and paths absent before installation. This is a private backup containing the original `.env`; do not include it in public release archives. The earlier server-only backup in `plugins/LosSantosAliveServer.backup-E1.1-pretest-20261001` was left untouched.

The replacement was assembled from the original Essential Hotfix #3 installer, archive SHA256 `4eb02a2723a87f287b3726d42369e3bf8d22359d5ee3d625e4bb63bae5afd924`, plus the deterministic hardened release. Old `server.js`, `node_modules`, custom source, and `NPCGeminiFiles` were removed from the active layout after backup. No old code/config was merged into Essential. Unrelated plugins and RAGEPluginHook launch settings were preserved.

The active payload contains the matching `plugins/LosSantosAlive.dll`, stock root dependencies, stock LSPDFR companion bridge files, `plugins/LosSantosAlive` configuration/archetypes, and a clean `plugins/LosSantosAliveServer` with the stock Node, ffmpeg, and prompts plus `server.bundle.mjs`, E1 modules, and public `e1.config.json`. All 40 installed files matched staging verification. The native DLL and independently pinned metadata verification passed.

The supported OpenAI credentials were copied privately from the old `.env` into a minimal new `.env`. No old model/provider settings were imported. E1 bootstrap now loads the four supported credential variables from this file because the native launcher does not pass `--env-file`. Existing process variables take precedence. Public settings remain in `e1.config.json`. Both normal bootstrap and bootstrap without inherited credentials resolve nonempty reasoning/STT/TTS credentials matching the rollback copy. No secret values were displayed.

Verification used installed Node v24.16.0: 16 module syntax checks passed, ffmpeg executed its version command successfully, and required native config fields and launcher entry files exist. Native launcher source expects bundled `node.exe` and `server.bundle.mjs`; no old package launcher is required. Stock controls remain Mouse4/F3/Mouse5, with `TextKey=None`; bind a text shortcut in stock settings for typed testing. Stock `ApiKey` remains blank: it is the Gemini setting, not the OpenAI credential.

The final source suite passed normally: **99 passed, 0 failed, 0 cancelled, 0 skipped**. Four new offline tests cover credential loading, process precedence, ignoring old settings, missing-file behavior, and isolated embedding environments. Deterministic build and DLL/metadata/source pinning passed.

Sanitized machine-readable evidence: `deployment-receipt.json`, `deployment-verification.json`, and `install-plan.json`. The prepared stage is private because it contains `.env`.

No backend conversation, real API request, or GTA launch occurred during this deployment. Native startup, protocol handshake, microphone capture, physical playback, action execution, and interruption behavior still require the separate in-game smoke checklist in `../lsa-essential-e1-candidate/docs/gta-smoke-checklist.md`.

Rollback must be a clean replacement using the saved version-owned roots and original absent-path list, never an overlay of old and new server code. Restore original shared files from the backup as well as the old DLL/server/config. Do not overwrite the backup.

## E5/E6 test deployment — 2026-10-01

The E5/E6 candidate was installed into the existing `plugins/LosSantosAliveServer` for the user’s controlled GTA test. The pretest server files are backed up at `backups/E5E6-pretest-20261001-175620`; `e5e6-backup-manifest.json` records the saved files and SHA-256 values. The E1 tree, launcher, example config, and build manifest were compared with the candidate payload after installation. The private `.env`, bundled Node/ffmpeg, public runtime config fields, and native DLL were kept in place; the live public config now has both streaming flags enabled. Build bundle SHA-256: `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`.

The configured Luna streaming API smoke passed before deployment: one complete dialogue-only segment was locally validated before `response.completed`. The game was not launched as part of deployment. Native audio, ordered segment playback, interruption, late failures, and playback-history commit still need the controlled in-game checklist. Roll back by restoring the backed-up E1 tree, launcher, and `e1.config.json`; do not overwrite the backup. Setting both flags false also returns the next run to the sequential route.

After adding the aggregate PCM ceiling and cancellation fault coverage, the full offline suite passed **139 tests, 0 failures**, and the deterministic candidate build succeeded. The refreshed live payload was installed with GTA closed on 2026-10-01. The previous E5/E6 payload is separately backed up at `backups/E5E6-prepcmcap-20261001-181053`; the original pretest snapshot remains untouched. The live config retains both opt-in flags and now explicitly sets `streamingMaxPcmBytes` to 6,291,456 bytes. The candidate and installed `server.bundle.mjs` SHA-256 are both `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`. The private `.env`, bundled runtimes, and native DLL were not replaced. There is still no post-deployment GTA log, so the in-game playback/lifecycle gate remains open.

An additional end-to-end offline gate now exercises E6 through the patched stock controller and Essential lifecycle bridge using two delayed TTS segments. It confirms first PCM precedes the model terminal event, preserves segment order and the same native identity, sends one stream-end handoff, and defers assistant-history commit until matching `PlaybackEnded`. The full suite now passes **140 tests, 0 failures**. The live GTA log has not changed; this harness strengthens code-side evidence but does not close the physical GTA gate.
