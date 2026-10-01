# LSA Enhanced Essential Fork

An OpenAI/Luna companion layer for **Los Santos Alive Essential Hotfix #3**.

> [!IMPORTANT]
> **This is not a standalone Los Santos Alive replacement.**
>
> You need a compatible copy of **Los Santos Alive Essential Hotfix #3** for this project to run in GTA V. This repository adds and patches the AI/provider side of Essential; it does not replace Essential's native DLL, GTA integration, bundled runtime, archetypes, prompts, or other stock files with an independent implementation.

## What this project actually is

Los Santos Alive Essential already provides the GTA-facing runtime:

- NPC/GTA state and context;
- native NPC/turn/generation identity;
- action capability filtering and dispatch;
- native playback authorization;
- interruption and playback completion;
- RAGE Plugin Hook integration;
- the stock Gemini path.

This project sits **on top of that Essential runtime** and replaces/extends the provider side for the OpenAI route.

Conceptually:

~~~text
Player / GTA V
      ↓
Los Santos Alive Essential Hotfix #3
      │
      ├─ GTA/NPC state
      ├─ actions
      ├─ native turn + generation identity
      ├─ playback lifecycle
      └─ stock Gemini path
      │
      ▼
LSA Enhanced Essential companion
      │
      ├─ OpenAI transcription
      ├─ Luna reasoning
      ├─ provider abstraction
      ├─ stable per-session voices
      ├─ OpenAI TTS
      ├─ safe retry/recovery logic
      └─ observability / run reports
      │
      ▼
OpenAI APIs
~~~

The core rule is:

> **OpenAI provides intelligence; this project adapts and validates provider work; Essential remains the authoritative GTA runtime.**

That separation is deliberate. The project does not create its own competing NPC lifecycle or action system.

## What you need

### Required

1. **GTA V Enhanced**
2. **RAGE Plugin Hook**
3. **Damage Tracking Framework**
4. A matching copy of **Los Santos Alive Essential Hotfix #3**
5. Node-compatible build environment for working on this repository
6. An OpenAI API key for the OpenAI route

If using the LSPDFR/Policing Redefined mode, the corresponding LSPDFR and Policing Redefined dependencies are also required.

### Why a stock Essential copy is required

The deployment tooling intentionally starts from a separately obtained stock Hotfix #3 payload.

A prepared installation is assembled as:

~~~text
stock LSA Essential Hotfix #3
        +
this repository's built LosSantosAliveServer payload
        +
local OpenAI credentials
        ↓
installable companion build
~~~

The repository preserves two hashed stock files under `lsa-essential-e1-candidate/upstream/` for deterministic offline build verification:

- `LosSantosAlive.dll`
- `server.bundle.mjs`

Those are **reference/build inputs only**. They are not a complete LSA Essential installation.

The deployment scripts require the matching full stock payload under:

~~~text
deployment/stock-hotfix3/
~~~

before preparing an install stage. The scripts verify that the stock DLL and server bundle match the expected Hotfix #3 fingerprints and fail closed if they do not.

See [deployment/README.md](deployment/README.md) for the current deployment workflow.

## How a turn works

For the OpenAI route, the current runtime flow is approximately:

~~~text
player presses Talk / submits text
        ↓
Essential creates/binds the native NPC turn
        ↓
PTT audio → OpenAI transcription
        ↓
Luna produces dialogue + optional command
        ↓
Essential role/capability validation
        ↓
validated command enters the stock Essential action path
        ↓
OpenAI TTS
        ↓
Essential authorizes tagged PCM for the exact generation
        ↓
native playback
        ↓
matching PlaybackEnded
        ↓
assistant history commits
~~~

Typed input skips transcription.

Accepted player text/transcripts are committed once. Assistant dialogue stays staged until matching native playback completes successfully. A stale, superseded, interrupted, rejected, or failed generation cannot later commit itself.

Internal/special-event turns remain internal context and do not become fake player dialogue.

## E2/E3 behavior

The current source includes the E2/E3 provider and reliability work.

### E2 — provider abstraction, voices, and acting

E2 adds separate reasoning, transcription, and speech provider seams while leaving Essential's native ownership unchanged.

It also adds:

- deterministic voice profiles scoped to one native NPC session;
- configurable voice pools;
- optional bounded TTS acting/style guidance;
- speech speed configuration;
- provider capability validation.

