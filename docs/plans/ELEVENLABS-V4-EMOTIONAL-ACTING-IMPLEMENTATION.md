# ElevenLabs v4 Turbo emotional acting — code-level implementation plan

**Status:** Implementation plan ONLY. No runtime feature is enabled by this document.
**Based on:** PR #54 head \`1dce84c9835b3291daf0e9de9e4fd9e7b4c57f78\` (Oct 11, 2026).
**Target:** Existing Essential-based E1 companion first; reusable provider-neutral emotion contract for the later standalone replacement.
**Dependency:** PR #54 must be present, with \`eleven_v4_turbo\` and working authenticated 24 kHz mono PCM streaming. No new LLM, native plugin, cloud call, GPU allocation, or memory DB schema required for the MVP.

## 1. User-visible objective / non-goals

Nathan should deliver *the same exact spoken words* with situation- and personality-appropriate expression:
- A verified witnessed threat can justify urgency; a witnessed injury can justify concern.
- A character who finds something amusing might chuckle; a different character may be frightened by the same incident.
- Quiet scenes can produce subdued speech **only with trusted context**; do not pretend a stealth state was verified when it was not.
- Default is a natural, neutral voice. Subtle performance is better than constant theatrics.

**Preserve:** dialogue text, action command, conversation/memory contents, source-evidence boundaries, player/NPC ownership, early TTS, output_transcript, 24k PCM, volume, cancellation, native playback receipts and current working ElevenLabs latency.

**Exclude from this PR:** ambient synthetic gunshots/explosions, direct control of native game audio or NPC animation, arbitrary free-form ElevenLabs tags from Luna, a second Luna call, extra local models, persistent mood/personality schema migrations, blanket false claims of NPC witnessing, merging Essential and standalone implementations.

## 2. Verified current code boundaries (PR #54)

