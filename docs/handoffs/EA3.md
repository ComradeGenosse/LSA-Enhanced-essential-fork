# EA3 handoff — Luna per-segment emotional intent v1

**Parent:** PR #60, commit `8c33082a34e9c6f7db514c9d631135a610b788de`  
**Owner:** Agent D (EA3). Changes limited to decision/schema, streaming decode, tests, and this handoff.  
**Status:** Opt-in backend contract implemented; not activated in production. Agent C owns runtime TTS handoff.

## Public internal API (for Agent C)

The legacy default is unchanged. All new entry points default to protocol **0**.

- `decideStreaming({ ..., lunaDeliveryVersion: 1 })` opts a specific Luna request into EA3; it forwards the same version to the request builder and streaming validator. Use only behind a future validated feature gate, e.g. the explicit expressive-delivery gate managed by EA0/EA2. No new config key or runtime behavior is introduced in this branch.
- `buildRequest({ ..., structuredSegments: true, lunaDeliveryVersion: 1 })` requests strict JSON schema `e1_segmented_delivery_v1`. Version 1 without structured streaming and any unknown protocol version are rejected.
- `streamDecision({ ..., body, lunaDeliveryVersion: 1, onSegment })` validates the wire schema name before network activity. A mismatched version fails closed, rather than silently interpreting v1 as legacy.
- `createSegmentDecoder({ ..., lunaDeliveryVersion: 1 })` accepts only objects with exactly `delivery` then `text` and emits `{sequence, text, delivery}` as each *complete* segment is validated.
- EOF returns `{mode, segments:[{text,delivery},...], reflowedSegments, decision:{dialogue,command}}`. The final `decision` is still the original canonical strictly validated stock decision. No emotion appears in `decision.dialogue`, command, dialogue trace or history.
- `LUNA_SEGMENT_DELIVERY_V1`: `neutral`, `whisper`, `excited`, `fearful`, `angry`, `amused`, `sad`, `sarcastic`, `concerned`.

Version 1's JSON wire example:

```json
{
  "mode": "dialogue_only",
  "segments": [
    { "delivery": "amused", "text": "That was a good one." },
    { "delivery": "neutral", "text": "Where next?" }
  ],
  "command": ""
}
```

`delivery` is a **model proposal**, not verified scene evidence or an ElevenLabs tag. The downstream deterministic resolver must enforce witness and actor boundaries, allow stronger verified danger to override the suggestion, and map only approved normalized hints into an audio-only provider request. Do not feed these hints into memory, stock commands, personality persistence or transcripts.

## Compatibility and safety guarantees

- Protocol 0 keeps existing strict `e1_segmented_decision` with exactly `{text}` segments. Non-streaming `{dialogue,command}` decisions are untouched.
- V1 schema is mirrored between `context/essentialDecision.mjs` and `openai/streamDecision.mjs`; an offline test asserts equality.
- Strict duplicate-key parsing, single-delivery enum validation, no extra keys, delivery-before-text ordering, existing text limits, hard segment/dialogue caps and word-boundary reflow are enforced.
- Reflow clones the originating hint onto all text pieces; early emitted segments are checked against validated final segments for equality. Command/mode restrictions still apply.
- Callback `dialogueAttempt.segment` intentionally receives only original `sequence,text,mode` to avoid storing acting hints; normal `onSegment` receives validated delivery.
- No second model request, no provider routing change, no extra GPU model, no latency-affecting lookahead beyond the existing complete-segment boundary.
- For `buffered_action`, **Agent C must continue to suppress early audio** until stock action validation. EA3 alone does not authorize playback.

## Offline verification

Added `lsa-essential-e1-candidate/tests/ea3-delivery-hints.test.mjs`, covering versioning, both schemas, early vs EOF release, strict action handling, malformed/duplicate/extra inputs, reflow, false tag injection, stream mocks, request count and bounded decoder speed.

Run from `lsa-essential-e1-candidate`:

```sh
node --test tests/ea3-delivery-hints.test.mjs tests/streaming-decision.test.mjs tests/decisions-and-requests.test.mjs
```

Agent D additionally syntax-parsed all five touched JS modules and exercised direct JavaScript decoding cases (valid legacy/v1, early split, reflow, invalid enum/key ordering/duplicates/commands); all passed. A 100-iteration decoder probe took about 31 ms in the in-process checker. **The repository's real Node test runner/CI has not yet executed in this environment**, so full regression status remains unverified until CI runs. The existing GitHub workflow's PR trigger currently does not include the PR #60 base branch.

## Integration checklist

1. EA0/EA1 agree on version and approved enum values and provide a validated config-level opt-in; version 0 must remain the default.
2. Agent C passes `lunaDeliveryVersion: 1` to `decideStreaming` only when the explicit validated feature flag is active; if not set, it must be omitted or 0.
3. Agent C reads `segment.delivery` at early TTS emission and `result.segments[].delivery` during final reconciliation; do **not** merge hints into canonical `decision.dialogue` or history.
4. Agent C maps v1 proposals through the verified scene resolver (scene facts override model intent), applies only allowed vendor tags to a TTS-only copy and retains authorization/cancellation/PCM invariants.
5. Run Node regression suite, synthetic streaming SSE tests and then GTA shadow/experimental latency acceptance before enabling the feature.

**Out of scope:** `runSequentialTurn.mjs`, TTS provider, config, scene resolver, mood store and Luna non-stream schema. None were modified.
