# E1 candidate — Minimal Luna / OpenAI on Essential

This is a candidate implementation based on the archived Essential backend pinned in `patches/essential-hooks.json`. The `upstream/` folder contains hashed read-only inputs copied from the supplied stock package for repeatable offline builds. The stock archive, developer build and installed GTA files remain unchanged. No GTA directory is a build or deployment target.

## Build and check

Use the workspace Node 24 runtime or Node 20.19+ / Node 22.12+ / Node 24. Run from this directory:

```powershell
node .\tools\buildCandidate.mjs
npm test
```

The builder checks the complete input backend and DLL SHA-256 values, applies one-match Acorn AST edits and writes only to `dist/plugins/LosSantosAliveServer/`. A different input hash or unmatched/ambiguous hook fails closed. The build manifest hashes both the E1 source tree and candidate payload. The payload contains the patched server entry, E1 JavaScript modules, and example config; it does not copy the DLL, Node runtime or ffmpeg runtime, and it has no deployment script.

## OpenAI settings

`e1.config.example.json` contains public model, timeout, and telemetry retention settings. Store credentials only in environment variables: `OPENAI_API_KEY` or endpoint-specific `OPENAI_REASONING_API_KEY`, `OPENAI_TRANSCRIPTION_API_KEY`, and `OPENAI_TTS_API_KEY`. Optional endpoint overrides are `OPENAI_REASONING_BASE_URL`, `OPENAI_TRANSCRIPTION_BASE_URL`, and `OPENAI_TTS_BASE_URL`. Credential values are never written to observability records. The E1 bootstrap loads only the four supported OpenAI credential variables from the server-directory `.env` because the stock native launcher starts Node directly. Existing process environment variables take precedence; settings from the old/custom LSA branch are ignored. Public settings remain in `e1.config.json`; private `.env` and generated `logs/` are excluded from the build payload.

## Runtime observability

In the actual `server.bundle.mjs` launch path, E1 writes ordered, schema-v1 JSONL events to `logs/e1-run-<UTC>-<runId>.jsonl` under the server directory. Default retention is five files, 10 MiB per file, and 100 MiB total. Telemetry never controls turn validity, authorization, playback success, history, or action execution. Records include exact native identity/source plus bounded reason codes, sizes, times, and provider-reported token counts when available; they exclude credentials, prompts, transcripts, dialogue, audio bytes, URLs, and response bodies. A failed/full log sink does not fail turns. Queue loss is counted and makes summaries incomplete.

Run `node tools/summarizeRun.mjs <server logs directory or JSONL file> [output-prefix]` to create a local JSON and Markdown report. Percentiles use nearest-rank, and successful and non-completed turns are summarized separately. Reports include provider attempts, recovered/exhausted/suppressed retries, and scheduled retry delay by stage. They mark truncated logs, missing summaries, and dropped events; unknown usage remains null. `action_dispatch_accepted` means the stock transcript/action event handler accepted the event. It does not prove that GTA finished the requested world action. Node timestamps measure when callbacks were observed, not physical audio timing on the native clock.

By default, the request order remains batch transcription for PTT, one non-streaming Luna JSON decision, current Essential action validation, and whole-dialogue TTS. E5/E6 are opt-in through `structuredStreamingEnabled` and `earlyTtsEnabled`; both default false. See [E5/E6 streaming behavior and test gates](docs/e5-e6-streaming.md). Early audio is limited to an initial `dialogue_only` mode, uses one serial TTS consumer, and retains Essential's exact-generation authorization and playback completion as the audio authority. Action-bearing responses remain buffered. Eligible provider requests can make one retry within the shared 45-second default `providerWorkDeadlineMs`; reasoning cannot retry after a streamed segment is released, and segment TTS cannot retry after the first native handoff. Responses requests set `store: false`; bounded dialogue history stays in memory for the current Essential session. Typed text skips transcription. A separate playback watchdog is sized from aggregate PCM bytes and bounded from its configured minimum and maximum; only native `PlaybackEnded` confirms success. Genuine typed/microphone input is committed once before Luna, while internal/special-event sources do not become fake player dialogue. PTT input is capped at 30 seconds of 16 kHz mono PCM16, including the native pre-hydration buffer; overflow fails without dropping the prefix.

## Explicit live API smoke

`npm test` and `npm run build` remain offline. A separate smoke command exercises the configured OpenAI transcription, Luna Responses, TTS, and E1.1 fake-native lifecycle. It makes billable requests and requires explicit opt-in:

```powershell
$env:E1_LIVE_API_SMOKE = '1'
npm run smoke:api
Remove-Item Env:E1_LIVE_API_SMOKE
```

