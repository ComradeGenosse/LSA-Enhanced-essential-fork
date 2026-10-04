# Conversation Gaze / Engagement (CGE)

Prepared October 4, 2026.

Repository baseline at plan creation: bc3b2027b0b2eb6a3c1a7dcb326587f9af781696.

This directory defines a deliberately restrained native Conversation Gaze / Engagement layer for LSA. Its job is to make the NPC who is already in conversation with the player visibly participate in that conversation.

## Goal

When the player addresses an NPC, the NPC should:

- notice and visually acquire the player;
- track the player with head/eye attention while listening;
- remain visually engaged while its own speech is playing;
- reorient its body only when a head-only pose is no longer plausible and doing so is safe;
- continue tracking as the player moves;
- release attention naturally when the exchange ends;
- fail closed when the ped, target, or gameplay state becomes unsafe.

The layer should feel responsive without becoming a second action scheduler.

## Explicit non-goals

CGE does not decide whether an NPC wants to talk.

CGE does not implement:

- activity interruption, suspension, or resume;
- "too busy to talk" policy;
- salience, social routing, or proximity-chat responder selection;
- relationship/personality reasoning;
- Luna-driven gaze decisions;
- Scene Director;
- path planning;
- arbitrary animation control;
- persistent attention state;
- broad ClearPedTasks cleanup;
- a second copy of Essential's turn, action, or playback lifecycle.

Those belong to later ACT4 / social / Director work. CGE is a physical presentation layer for an already-selected conversation partner.

## Source-grounded integration points

The current repository already provides the seams CGE should reuse:

| Need | Current source |
| --- | --- |
| Current conversation partner | LosSantosAlive.NPC.NpcTargeting.GetPlayerConversationPed() with GetCurrentSpeakerPed() fallback |
| NPC speech start/end | NpcPlaybackCoordinator.PlaybackStarted / PlaybackEnded |
| Native Core-fiber extension point | LosSantosAlive.Integrations.IIntegration + IntegrationManager.Register |
| Existing Essential-domain host | native/promoted-characters/RuntimeEntry.cs |
| Current selected-ped observation | native/intelligence/IntelligenceIntegration.cs |
| Native safety/state checks | NpcStateStore, scripted-state checks, current P2 safety patterns |
| Existing optional native runtime assembly | native/promoted-characters/PromotedCharacters.csproj |
| Loader-side UX host | native/enhanced/EnhancedHost.cs |

CGE must run inside Essential's domain through IIntegration.Update. The loader-domain EnhancedHost is not the place to issue ped natives.

The existing IntelligenceIntegration already polls the same conversation target and subscribes to playback events. CGE may copy the lifetime-validation pattern, but must not route physical gaze through the perception channel.

P2 also calls NpcFocus.SetFocus during Follow. CGE0 must determine what NpcFocus actually owns and whether it is suitable for visual-only conversation attention before introducing a parallel focus mechanism.

## Architecture

~~~text
Essential targeting / source-time speech lifecycle / playback events
                         |
                         v
             ConversationEngagementIntegration
                         |
              target + phase + safety
                         |
             ConversationEngagementController
                 /                 \
                v                   v
        NativeGazeDriver      BodyTurnPolicy
          head/look-at       stationary-only turn
                \                   /
                 \                 /
                  ---- GTA/RAGE ----
~~~

Moment-to-moment decisions stay native and deterministic. No network/model round trip is allowed in the gaze loop.

## Delivery shape

The implementation is split into four bounded stages:

1. CGE0 — prove lifecycle and native behavior in shadow/probe form.
2. CGE1 — head/eye look-at MVP with target lifetime, safety, release, and telemetry.
3. CGE2 — conservative body reorientation with hysteresis and strict ownership gates.
4. CGE3 — listening/speaking tuning, graceful release, vehicle head-only behavior, and hardening.

CGE1 is the first player-visible milestone. CGE2 and CGE3 must not be required to prove that head tracking works.

See:

- runtime-contract.md
- implementation-plan.md
- gta-validation.md

## Relationship to ACT4

CGE is intentionally narrower than ACT4.

CGE answers: "Given that this NPC is already the current conversation partner, how should its body visually attend to the player?"

ACT4 answers: "Given what this NPC is doing, should conversation interrupt it, continue alongside it, be deferred, or later resume?"

ACT4 may consume CGE's physical engagement state later, but CGE must not pre-implement ACT4's task suspension/resume system.
