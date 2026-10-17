# EA4 emotional continuity — Agent E handoff

Base: PR #60 head 8c33082a34e9c6f7db514c9d631135a610b788de. EA4 owns only lsa-essential-e1-candidate/src/voice/emotion/moodStore.mjs, a standalone offline test module, and this handoff. It does **not** modify the running TTS pipeline, shared DB, profile store, P1/P2 identity resolver, Luna schema, perception engine, or native plugin.

## Contract for Agent C / EA2

    import { createMoodStore } from '../voice/emotion/moodStore.mjs';
    const mood = createMoodStore({ ttlMs: 22000, maxEntries: 128 });
    // Construct only from trusted runtime objects, not actor JSON or LLM output.
    const context = {
      identity: turn.identity, // pedId, sessionNonce, generationId, turnId
      characterSnapshot: turn.characterSnapshot, // P1 prepare result, persistent only
      binding: runtime.identityService.bindings.get(turn.identity),
      hostContext: runtime.identityService.evidence.hostContext, // authenticated native hello
      timelineId: approvedTimeline.activeTimelineId, // M1 verified/selected lineage
      protagonist: verifiedProtagonist, // franklin|michael|trevor from trusted native input
      isCurrent: () => /* revalidate native turn, binding owner proof, epoch, timeline and protagonist */,
    };
    const priorEphemeralMood = mood.take({ context, nowMs: performance.now() });
    // Feed as a weak PRIOR to EA1, NEVER as scene observation or ground truth.
    // EA1 independently resolves danger > verified scene > Luna/cues > continuity.
    // Only after native host confirms actual playback for this same current turn:
    mood.commitPlayed({ context, nowMs: performance.now(), delivery: resolvedDelivery,
      receipt: { verified: true, playbackSucceeded: true, playbackStarted: true,
        hadAudio: true, wasInterrupted: false,
        pedId: turn.identity.pedId, sessionNonce: turn.identity.sessionNonce,
        turnId: turn.identity.turnId, generationId: turn.identity.generationId } });
    // Cancelled, failed/partial/interrupted: mood.invalidate({context,scope:'turn'}).
    // Owner retired/replaced/dismissed: mood.invalidate({context,scope:'binding'}).
    // Game reload, world epoch, save/protagonist, host change or shutdown: mood.clear().

createMoodStore, new MoodStore, take, commitPlayed, invalidate, and clear are exported APIs. take returns frozen {value, confidence:'soft', intensity:'subtle'} or null; it does not return previous scene evidence and does not emit an EA0 delivery object or ElevenLabs tag. It is idempotent for multiple streamed segments in ONE later native generation and carries a mood across only one follow-up unless there is a new accepted playback. commitPlayed returns boolean and refuses unproved playback, mismatched receipt/context, neutral/rage/sarcasm, and non-fresh source. Only delivery.source of verified_scene, dialogue_cue, or luna_hint is accepted; reconcile EA0's final source enum before integration. Supported carry values are amused, sad, concerned, fearful, whisper. Recording an emotion is NOT recording an event fact.

**Critical integration dependency:** PR #60 Essential has P1 owner host context but does **not** supply an integrated approved M1 timeline and verified protagonist for every TTS turn. M1 work is in separate memory PR #52. Correct default is take() === null and commitPlayed() === false until all prerequisites are securely wired. DO NOT infer missing IDs from world street, actor names, ped handles, model text, previous memory, or random UUIDs. Use M1 TimelineGuard.activeTimelineId only if source is proven and approved and a live isCurrent callback rechecks owner, native session/epoch, save, protagonist on every access. A callback and receipt must be established by trusted runtime logic: a caller-supplied JSON claim or boolean alone is not sufficient authentication.

P1 TurnCharacterSnapshot contains nativeIdentity, resolution, bindingId, bindingRevision. P1 runtime binding contains serverRunId, bindingId, bindingRevision, characterId, original claim, ped and session. P1 OwnerEvidence.hostContext contains hostRunId and worldEpoch. EA4 fences these fields; M1 durableSubjectRef recognizes franklin, michael, trevor. Use the verified M1 lineage; never mint another save lineage.

No timers, background processes, AI calls, disk persistence, native effects, memory schema or canonical dialogue modifications occur. The store is capped at 128 active entries, with a 15–30 second TTL (default 22 seconds) and monotonic-expiry purging on calls. Process restart starts empty. A monotonic clock regression clears all. Owner reassignment, world/timeline/protagonist changes evict old state; explicit clear must also be connected to native boundary events. With missing proofs, ordinary TTS continues unchanged.

Offline check from repository root:

    node --test lsa-essential-e1-candidate/tests/emotional-mood-continuity.test.mjs

Agent E local run: **14 passed, 0 failed** using Node.js test runner. No GTA acceptance, billable ElevenLabs call, whole E1 suite or runtime integration has been performed. Agent C must test streaming/buffered/director speech, verified playback receipts, cancellation, and native invalidation before experimental mode.
