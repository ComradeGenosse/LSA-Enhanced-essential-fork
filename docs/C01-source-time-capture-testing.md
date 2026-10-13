# C-01 source-time microphone lifecycle — experimental GTA test

**Scope:** C-01's optional native microphone lifecycle and experimental
Phase 9 proximity listener. The **shadow** setting collects source-time
microphone/turn diagnostics, without distributing speech. The **experimental**
setting additionally samples native per-observer geometry and sends v2 speech
receipts over the existing authenticated perception pipe. Only one accepted
STT, real native release, matching private P0 turn identity and verified
observer-specific audible intervals can authorize speech knowledge.

Source-time microphone IDs are attached to Essential's existing private
`turnKnowledge` block when its active mic is already known at P0. If native
Core callback ordering has not yet made that ID available, the older strictly
bounded one-active-mic join is still a provisional fallback; this boundary
**must be validated in GTA**. No new microphone engine, pipe, chat session,
persistent speech store or per-listener STT call is introduced.

**Scope exclusions:** PS7 group response routing, unconditional speech memory
writes and NPC-to-NPC playback transcription remain disabled. This is an
experimental test slice; MP8/Phase 9 GTA acceptance is not yet complete.

## Pinned Essential boundary

- Core SHA-256: `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`.
- Private central InputController mic start: metadata token `0x0600016F`.
- `InputController.SendMicStop()`: `0x06000170`.
- Existing `EssentialMicState` derives the active-mic Ped field from
  `SendMicStop` IL. The passive start prefix mints a provisional microphone ID when the
  pinned helper exposes a physical Ped; only the postfix, after Core owns
  the active mic, emits the authoritative start. If the Core helper lacks a
  readable Ped, the postfix remains the safe fallback. We capture the
  pre-stop Ped before Essential clears it; the stop postfix
  checks whether the Ped actually changed. A stop call that leaves it active
  does not count as released.
- Hook setup reuses Harmony already supplied to the P2 native loader. No Core
  replacement or new capture engine. Source-timed facts are recorded in a
  bounded queue and sent through the existing intelligence pipe on owner Update.
  Hook/buffer failure disables optional C-01 collection without touching
  Essential's microphone.
- A released event describes a native mic transition only; **it does not
  prove nonempty PCM, a successful transcription or an observed conversation**.
  Start source is conservatively `essential_mic` until stock/MarkedTalk/UX4
  path-specific source provenance is proven. A missing native Ped association
  is represented as null, not the current/latest target.

## Build and activation

Build both the regular companion and the P2 native add-on from this branch,
using the repository's existing pinned prerequisites; in particular:

```powershell
cd lsa-essential-e1-candidate
node tools/runTests.mjs
node tools/buildCandidate.mjs
node tools/buildCharactersAddon.mjs
```

Use the normal deployment scripts/process to stage and install the **matching**
companion bundle and `LSA.PromotedCharacters.Runtime.dll`; retain the
existing Core, stock payload, provider credentials and installed mods.
This branch contains source code, not an installation or compiled binary.

Keep the companion's existing `intelligence.mode = "shadow"`.
In `plugins/LSA.PromotedCharacters.json`, enable collection independently:

```json
{
  "intelligence": {
    "mode": "shadow",
    "pipeName": "LSA.Intelligence.v1",
    "directorMode": "experimental",
    "captureMode": "experimental"
  }
}
```

The block illustrates only the intelligence portion of the existing file.
Preserve the other working keys (enabled/worldProfileId/other modes). The
`directorMode` shown is the current experimental baseline, **not** a
prerequisite for capture; keep your actual director mode unchanged.

The default/example `captureMode` is `off`. Keep `shadow` for the
previous C-01-only diagnostics. Set `experimental` **only** for the new
proximity-hearing test: this advertises the native `playerSpeech` capability
only after the pinned Harmony hooks attach. It allows verified overheard
speech into PS2/PS3 and subsequently PS4, subject to the original PS6
admission gates. It does **not** start another transcription or auto-write
long-term memories.

