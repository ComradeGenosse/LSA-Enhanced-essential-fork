# Phase 3 implementation — native-owned typed dialogue (first increment)

**Status:** Phase 3 coding started on `feature/standalone-phase3-typed-turn`, stacked on [Phase 2 PR #42](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/42). The separate core and standalone Node companion do **not** load the Essential binary or patched stock server. **No GTA deployment and no real NPC playback is claimed.**

## This first Phase 3 increment

- `NativeTurnRegistry.TryIssueTyped` accepts a native-validated player text message bound to the exact `ActorRef`, conversation lease, native generation, turn ID and session nonce. Node **cannot fabricate a player actor, typed input, or lease**.
- The Phase 2 duplex pipe's `turn.next.result` optionally provides native-issued `playerText` (strict bounded text). `turn.confirm` remains exact; `turn.reply` newly validates the full native actor incarnation/lease/generation on the RAGE owner fiber and stages **one** text reply with a truthful `staged_not_played` receipt. A second reply, wrong actor, expired lease or reincarnated handle is rejected. `turn.cancel` retires it. **This is not an action or audio completion receipt.**
- `responsesProvider.mjs` offers an independent OpenAI Responses adapter configured using `OPENAI_API_KEY` and `LSA_STANDALONE_MODEL`. It does not rely on stock launcher/Gemini. It uses `store:false`, finite output, a deadline, abort support and no credentials logged. A deterministic offline fixture is used for CI; **no live model request was tested**.
- `typedTurn.js.mjs` implements typed offer → exact native confirm → provider fixture/adapter → validated `turn.reply` staging, with exact cancellation on provider failure and disconnect. `PendingDialogue` is volatile/uncommitted and intentionally has **no** history commit operation until a matching actual Phase 4 native playback receipt exists.
- `tools/typed-turn-fixture.mjs` exercises the real net481 server and independent Node client using native-issued typed text with a deterministic provider. The native harness uses a fake game adapter, not an RPH or GTA process.

## Verification

New tests in `lsa-standalone-companion/tests/typed-turn.test.mjs` check confirmed offer, missing source-time text, provider failure, disconnect mid-model, no durable/history commit, malformed/incomplete provider responses and no-offer. New C# native authority tests check typed text bounds, effect-token forgery, duplicate/stale staging, same-handle+same-address ABA retirement. CI uses **real net481 assembly** and **real separate Node process**; it compiles the RPH host against the published reference API but cannot prove in-game hosting.

## Remaining Phase 3 work

1. **Actual game-sourced target and text input.** Add a RAGE-selected conversation target and real typed-input/onscreen keyboard adapter, **only after the Phase 2 entity-lifetime gate**. Current host has no adopted NPC or player text producer; test harness alone simulates a native producer.
2. **Runtime service hookup.** Run native typed-turn polling in the independent `service.mjs` with one active provider pipeline per source-time turn, safe abort/retirement, observation-context integration and bounded model inflight capacity. The first slice is callable but **not active in the production service**.
3. **Native session ownership and multi-turn state.** Add owner-aware session establishment, player arbitration vs spontaneous events, robust generations and durable profile-independent history staging. Existing exact single-turn permits are a foundation, not the final session lifecycle.
4. **Phase 4 dependency.** The output remains *staged not played*. No TTS, PCM, lip sync, actual audibility, or post-playback history commit can be claimed here.

See [standalone roadmap](roadmap.md). **Phase 3 started—not declared complete or GTA-safe.** No Essential removal, merge, or deployment was performed.
