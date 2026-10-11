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

**Repository snapshot — October 11, 2026.** Current `main` includes the production E1–E6 dialogue stack, P0–P2 identities and promoted characters, UX0–UX4, PS0–PS3, ACT0–ACT2, plus the **experimental Phase 6 / PS4 / Phase 13a (PS6 Director)** integration merged by [PR #23](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/23) and subsequent fixes. **Merged does not mean installed, enabled, release-ready, or GTA-accepted.**

- **E1–E6 / P0–P2 / UX0–UX4:** merged. P2 promotion, editor/manual memories, summon and controls have GTA evidence. Shared Essential Talk interception has GTA evidence; direct-hold/explicit-selector UX4 regression acceptance remains a separate gate.
- **PS0–PS3:** merged; prior shadow GTA runs verified native PS2→PS3 evaluation, bounded JSONL persistence and retained-history pressure. Structured witness scenarios and the controlled damage-callback probe are still open. Player-speech hearing stays disabled without native source-time utterance proof.
- **ACT0–ACT2:** merged by [PR #18](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/18), recorded hash-installed and GTA smoke-tested October 6. Individual ACT capability/default-off/physical-completion gates remain open.
- **Phase 6 (C-05/C-06) and PS4:** implemented in the merged experimental baseline. PR #23 confirmed **one real GTA PS4→Luna gunfire-knowledge exchange** with actual generated speech and playback; that single success does **not** close the full 81-requirement PS4 acceptance audit or every Phase 6 physical gate.
- **PS4 reliability fixes:** [PRs #27–#30](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/30) merged observer continuity, frozen knowledge acknowledgment, original PS3 grant age, and Director ticket/hydration repairs. These fix known code paths, not a blanket sustained-gameplay acceptance claim.
- **PS6 / Phase 13a:** speech-only Director scheduling, guarded native admission, existing Essential turn/playback binding and lifecycle corrections are on `main` after [PR #31](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/31) and [PR #33](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/33). Native Director playback evidence was captured in troubleshooting, but post-fix reliable contextual spontaneous speech, entitlement consumption and end-to-end GTA acceptance remain to be reverified on the exact installed payload.
- **PS6 chatter preset:** [PR #34](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/34) merged an **opt-in testing** preset: independently bounded 12 attempts/minute in companion and native admission versus the normal 4/minute. It requires a freshly built/installed native DLL and coordinated experimental configs; nothing is automatically enabled. See [testing preset configuration](docs/ps6-testing-chatter-preset.md).
- **Radio R0–R5/v2:** integrated with PS4 on **open draft [PR #32](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/32)**; not on `main`, not GTA-accepted. Radio native text-ID, catalog and physical evidence gates are open.
- **Contextual ballistics:** visual shooter/injury evidence work exists on **open draft [PR #35](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/35)**; not on `main`, and live damage-callback, native build and GTA gates remain open. Air/ground/surface precision is not claimed implemented.
- **Later roadmap:** PS5 automatic experiential memory, memory-aware PS6 (13b), CGE, C-01/proximity hearing, PS7/social coordination, ACT3–ACT7 and E7 integrated soak/release acceptance remain distinct future phases.

The [October 5 UX4/PS3 run](docs/ux4-ps3-run-analysis-20261005.md), [playable v1.0 milestone](docs/lsa-v1-implementation-milestone.md), [PS4 acceptance audit](docs/ps4-v1-acceptance-audit.md) and [project roadmap](docs/ROADMAP.md) preserve the evidence and remaining gates. Keep **code merge, local GTA installation, experimental mode, and physical acceptance** as four different facts.

## Project layout

- [lsa-essential-e1-candidate/](lsa-essential-e1-candidate/README.md) — companion source, provider/reliability/voice/perception code, tests and build tooling.
- [native/promoted-characters/](native/promoted-characters/README.md) — P2 native host plus the merged UX/perception integration surface.
- [native/session-identity/](native/session-identity/README.md) — explicit-owner P1 identity library.
- [deployment/](deployment/README.md) — explicit staging/install/verification/rollback tooling.
- [docs/ROADMAP.md](docs/ROADMAP.md) — authoritative current roadmap and implementation/deployment/acceptance distinctions.
- [docs/UX4-talk-targeting-status.md](docs/UX4-talk-targeting-status.md) and [docs/UX4-talk-targeting-gta-acceptance.md](docs/UX4-talk-targeting-gta-acceptance.md) — merged UX4 behavior and its remaining GTA gates.
- [docs/PS3-deterministic-salience-status.md](docs/PS3-deterministic-salience-status.md) and [docs/ux4-ps3-run-analysis-20261005.md](docs/ux4-ps3-run-analysis-20261005.md) — current PS3 implementation and live-run evidence.
- [docs/ACT0-ACT1-status.md](docs/ACT0-ACT1-status.md) and [docs/ACT2-status.md](docs/ACT2-status.md) — merged activity foundation, October 6 GTA smoke record and remaining capability gates.
- [docs/radio-track-perception-r0-r2-status.md](docs/radio-track-perception-r0-r2-status.md) — early radio sampler history; current unmerged integration is draft PR #32.
- [docs/plans/conversation-gaze-engagement/](docs/plans/conversation-gaze-engagement/) — bounded CGE head/eye attention plan.
- [docs/research/system-convergence-architecture.md](docs/research/system-convergence-architecture.md), [dependency graph](docs/research/system-convergence-dependency-graph.md), [contract register](docs/research/system-contract-register.md), and [risk register](docs/research/system-convergence-risks.md) — forward system architecture and dependency constraints.
- [docs/controller-setup.md](docs/controller-setup.md) — current controller/shared-Talk setup.
- [docs/E2-E3-implementation-status.md](docs/E2-E3-implementation-status.md), [docs/E5-E6-implementation-status.md](docs/E5-E6-implementation-status.md), [docs/P0-turn-context-status.md](docs/P0-turn-context-status.md), [docs/P1-session-identity-status.md](docs/P1-session-identity-status.md), and [docs/P2-promoted-characters-status.md](docs/P2-promoted-characters-status.md) — phase-specific implementation records.
- [docs/plans/](docs/plans/) and [docs/research/](docs/research/) — design history and forward architecture. Files that describe an older checkpoint should be read as historical unless they explicitly say they are current.

## Roadmap

As of October 11 (see the [authoritative detailed roadmap](docs/ROADMAP.md)):

~~~text
✅ E1–E6 · P0–P2 · UX0–UX4
✅ PS0–PS3 (shadow producer/evaluation evidence; acceptance partial)
✅ ACT0–ACT2 (merged, GTA smoke-tested; individual physical gates open)
🟡 Phase 6 / PS4: experimental code merged; one PS4→Luna GTA exchange verified
🟡 PS6 / Phase 13a: experimental Director code and fixes merged; live acceptance open
🟡 PS6 testing preset: opt-in 12/minute in both layers; requires rebuild/config
🟡 Radio R0–R5/v2: draft PR #32, not merged or physically accepted
🟡 Contextual ballistics R0: draft PR #35, not merged or physically accepted
🔵 CGE, C-01/proximity hearing, PS5 memory, PS7 social routing: planned
→ Validate exact deployed PS4/PS6 behavior, PS4 audit, Phase 6 and PS6 receipts
→ Finish radio/ballistics separate source, build and GTA gates
→ Optional playback-only gaze, ACT3–ACT7, memory-aware 13b and later phases
→ E7 integrated regression, long-session acceptance and release gating
~~~

The [October 9 playable v1.0 milestone](docs/lsa-v1-implementation-milestone.md) remains the **scope boundary** for the experimental implementation, not a statement that all physical GTA acceptance gates have passed. Original master-plan and research documents remain preserved as design/provenance, not a current branch-status inventory.

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
