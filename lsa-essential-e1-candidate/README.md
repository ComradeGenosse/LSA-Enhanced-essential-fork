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

The companion source on current `main` is no longer only an E1/E6 candidate: it is the provider-side half of the merged P0–P2 and PS0–PS3 system.

- **P0** turn snapshots are merged and offline-verified; engine-level target-reference stress remains a GTA checklist item.
- **P1** SESSION_IDENTITY is merged and used by P2. Live P2 promotion exercises the owner-authenticated identity path; deeper recreation/revocation/stale-work stress remains follow-up coverage.
- **P2** promoted characters are merged and GTA-exercised, including promotion, editor/profile/manual-memory editing, summon, follow/wait and native vehicle/driver behavior.
- **PS0–PS3** are merged in default-off/shadow form. Live GTA evidence proves PS2→PS3 evaluation and persistent privacy-filtered JSONL telemetry. Player-speech hearing remains intentionally gated pending source-time capture receipts, and direct DamageTracker callbacks still need a controlled probe.
- **UX4** lives primarily in the native/loader package but is part of the current integrated runtime. Shared Essential Talk-key interception has live GTA evidence; the latest direct-Talk/no-bracket vs tap/cycle explicit-selector refinement is merged and awaits a fresh exact-main GTA pass.
- **E5/E6** remain implemented. E5 has live API capability evidence; E6 has live GTA playback-path evidence. Audible pre-terminal playback and multi-segment stress remain regression/soak items.

See the root [ROADMAP](../docs/ROADMAP.md) for the current main/off-main split and sequencing.

## P2 promoted characters

The optional P2 system extends the merged P1 authored identity seam with bounded encounter names, independent durable profiles/manual memories, a local character editor, RAGE console controls and an explicitly loaded native owner plugin. Both flags remain default-off. See [P2 setup and invariants](../docs/P2-promoted-characters-status.md) and [native package build](../native/promoted-characters/README.md). `node tools/buildCharactersAddon.mjs` builds a separate compile-only package; ordinary candidate builds never deploy it or run GTA.
