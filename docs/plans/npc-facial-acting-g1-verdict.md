# NPC facial acting (G1) — feasibility verdict

**Date:** 2026-10-17  
**Verdict: BLOCKED. No facial expression is implemented, and none should be until the in-game experiments below are run.** `reactions` plays no facial clip; the only facial code added by this work is a read-only, off-by-default existence probe (`reactions.diagnostics`).  
**Plan:** G1 in [#222](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/222) (`docs/plans/npc-nonverbal-acting-completion-after-pr204-20261017.md`). #222 defines a documented blocked result, with the evidence below, as a valid completion of the feasibility work. It also forbids shipping speculative facial commands.

## 1. What was audited

All evidence is from this repository. The pinned Essential DLL is obfuscated and was **not** read beyond its public surface. No GTA run was possible.

| Owner of the face | Evidence | What it means for an expression layer |
| --- | --- | --- |
| Essential `NpcLipSync` | Public surface is `StartTalking(Ped)`, `StopTalking(Ped)`, `StopTalking()`, `Stop()` and the player variants (`LosSantosAlive_Hotfix3_Extension_API_Analysis.md`). There is **no** query such as `IsTalking`. | We cannot tell when Essential is driving the mouth, or what it plays. Ownership is *unknown*. #222's contract says to yield whenever ownership is unknown, so no expression may run while the NPC is speaking. |
| #215 `NpcVoiceMouthOverlay` | `PLAY_FACIAL_ANIM(ped, "mic_chatter", "mp_facial")` refreshed every 1.25 s while open, reset with `PLAY_FACIAL_ANIM(ped, "mood_normal_1", "facials@gen_<sex>@base")`. The class is `internal` to `LSA.PromotedCharacters`, and `Applied` is not exposed. Opt-in (`mouthEnabled`), unverified on Enhanced. | It already uses the only facial slot the game exposes for this. Its reset is a blunt `mood_normal_1`, so any expression played before the reset would be erased by it. Reactions has no way to ask whether the overlay is active. |
| Conversation gaze (CGE) | Plan only (`docs/plans/conversation-gaze-engagement/runtime-contract.md`); no runtime on `main`. Contract: head/eye only, yields while Essential's `ConversationLookBehavior` is active or unknown. | Expressions must not touch gaze. Nothing to conflict with today. The head-adjacent gestures (nod, shrug) are the part to re-check once CGE exists. |
| `PLAY_FACIAL_ANIM` itself | One facial animation per ped at a time. A later call replaces the earlier one. | Any expression we play either replaces Essential's or the overlay's mouth clip, or is replaced by them. There is no layering to rely on. |
| Clips on Enhanced | `facials@gen_male@base`, `facials@gen_female@base` and `mp_facial` are already *assumed* by #215. No mood clip name (`mood_happy_1`, `mood_angry_1` and so on) has been confirmed. Existence of the dictionaries on Enhanced is unproven. | No expression clip can be named honestly. |

## 2. Why this is a genuine blocker, not a skipped task

1. **Ownership cannot be proven offline, or even in code.** `NpcLipSync` has no readable state. The overlay's state is private. A facial layer that cannot know who owns the face is exactly the "continuous fight over `PLAY_FACIAL_ANIM`" that #222 forbids.
2. **The only interval that avoids lip-sync is after speech.** Even that interval is unsafe until the clip names and the post-`StopTalking` behavior are verified, and the overlay's own `mood_normal_1` reset could land on top of an expression.
3. **No clips are verified.** Naming candidate mood clips would be a guess, and a wrong guess shipped behind a flag is still a speculative facial command.
4. **A coordination seam is needed in code owned by #215.** A shared "face is busy" flag between the overlay and reactions is the right design. It modifies the voice-presence files, which this work was told to preserve.

## 3. What was added so the question can be answered cheaply

With `reactions.diagnostics: true` (native config, default `false`), the first reaction in `shadow` or `on` mode logs one `[RX] probe_facial` line:

```
[RX] probe_facial mp_facial=exists facials@gen_male@base=exists facials@gen_female@base=missing (existence only; no facial clip is played by reactions)
```

It uses only `DOES_ANIM_DICT_EXIST`. It never requests, loads or plays a facial clip. Offline test: `diagnostics: off by default; on reports each candidate once per reaction and gender, plus facial dictionary existence only`.

## 4. Experiments that would unblock G1b

Run with `reactions.mode: "shadow"` and `diagnostics: true` first, then follow the listed steps. Nothing below ships code.

1. **Dictionaries.** Read `[RX] probe_facial`. If `facials@gen_male@base` or `facials@gen_female@base` is `missing`, stop: #215 itself cannot work on Enhanced.
2. **Essential's own mouth.** `npcVoicePresence.mode: "off"`. Talk to an ordinary male and an ordinary female NPC. Does the mouth move in time with speech with no LSA overlay? Record when it starts and stops relative to audio. This characterises `NpcLipSync`.
3. **Overlay interaction.** Repeat with `mode: "on"`, `mouthEnabled: true`. Does the mouth look different or doubled? Does `mood_normal_1` visibly reset a face that Essential changed?
4. **A manual expression probe (outside this repo).** After speech ends, using a throwaway RPH snippet, play one candidate mood clip on a standing NPC and watch it for 3 s. Record the exact dictionary and clip name that works for male and female, how long it holds, and whether Essential or the overlay overwrites it.
5. **Reset behavior.** After step 4, call `PLAY_FACIAL_ANIM(ped, "mood_normal_1", ...)`. Does the face return to the NPC's usual idle, or to a flat default that differs from what it was before?

## 5. The shape G1b should take if steps 1–5 pass

This is a design sketch, not code.

- Add a `facial` kind to the existing catalog/policy/executor seam. It stays in `native/reactions`, and the companion still sends only a validated reaction name.
- It plays **only after an exact, uninterrupted `playback_ended`** for the same turn, never while speaking. It is finite (≤ 2.5 s), single-shot, with no polling.
- Before playing, it requires a positive "face is free" answer from a small shared flag set by the overlay when `Applied`. An unknown or missing flag means do nothing.
- Cleanup is the same clip-scoped rule as gestures: reset only if this executor started the expression, and only for the same ped incarnation.
- At most three whitelisted expressions (for example amused, concerned, frustrated), selected by the same conservative cue scan, with the trusted ElevenLabs delivery value used only as a veto, exactly as for nod and shrug.
- Default off, with its own `reactions.enabled` entries, and not enabled until a GTA smoke report exists.

## 6. Status

| Item | Status |
| --- | --- |
| Audit of Essential `NpcLipSync`, #215 overlay and the gaze contract | Done (repository evidence only) |
| Compatibility verdict | **Blocked** |
| Facial expressions in `reactions` | **Not implemented, by design** |
| Existence probe for facial dictionaries | Implemented, read-only, off by default |
| In-game experiments 1–5 | **OPEN** (need GTA V Enhanced) |
