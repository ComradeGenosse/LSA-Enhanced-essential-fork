# EA FINAL C — Emotional continuity and ElevenLabs applied-delivery handoff

Date: 2026-10-11
Branch: `feature/ea-final-c-emotional-delivery-20261011`
Required immutable base: PR #68, `4cad39198478d7f03bb8ec6657b674e52fa659dd`
Source imports: EA7 PR #78, `7e9427fa704ddfba9405bef6c423db0f7f3cdca6`; EA8 PR #79, `199d602f725e323763441da6cb139e5d0a0241c7`.
Status: **draft, offline source reconciliation; NOT yet Agent F wired, GTA accepted, CI accepted, or vendor-audibly verified.**

## Source delivered

- EA7's `moodRuntime.mjs`, `moodStore.mjs`, `sceneDelivery.mjs`, `resolveSpeechDelivery.mjs` imported from the real EA7 source and reconciled with EA8.
- EA8's `elevenTags.mjs` and `speechProvider.mjs` imported from real EA8 source, retaining 24 kHz aligned PCM, strict Unicode/budget, bracket sanitization, preflight, and cancellation after `is_final`.
- The verified-model-only selector now gets supported tag values from the **same** `verifiedElevenTagForDelivery(value, modelId)` policy used by the actual Turbo renderer. `fearful` maps to `[scared]` only for `eleven_v4_turbo`. `concerned` remains untagged. EA0's old six-key exported map and standalone unspecified-model renderer default remain solely for historical EA0 pure-renderer compatibility: actual provider/selector paths always supply modelId and fail neutral for unsupported models.
- The selector accepts only **in-process branded** delivery instances returned by the trusted EA1 selector. No plain Luna JSON, spread copies, fake delivery objects or arbitrary string tags can gain the brand. One new branded per-segment object is minted, avoiding shared-selector object aliasing.
- `speechProvider.synthesize()` returns its existing `bytes/chunks/sampleRate/channels` plus diagnostic `tagApplied:boolean`, `appliedTag:string|null`. Only after successful socket-send, final PCM drain, positive byte reconciliation and no cancellation does the provider privately WeakMap-brand the returned result. `wasElevenTagApplied(result, {delivery,identity})` is the authoritative, in-process check. Diagnostic object fields alone never prove anything.
- `synthesized(delivery, nativeReceipt, providerResult)` records per-segment evidence only when that specific delivery and native identity match a real provider-applied tag AND a complete/accepted `playback_ended` receipt. It **never** commits mood.
- `complete(nativeReceipt,{historyAccepted:true})` must be called **after every segment acknowledgment and only after stock `history.acceptPlaybackResult(...)` accepted**. It chooses the last fresh, actually applied and playback-accepted mood-eligible delivery by original segment ordinal, not callback arrival order; calls the EA4 mood adapter once. Omitted/unsupported/cancelled/foreign/partial audio never counts; `ephemeral_mood` cannot recommit itself.
- `moodRuntime.onSpeechCompleted` independently insists on `historyAccepted:true`, a real branded provider result, a complete native reason `completed`, all four exact owner tuple fields, and current P1/PS2/native/M1/protagonist proof. No new SQLite, native producer or permanent memory effects.
- MoodStore keeps a bounded same-map generation tombstone after its 22-second value expiry, so a late duplicate completion cannot resurrect expired emotion. Soft value is still removed; at most 128 records are retained. Same-turn idempotent soft reuse and exactly one next generation remain.
- Off/shadow text remains unchanged at the WebSocket input boundary. Experimental sanitizes only temporary speech, not the dialogue, transcript, native command or memory. No additional ElevenLabs or Luna call path was added.

## Mandatory Agent F integration contract — NOT implemented in this branch

The current `src/openai/runSequentialTurn.mjs` **does not pass provider outcomes** to the emotional resolver, and its existing two-argument `synthesized(delivery,receipt)` cannot establish applied-tag evidence. Consequently EA4 must remain neutral until F wires this.

1. Preserve **each actual** returned `audio` object from `services.speak()` alongside its own `delivery` in both early-segment and buffered/director branches:
   ```js
   if (audio?.bytes && delivery) renderedDeliveries.push({
     delivery, providerResult: audio, sequence: segment.sequence, // or 1 for buffered
   });
   ```
   Do not push the final aggregated earlyAudio byte count as a stand-in for each provider result.
