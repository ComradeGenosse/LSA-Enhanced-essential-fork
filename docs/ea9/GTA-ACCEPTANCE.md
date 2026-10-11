# EA9 isolated GTA V Enhanced operator acceptance

**Never run against the active GTA install.** Human operator procedure, not CI evidence. Cases are **NOT RUN** until a test operator records real receipts from an isolated installation sealed against the combined Agent F SHA. Default expressive mode is off.

## Record before starting

Capture source SHA, EA9 release-manifest SHA-256, exact native DLL and server bundle hashes, Node 24 version, Windows/game/RAGE versions, redacted model/voice identity, UTC time, tester, config diff, explicit active save/timeline proof, two opaque promoted NPC IDs, and Agent F combined matrix report. Never expose credentials, names, or private audio/memory text. Attach redacted native receipts and consented clips only.

Each case requires: ID, config mode, exact source/package SHA, native host run and epoch, owner/ped binding revision, M1 timeline/source status, protagonist sequence/revision, complete generation tuple, canonical text hash, sent TTS text hash, native playback-start/end tuple and accepted dialogue history receipt, measured first-PCM and first-audible offsets, PASS/FAIL/BLOCKED/NOT RUN, reason, evidence location. PCM generated != audible playback.

## Test matrix

| ID | Scenario | Pass condition |
|---|---|---|
| G00 | Default off, JSON storage, Luna v0; typed, STT and NPC spontaneous turns | Exact stock/canonical text, TTS input, history, action and controls parity; no tags or mood persistence |
| G01 | Shadow mode with otherwise identical pinned text and scene | Outgoing TTS bytes and history identical to off; no shadow-only mood commit |
| G02 | Native Franklin to Michael to Franklin switch | Native-authenticated player model and ordered revision changes for both switches, including ABA; old record not current |
| G03 | Cutscene, character switching, invalid ped, native disconnect and reconnect | Unknown/null revokes immediately; no stale protagonist or mood recovery |
| G04 | Explicit save A selection, fork/save B, reload A and restart | EA6 SQLite writable only with verified source AND explicit selection; no auto selection/JSON authority fallback; WAL recoverable |
| G05 | Promote NPC A and B; A personally witnesses danger, B does not | Only A has source-qualified evidence; never infer a second observer or permanent memory |
| G06 | One completed emotional A turn, next turn read twice, third turn and 22-second expiry | Exactly one follow-up and idempotent within that generation; no indefinite reseeding; expiry <=30s |
| G07 | Cancel before start, interrupt mid-PCM, supersede generation, disconnect | No mood/history completion without exact native ended and history accepted; no ghost playback |
| G08 | Early streaming vs buffered action turn | No early action speech before validation, no double speech, correct complete segment order |
| G09 | Typed/STT and PS6 Director speech with competing player turn | Correct owner tuple, player priority, Director speech-only/action veto |
| G10 | Complete multi-segment native speech with history receipts | Exact pedId, sessionNonce, turnId, generationId through native start/end; commit only after successful full playback and history acceptance |
| G11 | Measure API entry, first provider PCM, native PCM accepted, synchronized first audible sound | Real monotonic measured milliseconds for first PCM AND first audible, variance and 24 kHz PCM16; no invented timings |
| G12 | Experimental tagged/untagged A/B only after explicit billing approval | Approved Turbo tags on TTS-only copy, no canonical/history/memory changes; unapproved concerned untagged |
| G13 | Stop GTA and companion; rollback isolated installation; restart off | Hash-verified restoration of original DLLs, configs, JSON, SQLite, WAL/SHM, voices and unrelated files |

## Hard stops

Switch to off and rollback for a guessed player model, stale timeline proof, false NPC witnessing, cross-NPC mood leakage, interrupted completion recorded as history, altered canonical text, unsupported vendor tag, native/ABI fault, billable request without explicit approval or rollback hash mismatch. Unknown native identity is a correct neutral result. G00-G11 and G13 must not require billable audio when test doubles are sufficient. G12 is separately approved via PAID-ELEVENLABS-AB.md. Offline tests cannot mark a GTA case passed.