The smoke harness loads a private root `.env` only after the opt-in flag is present; it never prints credentials. It does not retry, substitute models, fall back to Gemini, or contact GTA. Sanitized reports are written to `E1-API-SMOKE.json` and `E1-API-SMOKE.md`; generated PCM/WAV files go under ignored `outputs/api-smoke/`.

After a complete `all` run, a targeted end-to-end rerun can reuse its passing TTS fixture and STT evidence, avoiding repeat standalone probes:

```powershell
$env:E1_LIVE_API_SMOKE = '1'
$env:E1_LIVE_API_SMOKE_PHASE = 'pipeline'
npm run smoke:api
Remove-Item Env:E1_LIVE_API_SMOKE, Env:E1_LIVE_API_SMOKE_PHASE
```

Action validation parses with the stock Essential command parser and compares against the actor's current role and capability-filtered action list. It rejects chained actions, unresolved person/vehicle references, and weapons absent from supplied actor inventory data. The validated command enters the existing Essential transcript/action path; only the dialogue is sent to TTS.

## Rebase documentation

- [Architecture and removed legacy machinery](docs/architecture.md)
- [Audit](docs/rebase-audit.md)
- [Native dependency contract](docs/native-contract.md)
- [Verification report](docs/verification.md)
- [Remaining GTA smoke checklist](docs/gta-smoke-checklist.md)
- [P1 explicit-owner identity, voice continuity, and pending GTA checks](../docs/P1-session-identity-status.md)
- [Optional native identity addon and owner API](../native/session-identity/README.md)

## Status

P1 SESSION_IDENTITY is implemented and verified offline on the merged P0 baseline. It defaults off; shadow mode verifies metadata without adopting character voices, and voices mode adopts a persisted actual assignment only at a clean session boundary. All native effects retain the original Essential tuple, and returning characters get fresh session history. The optional addon uses only pinned public integration seams. No P1 payload was deployed or tested in GTA; its controlled checklist and the separate P0/E6 physical gates remain pending. See the [P1 status record](../docs/P1-session-identity-status.md) for current test counts and build hashes.

E5 structured streaming is implemented and has passed the explicit live streaming capability smoke against the configured `gpt-6-luna` endpoint. E6 early segmented TTS is implemented and has passed the stock-controller/native-lifecycle integration gate: early PCM precedes model completion, delayed segments keep exact native identity/order, one final stream-end is used, and assistant history waits for matching `PlaybackEnded`.

The character-aware voice branch passes the full offline regression suite: **164 tests, 0 failures**, followed by a successful pinned candidate build with **25 source-pinned patches**. The built launcher hash is `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`. [GitHub Actions validation](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/36948145647). It includes the `84df8e30` model-failure/PCM16 hardening and the production telemetry repair reproduced from the first failed E5/E6 GTA runs. The stock E6 test now exercises the real logger; physical GTA acceptance of the repaired build remains open.

A controlled E5/E6 payload is installed/staged in the live GTA server directory with both runtime flags enabled and rollback backups recorded. Repository HEAD may be newer than that installed payload. Physical GTA playback, real segment-gap behavior, interruption/late-failure behavior, and resulting live log evidence remain the outstanding E6 release gate. The checked-in example config continues to default both feature flags off.

## P2 promoted characters

The optional P2 system extends the merged P1 authored identity seam with bounded encounter names, independent durable profiles/manual memories, a local character editor, RAGE console controls and an explicitly loaded native owner plugin. Both flags remain default-off. See [P2 setup and invariants](../docs/P2-promoted-characters-status.md) and [native package build](../native/promoted-characters/README.md). `node tools/buildCharactersAddon.mjs` builds a separate compile-only package; ordinary candidate builds never deploy it or run GTA.


### PS4 matching build support (implementation branch)

Ordinary companion builds retain an unavailable optional-perception contract and safe base dialogue. To build a PS4-capable companion explicitly, first build the native addon using the pinned references documented above, then set `LSA_PS4_NATIVE_PAYLOAD` to that package directory before running `node tools/buildCandidate.mjs`. Programmatic callers use `buildCandidate({nativePayloadPath})`. The builder verifies the current native compile-source receipt, C-02/C-13/C-14 versions, existing perception pins, and every native artifact hash; mismatches fail the build. Its manifest records the matched native manifest/source/file hashes.

This declares compiled support only. `dialogueKnowledge.mode` remains `off` by default, native intelligence remains off by default, and installed runtime host/version/currentness checks still apply. No build enables perception delivery, deploys to GTA, or establishes physical acceptance. Controlled shadow preview and active requested-turn acceptance follow the unchanged PS4 G6/G7 gates. Source changes require a fresh native build; no stale package is silently accepted.


