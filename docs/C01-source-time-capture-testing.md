# C-01 source-time microphone lifecycle — experimental GTA test

**Scope:** C-01's experimental native/companion source-time capture,
exact P0-to-native mic turn association and one-STT acceptance. The join is
strictly bound to a current captureRef, host run/epoch, native release and one
Essential player turn tuple. It can fail closed if Core and companion callbacks
arrive outside the bounded association window. **Proximity hearing, observer
acoustic coverage, speech-to-PS2 observations and PS7 social routing are not enabled and must not be inferred from these frames.** This is NOT a
claim that the entire Phase 8/MP8 acceptance gate is complete.

## Pinned Essential boundary

- Core SHA-256: `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`.
- Private central InputController mic start: metadata token `0x0600016F`.
- `InputController.SendMicStop()`: `0x06000170`.
- Existing `EssentialMicState` derives the active-mic Ped field from
  `SendMicStop` IL. We check the current state after the start method returns
  and capture the pre-stop Ped before Essential clears it; the stop postfix
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
    "captureMode": "shadow"
  }
}
```

The block illustrates only the intelligence portion of the existing file.
Preserve the other working keys (enabled/worldProfileId/other modes). The
`directorMode` shown is the current experimental baseline, **not** a
prerequisite for capture; keep your actual director mode unchanged.

The default/example `captureMode` is `off`. No new PS4 knowledge,
PS6 speech triggers or second transcription are authorized by this switch.

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
6. Confirm existing requested dialogue, PS4 event knowledge, Director speech
   and controller/UX4 ownership continue to behave as before.

Record the exact DLL and bundle hashes, game session, captures/terminals and
observed failures for the source-hook acceptance gate. The joined transcript remains private to the bounded C-01 runtime ledger.
Because Core/native and companion do not currently exchange a direct shared
turn token, admission additionally requires unique in-flight mic ownership,
a proven current P0 captureRef and a 1.5-second bounded association window.
That pairing still needs the GTA A19/A20 receipt to establish real-world
correctness. Any uncertain pairing remains unsupported, not assumed true.
Next: collect actual source-time observer coverage before enabling PS2 hearing.

## Fail-closed guarantees

- Native Core hash or metadata mismatch: C-01 off.
- Hook exception, lost mic field or capacity exhaustion: diagnostic only; no
  inferred hearing, fake actor identity, extra transcription or mic control.
- Restart, reconnect, world epoch reset, entity retirement: no old
  utterance may authorize new speech knowledge.
- No user speech text, PCM, raw GTA handles or UUID identities are written
  to persistent diagnostics.
