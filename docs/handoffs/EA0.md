# EA0 — Agent A implementation and integration handoff

**Base:** PR #60, commit `8c33082a34e9c6f7db514c9d631135a610b788de`.
**Scope:** ONLY delivery contract, ElevenLabs pure tag renderer, E1 config, example config, and dedicated offline tests. No provider, turn runner, Luna schemas, scene selection, or audio pipeline changes. EA0 is not independently deployable emotional acting; subsequent EA1/EA2 agents must wire it.

## Exports (stable integration APIs)

`lsa-essential-e1-candidate/src/voice/emotion/deliveryContract.mjs`:

- `DELIVERY_VALUES` (frozen array): `neutral, whisper, excited, fearful, angry, amused, sad, sarcastic, concerned`.
- `DELIVERY_SOURCES` (frozen array): `neutral, verified_scene, luna_hint, dialogue_cue`.
- `DELIVERY_CONFIDENCES` (frozen array): `supported, soft`.
- `DELIVERY_INTENSITIES` (frozen array): `subtle, normal, expressive`.
- `EXPRESSIVE_DELIVERY_MODES` (frozen array): `off, shadow, experimental`.
- `DEFAULT_EXPRESSIVE_DELIVERY_CONFIG` (frozen object): `{mode:"off", intensity:"subtle", maxTaggedSegmentsPerTurn:2}`.
- `normalizeExpressiveDeliveryConfig(input?, { speechProvider = "openai" } = {})`: returns a frozen config with exactly the three keys above. Missing input defaults off. Rejects unknown keys, getters/symbols, invalid types, modes, intensities, and tag budgets outside **0..8**. Any provider other than exactly `elevenlabs` forces the mode to `off` after validation.
- `createDelivery(input = {})`: trusted *internal-only* constructor. Returns a frozen, WeakSet-branded shape with **exact keys** `{version:1,value,source,confidence,intensity,evidenceRef}`. Defaults to neutral / neutral / soft / subtle / null. Only closed enums are accepted; evidenceRef may be null or an opaque 1..128-char ASCII identifier matching `[A-Za-z0-9][A-Za-z0-9._:-]*`. Only `verified_scene` may provide `confidence:"supported"` or evidenceRef; `verified_scene` must use supported confidence. `neutral` source cannot claim non-neutral. The caller must independently prove ownership, freshness and evidence provenance before passing scene data; format-checking an ID is **not** ownership proof.
- `isDelivery(value)`: true **only for objects returned by this in-process factory**. Plain JSON, spread copies and arbitrary model objects are not trusted.
- `NEUTRAL_DELIVERY`: frozen/branded neutral singleton.

`lsa-essential-e1-candidate/src/voice/emotion/elevenTags.mjs`:

- `ELEVEN_TAG_FOR_DELIVERY` (frozen allowlist): `whisper→[whispers], excited→[excited], angry→[angry], amused→[laughs], sad→[sad], sarcastic→[sarcastic]`. `fearful` and `concerned` (and neutral) are **untagged**, avoiding invented vendor directives.
- `ELEVEN_SPEECH_MAX_CHARS = 3000`.
- `renderElevenSpeech({dialogue, delivery = null, enabled = false})`: pure, returns a *new string* without modifying canonical dialogue. Throws on empty or over-3000 dialogue, invalid enabled type. With `enabled:false`, returns the **exact input bytes**, including any bracket text (required for off/shadow regression). With `enabled:true`, neutralizes all ASCII square brackets from *dialogue only* into typographic quotes so model/player text cannot inject direct audio tags; inserts **at most one** allowlisted tag from a branded intent. If a tag would push the rendered speech over 3000 chars, it omits the tag; never truncates dialogue. Does not alter the source dialogue, actions, receipts, or memory.
- Intensity is a **resolver-side cap** / acting policy, not an ElevenLabs vendor intensity parameter; renderer only chooses supported tag by value.

## Strict E1 configuration

`normalizeConfig(input, env).expressiveDelivery` is always present, immutable and independent of legacy `actingEnabled` (speech instruction prompts). Optional example:

```json
{
  "expressiveDelivery": {
    "mode": "off",
    "intensity": "subtle",
    "maxTaggedSegmentsPerTurn": 2
  }
}
```

No provider changes in EA0 means config alone **does not apply audio tags yet**.

## EA1/EA2 integration obligations

1. In off mode, bypass emotion resolution completely. In shadow mode, resolve only for safe categorical telemetry; never modify network text. In experimental mode, **only for ElevenLabs**, pass the trusted contract as an ephemeral sibling to canonical dialogue.
2. EA1 creates intents using `createDelivery(...)` **after** validated observation/identity/epoch/witness checks; never call factory directly on raw Luna JSON, player text, or stale scene payloads. For unsupported emotion states, return `NEUTRAL_DELIVERY` or a trusted typed untagged intent.
3. EA2's ElevenLabs provider calls `renderElevenSpeech({dialogue,delivery,enabled:config.expressiveDelivery.mode==="experimental"})` **only to populate websocket `inputs[0].text`**. The canonical string remains the input to history, transcript and memory. Keep PCM/sample rate/key/voice/cancellation/socket flow unchanged.
4. Track `maxTaggedSegmentsPerTurn` per *turn* in EA1/EA2 (renderer intentionally has no mutable counters). Do not add extra tag stacks to a segment; keep early + buffered paths equivalent. Never trust the factory brand across a JSON transport: revalidate sources server-side.
5. Test off and shadow byte-identical provider payloads, and experimental tag-only changes with a fake WebSocket before GTA testing. No billable calls in CI.
6. Rollback is config mode `off` plus companion restart.

## Offline verification

Run from `lsa-essential-e1-candidate`: `node --test tests/elevenlabs-emotional-acting.test.mjs` and `npm test`. This EA0 branch does not purport to complete EA1 scene selection or EA2 provider integration.