### Capability validation diagnostics (C-09)

`runtime.services.capabilityHealth()` returns an immutable current read model for perception, PS4, the four implemented ACT2 capabilities, and the still-uncompiled speech/gaze/radio contributors. Each row separates `compiled`, `configured`, `runtimeSupported`, `hostRunId`, `validated` payload hashes, `suspended`, and derived `active`. This is acceptance eligibility information; it never admits an action or replaces a subsystem's runtime gates. The private host association stays outside model context and normal scalar telemetry. ACT probe configuration is read through the existing registry gate and is never treated as physical validation.

At startup the companion optionally reads `diagnostics/validation.v1.json` under its working directory (embedding may specify `capabilityValidationPath`). The bounded 64 KiB file has the closed shape `{version:1,receipts:[...]}` with at most 64 closed receipt rows: `capability`, `payloadHash`, `sourceCommit` (40 lowercase hex), `sessionId` (UUID), `result` (`passed`, `failed`, or `not_run`), and `evidenceSha256`. Hashes are 64 lowercase hex. `payloadHash` identifies the exact companion build-manifest bytes, which include the matching native manifest/source/file hashes; `evidenceSha256` references the complete acceptance-session evidence. Record `passed` only after the capability's complete required acceptance gates pass on that payload. No acceptance file or successful receipt is generated automatically. A later failed/not-run receipt supersedes an earlier pass for that capability/payload. Missing, oversized or malformed records yield no validated capabilities; another payload's pass never establishes current acceptance. Restart after updating records; there is no added watcher or polling loop.

This read model is available to diagnostics consumers through the runtime service API. Native F11 presentation remains a separate integration task; no command-contract changes or authority-bearing health service were introduced.


### Optional SELF contributors (implementation branch)

`dialogueKnowledge.activityFacts` and `dialogueKnowledge.dialogueReceipts` independently accept `off`, `shadow`, or `active`; omission means off. The parent `dialogueKnowledge.mode` must permit PS4 projection. Shadow contributors enrich only the immutable preview, never the selected request. Active SELF additionally requires parent active mode, original released/current P0 capture, matching build/live shared PS/ACT host and transport scope, and an active C-09 capability backed by a passed acceptance record for the exact payload. Capability names are `ps.activity_facts` and `ps.dialogue_receipts`; dialogue receipts additionally require negotiated C-05 version 1. Configuration and ACT `passedProbes` do not establish this acceptance. No successful record is supplied by this implementation.

Both contributors use the existing single PS4 renderer and shared SELF/manual-memory budget. Private provenance stays outside model allocation; stale whole items prune before first send and invalidate an already-sent request. Neither contributor consumes PS3 salience. Current dialogue templates cover the 65 registry actions in the existing pinned Essential catalog; parser-only bridge entries and aliases remain omitted. Real Essential callback/body-resolution probes and MP6/G8/GTA acceptance remain open. Native collection configuration and synthetic Windows pipe interoperability have offline coverage.


Passive receipt collection uses the existing ACT host: native `activities.dialogueReceipts: true` opts into C-05 while `activities.mode` remains explicitly shadow/on. Companion normalization preserves only a literal true opt-in; this does not enable ACT dialogue dispatch or change mode. Both example configurations remain false/off. Collection and SELF activation are independent; no physical acceptance record is supplied.

The companion publication service also requires its literal-true `activities.dialogueReceipts` opt-in; native negotiation alone never enables publication annotation.


### C-05 Windows interoperability fixture

Build `native/activities/tests/ActivityTests.csproj` from the repository root, then run `node tools/testDialogueActionsInterop.mjs` from this candidate directory. The same check is in `tests/dialogue-action-interop.test.mjs` on Windows. It uses the production current-user ACT pipe/session, native shared ring/correlator/publisher and Node ActivityRuntime to verify ordinary/owned binding shapes, accepted/failed handler receipts, closed SELF projection, stale-host rejection, sequence preservation, passive mode and reconnect cleanup. The helper supplies synthetic before/handler callbacks and executes no game assemblies. A pass proves cross-process interoperability; it does not prove native actor resolution, Essential callback ordering or physical MP6/GTA acceptance.


The C-05 Windows fixture also sends five malformed peer packets (host/world/sequence/action/owned-binding faults) to prove native rejection independently of the Node sender. Each rejection must clear existing pending/completed evidence and permit a fresh publication after reconnect. All 49 checks remain synthetic callback/transport evidence, not physical acceptance.
