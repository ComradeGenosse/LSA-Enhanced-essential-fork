# Phase 0 — standalone host, audio technology and distribution feasibility

**Research conclusion:** a standalone .NET Framework/RAGE host and independent Windows PCM playback are **plausible with identified APIs**. Device-grade and in-game audio behavior are **not verified**. No replacement plugin or Windows output prototype was built in this Phase 0 PR.

## 1. RAGE host architecture: direct evidence

The existing working add-on already declares a RAGE plugin using \`[assembly: Plugin(..., EntryPoint=..., ExitPoint=...)]\` in \`native/promoted-characters/EntryPoint.cs\`; it has a live \`GameFiber.Sleep(100)\` update loop and a cleanup path. This provides proven **source infrastructure**, *not* proof of standalone NPC authority.

Current Essential-specific host mechanism:

1. \`EntryPoint.StartHost\` invokes \`ClrDomains.FindEssential(bootstrap)\` and waits for the existing Core domain.
2. \`DomainHost.CoreStatus\` requires one loaded \`LosSantosAlive\` assembly with an exact SHA-256 before loading \`LSA.PromotedCharacters.Runtime.dll\` into **Essential's** AppDomain.
3. \`RuntimeEntry.Start\` launches the owner game fiber and registers \`IIntegration\` with Essential's \`IntegrationManager\`; P1/P2/PS/ACT callbacks then execute in Essential's dispatch context.
4. Existing compile-only/native test suites validate isolation, IPC and lifecycle behavior with stubs, but not the new host in actual RAGE.

**Required change:** independently load \`LSA.Native.Core\` from our own entry point; own one game-fiber dispatcher and world epoch; expose command and fact channels without \`ClrDomains.FindEssential\`, \`DomainHost.CoreStatus\`, \`IntegrationManager.Register\`, or any \`LosSantosAlive\` type at runtime. Avoid assuming a RAGE plugin can execute arbitrary game natives on a background network thread: RAGE documents fiber execution for synchronized game calls.

**Critical startup safety:** reject simultaneous Essential/native authority. Config flag alone is insufficient: validate runtime residency and reject a second active controller (distinct plugin names/process-wide ownership guard), while preserving safe shutdown and rollback. Do **not** load both and hope they address different peds by convention.

**Target compatibility:** current production project targets \`net481\`. Use compile-only, locally licensed RAGE Plugin Hook SDK references pinned to the exact supported GTA V Enhanced/RPH installation; run on Windows before deployment. Public NuGet shows RAGE plugin SDK target compatibility with .NET Framework, but it cannot prove the user's installed game build/API behavior.

## 2. More precise Essential audio finding (user-supplied DLL, static IL)

The SHA-matched \`LosSantosAlive(5).dll\` was inspected as managed metadata plus IL call tokens. Unlike an unsupported guess about the audio technology, these calls are present in methods belonging to \`LosSantosAlive.Audio.NpcSpatialAudio\`:

| Confirmed external call in audio class | Meaning of the evidence |
| --- | --- |
| \`NAudio.Wave.WaveOutEvent::.ctor\` | Uses an independently available Windows waveform output class |
| \`WaveOutEvent::set_DesiredLatency\`, \`set_NumberOfBuffers\` | Configurable buffer/latency setup |
| \`WaveOutEvent::Init\`, \`Play\`, \`Stop\`, \`Dispose\` | Explicit playback lifecycle |
| \`NAudio.Wave.WaveFormat::.ctor\` | Audio sample format construction present |

Metadata also enumerates \`NpcSpatialAudio.Initialize\`, \`SetAudioVolume\`, \`SetSpeakerPed\`, \`EnqueuePcm16Mono\`, \`TryQueueMonoChunk\`, \`InterruptTurn\`, \`IsAudibleAudioPlaying\`, \`GetLastChunkRms\`, \`Stop\`. The independent \`NpcPlaybackCoordinator\` maintains authorization, tagged turn/generation PCM, stream ending, interruption and playback events; \`NpcLipSync\` exposes start/stop operations.

**Interpretation:** use **NAudio 2.x** as the first independently authored backend candidate; it is compatible with .NET Framework, and the NAudio project publishes MIT terms. **Do not adopt NAudio 3** into \`net481\`: the current upstream NAudio 3 documentation states it targets net9+ and drops legacy .NET Framework. This proposal does not require using code or assets recovered from Essential.

**What is *not* proven:** the original class's spatial mixing/panning/attenuation implementation, Windows output device management, actual audible playback while GTA runs, interaction with the game's own volume settings, RMS-driven facial animation details, or animation native ownership. NAudio \`WaveOutEvent\` alone is an output backend, **not** a source-attached GTA emitter or built-in 3D renderer.

## 3. Candidate audio choices and constraints

| Option | Why consider it | Limitation / decision |
| --- | --- | --- |
| NAudio 2.x WaveOut/WASAPI + independently written attenuation/pan | Evidence that Essential uses NAudio; .NET Framework support; straightforward PCM buffering and device testing | Pan/distance/occlusion/headphone spatial feel **must** be implemented separately; audio will be emitted through Windows output, not automatically GTA's native mixer |
| XAudio2 + X3DAudio positional DSP | Microsoft documents 3D listener/emitter calculations and output channel matrices | New interop and lifecycle complexity; defer unless NAudio meets neither spatial realism nor quality |
| GTA native sound system for streamed arbitrary PCM | Would integrate more directly into game's mixer if proven | **No proven supported arbitrary speech PCM route identified.** Do not assert one exists or build phase gates on an unverified API |

**Phase 1–4 design:** expose \`IAudioOutput\` and \`IListenerPose\` behind a deterministic test adapter. Transport PCM is 24 kHz mono PCM16 from our TTS path; choose output format and resample only at the hardware edge. Bound audio bytes and queue duration, implement monotonic chunk indexes, correctly drain vs hard-cancel, handle output-device failure, expose device-start/end receipts, and keep expensive audio processing off the GTA native-call fiber. Poll speaker/listener 3D poses **on the game fiber**, publishing immutable snapshots to the output worker.

## 4. Offline technical go/no-go before live game

Before any GTA standalone audio test, require:

- Real Windows .NET Framework compilation (not a fake or isolated project substituted for the production assembly).
- A standalone NAudio output smoke tool (not using Essential), explicit TTS 24 kHz PCM fixture with expected output bytes/time and deterministic completion.
- Invalid-sample, out-of-order chunk, missing EOS, duplicate EOS, underflow, excessive backlog, mid-stream cancel, speaker retirement and output-device-unavailable tests.
- Bounded CPU, memory and latency measurements from the actual adapter on Windows (not extrapolated from Node tests).
- Legal copy/reference of RPH/NAudio DLLs, dependency versions pinned and license notices tracked; no RPH SDK or Essential binaries redistributed in the repo or PR.

**Physical GTA gate remains required** for actual 3D position/volume/occlusion, listener movement/vehicles, competing audio, lip-sync timing and owner-fiber safety. Phase 0 cannot truthfully pass these without a game installation.

## 5. Distribution/licensing decision

- **Essential/LSA original assets:** Nexus author permissions prohibit third-party modification and distribution/use of their files/assets without permission. Independently implement our native runtime and do not ship \`LosSantosAlive.dll\`, stock \`server.bundle.mjs\`, copied AI prompt packs, sound assets, or author-created resources unless permissions are obtained. Static compatibility/behavior research does not grant redistribution rights.
- **RAGE Plugin Hook:** its package description asks not to upload/repackage the SDK without prior written permission. Compile against an installed or approved SDK, exclude it from distribution; confirm installed version and any provider restrictions.
- **NAudio 2.x:** project documents MIT; retain applicable copyright/license attribution if distributing it. Pin concrete version and transitive dependency licenses in Phase 1 packaging bill of materials.
- **RAGENativeUI:** NuGet 1.9.3 lists MIT and .NET Framework compatibility; remain optional for the first typed-turn slice, reuse only under its terms.
- **XAudio2/X3DAudio:** native Windows API option, not a presently built dependency. Review redistributables and exact Windows availability before selecting.

**License research status:** enough to prescribe a clean, independently authored Milestone A design; **not** a blanket sign-off on any future assembled distribution. A real bill of materials must be reviewed at implementation time.

## 6. Environment/GTA evidence needed before first deployment

Record installed GTA exe/RPH versions, available SDK/.NET/NAudio versions, current LSA/native/Node hashes, audio device name (prefer redacted/hardware-category only in PR), configuration/voice/microphone sample rates, log run IDs and a local backup restore. Use the source-level baseline to specify the capture list; we cannot infer current *installed* binaries from the repo.

### Reference material

- Source: \`native/promoted-characters/EntryPoint.cs\`, \`ClrDomains.cs\`, \`DomainHost.cs\`, \`RuntimeEntry.cs\`, \`PromotedCharacters.csproj\` and \`docs/plans/LosSantosAlive_Hotfix3_Extension_API_Analysis.md\`.
- [RAGE Plugin Hook execution model](https://docs.ragepluginhook.net/html/4c04eafe-2474-4f41-9087-ac47bb16d491.htm)
- [RAGE Plugin Hook NuGet redistribution note](https://www.nuget.org/packages/RagePluginHook)
- [NAudio official source/license/version compatibility](https://github.com/naudio/NAudio)
- [X3DAudio positional calculations](https://learn.microsoft.com/en-us/windows/desktop/xaudio2/x3daudio-overview)
- [RAGENativeUI 1.9.3 compatibility/license](https://www.nuget.org/packages/RAGENativeUI/1.9.3)
- [Los Santos Alive Nexus author permissions](https://www.nexusmods.com/gta5enhanced/mods/985)
