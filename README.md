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

Current `main` includes the production dialogue stack plus the merged identity, promoted-character, UX, perception and salience foundations:

- E1/E1.1, E2, E3, E4, E5 and E6 are implemented. E6 remains worth stress-testing for audible pre-terminal audio and real multi-segment continuation, but it no longer blocks roadmap progression.
- P0 TURN_CONTEXT is merged and used by later stages. Its original standalone GTA checklist remains useful regression coverage rather than evidence that P0 is uninstalled.
- P1 SESSION_IDENTITY is merged and is exercised by the live P2 promoted-character path.
- P2 PROMOTED_CHARACTERS is merged and has been exercised in GTA for promotion, editor/profile memory editing, summon, follow/wait and native vehicle/driver behavior.
- UX0–UX3 are merged: command bridge, gesture router, F11 menu, Current NPC / Characters / Controls / AI / Diagnostics.
- **UX4 is now merged to `main`.** The current interaction is: normal hold = direct Talk with no selector bracket; tap = explicit target selection; repeated taps = cycle; explicit selection survives after the bracket fades and is used by the next hold. Shared Essential Talk-key interception is supported, so the existing controller binding can stay unchanged.
- PS0/PS1, PS2 and corrected PS3 are merged. PS3 is deployed in shadow and live JSONL persistence plus real PS2→PS3 evaluation were verified in GTA. The October 5 run also exercised retained-history pressure without admission drops. The controlled native damage-callback probe remains open.
- Player-speech witnessing remains intentionally disabled until a source-time capture/utterance receipt is proven. Post-STT text is not treated as hearing.
- ACT0/ACT1 and ACT2 are substantial **implemented but unmerged** branches. They require reconciliation onto current `main`, post-hardening regression/build reruns and GTA probes before production enablement.
- Radio R0–R2 is implemented on an unmerged branch as raw factual sampling only. CGE conversation gaze/engagement is planned/documented but not implemented.
- PS4+ and ACT3+ remain future implementation work under the convergence architecture.

The latest live UX4/PS3 run is documented in [docs/ux4-ps3-run-analysis-20261005.md](docs/ux4-ps3-run-analysis-20261005.md). It verified shared Mouse4 suppression, three clean microphone turns, PS3 evaluation, JSONL persistence and history-pressure behavior. It did **not** validate the later direct-talk/explicit-selector UX refinement now on `main`; that refinement still needs a fresh GTA acceptance pass.

Build/deployment state and physical acceptance are intentionally tracked separately. A phase can be merged without being physically accepted, and a local installation can lag repository `main`.

## Project layout

- [lsa-essential-e1-candidate/](lsa-essential-e1-candidate/README.md) — companion source, provider/reliability/voice/perception code, tests and build tooling.
- [native/promoted-characters/](native/promoted-characters/README.md) — P2 native host plus the merged UX/perception integration surface.
- [native/session-identity/](native/session-identity/README.md) — explicit-owner P1 identity library.
- [deployment/](deployment/README.md) — explicit staging/install/verification/rollback tooling.
- [docs/ROADMAP.md](docs/ROADMAP.md) — authoritative current roadmap and implementation/deployment/acceptance distinctions.
- [docs/UX4-talk-targeting-status.md](docs/UX4-talk-targeting-status.md) and [docs/UX4-talk-targeting-gta-acceptance.md](docs/UX4-talk-targeting-gta-acceptance.md) — merged UX4 behavior and its remaining GTA gates.
- [docs/PS3-deterministic-salience-status.md](docs/PS3-deterministic-salience-status.md) and [docs/ux4-ps3-run-analysis-20261005.md](docs/ux4-ps3-run-analysis-20261005.md) — current PS3 implementation and live-run evidence.
- [docs/controller-setup.md](docs/controller-setup.md) — current controller/shared-Talk setup.
- [docs/E2-E3-implementation-status.md](docs/E2-E3-implementation-status.md), [docs/E5-E6-implementation-status.md](docs/E5-E6-implementation-status.md), [docs/P0-turn-context-status.md](docs/P0-turn-context-status.md), [docs/P1-session-identity-status.md](docs/P1-session-identity-status.md), and [docs/P2-promoted-characters-status.md](docs/P2-promoted-characters-status.md) — phase-specific implementation records.
- [docs/plans/](docs/plans/) and [docs/research/](docs/research/) — design history and forward architecture. Files that describe an older checkpoint should be read as historical unless they explicitly say they are current.

## Roadmap

At a glance:

~~~text
✅ E1/E1.1 · E2 · E3 · E4 · E5 · E6
✅ P0 · P1 · P2
✅ UX0–UX4
✅ PS0/PS1 · PS2 · PS3   (shadow; damage-callback probe still open)

🟡 ACT0/ACT1 implemented on branch, unmerged
🟡 ACT2 implemented on branch, unmerged
🟡 Radio R0–R2 implemented on branch, unmerged
🔵 CGE planned
→ PS4 TurnKnowledgeFrame / epistemic firewall
→ ACT3 rich player activities
→ Profile v2 / TimelineGuard / SubjectRef
→ PS5 memory
→ PS6 initiative ∥ ACT5 model-proposed activities
→ PS7 social routing ⇄ ACT7 commitments/director integration
→ ACT6 navigation ∥ PS8 verified sensors
→ E7 integrated soak / acceptance
~~~

The immediate consolidation order is: fresh UX4 GTA acceptance on current `main`; reconcile and merge ACT0/ACT1; reconcile and merge ACT2; then proceed with PS4 and ACT3 in parallel under the system-convergence contracts.

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