| Existing path | Actual constraint / intended change |
|---|---|
| \`src/openai/runSequentialTurn.mjs\` | Early path calls \`services.speak({ dialogue: segment.text, speechProfile, onPcm, ... })\` as each complete segment arrives; buffered path calls \`services.speak({ dialogue: decision.dialogue, ... })\`. **Both paths** need the same delivery resolver. |
| \`src/openai/segmentDecoder.mjs\` | Strict streaming segment is exactly \`{text}\`; \`extractCompleteSegments\` reflows long text and strictly reconciles with final JSON. Avoid touching it in MVP. |
| \`src/context/essentialDecision.mjs\` | Final model decisions are strictly \`{dialogue,command}\`, and the streamed schema is strictly \`{mode,segments,command}\`. Keep both unchanged in MVP. |
| \`src/openai/streamDecision.mjs\` | Uses a second copy of the exact segmented schema. **Any future schema change must update both plus the decoder and fixtures together.** |
| \`src/providers/providerStack.mjs\` | \`speak: input => speech.synthesize(input)\`: permits an optional new \`delivery\` field without routing changes; OpenAI and Qwen continue ignoring it. |
| \`src/providers/elevenlabs/speechProvider.mjs\` | Sends \`inputs:[{text:dialogue,voice_id:voiceId,new_turn:false}]\` over v4 Text-to-Dialogue WebSocket and closes to flush. Insert a trusted, validated audio tag into a **TTS-only copy** of \`dialogue\`; never modify canonical text. |
| \`src/voice/voiceProfile.mjs\` | \`actingEnabled\` currently generates natural-language instructions only when \`speechInstructionsSupported\`, which is false for ElevenLabs. New \`expressiveDelivery\` gate must be explicit; do not overload this boolean. |
| \`src/perception/contracts.mjs\`, \`directorContext.mjs\` | Structured observations have observer, evidence, expiry, event type and severity. Only verified eligible current-NPC observations can drive strong scene emotion; missing evidence means **unknown**, not witnessed. |
| \`src/characters/profileStore.mjs\` | Strict persisted promoted-character profile shape. Do not add an emotion column/field in MVP; use existing personality snapshot as an optional bounded modifier. |

### Crucial playback invariant

\`runSequentialTurn\` may send audio before the whole Luna decision has finished. The original strict segment text remains what will be validated, published and historically committed. The new emotion direction is a *separate, ephemeral audio-only hint*, and must never travel through \`decision.dialogue\`, \`validated.internalTranscript\`, \`history.stage\` or future M2/M3 memory journal records. Failing to maintain this separation would contaminate recall and could break exact quotations.

## 3. New internal contract — typed intent, not vendor tags

Create \`src/voice/emotion/deliveryContract.mjs\`.

\`\`\`js
export const DELIVERY_VALUES = Object.freeze([
  'neutral', 'whisper', 'excited', 'fearful', 'angry',
  'amused', 'sad', 'sarcastic', 'concerned'
]);

// Internal objects are frozen and bounded, not written to permanent memory.
// Example, NOT a public wire/host protocol:
const hint = Object.freeze({
  version: 1,
  value: 'amused',
  source: 'verified_scene', // or 'luna_hint', 'dialogue_cue', 'neutral'
  confidence: 'supported',  // 'supported' | 'soft'
  intensity: 'subtle',      // 'subtle' | 'normal' | 'expressive'
  evidenceRef: 'observation-id-or-null', // opaque, never user-supplied
});
\`\`\`

Prefer a *single delivery* per speech segment. Avoid simultaneous \`[laughs][whispers][angry]\` stacks; quality and timing would be unpredictable. Enforce fixed enum, exact object keys, maximum length, no arbitrary tag strings, no player-controlled evidence IDs or vendor parameter injection. This contract belongs in shared brain logic; adapter maps it to ElevenLabs syntax.

**Known ElevenLabs v4 tags to test with Nathan, not all ship automatically:** \`[whispers]\`, \`[excited]\`, \`[angry]\`, \`[sad]\`, \`[laughs]\`, \`[sarcastic]\`, \`[sighs]\`, \`[curious]\`. These are delivery hints, not guaranteed effects. For \`fearful\`/\`concerned\`, begin with an empirically tested low-risk combination or leave **untagged**; do not invent an undocumented tag or use sound effects as a substitute.

Documented sources (check again before implementing):
- https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices
- https://elevenlabs.io/docs/overview/capabilities/text-to-dialogue
- https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd

## 4. MVP implementation in three small commits

### EA0 — configuration, typed contract, pure tag formatting

Add \`src/voice/emotion/deliveryContract.mjs\` and \`src/voice/emotion/elevenTags.mjs\`.
Extend \`src/config/e1Config.mjs\` and ignored \`e1.config.example.json\` with a **separate** strict configuration:

\`\`\`json
"expressiveDelivery": {
  "mode": "off",
  "intensity": "subtle",
  "maxTaggedSegmentsPerTurn": 2
}
\`\`\`

Mode choices: \`off\` (default), \`shadow\` (calculate and log only), \`experimental\` (send approved tags to ElevenLabs). Reject unknown keys, invalid types and out-of-range counts. If \`speechProvider !== "elevenlabs"\`, calculate nothing or force off; no unintentional behavior changes for OpenAI/Qwen. Maintain backwards-compatible normalization when the object is absent.

Proposed pure renderer:

\`\`\`js
export function renderElevenSpeech({ dialogue, delivery, enabled }) {
  // Only accept a normalized enum/contract. No tag string from Luna/player.
  // Return unmodified dialogue when disabled, neutral or unsupported.
  // Ensure <= 3000 characters AFTER tag insertion.
  const tag = enabled ? TAG_FOR_DELIVERY[delivery?.value] : null;
  return tag ? tag + ' ' + dialogue : dialogue;
}
\`\`\`

Use an allowlist (start with \`whisper -> [whispers]\`, \`excited -> [excited]\`, \`angry -> [angry]\`, \`amused -> [laughs]\`, \`sad -> [sad]\`, \`sarcastic -> [sarcastic]\`; unsupported intents yield plain dialogue). Tagged text is used **only in \`speechProvider.synthesize\`** to populate the socket \`inputs.text\`. Respect \`dialogue.length <= 3000\`, including tags. Do not add any arbitrary action/sfx tags; do not alter \`voices\`, \`xi_api_key\`, \`output_format\`, PCM transfer or \`close_socket\`.

**Tag injection boundary:** canonical Luna dialogue must not be able to smuggle bracketed stage instructions. Add a narrow validated **TTS-only** normalization of known \`[...]\` audio-control patterns or reject automatic acting for text with bracket syntax and sanitize that copy; test preservation of literal bracket quotations. Do not silently modify validated canonical dialogue or let model-supplied raw tag strings bypass the allowlist.

### EA1 — deterministic verified-scene selector (no extra Luna request)

Add \`src/voice/emotion/sceneDelivery.mjs\` as a pure, synchronous function:

\`\`\`js
export function resolveDelivery({
  identity, segmentText, source, nowMonotonicMs,
  currentSceneEvidence, actorTraits, priorEphemeralMood, config
}) {
  // Return {value:'neutral', source:'neutral', ...} unless facts are valid.
  // 1) Validate NPC owner/epoch/turn and observation freshness.
  // 2) Derive eligible urgent/concerned reactions from witnessed/self events.
  // 3) Apply small bounded personality preference from existing profile traits.
  // 4) Apply safe conversational cues only when not contradicted by the scene.
  // 5) Apply rate-limit/cooldown; return an immutable delivery contract.
}
\`\`\`

Inputs must be a **bounded immutable projection** of already verified \`PS\` observations for **this** owner, not broad global scene strings. Reuse \`perception/contracts.mjs\` validators and already established native owner proofs; do not invent a new witness type. Reject stale \`expiresAtMonotonicMs\`, different \`observer.captureRef\`, different world/run/epoch, missing ownership, \`reported\`/uncertain claims as *direct* witnessing, and observations without relevant admissible evidence. A nearby gunshot that the NPC did not witness or hear must **not** induce a witnessed-gunfire panic reaction.

First rules (conservative):

| Verified signal in current scene | Candidate | Caveats |
|---|---|---|
| Fresh dangerous threat/firing that this NPC has a valid witness or self receipt for | excited / fearful | Strong urgency only if supported, use neutral when evidence weak |
| This NPC injured / fresh witnessed injury | concerned / sad | Another NPC's private injury is not automatically known |
| Fresh witnessed vehicle impact | excited / concerned | Existing signal is \`vehicle_impact\`, **not** proof of rollover; save jokes about flips for future M9 coverage |
| Self/known conversational banter supported by dialogue plus personality | amused / sarcastic (soft) | Default neutral on ambiguity; never assert false world facts |
| Quiet/stealth or embarrassment | neutral in MVP unless verified | Current perception doesn't prove a GTA stealth state; defer special triggers |

Precedence: **current verified danger > recent supported scene > bounded dialogue cue > ephemeral mood > neutral**. The character personality may modify strength and selection, but may not manufacture knowledge. Never infer anger/sadness solely from the player's sentiment; preserve nuance and agency.

Default to at most one tag per segment and at most two tagged segments per turn; substantial reactions need evidence. Prevent repeated laughing on every segment, rage-latching or indefinite fear. The resolver should take under 1 ms per segment offline; no asynchronous work or native calls on the hot path.

### EA2 — both TTS paths, safe shadow telemetry and rollout

Add a shared orchestration helper (\`src/voice/emotion/resolveSpeechDelivery.mjs\`) invoked at the **last common speak boundary** in \`runSequentialTurn.mjs\`. Pass an immutable \`delivery\` value as a sibling to \`dialogue\`, not embedded in it.

\`\`\`js
const delivery = expressiveResolver.forSegment({
  turn, segmentText: segment.text, sequence: segment.sequence, mode: config.expressiveDelivery.mode
});
await services.speak({
  identity, dialogue: segment.text, delivery,
  speechProfile: turn.speechProfile, signal, timeoutMs, telemetry, onPcm
});
\`\`\`

Apply same helper at fallback/final single-utterance call with \`decision.dialogue\`; ensure **no second tag application** after early TTS has already produced audio. Buffered mode, passive scene-director speech, typed and STT turns must all route identically. Guarantee delivery is bound to current \`identity\`/generation/session, not a global mutable "NPC mood". Keep cancellation, identity checks, segment order and native authorization unchanged.

The \`elevenlabs/speechProvider.mjs\` uses the validated \`delivery\` only for WebSocket input text in \`experimental\`. In \`off\` and \`shadow\`, socket text MUST be byte-identical to the current PR #54 request. Do not accidentally synthesize shadow tags.

Add **bounded non-sensitive telemetry**:
- \`acting_decision\`: mode, selected enum, source enum, confidence enum, acted boolean, segment sequence, evidence category/age (no raw text, exact evidence ID or names).
- \`acting_tts_first_pcm_delta\` (aggregate experimental A/B offline only).
- Existing first-PCM, native audible/playback, failures and credit counters remain authoritative.

In \`shadow\`, only the categorical \`acting_decision\` event changes; there is no difference in API request bytes, TTS cost or audio.

## 5. Later gated phases — model nuance and character continuity

### EA3 — optional Luna emotional hint (NOT required for initial MVP)

Once deterministic MVP and in-game acceptance pass, change Luna's *strict structured schema* to include a **bounded enum field per segment**, e.g. \`{ "delivery": "amused", "text": "..." }\`, with \`delivery\` ordered first so the decoder receives intent before early release. **Do not add free-form tag strings** or extra narrative.

This is **not a trivial one-file edit**. Version/gate it explicitly, updating together:
- \`context/essentialDecision.mjs\` request schema + instructions;
- \`openai/streamDecision.mjs\` second exported schema;
- \`openai/segmentDecoder.mjs\` exact-key parser, reflow preserving intent, strict final reconciliation, legacy schema coexistence;
- \`openai/decide.mjs\` optional \`structuredSegments\` and hint conversion;
- \`openai/runSequentialTurn.mjs\` validated hint precedence at early-release and final replay;
- existing streaming/reflow/rollback tests, director-mode restrictions and model-output token budgets.

Strict JSON schemas generally require every property in the active schema; use \`"delivery":"neutral"\` rather than an optional key. Do **not** add output fields to the legacy \`{dialogue,command}\` decision until a separate migration is designed. During legacy/nonstream mode, deterministic selection remains sufficient. A Luna hint is a *proposal*, not verified scene evidence: allow conversation-level amusement or sadness but override/neutralize contradictions, false witnessing, arbitrary speech tags and source boundary violations. No extra model call.

### EA4 — personality-aware continuity

Add a small in-memory state store, keyed by \`(characterId, worldEpoch, timelineId, protagonist, session/generation)\` **only if all are proven and available**. Expire on turn completion/interruption, actor reassignment, reload/epoch change, or a strict ~15–30 second TTL. A short-lived subdued/afraid/amused tendency may carry across **one** valid conversational follow-up, but danger and evidence rules always win. Unknown identity => stateless neutral fallback. Never turn ephemeral delivery state into M2/M3 witnessed facts, M6 permanent memories or relationship truth. Memory can affect *what Luna says* via the existing retrieval system; that does not give the emotion controller permission to assert observations.

Future optional player-authored personality preferences can be added to the promoted profile only with a separate versioned migration and editor validation; do not mutate the current strict P2 profile shape.

## 6. Test matrix / explicit acceptance

Add tests in \`lsa-essential-e1-candidate/tests/elevenlabs-emotional-acting.test.mjs\`, plus fixtures in existing streaming, config, identity and PS tests:

1. Strict config: missing object defaults off; invalid modes/intensity/tag budgets rejected; changing ElevenLabs emotion controls never changes OpenAI or Qwen output.
2. Pure intent/renderer: supported mappings, neutral passthrough, one tag maximum, unsupported intent fallback, 3000-character TTS payload ceiling, no raw model/user tag injection, non-speech effects never emitted.
3. **Immutable original:** \`decision.dialogue\`, segment.text, command, staged/committed transcript and simulated memory-journal plaintext are byte-for-byte unchanged with experimental acting on.
4. **Early vs buffered equivalence:** a given trusted scene + identical line produces equivalent TTS-only tags; strict decoder reflow and buffered_action restrictions remain correct; NO second synth request and NO extra Luna call.
5. Verified scene-only behavior: visible/audible witnessed threat reacts; offscreen unwitnessed gunfire, reported/uncertain/expired signals, cross-character observer, wrong world/epoch or missing proof fall back to neutral. Test two nearby NPCs with different evidence and different results.
6. Precedence and expression quality: immediate danger beats sarcasm; sarcastic cues do not override grief; personality modifier doesn't create false witness; tags don't repeat every segment.
7. Turn retirement: cancellation, partial PCM, interrupted playback, promotion, NPC recycling, game reload, world switch and memory timeline fork cannot reuse emotional state across identities.
8. Shadow mode: diagnostics only and **byte-identical** ElevenLabs request; off mode adds no processing/network; failures and telemetry cannot reveal raw dialogue, prompts, IDs or API key.
9. Provider mock over WebSocket: assert exact \`inputs[0].text\` in all modes while retaining PCM16/24k frame sequence, closing, error handling and credits; no billable test in CI.
10. Performance: resolve/render <1 ms p90 offline; no additional Luna requests. Run 10 tagged vs 10 untagged **real** samples with identical Nathan text and voice and a separately authorized billing flag; compare first-PCM median/p90, audio duration, playback, credit debits and expressive quality by ear. Baseline direct ElevenLabs untagged measurements: median 226 ms, p90 267 ms; user hardware/net/voice may vary. Watch for materially slower first PCM and audible stutter, do not silently trade away speed for acting.
11. GTA acceptance: typed and STT, early segments, passive scene-director speech, one NPC in danger and another not, personality differences, cancellations, interruption/swap, volume/spatialization. Ensure only the correct NPC reacts, original words remain exact, evidence isn't fabricated, and native playback receipts still gate assistant-history commits.

**Rollout gates:** merge/unit-test EA0+EA1 with mode \`off\` → run \`shadow\` offline and GTA with no modified audio → \`experimental\` for one promoted NPC and an explicit time-limited GTA trial → broaden only if behavior/latency and credit usage are acceptable. Rollback: \`expressiveDelivery.mode="off"\` and restart companion; old ElevenLabs audio path remains intact.

## 7. PR strategy, ownership, and stop conditions

- Use this **design-only plan PR stacked on #54**, not a change to #54's working runtime. No other active memory or standalone branches need to be rebased to *read* this plan.
- Implementation PR 1: EA0–EA2 only (provider-neutral contract + deterministic selector + existing early/final integration + tests; default off). This is the MVP suitable for GTA.
- Implementation PR 2: EA3 Luna strict-schema enhancement after MVP latency acceptance, because it can affect early streaming contracts and stock actions.
- Implementation PR 3 (optional): EA4 short-lived mood/personality continuity after evidence ownership/epoch contract proof and M1–M7 architecture reconciliation.
- Prefer the original Essential adapter now. Keep the domain-level delivery contract standalone-ready, with a later single adapter passing \`{dialogue,delivery}\` to the replacement audio pipeline; avoid parallel copies of the policy engine.

**Stop implementation** if proofs aren't available, if a needed native event/owner receipt doesn't exist, if early streaming gets delayed by schema parsing, if vendor tags are spoken literally, if transcripts/memory include tags, or if confidence about witness ownership cannot be established. Fall back to neutral/off, document the blocker and continue only with verified capabilities.