This is **session identity**, not permanent character identity. Durable cross-session character identity is a later roadmap phase.

### E3 — stage-aware reliability

E3 adds conservative provider retries without replaying GTA/native side effects.

Important rules:

- one original provider request plus at most one automatic retry;
- retries share the original provider-work deadline;
- no whole-turn retries;
- no automatic provider fallback;
- no retries after cancellation, supersession, or stale generation;
- action dispatch is never replayed by retry logic;
- native authorization/playback completion is never retried;
- dialogue-only TTS can retry only before its first usable native PCM side effect;
- action-bearing TTS closes retry eligibility before stock action publication.

See [E2/E3 implementation status](docs/E2-E3-implementation-status.md) for the current validation record.

## E5/E6 low-latency pipeline

### E5 — structured streaming

E5 is implemented. The OpenAI reasoning path can use bounded Responses SSE with complete, locally validated speech segments and strict terminal reconciliation. The configured `gpt-6-luna` live capability smoke produced its first validated segment at about **1.05 s**, before `response.completed` at about **1.19 s**.

### E6 — early segmented TTS

E6 is implemented for `dialogue_only` turns. TTS/native PCM can begin from the first complete safe segment while reasoning continues. Action-bearing turns remain buffered until final validation.

The stock-controller/native-lifecycle integration gate verifies early PCM before model completion, ordered delayed segments on the same native identity, one final stream-end, and assistant-history commit only after matching `PlaybackEnded`.

**Physical GTA acceptance is still pending.** See [E5/E6 implementation status](docs/E5-E6-implementation-status.md) and the [GTA smoke checklist](lsa-essential-e1-candidate/docs/gta-smoke-checklist.md).


## Observability

The companion writes privacy-filtered rotating JSONL runtime logs when launched through the actual patched server path.

Telemetry covers things such as:

- turn/source binding;
- microphone capture;
- STT/model/TTS timing;
- provider attempts and retries;
- first TTS byte;
- action validation/stock-handler boundaries;
- native authorization;
- PCM forwarding;
- playback start/end;
- interruption and supersession;
- history outcomes;
- terminal generation summaries.

It intentionally excludes credentials, prompts, transcripts, dialogue, raw provider responses, endpoint URLs, and audio bytes.

To summarize a captured run:

~~~powershell
cd lsa-essential-e1-candidate
node tools/summarizeRun.mjs <server logs directory or JSONL file> [output-prefix]
~~~

## Configuration

There are two different configuration layers.

### LSA Essential controls/config

Essential's GTA-side controls remain in the stock LSA configuration, for example:

~~~text
plugins\LosSantosAlive\LosSantosAlive.config
~~~

The current stock/default talk binding is `Mouse4`, with fallback handling for the older `NPCI.ini` keybind path.

### Companion/OpenAI config

Public provider/model/voice/retry settings live in:

~~~text
plugins\LosSantosAliveServer\e1.config.json
~~~

The repository template is:

~~~text
lsa-essential-e1-candidate/e1.config.example.json
~~~

Private credentials live in:

~~~text
plugins\LosSantosAliveServer\.env
~~~

Supported credential variables are:

~~~text
OPENAI_API_KEY
OPENAI_REASONING_API_KEY
OPENAI_TRANSCRIPTION_API_KEY
OPENAI_TTS_API_KEY
~~~

The common case only needs `OPENAI_API_KEY`.

Do not commit a real `.env`.

## Build and test

Use Node 20.19+.

From the repository:

~~~powershell
cd lsa-essential-e1-candidate
node tools/runTests.mjs
node tools/buildCandidate.mjs
~~~

The normal test/build path:

- makes no OpenAI requests;
- does not launch GTA;
- does not install into GTA;
- verifies the pinned stock/native hashes;
- applies source-pinned AST patches;
- writes generated output only under the ignored `dist/` directory.

Vendored Acorn is included; the documented build/test commands do not require an npm install.

## Explicit live API smoke

Normal tests are offline. Live OpenAI smoke testing is separately opt-in and billable.

From `lsa-essential-e1-candidate/`:

~~~powershell
$env:E1_LIVE_API_SMOKE = '1'
npm run smoke:api
Remove-Item Env:E1_LIVE_API_SMOKE
~~~

The live smoke exercises the configured OpenAI transcription, Luna reasoning, TTS, and a simulated native lifecycle. It does **not** launch GTA.

## Deployment

Deployment is intentionally separate from build/test.

