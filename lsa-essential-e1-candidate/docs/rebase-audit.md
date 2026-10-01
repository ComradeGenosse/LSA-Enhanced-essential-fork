# E1 Hotfix #3 rebase working audit

Baseline: copied candidate from the adjacent `files-pasted-by-the-user-we` workspace. All changes and builds stay in this candidate. Pinned bundle SHA-256 is 5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2; DLL is 9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653.

| Current owner / responsibility | Verified Essential equivalent | Decision / files / risk |
|---|---|---|
| Xn creates/binds generation; E1 snapshots it | stock le turn store and generation allocator | Keep native allocation, never allocate in adapter. Build hooks: avoid Gemini output-owner registration for OpenAI. Risk: stock callers also preflight owner maps. |
| E1 bridge checks ed active output owner | DLL TryAuthorizeTurn + stock RP/by accepted/rejected messages | Replace owner-dependent checks with exact native turn/session checks; await acceptance before any PCM. essentialGlue/buildCandidate. Risk: authorization event arrives synchronously or after cancellation. |
| Generic provider events share Gemini routing | AP/mK/CP/pP tagged protocol already exists | Use exact provider route, no binary fallback; require v3 endpoint. Keep stock Gemini branch unchanged. |
| TTS success stages readiness; two history listeners | Native by/vK/PlaybackEnded | One per-job subscription before output; commit in one place after exact successful completion. Remove global history listener and duplicate wait implementations. Wrong identity must not delete pending history. |
| Serial connection tail and mutable active slot | Immutable identity for independent HTTP work | Remove cross-job promise tail; abort old work and guard every continuation. Deduplicate launch/bind/input. Provider job is not playback owner. |
| Duration-derived acknowledgement timer | Matching native completion | Replace duration estimate with bounded failure-only deadline. Never infer success from bytes/time. |
| td retires Gemini output awaiting provider boundary | Exact tagged Ey interrupt and native terminal lifecycle | OpenAI bypasses retirement maps; exact failure/cancel cleanup, including accepted-but-zero-chunk authorization. |
| Current action list already uses ra(actor), Cb, h4 | Stock current bundle capability catalog and native dispatch | Preserve dynamic capability filter, strengthen parameter validation. Rb dispatches at transcript, except requestbackup at final; preserve timing and stock dedupe. Guard stale callback dispatch. |
| Native context and PTT | Stock hydration/context and microphone capture/drain | Preserve; tighten duplicate input/overflow/cancel handling without new capture subsystem. |
| HTTP, Responses, WAV and PCM | Provider concerns | Preserve with post-await cancellation checks and reader cleanup. |
| Hash + single-match AST hooks | Build-time contract | Keep input pins, add explicit lifecycle hook evidence/tests and stricter output isolation. |

DLL declarations checked in available decompilation: TryAuthorizeTurn(Ped,string,long,out string,Ped,string,bool), QueueTaggedAudioChunk(byte[],Ped,string,long,out string), MarkStreamEnded(string,string,long,out string), InterruptExactTurn overloads, PlaybackStarted/PlaybackEnded event fields. Implementation bodies are obfuscated. The shipped server source is authoritative for the existing wire mapping and observable acknowledgement behavior; do not infer that RP's `authorized` means accepted (it means request sent).

The stock server is part of Essential: its le turn store, action dedupe, playback gating and identity allocator are retained, not reimplemented. Gemini output-owner maps exist to correlate untagged Gemini output; OpenAI HTTP jobs already have identity and must not participate in them.