2. Only after `observation.completion` confirms `result.type === 'playback_ended'`, `result.reason === 'completed'`, `result.ok === true`, `wasInterrupted === false`, `hadAudio === true`, `playbackStarted === true`, with complete `pedId/sessionNonce/turnId/generationId` matching native identity, and after the **existing** `history.acceptPlaybackResult({ ...result, playbackSucceeded: true })` returns true:
   ```js
   for (const {delivery,providerResult} of renderedDeliveries)
     speechDelivery.synthesized(delivery, result, providerResult);
   speechDelivery.complete(result, {historyAccepted:true});
   ```
3. Do not fabricate `providerResult`, `tagApplied`, `acceptedHistory`, `playback_ended` or native identities. Do not deserialize/clone the branded return object; the WeakMap cannot survive JSON transport. The existing in-process speak result should be preserved.
4. Keep `speechDelivery.retire(playbackCommitted)` in finalization; cancel/abort turns never call `complete`. Keep the original history, action guard, canonical transcript and stock native lifetime semantics. Do not commit once per streamed segment: all segment receipts must be gathered before one `complete` call.
5. Wire EA5's real revocable `protagonistAuthority.readVerified/isCurrent` and EA6's P2 M1-selected, verified SQLite timeline onto the actual `createMoodRuntime`. Listen for lifecycle `clear()` on host, world, save, owner and protagonist revision changes. No synthetic approval/source substitute.
6. Ensure the active config's exact `elevenLabs.modelId` reaches the resolver; unsupported/unknown model IDs are non-taggable. `off` never resolves, `shadow` never commits and must send byte-identical TTS text.
7. Run integrated tests on the exact F head, including the native playback result with full identity fields, early/final provider return retention, typing, mic/STT and Director paths. Direct EA2 mock-speak tests were amended to explicitly expect **no** mood without this missing wiring.

## Test paths and evidence

New: `tests/ea-final-c-emotional-delivery.test.mjs`, `tests/helpers/eaFinalApplied.mjs`.
Imported and adapted: `tests/ea7-emotional-continuity-completion.test.mjs`, `tests/ea8-elevenlabs-provider-safety.test.mjs`, `tests/ea2-speech-delivery.test.mjs`, `tests/ea2-turn-lifecycle.test.mjs`, `tests/ea4-runtime-integration.test.mjs` (also repairs baseline line-128 parse defect).
All tests are network-free and use the real production provider implementation with a fake socket.

**Execution status:** no repository Node CLI suite was executed. This working environment has a GitHub file/PR connector, but cannot clone this repository into its Node container or start a GitHub workflow run. A V8 JavaScript source syntax compilation check passed for modified source and test files; this is *not* a substitute for `node --test`. Do **not** mark Node acceptance passed. The existing `.github/workflows/ea-integration.yml` only watches integration-branch push or PRs against the planning branch, not this stacked feature PR, so exact-head CI may not auto-run.

To run on an actual checkout:

```sh
cd lsa-essential-e1-candidate
node --test tests/ea-final-c-emotional-delivery.test.mjs tests/ea7-emotional-continuity-completion.test.mjs tests/ea8-elevenlabs-provider-safety.test.mjs tests/ea2-speech-delivery.test.mjs tests/ea2-turn-lifecycle.test.mjs tests/ea4-runtime-integration.test.mjs tests/emotional-mood-continuity.test.mjs tests/elevenlabs-emotional-acting.test.mjs tests/elevenlabs-provider.test.mjs tests/scene-delivery.test.mjs
npm test
```

Also run Windows and Linux workflow, isolated Python, native/ABI and packaging on integrated F head. Any failure is a hard no-deploy blocker. No paid ElevenLabs request or GTA change/test was performed.

## Vendor evidence and limits

- ElevenLabs official September 30, 2026 v4 tag list: https://elevenlabs.io/blog/elevenlabs-audio-tags-list — `[scared]` explicitly listed, and v4 Turbo API audio tags supported.
- Official Text-to-Dialogue WS: https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd — `eleven_v4_turbo` real-time stream inputs.
- **Emitted-tag proof means precisely a verified textual directive was included in the provider request and TTS PCM forwarding completed.** It is NOT a vendor guarantee of prosody/expressiveness nor evidence of native audible playback. The latter requires independently accepted native playback and GTA/operator audio evaluation.
- `[concerned]` is deliberately not emitted. No new vendor tags, public free-text selectors or SFX are authorized.

## Release classification

Draft source-correctness handoff only. A runtime F integration, actual Node+native CI, source-confirmed M1/native player authority, GTA shadow observations and separately authorized billable A/B audible acting validation are **mandatory** before experimental deployment/release.
