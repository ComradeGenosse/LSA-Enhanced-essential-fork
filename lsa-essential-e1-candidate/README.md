# LSA Enhanced — Companion

The Node.js side of [LSA Enhanced](../README.md). This is where Luna dialogue, transcription, speech, memory, perception and the activity bridge are wired into **Los Santos Alive Essential**.

Essential owns NPC state, native actions, turn identity and audio playback. This companion supplies the conversation and supporting context; it does **not** run GTA or replace Essential.

## Build and test

Requires **Node.js 20.19+**. From this directory:

```powershell
npm test
npm run build
```

The build checks pinned Essential inputs and writes to `dist/plugins/LosSantosAliveServer/`. A mismatched source hash or unsupported patch stops the build. Neither command installs a mod, launches GTA or calls an AI API.

Optional native additions (promoted characters, perception and activities) have their own builds and version checks. See the [native addon](../native/promoted-characters/README.md) and [deployment guide](../deployment/README.md) before preparing an install.

## Configuration

- Start with [`e1.config.example.json`](e1.config.example.json); the installed companion uses `plugins/LosSantosAliveServer/e1.config.json`.
- Put `OPENAI_API_KEY` (or separate reasoning/transcription/TTS keys) in the private server `.env`. Never commit credentials.
- ElevenLabs voices, expressive delivery, streaming, memory and perception have separate settings. Some advanced capabilities require explicit enablement and matching native builds.

## Logs and checks

Runtime logs go under `logs/` in the launched server directory. They record timing and lifecycle events without storing raw conversations by default. Private dialogue tracing can be enabled deliberately for debugging.

```powershell
node tools/summarizeRun.mjs <logs-path>
```

A separate **billable** OpenAI smoke test exists for provider checks; it does not launch GTA:

```powershell
$env:E1_LIVE_API_SMOKE = '1'
npm run smoke:api
Remove-Item Env:E1_LIVE_API_SMOKE
```

## More detail

- [Current features and roadmap](../docs/ROADMAP.md)
- [Implementation evidence and remaining GTA checks](../docs/IMPLEMENTATION-STATUS-20261017.md)
- [Architecture](docs/architecture.md) and [native interface](docs/native-contract.md)
- [E5/E6 streaming](docs/e5-e6-streaming.md)
- [In-game smoke checklist](docs/gta-smoke-checklist.md)

The source is ahead of some installed/tested GTA builds. Check the matching native and companion versions before treating a feature as ready.
