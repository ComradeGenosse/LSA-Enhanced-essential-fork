# EA1 Agent B handoff — verified-scene delivery selection

**Status:** Independent offline implementation committed on `feature/ea1-scene-delivery-agent-b-20261011`, starting from PR #60 commit `8c33082a34e9c6f7db514c9d631135a610b788de`. **Not integrated with the TTS runner, not enabled in GTA, not a proof that native owner evidence is available for every turn.**

## Scope and exports

- New module: `lsa-essential-e1-candidate/src/voice/emotion/sceneDelivery.mjs`.
- New offline suite: `lsa-essential-e1-candidate/tests/scene-delivery.test.mjs`.
- Named exports: `resolveDelivery(input)`, `SCENE_DELIVERY_BOUNDS`.
- No config, ElevenLabs, Luna-schema, streaming-decoder, native, playback or mood-store files changed.

`resolveDelivery` is a **synchronous, pure** selector. It reads an owner-fenced, immutable snapshot of PS2 observations; it neither creates a witness receipt nor calls the model/provider. Return shape is **exactly** the EA0 six-field normalized delivery intent:

```js
Object.freeze({
  version: 1,
  value: 'neutral' | 'whisper' | 'excited' | 'fearful' | 'angry' |
         'amused' | 'sad' | 'sarcastic' | 'concerned',
  source: 'neutral' | 'verified_scene' | 'dialogue_cue' | 'luna_hint',
  confidence: 'soft' | 'supported',
  intensity: 'subtle' | 'normal' | 'expressive',
  evidenceRef: null | '<PS2 observation UUID>',
})
```

**EA1 currently emits only** `neutral`, `fearful`, `excited`, `concerned`, `sad`, `amused` and `sarcastic`, with sources `neutral`, `verified_scene` and `dialogue_cue`. It does not emit vendor tags or a Luna hint. If EA0's contract disagrees, reconcile the shared enum only during integration rather than changing either independent agent's owned files unilaterally.

## Exact integration input

```js
resolveDelivery({
  identity,                  // current turn/owner-stamped identity (below)
  segmentText,               // canonical Luna segment text, never modified
  source,                    // lowercase player_text, player_mic,
                             // special_event, scene_director, director, internal
  nowMonotonicMs,            // integer from same clock as PS2 store
  currentSceneEvidence,      // frozen trusted projection (below)
  actorTraits,               // optional { characterId, traits: [] }
                             // or { characterId, personality: { traits: [] } }
  priorEphemeralMood,        // optional frozen previous-tag receipt (below)
  config,                    // EA0 validated expressiveDelivery section
});
```

**Identity** must contain: `characterId`, `observerCaptureRef`, `incarnationId`, `ownerProofRevision`, `hostRunId`, `worldEpoch`, `nativeRun`, `pedId`, `sessionNonce`, `turnId`, `generationId`; optionally `timelineId` (UUID or null). Character/observer/incarnation/host/native run fields are UUIDs, proof revision and world epoch are positive integers, and the Essential tuple fields are bounded nonempty strings or nonnegative integers. All are required because an Essential turn ID, a persistent CharacterId, or a PS2 `captureRef` alone never authenticates who owns an observation. Never fill missing IDs with fabricated constants.

**Projection** must be constructed from authenticated, *currently matching* native P1/P2 ownership + PS channel state + the original PS2 observation store (or equivalent verified source). It is exactly this consumed shape:

```js
const currentSceneEvidence = Object.freeze({
  verifiedOwner: true,        // only after actual P1/P2 owner verification
  lifetimeCurrent: true,      // current anchor/incarnation, not a stale index
  channelHealthy: true,       // currently valid PS channel, run and host epoch
  identity: Object.freeze({ ...boundIdentity }),
  observations: Object.freeze(sourceQualifiedRows.slice(0, 32).map(row =>
    Object.freeze({
      observation: row.value,  // original frozen Observation v1
      observedAtMonotonicMs: row.observedAtMonotonicMs, // PS2 sidecar
    }))),
});
```

The selector *requires* this projection and its identity/observation-array/row wrappers to be frozen. `identity` in the projection must match the turn identity in **every** required field, plus optional `timelineId` if present. An observation must have a matching `observer.captureRef` and `observedAt.nativeRun`, pass `validateObservation`, be unexpired and sufficiently fresh from its PS2 monotonic receipt, and contain a supported non-report claim from the observation's latest sampled game tick. A malformed/missing/old claim is ignored, never upgraded. Use `ObservationStore.entries[*].observedAtMonotonicMs` sidecar, not `receivedUtc` or a newly synthesized receipt time. Do not create the projection from global scene text, PS3 reason strings, a transcript, a memory, or a player's report.

