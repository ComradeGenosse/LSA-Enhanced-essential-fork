# Unified LSA settings manager (opt-in)

This is an offline management tool. GTA, Essential, the native Enhanced host, promoted characters, Memory K and ElevenLabs still read their original runtime files. It does not run in GTA, watch files, poll, call Luna or touch SQLite. The #216/#217 reconnect code is not modified.

## Usage

From the repository root with Node 20.19+ installed, use the following PowerShell commands:

    node tools/unified-config/cli.mjs import --game "C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced"
    node tools/unified-config/cli.mjs validate --game "C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced"
    node tools/unified-config/cli.mjs diff --game "C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced"
    node tools/unified-config/cli.mjs apply --game "C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced" --activate
    node tools/unified-config/cli.mjs status --game "C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced"
    node tools/unified-config/cli.mjs rollback --game "C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced"

After first explicit activation, edit the generated LSA.settings.json at the GTA game root, run validate, diff, and apply (no --activate required again). Import reads existing installed JSON values and never modifies the three runtime files. Import does not silently enable defaults. If a master exists, import refuses unless you explicitly give --replace.

Omit --game for default Steam discovery; set LSA_GTA_DIR or --game to select an alternate game path. Discovery refuses ambiguous installations. You can use --master to place the master, journal and backups in a writable directory outside Program Files. The actual runtime config files still require write permissions.

## Files and sections

The master is created in the selected game root. It is not checked into GitHub with someone's local settings. Generated targets:

| Config | Relative to GTA |
| --- | --- |
| E1 | plugins/LosSantosAliveServer/e1.config.json |
| Promoted native | plugins/LSA.PromotedCharacters.json |
| Enhanced controls | plugins/LSA.Enhanced.json |

The Essential key file plugins/LosSantosAlive/LosSantosAlive.config is READ-ONLY.

The master groups E1 and native values under ai, voice, memory, perception, npcBehavior, ux, controls, diagnostics and extensions. Both companion and native requested settings exist where necessary, to retain values faithfully and detect mismatches instead of silently forcing one side. Examples: voice.elevenLabs.voices, memory.memoryK, memory.promotedCharacters.sqliteStorePath, memory.native.worldProfileId, controls.input.keys and ux.talkTargeting.key.

Unrecognized E1 root keys appear in sections.extensions.e1. Existing valid native extra fields survive the merge. Strict Enhanced unknown keys are rejected to match its native schema. Credentials are excluded from the master, with existing credentials in runtime configs retained untouched. Keep OpenAI and ElevenLabs secrets in environment variables; do not edit them into the master.

## UX4 F10 / Mouse4

Matching UX4 talkTargeting.key and Essential TalkKey is intentionally supported shared-input mode. Matching Essential TextKey, MarkPedKey, MarkedPedTalkKey, or an Enhanced router key is a conflict.

If UX4 is F10 while Essential Talk is Mouse4, the manager cannot inspect Steam Input's physical mapping. It refuses to apply until neutral binding is explicitly acknowledged by adding this to the master root:

    "approvals": { "neutralTalkKey": "F10" }

Only do that after physically checking that the controller's Talk button sends F10. The approval does NOT remap keys. A shared Mouse4/Mouse4 mapping needs no approval. This prevents the accidental bypass that would leave UX4 conversation visuals and microphone meter inactive.

## Transaction and recovery

Read-only validate/diff/status never modify files. Apply refuses if an installed generated file changed after import or the last apply, if a schema/dependency/key collision exists, or if a capability is marked unimplemented. Deliberately use import --replace after inspecting external edits to establish a fresh baseline.

Diff includes redacted before/after values in the `preview` field, not just changed setting names. Changing a previously active setting to off/false is blocked by `DISABLE_GUARD` unless that specific runtime path is explicitly listed under `approvals.allowDisable` in the master (for example `"approvals": { "allowDisable": ["e1.actingEnabled"] }`). This confirmation does not automatically disable anything; `apply` is still required. `status.pendingRestart` tracks conservative restart requirements after applying E1/native edits, but cannot know if GTA has actually restarted.

Apply acquires an exclusive lock, backs up originals, writes a transaction journal, uses same-folder temporary files and atomic replacement, then updates the master baseline. If an interruption leaves a prepared journal, the next mutating operation restores the originals, but ONLY when no third-party edit has occurred. Backups remain in LSA.settings.json.backups. Rollback checks current hashes before restoring the previous valid configuration and its matching master. If backups or files changed unexpectedly, recovery refuses without overwriting them.

Do not delete lock, journal or backup files before investigating interrupted work. Stop GTA/RAGE Plugin Hook and the companion before applying or rolling back. E1/native changes require restart; Enhanced can hot reload. The manager never restarts GTA or claims an operational feature is verified; status reports configured values only. Windows Program Files installs might need administrative permission for writes.

## Testing

    node --test tools/unified-config/manager.test.mjs

The regression suite covers import, lossless values, speech/voice configuration, secret exclusion, round-trips, UX4 F10 and Mouse4, router/Essential collisions, cross-file modes/pipes/identity, missing and invalid JSON, unknown fields, absent capabilities, external edits, backup, rollback, interruption and file permissions. CI runs it on Node 24 for Windows and Ubuntu.

## Limits

E1 validation reuses the actual E1 normalizer. The C# Enhanced parser cannot run directly under the Node command; a maintained Node mirror checks its schema, with native acceptance still a separate deployment gate. The manager cannot inspect installed binary versions, external Steam Input layouts, live native receipts or GTA runtime readiness. No Essential F7 settings, NPC profiles, SQLite databases or unfinished runtime features are changed.