The current deployment flow is:

1. Obtain the matching **LSA Essential Hotfix #3** package.
2. Place/extract its stock payload under `deployment/stock-hotfix3/`.
3. Build the companion candidate.
4. Prepare a staged installation with `deployment/prepare-install.mjs`.
5. Review the generated plan and machine-specific GTA path.
6. Run the explicit installer only when you intend to modify the GTA installation.
7. Verify the installed files.
8. Run the GTA smoke checklist.

The deployment tooling creates a verified rollback backup before replacing version-owned LSA roots. It is designed to avoid blindly merging the old/custom LSA 2.1 layout into Essential.

See:

- [Deployment tools](deployment/README.md)
- [Historical deployment receipt](deployment/DEPLOYMENT.md)
- [GTA smoke checklist](lsa-essential-e1-candidate/docs/gta-smoke-checklist.md)

## Current status

The repository currently contains:

- hardened E1/E1.1 native-lifecycle integration;
- observability/reporting and Windows-safe log retention;
- E2 provider/voice/acting implementation;
- E3 provider retry/reliability implementation;
- **E5 structured Responses streaming**;
- **E6 early segmented TTS for safe dialogue-only turns**;
- source-pinned build tooling;
- native contract verification;
- deployment/rollback tooling;
- offline regression coverage.

E5 has passed the explicit live streaming capability smoke against the configured `gpt-6-luna` endpoint. E6 has passed the patched stock-controller/native-lifecycle integration gate, including early PCM before model completion, ordered delayed segments, one stream-end, and playback-gated assistant history.

The latest recorded full regression checkpoint is **140 passing tests, 0 failures** at commit `b604b5e1`. Current `main` then added `84df8e30` to abort early speech on model failure and reject incomplete PCM16 output; a fresh full-suite result after that final hardening commit is not yet recorded.

A controlled E5/E6 payload is staged/installed for GTA testing with both flags enabled, but repository HEAD may be newer than the installed payload. **Physical GTA playback/interruption/late-failure acceptance remains the open E6 release gate.**

## Project layout

- [lsa-essential-e1-candidate/](lsa-essential-e1-candidate/README.md) — current companion source, tests, provider/reliability/voice code, build tools, native metadata, and pinned stock reference inputs.
- [deployment/](deployment/README.md) — explicit staging/install/verification/rollback tooling.
- [docs/E2-E3-implementation-status.md](docs/E2-E3-implementation-status.md) — current E2/E3 implementation and validation state.
- [docs/E5-E6-implementation-status.md](docs/E5-E6-implementation-status.md) — current E5/E6 implementation, API/native-lifecycle evidence, deployment state, and remaining GTA gate.
- [docs/plans/](docs/plans/) — design history, E2/E3 plans/reviews, native analysis, and original mission records.
- [docs/ROADMAP.md](docs/ROADMAP.md) — current roadmap through streaming, durable identity, perception, salience, autonomy, actions, and final acceptance.

## Roadmap

Current phase status:

~~~text
✅ E1 / E1.1
   Essential-native OpenAI/Luna foundation

✅ Observability / E4 pulled forward

✅ E2
   provider abstraction + stable session voices + acting

✅ E3
   stage-aware retries / failure recovery

✅ E5
   structured Responses streaming
   live Luna incremental-delivery capability validated

🟡 E6
   early segmented TTS implemented
   stock-controller/native-lifecycle gate passed
   → physical GTA acceptance pending

⏭ SESSION_IDENTITY
   durable character identity

→ PERCEPTION
   richer world/event awareness

→ SALIENCE
   decide what actually matters

→ SCENE_DIRECTOR
   NPC initiative / coordinated autonomous behavior

→ CUSTOM ACTIONS / ACTIVITIES

→ E7
   full regression, soak testing, and GTA acceptance
~~~

See the full [project roadmap](docs/ROADMAP.md).

## Project relationship to the old custom LSA 2.1 branch

This repository is the **Essential-based companion branch**.

It is not the old custom LSA 2.1 implementation upgraded in place.

The old/custom branch remains useful as a feature reference. When bringing an older capability forward, the intended process is:

~~~text
understand the old behavior
        ↓
check whether Essential already provides it
        ↓
use an Essential extension seam when possible
        ↓
port/reimplement only what is actually missing
~~~

That keeps Essential's native lifecycle authoritative instead of rebuilding LSA around a second parallel state machine.
