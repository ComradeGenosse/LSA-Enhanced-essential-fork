# NPCTalk reference snapshot — 2026-10-16

**Reference only; not built or loaded by LSA.** This directory contains unmodified upstream source files, copied from [christos-antono/NPCTalk](https://github.com/christos-antono/NPCTalk) at commit [59635ceb8ee010599c3caf9d9d1ee1aa114af91d](https://github.com/christos-antono/NPCTalk/commit/59635ceb8ee010599c3caf9d9d1ee1aa114af91d).

| This file | Original upstream path | Upstream Git blob |
| --- | --- | --- |
| `SpeechPlayer.cs` | `examples/gta-v/mod/SpeechPlayer.cs` | `b39160bbd443bb58fe5e098889a77d58ec933f77` |
| `NpcVoiceScript.cs` | `examples/gta-v/mod/NpcVoiceScript.cs` | `8b43b9fe1b8205bb291d0e0d91c6ddc2ffe8f9f7` |
| `LICENSE` | `LICENSE` | `b64f5205315d649fcdac4c4a7d1bef259b7cf08e` |

Copyright (c) 2026 Christos Antonopoulos. Licensed under MIT; see [LICENSE](LICENSE). Retain the notice when adapting code.

The upstream example targets GTA V **Legacy** with ScriptHookVDotNet and NAudio; LSA targets **Enhanced** with RAGE Plugin Hook and Essential's existing native playback authority. Do **not** include these two unmodified files in a native project or reuse their independent sound output path as an LSA audio player.

Relevant functions: `SpeechPlayer.LevelTap`, `AddPcm`, `Pan`, `Volume`; `NpcVoiceScript.UpdateSpeaker`, `UpdateMouth`, `PlayFace`, and `EndSpeaker`. For technical integration, read [the implementation plan](../../plans/npctalk-npc-voice-presence-implementation-20261016.md) and [the implementation-agent prompt](../../handoffs/NPCTALK-NPC-VOICE-PRESENCE-IMPLEMENTATION-PROMPT-20261016.md).