**Actual native sources:** `ShadowRuntime.directorOwnerProofFor(observerCaptureRef)` supplies owner host/run/epoch/incarnation/revision for an owned, current PS observer, while the PS2 `ObservationStore` supplies immutable observation and source-time sidecar. The integration agent **must additionally prove** this owner is the exact active Essential `(pedId, sessionNonce, turnId, generationId)` and matches the resolved P1 `characterId`. `directorOwnerProofFor` by itself does not establish that join. If that join cannot be demonstrated, provide no valid projection and select neutral. The PS2 observation schema carries `nativeRun` but does not itself carry the host epoch or Essential turn tuple.

**Prior state** is optional, strictly ephemeral and is **not created/persisted by EA1**:

```js
Object.freeze({
  identity: Object.freeze({ ...boundIdentity }),
  taggedSegmentsInTurn: 1,      // count of actual previously acted segments
  lastValue: 'fearful',         // last acted normalized intent
  lastTaggedAtMonotonicMs: 9900,
});
```

The selector uses it for same-value cooldown (6.5s) and turn budget. A foreign identity's state is ignored (never inherited). The EA2 caller owns updating this state **only after an actually used tag**, and clearing it on cancellation, turn replacement, owner/proof/host/epoch/timeline changes. The selector is stateless itself; there is no cross-turn mood latch. Default tag budget is two; accepted configured budget range is 0–8; no direct call to native/PS runtime occurs here.

## Evidence policies and precedence

1. **Verified danger**: fresh PS2 `firing_burst + firing` or `threat + attack` with supported direct witness/self evidence. Default `fearful`; `bold` (without `cautious`) chooses `excited`. Fire event max age 6s.
2. **Death/injury**: fresh `death_seen/body_found + dead` chooses `sad`; `injury + injured` chooses `concerned`. Max age 12s.
3. **Impact**: fresh `vehicle_impact + injured` chooses `concerned` or `excited` for a `bold` actor, max 8s. Note: PS2 uses `injured` as a generic mapped damage claim for vehicle damage; this is *not* proof a person was harmed. A `vehicle_state` sound alone does not establish a collision. No rollover claim.
4. **Conversation**: strongly anchored NPC text cues (`Haha`, `Heh`, `lol`, `that's hilarious`, `are you okay?`) permit *soft*, evidence-free vocal styling. `sarcastic` or `wry` traits can enable `yeah, right` or `as if`; neither is a claim that a game incident happened. Traits apply **only** when the supplied `actorTraits.characterId` matches the current identity.
5. **Cooldown/neutral**: no qualified evidence or cue yields neutral. No inferred stealth, embarrassed NPC, invisible gunfire, cross-observer knowledge, emotional response solely from player sentiment, perpetual panic or repetitive laughter.

Priority is danger > death > injury > impact > dialogue cue > neutral. `reserved`/`stoic` clamp intensity to subtle. Intensity is otherwise the EA0 normalized `config.intensity`. Selector does not inject text. Strong intents `fearful` and `concerned` may remain **untagged** in EA0's ElevenLabs renderer until validated vendor mappings exist; that is intentional.

## Testing and integration boundaries

Run from `lsa-essential-e1-candidate`:

```sh
node --test tests/scene-delivery.test.mjs
npm test
```

Tests cover valid PS2 evidence, a second nearby NPC with no witness, report/uncertain channel rejection, host/run/epoch/turn/timeline/owner proof mismatch, age/freshness/claim-sampling, malformed nested evidence, native lifetime loss, priority over sarcasm, vehicle-state false impacts/rollovers, traits, dialogue-only cues, budget/cooldown, immutable canonical text, and pure-call latency on ordinary fixtures. These are **offline test fixtures**, not an end-to-end implementation or GTA validation.

**Integration agent EA2 checklist:** build a trusted projector at the actual turn boundary; verify native tuple join and owner proof; snapshot PS2 sidecar with `performance.now()`-compatible monotonic clock; resolve *once per complete speech segment* on early and buffered paths; pass `delivery` beside `dialogue`; keep `decision.dialogue`, history and memory byte-identical; only EA0 maps supported intents to TTS-only allowlisted tags; apply budget based on actual tags; shut off/on and world/turn resets drop state; test shadow byte-identical TTS, cancellation, telemetry, and true GTA evidence. If a required field/proof is unavailable, **neutral is correct**.

**No actual local/GTA test execution claim is made by this handoff unless a later verified CI result is linked in the PR.**
