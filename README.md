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

P2 now adds optional **promoted persistent characters**: application-assigned encounter names, explicit player promotion through P1, a separate profile/memory store and local editor, guarded summon/recreation, and existing Essential companion controls. It defaults off; promotion, editor/profile memory editing, summon, follow/wait, and native vehicle/driver behavior have been exercised in GTA, while broader regression/acceptance remains ongoing. See [P2 setup, behavior and acceptance checklist](docs/P2-promoted-characters-status.md) and [compile-only native package](native/promoted-characters/README.md).

Current `main` also contains the default-off **PS0–PS3 perception/salience pipeline** and **UX4 talk targeting**. PS3 runs in shadow and has live GTA evidence for PS2→PS3 evaluation plus privacy-filtered JSONL telemetry; player-speech hearing remains gated pending a source-time capture receipt, and direct DamageTracker callbacks still need a controlled probe. UX4 can reuse Essential's existing Talk key with no Steam Input remap: normal hold performs direct Talk without a selector bracket, while tap/cycle enters explicit target-selection mode.

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
- optional character-aware assignment from Essential's hydrated actor gender and age range;
- configurable voice pools with fail-closed demographic profile metadata;
- optional bounded demographic-aware TTS acting/style guidance;
- speech speed configuration;
- provider capability validation.

Character-aware assignment remains session-scoped: the profile is selected once from the first hydrated actor context and then frozen for that native session, including segmented E6 speech. The voice-profile labels are project calibration, not authoritative OpenAI gender/age metadata. See [character-aware NPC voices](lsa-essential-e1-candidate/docs/character-aware-voices.md).

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

Optional **dialogue tracing** keeps private local conversation details for debugging. In `e1.config.json`, set `"dialogueLogging": { "enabled": true }`. It writes bounded, rotating JSONL under `logs/dialogue` (up to five 10 MiB files by default). Records correlate the assembled OpenAI prompt, returned text/stream segments, validated decision, and observed native playback/history outcome. Large payloads are chunked and explicitly marked if truncated or incomplete. API credentials are redacted; audio and hidden reasoning are not recorded. Leave this setting off when dialogue capture is not needed, because the files can include NPC/world context and conversations. Stock Gemini requests do not use this trace.

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

For demographic voice matching, set `voiceAssignment` to `character-aware-session` and provide one `speechVoiceProfiles` entry for every configured speech voice. The checked-in example config contains a starter male/female and age-band calibration. See [character-aware NPC voices](lsa-essential-e1-candidate/docs/character-aware-voices.md).

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

The authoritative code baseline is `main@d7d8311`.

| Area | Current state |
| --- | --- |
| E1/E1.1, E2, E3, E4, E5, E6 | Implemented. E5 has live API capability evidence; E6 has GTA playback-path evidence. Audible-before-model-complete and multi-segment stress remain E7-style regression coverage rather than implementation blockers. |
| P0 | Merged and offline-verified; dedicated GTA target-reference stress checklist remains open. |
| P1 | Merged and used by P2. Live P2 promotion exercises the owner-authenticated identity path; deeper recreation/revocation/stale-work stress remains follow-up coverage. |
| P2 | Merged and exercised in GTA: promotion, editor/profile/memory editing, summon, follow/wait and vehicle/driver behavior. |
| UX0–UX3 | Merged. Command bridge, gesture router and F11 menu are part of the optional P2 loader; full controller acceptance remains incomplete. |
| UX4 | **Merged to main.** Shared Essential Talk-key interception was exercised in GTA with three clean turns and no duplicate stock Talk. The newer direct-Talk/no-bracket vs tap/cycle explicit-selector refinement is merged but still needs a fresh exact-main build/deploy/GTA pass. |
| PS0–PS2 | Merged in default-off/shadow form. The live pipeline is running; structured witness/episode acceptance remains open. Source-time player speech is intentionally disabled pending capture receipts. |
| PS3 | **Merged, deployed in shadow and live-telemetry verified.** The latest run recorded 380 PS3 decisions with 0 PS3 faults and no companion/PS2 admission drops under retained-history pressure. Structured salience behavior and direct player/NPC/vehicle damage callbacks remain open. |
| ACT0/ACT1 | Implemented and hardened off-main; 11 unique commits / 78 behind current main. Reconcile + full rerun before merge. |
| ACT2 | Implemented and hardened off-main; 40 unique commits / 78 behind current main, stacked on ACT0/1. |
| PS4+, ACT3+, CGE | Not implemented on main. Architecture/plans exist. |
| Radio | Raw R0–R2 sampler exists off-main; stronger public-data/text-ID v2 research exists. Reconciliation and GTA identifier proof are required before merge. |

The latest combined UX4/PS3 GTA report is [UX4 shared Talk + PS3 follow-up run analysis](docs/ux4-ps3-run-analysis-20261005.md). The full implementation/validation distinction and current branch reconciliation live in [ROADMAP.md](docs/ROADMAP.md).

## Project layout

- [lsa-essential-e1-candidate/](lsa-essential-e1-candidate/README.md) — current companion source, tests, provider/reliability/voice code, build tools, native metadata, and pinned stock reference inputs.
- [deployment/](deployment/README.md) — explicit staging/install/verification/rollback tooling.
- [docs/E2-E3-implementation-status.md](docs/E2-E3-implementation-status.md) — current E2/E3 implementation and validation state.
- [docs/E5-E6-implementation-status.md](docs/E5-E6-implementation-status.md) — current E5/E6 implementation, API/native-lifecycle evidence, deployment state, and remaining GTA gate.
- [docs/plans/](docs/plans/) — design history, E2/E3 plans/reviews, native analysis, and original mission records.
- [docs/UX-phase0-1-status.md](docs/UX-phase0-1-status.md), [docs/UX-phase2-3-status.md](docs/UX-phase2-3-status.md), [docs/UX4-talk-targeting-status.md](docs/UX4-talk-targeting-status.md), [docs/controller-setup.md](docs/controller-setup.md) — command bridge, gestures/menu and the current UX4 direct-Talk/explicit-selector controls.
- [docs/ROADMAP.md](docs/ROADMAP.md) — current roadmap through streaming, durable identity, perception, salience, autonomy, actions, and final acceptance.

## Roadmap

Current phase status, condensed:

~~~text
✅ E1/E1.1 · E2 · E3 · E4 · E5 · E6
✅ P0 · P1 · P2
✅ UX0–UX4 on main
✅ PS0–PS3 on main (shadow/default-off where applicable)

🟡 GTA/runtime validation still open:
   current-main UX4 refinement
   structured PS0–PS3 acceptance
   direct damage callbacks
   source-time player-speech capture receipts

🟡 Implemented off-main:
   ACT0/ACT1 → reconcile first
   ACT2 → reconcile after ACT0/1
   Radio R0–R2 → reconcile only after v2 identifier proof

→ Next new core implementation:
   PS4 immutable dialogue knowledge
   ACT3 rich short-range activities

→ Later:
   PS5–PS8
   ACT4–ACT7
   CGE head/eye engagement
   proximity/social routing
   Scene Director
   E7 integrated soak/acceptance
~~~

See the full [project roadmap](docs/ROADMAP.md) for exact branch deltas, validation gates, and sequencing.

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
