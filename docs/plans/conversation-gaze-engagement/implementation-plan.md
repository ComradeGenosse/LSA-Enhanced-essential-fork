# CGE implementation plan

Prepared against main at bc3b2027b0b2eb6a3c1a7dcb326587f9af781696.

This plan is implementation-ready except for two GTA facts explicitly assigned to CGE0: the exact source-time player-speech seam and the exact non-disruptive look-at native/Essential helper.

## 1. Fixed scope

Deliver native physical conversation engagement for the current conversation partner.

Allowed: observe Essential targeting/input/playback, issue finite gaze, later issue tightly gated short body turn, emit bounded telemetry.

Not allowed: cancel/suspend/resume activities, decide response willingness, alter prompts/Luna, put network/model latency in the gaze loop, change stock action publication, clear arbitrary ped tasks, or create persistent attention state.

## 2. Proposed source layout

Add:

~~~text
native/conversation-engagement/
  ConversationEngagementIntegration.cs
  ConversationEngagementController.cs
  ConversationEngagementPolicy.cs
  ConversationEngagementTarget.cs
  ConversationEngagementConfig.cs
  NativeAttentionDriver.cs
  README.md
  tests/
    ConversationEngagementTests.csproj
    Program.cs
    Fakes.cs
~~~

Modify:

~~~text
native/promoted-characters/PromotedCharacters.csproj
native/promoted-characters/RuntimeEntry.cs
native/promoted-characters/LSA.PromotedCharacters.example.json
native/promoted-characters/README.md
docs/ROADMAP.md
~~~

Only if CGE0 proves a new player-speech event is required, modify the source-pinned Essential hook/build metadata and its integration tests.

Do not modify native/enhanced/EnhancedHost.cs to perform gaze. That host is loader-domain UX, not the authoritative Core-fiber location for ped work.

## 3. Registration and lifetime