## In-game checks

1. Start GTA and inspect RAGE logs for `[C01] mic_hooks=attached`. If it says
   `mic_hooks=unavailable`, stop and inspect the pinned Core/Harmony/metadata;
   do not mark the gate passed.
2. Start/release **stock Talk** three times, then MarkedTalk, then UX4 PTT.
   The PS `companion_shadow.c01` diagnostic counts should show one
   `started` and one `ended` per successfully admitted native mic. For
   silent/empty recordings no speech or hearing knowledge should be added.
3. Test an early cancellation, actor removal, stop after a target swap,
   pause/resume, repeated stop and world reload; no orphan start/end may
   become a valid transcript or leak another NPC's identity.
4. Confirm typed input does not emit a native microphone start. An accepted
   typed turn gets a companion-local, exact Essential-tuple, zero-duration
   annotation with **no acoustic observers**.
5. After releasing the mic, inspect `companion_shadow.c01.joined` and
   `companion_shadow.c01.sttAccepted`. Both should advance for a player-mic
   turn whose promoted NPC has a current P0 capture reference. Missing native
   actor association, early cancellation, no PCM or stale epoch must not
   advance `sttAccepted`. The STT provider must still run only once.
6. Under `experimental`, have Nathan listen while Sarah is nearby. Speak
   once to Nathan; check `companion_shadow.c01.receipts`, `.accepted` and
   `.observations`. Ask Sarah on a **later** turn what she heard while her
   observation/transcript window is current. Full-coverage listeners may quote
   the actual STT; partial-coverage listeners may know speech was present but
   **not** the words. An NPC beyond 12 m (6 m in the verified enclosed
   shared-vehicle case), across blocked interiors, or with an unknown acoustic
   path must not receive words. Only source-time, current observers count.
7. Repeat with Nathan and Sarah swapping locations or entering/leaving
   vehicles during speech, a cancelled recording, and a short mic/turn swap.
   Missing samples, LOS-budget exhaustion, lost native owner, and invalid
   source-time receipt must drop hearing authority, not produce false quotes.
8. Confirm existing requested dialogue, PS4 event knowledge, Director speech
   and controller/UX4 ownership continue to behave as before.

Record the exact DLL and bundle hashes, game session, captures/terminals and
observed failures for the source-hook acceptance gate. The joined transcript remains private to the bounded C-01 runtime ledger.
Because Core/native and companion do not currently exchange a direct shared
turn token, shadow diagnostics may additionally use a unique in-flight mic,
a proven P0 captureRef and a 1.5-second bounded association window.
**This bounded inference cannot authorize nearby NPCs' words.**
Experimental proximity requires an exact `micUtteranceId` recorded in the
native P0 `turnKnowledge` block, confirmed by source start/end and the
same accepted STT. If Essential invokes P0 before even the native start
prefix, proximity will reject the attempt, and the GTA callback-order
trace will identify that integration gap.
That pairing still needs the GTA A19/A20 receipt to establish real-world
correctness. Any uncertain pairing remains unsupported, not assumed true.
The v2 receipt is now implemented in code, but the **physical GTA
sampling, Core callback order and the P0 microphone token availability**
remain acceptance probes. Native monotonic time is translated at receipt into
the companion's clock domain using the native end-age, preserving exact native
start/end **duration** without comparing unrelated absolute timestamps.
`SharedTranscriptStore` authorizes verbatim quotes only for complete
bounded intervals, subject to the current 30-second speech TTL.

## Fail-closed guarantees

- Native Core hash or metadata mismatch: C-01 off.
- Hook exception, lost mic field or capacity exhaustion: diagnostic only; no
  inferred hearing, fake actor identity, extra transcription or mic control.
- Restart, reconnect, world epoch reset, entity retirement: no old
  utterance may authorize new speech knowledge.
- No user speech text, PCM, raw GTA handles or UUID identities are written
  to persistent diagnostics.
