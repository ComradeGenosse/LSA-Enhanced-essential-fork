# LSA — Complete NPC gestures and microexpressions after PR #204

**Date:** 2026-10-17  
**Scope:** Planning only; no runtime changes or GTA validation in this PR  
**Integration baseline:** PR #216 (`integration/memory-k-ea-preservation-20261017`), which includes the merged PR #204 gesture runtime and PR #215 experimental voice-presence work  
**Sources:** [Original Phase 0–2 plan (#199)](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/199), [implemented #204](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/204), [#204 findings](npc-gestures-findings.md), [voice-presence notes](../npc-voice-presence.md), [#215](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/215), [CGE gaze contract](conversation-gaze-engagement/runtime-contract.md).

## 1. Code review: what #204 actually shipped

| Original work | Status in integration baseline | Evidence / boundary |
| --- | --- | --- |
| Deterministic gesture selection from the validated NPC reply | **Implemented** | `lsa-essential-e1-candidate/src/reactions/reactionSelector.mjs`; no extra Luna request, no new `{dialogue, command}` field |
| Two gesture names (`facepalm`, `middle_finger`) | **Implemented as candidate native clips** | JS `reactionCatalog.mjs` and native `ReactionCatalog.cs`; candidate animation dictionaries have **not** been proven in GTA Enhanced |
| Per-turn native timing, admission, cooldowns, cancellation, current ped/turn identity | **Implemented with offline regression coverage** | `reactionService.mjs`, `reactionClient.mjs`, `ReactionPolicy.cs`, `ReactionExecutor.cs`, `ReactionChannel.cs`; #204 review fixed stale-generation and owner-preflight issues |
| Phase 0: verify actual Enhanced animation dictionaries, native invocation and task preservation | **Open acceptance gate** | #204 explicitly says no gameplay validation; offline harness and stub compilation cannot prove native animations look correct or preserve tasks |
| Phase 2: 2–3 subtle facial-only moods/expressions | **Not implemented** | No facial reactions in the reaction catalog; Essential `NpcLipSync`, optional `NpcVoiceMouthOverlay` and CGE/look ownership need arbitration |
| Broad conversational body language (nod, shrug, point, open-hand emphasis, etc.) | **Not originally committed scope** | Original #199 deliberately proposed a small slice, with `square_up` deferred as action-heavy; this is a proposed later expansion, not a broken promise in #204 |

**Current limitations (do not mislabel as defects):** Only `player_text` and `player_mic` turns are eligible; selection is phrase-based, not an emotional performance engine; the allowed response schema is unchanged. `shadow` means inspection/eligibility, not physical animation. Two catalog entries being compiled does **not** mean they were verified in GTA.

## 2. Objectives and rules

Complete the *unfinished original work first*, using the existing #204 architecture. Then optionally expand to natural body language in distinct implementation PRs.

- Preserve #204 exact-turn `playback_started` requirement, speaker/actor identity, run/world epoch, cancel/reset/interrupt and preflight safeguards. One visible cosmetic action per eligible turn by default; `none` should be common.
- Preserve Essential audio, Luna generation/streaming, ElevenLabs emotional delivery, UX4, P2/ACT behavior and Memory K; gesture failure must never block or alter conversation.
- No `Task.ClearAll`, `CLEAR_PED_TASKS`, forced heading, movement, weapons, combat gestures or changes to ACT command ownership. Do not port NPCTalk's unsafe `Restore()`.
- Do not add an extra model request, Jev service, background agent, event memory or inferred real-world emotion. Do not let player text command a cosmetic action. Do not emit arbitrary animations/durations from Luna.
- Native owns a closed allowlist of candidate dict/clip/flags; companion chooses only a validated reaction ID. Suppress quoted/negated/ambiguous cues; cap cooldowns and preserve default-off behavior.
- Verify on **GTA V Enhanced** and the installed Essential DLL, not only GTA Legacy clips or stubs.

## 3. Required workstreams / incremental PRs

### G0 — Finish Enhanced compatibility and native ownership proof (first, required)

**Goal:** Know which existing #204 gestures are truly safe before expanding the catalog.

1. Add bounded, debug-gated RPH diagnostics for candidate dictionary exists / loaded / clip duration / native-call success and a clip-scoped stop; do not emit user dialogue or force an action on failed preflight. Reuse `ReactionCatalog.cs`, `ReactionExecutor.cs` and existing `[RX]` reports.
2. With the matching shipped native binary, exercise `off`, `shadow`, then opt-in `on` on *ordinary and promoted male/female* peds. Verify facepalm and middle finger visuals; capture which exact Enhanced clip works and any gender differences. Test the real `CallByName` native names.
3. Observe idle standing, speaking, walking, follow/wait/sit, scenario, vehicle entry, combat/flee, mission/cutscene, interrupted/replaced audio, actor despawn, handle reuse, world reset, and multiple rapid turns. Confirm clips are upper-body-only and preserve Essential/P2/ACT authority. Any unverified case remains unavailable or disabled.
4. Resolve any *actual* #204 issues in a small G0 implementation PR; keep original behavior as fallback until verified. Record reproducible in-game results and a per-clip safety matrix.

**Acceptance:** An in-game evidence matrix establishes verified clips and non-interference; unsupported clips are skipped without fault spam or speech interruption. If none is safe, do not proceed with mutating gestures.

### G1 — Complete original Phase 2: safe subtle facial reactions (after G0)

**Goal:** Add at most **2–3** understated expressions (e.g. amusement, concern, frustration) only if genuine Enhanced-compatible facial clips and arbitration are demonstrated.

1. Audit current Essential `NpcLipSync`, `NpcSpatialAudio`, PR #215 `NpcVoiceMouthOverlay.cs`, and the live gaze/attention owner. Identify whether any *facial-only* native can coexist with mouth/lip animation; separately verify male/female ped dictionaries and that reset affects only our own owned overlay.
2. Define a minimal **facial ownership contract**: speaking mouth/lip sync wins; expression yields whenever ownership is unknown or shared; never continuously fight with `PLAY_FACIAL_ANIM`. Prefer idle or post-speech presentation if that is the only verified safe interval. No new continuous polling or second audio player.
3. Add a dedicated closed, default-off facial allowlist and bounded rules to the existing `reactionCatalog.mjs` / `ReactionCatalog.cs`, `ReactionPolicy.cs`, `ReactionExecutor.cs` seam. Keep strict current ped/turn/generation/host and clip-scoped cleanup; no arbitrary model-origin animation strings.
4. Select reactions conservatively from the NPC's *verified response* and, **only if available**, existing trusted, turn-bound ElevenLabs/Luna delivery intent. Map whitelisted acting enums deterministically; do not infer facts from M8 personality opinions and do not mistake a tone hint for player consent or witnessed emotion. No extra Luna call or strict response-schema change.
5. Run focused JS/C# regression checks; test the actual clip, mouth pauses, interruption, actor switch, and speaking overlay coexistence in GTA Enhanced. If no provably non-conflicting facial implementation exists, document **blocked**, retain default-off, and do not ship speculative facial commands.

**Acceptance:** A subtle expression visibly works on safe test peds without breaking lip-sync, voice playback or gaze; otherwise an honest blocked result with captured evidence is a valid completion of the feasibility work.

### G2 — Optional new expansion: broader conversational body language (not part of #199 promise)

This stage is a **new product decision**, not a missing #204 deliverable. Plan it as separate small slices after G0/G1 results, prioritizing: brief nod, shrug, open-hand emphasis, and a modest dismissive wave **only where verified compatible with Enhanced and player/NPC ownership**. Pointing needs target/position proof and stronger authorization; `square_up` is confrontational/action-like and stays outside cosmetic reactions unless ACT explicitly owns it.

For each individual gesture: validate animations on male/female ordinary and promoted NPCs; add one closed catalog ID, one precise cue/signal policy, and focused tests; allow `none`; keep strict behavior gates and no direct player orders. Reuse #204's finite upper-body clips / exact playback; don't create another scheduler. Do not tie this optional stage to completion of original Phase 2.

### G3 — Controlled delivery and game acceptance

- Test E1/native config agreement: `reactions.mode` and pipe name must match; `off` and `shadow` are nonmutating; `on` is opt-in only after safety proof. Preserve custom user settings. Do not silently enable all gestures during installation.
- Update `docs/plans/npc-gestures-findings.md` and a short tester checklist: exact version/commit + pinned Essential DLL, startup/runtime logs, visible game observations, known incompatibilities, clips disabled, and rollout/rollback instructions.
- Add targeted regressions in `lsa-essential-e1-candidate/tests/reactions.test.mjs`, `reactions-turn-hook.test.mjs`, and `native/reactions/tests/Program.cs` plus production `net481` build with the real installed RPH/Essential references (not only a stub).
- Test interrupted ElevenLabs/OpenAI audio, speaking-to-thinking transitions, FX failures, optional face owner absence, missing dict, pending source loss, host/world reset, stale tuple, player switch, and native pipe reconnect.
- Require an actual Enhanced smoke report before enabling new facial/gesture IDs by default. A CI-green result alone is not gameplay acceptance.

## 4. Suggested PR breakdown / dependencies

1. **G0:** finish #204 compatibility/gameplay proof and any focused corrections (first).
2. **G1a:** facial/lipsync/gaze ownership + clip-feasibility audit (may legitimately conclude unsupported).
3. **G1b:** implement 2–3 expressions **only if G1a proves a safe seam**, with hard off/shadow/on gates.
4. **G2-x (optional):** one or two new natural body gestures at a time; no blanket catalog rollout.
5. **G3:** documentation and acceptance checks accompany each relevant implementation PR, not one giant final merge.

If real GTA access is unavailable, finish the offline audit/tests and mark gameplay checks **OPEN**. Do not report G0/G1 as completed merely because tests compile. Do not require completion of optional G2 to close the original Phase 2 scope.

## 5. Implementation surfaces

- **Companion:** `lsa-essential-e1-candidate/src/reactions/{reactionCatalog,reactionSelector,reactionService,reactionClient,reactionConfig}.mjs`; preserve hooks in `src/openai/runSequentialTurn.mjs`.
- **Native:** `native/reactions/{ReactionCatalog,ReactionPolicy,ReactionExecutor,ReactionIntegration,ReactionChannel}.cs`; observe `native/promoted-characters/RuntimeEntry.cs` ownership and `NpcVoiceMouthOverlay.cs`.
- **Tests:** `lsa-essential-e1-candidate/tests/reactions*.test.mjs`, `native/reactions/tests/Program.cs`, `.github/workflows/npc-gestures.yml`.
- **Other owners to inspect, not overwrite:** Essential `NpcLipSync` and audio, PR #215 voice presence, conversation-gaze contract, P2/ACT activity ownership, existing emotional delivery enums.

## 6. Definition of done and explicit non-goals

**Original unfinished plan can be considered closed only when**: G0's real-Enhanced gesture compatibility is documented and any necessary #204 repairs land; G1's safe expression implementation has real visual proof **or** the audit establishes why it must remain disabled; no Essential lip-sync/voice/ACT regression is observed in the available controlled test matrix. Report code-level, CI and GTA acceptance independently.

**Not goals:** a universal NPC animation framework, emotion inference from untrusted content, secondary AI inference, head/gaze/body direction ownership, arbitrary player-commanded gestures, persistent emotion claims, default-enabling unverified animations, or incorporating optional G2 into #204's original acceptance criteria.

**PR handoff:** This is a docs-only implementation plan, not a claim that any missing phase has now been coded, deployed, or tested in GTA.