Compile native/conversation-engagement/*.cs into LSA.PromotedCharacters.Runtime, matching the current intelligence-module pattern.

RuntimeEntry owns a separate ConversationEngagementIntegration field. Off means not constructed. Shadow/active means registered with IntegrationManager and initialized in the Essential domain.

CGE initialization/update/shutdown failures are contained independently and must not trigger P2/PS shutdown.

The first packaging can reuse the existing P2 runtime host even though gaze works for ordinary, non-promoted conversation targets. Decoupling CGE when P2 is disabled is a later packaging improvement, not part of this feature.

## 4. Configuration

~~~json
{
  "conversationEngagement": {
    "mode": "off",
    "gazeRefreshMs": 150,
    "gazeDurationMs": 650,
    "maxDistanceMeters": 12.0,
    "lostTargetGraceMs": 500,
    "releaseHoldMs": 900,
    "bodyTurnEnabled": false,
    "bodyTurnEnterDegrees": 70,
    "bodyTurnExitDegrees": 35,
    "bodyTurnHoldMs": 500,
    "vehicleHeadTracking": false
  }
}
~~~

Modes: off, shadow, active.

Keep bodyTurnEnabled and vehicleHeadTracking false through initial CGE1 rollout. Reject unknown keys/out-of-bounds values. No native config hot reload in v1.

## 5. CGE0 — lifecycle and native capability spike

### 5.1 Player-speech lifecycle

Inspect the exact pinned Essential Hotfix #3 runtime/source patch points.

Prove an authoritative source-time event for microphone capture start/end and accepted typed turn.

Preferred: reuse an existing public event. Otherwise expose the smallest event at the real Essential input boundary. It must carry enough native identity to reject stale/other-target notifications.

Do not route this from post-STT Node code.

### 5.2 NpcFocus audit

P2 currently calls NpcFocus.SetFocus(ped, player, "p2_player_command"). Determine whether this is semantic focus, visual IK/look-at, a primary task, what owns it, and how it clears. Reuse it only if it is appropriate for non-destructive conversation gaze.

### 5.3 Look-at probe

If NpcFocus is not sufficient, test the narrowest GTA look-at mechanism against stationary, walking, scenario, passenger, driver, side/behind movement, target disappearance, repeated refresh, and natural expiration.

Exit gate:

- exact player-speech seam documented;
- exact gaze mechanism documented;
- no broad task clear required;
- finite release known;
- shadow mode follows target/lifecycle without gameplay mutation.

## 6. CGE1 — head/eye gaze MVP

### ConversationEngagementIntegration

- subscribe/unsubscribe lifecycle events;
- resolve current target on Update;
- validate Ped + handle + MemoryAddress;
- feed immutable per-tick facts to pure policy;
- invoke native driver only on Core fiber;
- contain exceptions and disable only CGE.

Event handlers only record bounded facts. Update reconciles them.

### ConversationEngagementController

Suggested pure input:

~~~csharp
readonly struct EngagementFrame
{
    public long NowMs;
    public ConversationAttentionTarget Target;
    public bool PlayerSpeechActive;
    public bool NpcSpeechActive;
    public bool ScriptedState;
    public bool Ragdoll;
    public bool InVehicle;
    public bool EnteringOrExitingVehicle;
    public bool InDirectedInteraction;
    public float DistanceMeters;
    public float HorizontalAngleDegrees;
}
~~~

Suggested output:

~~~csharp
readonly struct EngagementDecision
{
    public ConversationEngagementState State;
    public bool RefreshGaze;
    public bool RequestBodyTurn;
    public string BlockReason;
}
~~~

### NativeAttentionDriver

Translate approved decisions into the pinned native mechanism. Track only commands CGE issued and enforce refresh rate. It does not select targets, decide safety, own conversation state, or call companion/Luna.

### Acquisition

Acquire only when a valid current target exists and source-time player input becomes active/accepted or matching NPC playback begins. Merely marking an NPC must not cause indefinite staring.

Target change force-releases the old epoch before the new one.

### Release

Normal: Releasing -> hold -> stop refresh -> finite native expires -> Inactive.

Forced: immediate stop-refresh for target invalidation, shutdown, death, world reset, or replacement.

### Initial allow-list

Start active mode conservative: on-foot valid human peds outside scripted/unsafe states. Walking/scenario/vehicle support is enabled only where CGE0 proved the selected native does not steal behavior.

### Tests

Required unit cases:

- no target stays inactive;
- current target without conversation activity does not gaze;
- player speech acquires;
- NPC playback engages;
- between-turn quiet holds;
- target swap invalidates old epoch;
- same handle/new MemoryAddress invalidates;
- death/disappearance force-releases;
- scripted/ragdoll block is non-destructive;
- no ClearPedTasks emission;
- refresh cadence is bounded;
- shadow mode emits zero native mutations;
- driver exception disables CGE only.

Run all existing P0/P1/P2/PS/UX native regressions and the native runtime build.

## 7. CGE2 — conservative body reorientation

Only after CGE1 physical acceptance.

Compute horizontal off-axis angle. Use enter/exit hysteresis and dwell. Request one bounded turn only after sustained off-axis state.

Hard gates: on foot, approximately stationary, not ragdolled, not combat/fleeing, not vehicle transition, not directed interaction, not known P2/ACT controlled locomotion, and no mission/script safety conflict.

If an existing Essential action owns orientation, CGE loses arbitration.

Never snap heading. Never restart every frame. If the primitive cannot coexist safely, drop CGE2 and remain head-only.

## 8. CGE3 — conversational tuning and hardening

- distinguish PlayerSpeaking and NpcSpeaking;
- stronger continuous gaze while listening;
- optional bounded micro-break during long NPC speech;
- short between-turn hold;
- enable passenger/driver head-only only where probes passed;
- aggregate diagnostics;
- failsafe for missing terminal lifecycle event.

Do not make random gaze the core behavior. Stable attention is the default.

## 9. Observability

Passive and bounded. Example:

~~~text
[CGE] state=engaged target=142 epoch=8 role=player gaze_refresh=34 body_turn=0 blocked=0
~~~

No transcript text. Add shutdown totals for acquisitions, gaze starts, block reasons, body turns, forced releases, and driver failures.

## 10. Rollout

1. merge docs;
2. implement CGE0 on a feature branch;
3. offline tests/build;
4. GTA probe in shadow;
5. enable CGE1 on-foot only;
6. collect focused GTA evidence;
7. implement CGE2 only after CGE1 passes;
8. tune CGE3 last.

Do not combine head tracking, body turn, interruption/resume, and activity awareness in one PR.

## 11. Definition of done

- speaking to the current NPC causes prompt visible gaze acquisition;
- head tracks normal player movement without freezing unrelated behavior;
- NPC playback remains visually engaged;
- target changes cannot leave stale gaze;
- exchange end releases without snap or broad task clear;
- unsafe states fail soft;
- body turn, if enabled, is hysteretic and does not fight locomotion/vehicles/actions;
- no model/network latency in gaze control;
- disabling CGE changes no dialogue/action behavior.

Activity-aware interruption/resume remains ACT4.
