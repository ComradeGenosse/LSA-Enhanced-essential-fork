# Offline character speech recovery (voice fallback)

## Current scope and limitations

This is a **pre-native-PCM** recovery path. On STT, Luna, validation, or TTS
failure, if the current native turn is still live, no PCM has been sent, and
a matching prerecorded character asset exists, E1 feeds the recorded
24-kHz mono PCM16 into the **existing** native audio transport. No AI request,
network connection or synthesis is needed at failure time.

No new audio player, microphone owner, Essential command dispatcher, or
memory system is created. Fallback audio succeeds **only after** exact native
`playback_ended(completed)` plus RAM-history acknowledgment. Original failed
dialogue is discarded; completed fallback text is recorded as the spoken
assistant line. Gameplay commands already published are **never repeated**.
With an unverified action outcome the line must be neutral (e.g. "Let me
check that"), never "I'm driving" or "Done".

**Native transport failure, partial speech, cancellation, supersession, or a
stuck playback-completion session are NOT solved by a local WAV file.**
The v3 native contract exposes no reliable queue-drain/reset-and-reopen
capability on the same turn. The runner retires that turn using the existing
`failTurn` path and does not talk over the player or replay an action.
A separate reviewed native contract change is required to add an independently
proven recovery route for those cases. Audio playback receipts are not faked.

## Recording and deployment

Assets are not committed by default. No production-ready prerecorded Nathan
clips exist in the repository. This change is **not audio validated** until
real character recordings have been generated, packaged, deployed and
successfully played in GTA.

1. Copy `VoiceFallback/recording-plan.example.json` to
   `VoiceFallback/recording-plan.json`.
2. Replace `characterId` with the real, **verified** P1 persistent character
   UUID from the promoted-character profile (not the NPC name or pedId).
3. Replace `voice` with the **exact configured ElevenLabs voice alias**
   belonging to that character, then customize text for the character.
   Another NPC will never silently use Nathan's clips.
4. Use Node 22+ and set `ELEVENLABS_API_KEY` in the calling process
   (do not put secrets in the plan or Git).
5. Run `node tools/recordVoiceFallback.mjs path/to/e1.config.json VoiceFallback/recording-plan.json`
   from `lsa-essential-e1-candidate`.
6. Verify `VoiceFallback/manifest.json` and the corresponding
   `VoiceFallback/<character-uuid>/<clip-id>.wav` files. The normal candidate
   builder copies the complete `VoiceFallback` directory into the server
   distribution, which is installed with the E1 files.
7. Test with a deliberately failed pre-PCM TTS response in GTA. Observe
   `voice_fallback_requested`, `voice_fallback_selected`,
   `voice_fallback_playback_started`,
   `voice_fallback_playback_completed`, and the matching native
   `playback_ended(completed)` event for the **same turn ID**.

The WAV parser accepts only standard 44-byte PCM RIFF, 24,000 Hz, mono,
16-bit, with aligned samples and at most seven seconds per clip. MP3 and
M4A are not accepted (intentional removal of decoder dependencies).
Manifest IDs and asset paths are bounded; traversal is rejected.

## Configuration

Add to `e1.config.json` as desired:

```json
"localVoiceFallback": {
  "enabled": true,
  "assetDirectory": "VoiceFallback",
  "maxRecoveryDelayMs": 1500
}
```

The feature defaults on but is inert without verified identity and
matching recordings. Directory is a safe single folder name under the
installed server directory. Local read has a bounded timeout. Provider
retries retain the existing execution policy and never redo native commands.

## Categories and authoritative action outcomes

`misheard`: STT failure. `lost_thought`: failed Luna/invalid model
decision. `speech_lost`: TTS failure before PCM. `action_unconfirmed`:
a stock action has been published or ACT is pending; no success asserted.
`action_failed`: known unavailable activity. `action_succeeded` is
reserved for a future **verified**, authoritative success receipt.

Missing category audio fails safely and terminates the original turn;
there is no fallback to another character, voice, language or misleading
action claim. Clip selection rotates recently used assets in-process
without persisting user speech.

Telemetry contains turn correlation, failure stage/reason, selected
category and asset ID, playback outcomes and native receipts. Mic audio,
the spoken words, API keys and vendor message text are not logged by
these events. No browser debugging dashboard is required.

## Validation state

Unit tests exercise PCM validation, asset absence/corruption, wrong
identity/voice, category routing, rotation, I/O timeout, history proof
and ledger reset. Also run the existing essential source suite. Native
runtime playback cannot be proven by Node tests or GitHub Actions.

**Unfinished:** real recorded packs for Nathan and other characters,
GTA audible playback confirmation, independent post-PCM or native playback
recovery contract, and full in-GTA race validation. Those items must not
be called complete or merged as production-ready without evidence.
