# UX4 Talk Target Selector — implementation plan

Status: implementation plan only. Do not merge runtime changes from this research branch.

Architecture companion: ../research/ux4-talk-targeting-architecture.md

## Baseline and invariants

Plan base: main at bc3b2027b0b2eb6a3c1a7dcb326587f9af781696.

The roadmap currently identifies runtime/code baseline 6ae6bc9. Rebase this plan onto the implementation branch's then-current main before coding, but preserve the boundaries below.

Non-negotiable invariants:

1. Essential owns microphone capture and conversation lifecycle.
2. Ped reads/mutation occur on the existing Essential/P2 Core.Update fiber.
3. Loader input code never owns or persists Rage.Ped references.
4. Selection never retargets stale work to a replacement incarnation.
5. No synthetic TalkKey remains down after release, focus loss, a closed input gate, reload or shutdown.
6. Current current.* commands retain expectedEncounterId / target_changed protection.
7. UX4 is default-off and removable without changing LosSantosAlive.config.
8. No new provider/model call is introduced by selecting or cycling a target.

## Phase T0 — prove the Essential targeting seam

Purpose: close the only architectural uncertainty before code expansion.

### Add

- docs/UX4-talk-targeting-gta-acceptance.md — T0 section is the executable probe matrix.
- A temporary diagnostic console command or minimal debug-only path in the eventual feature branch. Do not keep an unsafe generic Ped setter.

### Probe

Use two or more ordinary NPCs and capture RagePluginHook/E1 logs.

Required cases:

- closest A / farther B: explicitly set B, hold normal Essential TalkKey, verify B receives the mic turn
- driver B
- passenger B
- current speaker A while selected B
- clear B before talk
- B despawns between setter and press
- TextKey after setter
- setter only: verify no provider request or behavior task starts
- optional ActivateAttention comparison

### Exit gate

PASS only if the target used by actual microphone turn creation is the exact selected B in all supported ordinary/seated cases and setter-only behavior is benign.

If PTT does not honor the setter, stop after T0. Do not implement a parallel microphone path. Produce a source-pinned mic target-acquisition hook plan first.

## Phase T1 — native TalkTargetSelector

### Add

native/promoted-characters/TalkTargetSelector.cs

Responsibilities:

- build a bounded candidate list from current PerceptionSystem data
- validate Ped + MemoryAddress lifetime
- freeze ordering for one cycle session
- select first / next
- expire idle selection
- clear on world clock reset
- expose SelectedPedIfValid
- optionally set/clear NpcTargeting player conversation target after T0
- never persist state

Suggested API:

~~~csharp
internal sealed class TalkTargetSelector
{
    public TalkTargetView SelectFirst(long now);
    public TalkTargetView SelectNext(long now);
    public TalkTargetView Commit(string expectedSelectionId, string expectedEncounterId, long now);
    public TalkTargetView Inspect(long now);
    public Ped SelectedPedIfValid(long now);
    public void Update(long now);
    public void Clear(string reason, bool clearEssentialTarget = true);
    public void ResetForWorldChange();
}
~~~

Candidate collection:

- PerceptionSystem.TryGetSnapshot
- reject null/invalid/dead/player/non-human
- reject > radiusMeters
- cap candidates before expensive projection where possible
- project surviving candidates for screen-center score
- cap final frozen list at maxCandidates

Do not call EncounterFor for every nearby candidate. Materialize an encounter only for the selected candidate when CurrentView/commit needs one.

### Modify

native/promoted-characters/PromotedCharactersIntegration.cs

- construct selector with access to safe encounter materialization
- call selector.Update from Update
- call selector.ResetForWorldChange before/with existing local bridge reset
- clear on Shutdown
- make selector available to NativeCommands partial

### Tests

Add pure selector policy tests where possible, with Ped/world access behind a narrow adapter if required.

Cases:

- ranking by on-screen center then distance
- fixed cycle order despite changing scores
- wraparound
- one candidate
- zero candidates
- target invalid
- same handle/new address
- timeout
- world reset
- candidate cap

## Phase T2 — native bridge and current-target integration

### Modify

native/promoted-characters/LocalCommandQueue.cs

Add strict internal commands:

- talk.select_first
- talk.select_next
- talk.commit
- talk.clear
- talk.inspect

Add source talk_input.

Do not loosen arbitrary command/argument parsing. Give each talk command an exact target/args schema.

Extend LocalCommand only with fields actually required, for example ExpectedSelectionId and ExpectedEncounterId.

Keep queue Capacity, expiry, dedupe and bounded result behavior unless testing proves a separate cap is necessary.

### Modify

native/promoted-characters/NativeCommands.cs

Add command handlers that call TalkTargetSelector only on Core.Update.

Change CurrentPed() to:

~~~csharp
var selected = talkTargets.SelectedPedIfValid(Monotonic);
return selected
    ?? NpcTargeting.GetPlayerConversationPed()
    ?? NpcTargeting.GetCurrentSpeakerPed();
~~~

CurrentView remains the single read path for UX current NPC. Existing EncounterFor lifetime logic and expectedEncounterId remain authoritative.

### Modify

native/enhanced/Commands/NativeSnapshot.cs

Add defensive optional TalkTargetInfo parser.

### Modify

native/enhanced/Commands/Contracts.cs

Add a dedicated internal builder for strict talk bridge envelopes rather than overloading player phrase fields.

Example concept:

~~~csharp
CommandEnvelope.BuildTalk(
    id,
    command,
    utcNow,
    expectedSelectionId: ...,
    expectedEncounterId: ...);
~~~

### Tests

Extend P2 bridge/offline tests:

- exact field rejection
- unsupported source rejection
- stale/duplicate request
- select -> inspect
- cycle
- commit matching selection
- commit stale selection
- target dies before commit
- current.inspect prefers selected target
- clear restores legacy current resolution
- current.follow expectedEncounterId still rejects a changed target

## Phase T3 — visual indicator

### Add

native/promoted-characters/TalkTargetIndicator.cs

Keep rendering side-effect-free with respect to NPC behavior.

V1 rendering:

- get selected head/upper-body world coordinate
- world-to-screen projection
- four small screen-space bracket rectangles
- optional tiny cycle counter
- no external texture dependency
- no LOS hard gate
- target validity required every frame

Indicator should be visually usable for:

- standing pedestrian
- driver
- front passenger
- rear passenger
- convertible
- closed-roof vehicle

### Failure behavior

Rendering exceptions are contained. After repeated failure, disable indicator only and log one bounded status. Do not disable P2 or targeting.

### Tests

Pure geometry/clamping helper tests plus GTA visual acceptance. Do not pretend offline tests prove vehicle visibility.

## Phase T4 — held PTT input

### Add

native/enhanced/Input/EssentialHeldKeyRelay.cs

Use existing IInputInjector.

Proposed API:

~~~csharp
public sealed class EssentialHeldKeyRelay
{
    public string Begin(EssentialKey key);
    public void End();
    public void ReleaseAll();
    public bool Active { get; }
}
~~~

### Add

native/enhanced/Input/TalkTargetInput.cs

Inputs:

- IKeySource
- INativeBridge
- IClock
- IHud
- EssentialHeldKeyRelay
- Func<EssentialBindings>
- settings accessor
- gate/open-menu state

It owns only the physical gesture state and request generation.

Internal fields should include:

- physicalDown
- downAt
- state enum
- requestGeneration
- pending command id
- selected summary last seen
- whether Essential TalkKey is currently held

Do not start microphone capture until:

1. physical key is still down
2. hold threshold elapsed
3. exact native commit reply succeeded for the selection generation

If the player releases before commit arrives, discard the late reply and never press TalkKey.

### Modify

native/enhanced/EnhancedHost.cs

Create one EssentialHeldKeyRelay and TalkTargetInput beside the existing InputRouter.

Per frame:

~~~text
dispatcher.Update
router gesture processing
talkTargetInput.Tick
ui.Tick
~~~

Exact ordering may be adjusted to avoid duplicate dispatcher.Update; only one owner should update shared jobs per frame.

On shutdown/failure/focus loss, ReleaseAll on both pulse and held relays.

Host idle logic must remain per-frame while the talk selector key is down or held PTT is active; otherwise it can return to low-frequency idle.

### Important

Do not route the neutral Talk selector key through GestureRecognizer's ordinary command bindings. It has its own state machine.

## Phase T5 — settings and controller migration

### Modify

native/enhanced/Settings/EnhancedSettings.cs

Add strict optional talkTargeting section:

- enabled
- key
- talkHoldMs
- cycleWindowMs
- selectionTimeoutMs
- radiusMeters
- retentionRadiusMeters
- maxCandidates
- indicator

Default enabled=false.

Reject duplicate/conflicting physical keys.

Essential key conflict must be evaluated dynamically on Essential config reload. If talkTargeting.key becomes equal to TalkKey/TextKey/MarkPedKey/MarkedPedTalkKey, suspend UX4 targeting and force-release any held synthetic TalkKey.

### Modify

packaged LSA.Enhanced.example.json

Add documented disabled example.

### Modify

docs/controller-setup.md

Add UX4 setup:

1. choose neutral key, suggested F10 only if otherwise unused
2. map physical controller Talk button to that neutral key
3. remove direct Steam mapping from that controller button to Essential TalkKey
4. leave Essential's own TalkKey configured in LosSantosAlive.config
5. enable talkTargeting
6. verify log reports target input ready

Rollback instructions must explain how to restore direct Talk mapping.

### Tests

Settings parser:

- bounds
- duplicates
- all Essential conflicts
- hot reload while PendingHold
- hot reload while Talking
- malformed section preserves old settings
- missing section leaves feature disabled

## Phase T6 — UX-wide selected-target reuse

Once T0 proves SetPlayerConversationPed is safe, selecting/cycling should align Essential current target immediately.

Verify these existing features consume the same NPC:

- current.follow chord
- current.wait if bound/menu-selected
- Promote
- Current NPC page
- current_describe
- TextKey / typed input
- PTT

No new implementation is needed where CurrentView already feeds the feature; add only the minimal target-precedence changes.

Do not change Mark/MarkedTalk semantics in v1. They remain Essential features.

If typed input does not honor PlayerConversationPed, treat that as a separate small integration follow-up rather than silently routing text through a new conversation system.

## Phase T7 — diagnostics and menu

### Controls page

Show:

- Talk target feature On/Off
- neutral physical key
- hold threshold
- search radius
- selection timeout
- state Idle / Selecting / CommitPending / Talking / Suspended
- conflict reason

### Current NPC page

When explicit UX4 target exists, show:

- Explicit talk target
- candidate position N/M
- expires in approximately N s
- clear target action

Do not show raw Ped address or owner token.

### Diagnostics

Add:

- selected yes/no
- native selector state
- indicator state
- held relay state
- last bounded UX4 failure

## Phase T8 — full offline verification

Required suites before GTA:

- existing companion suite unchanged
- ux-input existing tests unchanged
- new TalkTargetInput deterministic tests
- p2-bridge
- p2-offline
- p2-runtime
- ps-host / Windows suites that touch the host AppDomain
- buildCharactersAddon
- buildCandidate
- manifest/hash checks

New deterministic input cases:

- first tap selects but never presses Essential TalkKey
- repeated taps issue cycle commands
- hold starts only after threshold + commit
- hold with no target selects first then commits
- release before threshold -> no PTT
- release while commit pending -> no late PTT
- release while talking -> one key-up
- focus loss -> one key-up
- menu opens -> one key-up
- settings reload -> one key-up
- native unavailable -> no PTT
- target_lost -> no PTT
- 100 rapid input sequences -> no stuck key
- shutdown in every state -> no stuck key

## Phase T9 — GTA acceptance

Use docs/UX4-talk-targeting-gta-acceptance.md.

Do not merge until the acceptance matrix demonstrates:

- the visual selection and actual microphone target always match
- cycling is stable and understandable
- drivers/passengers are visibly targetable
- no accidental mic turns on taps
- PTT latency is acceptable
- Follow/quick menu use the selected NPC
- target loss never redirects speech
- no stuck TalkKey
- old behavior is recoverable by disabling UX4

## Proposed file map

### New runtime files

- native/promoted-characters/TalkTargetSelector.cs
- native/promoted-characters/TalkTargetIndicator.cs
- native/enhanced/Input/TalkTargetInput.cs
- native/enhanced/Input/EssentialHeldKeyRelay.cs

### Existing runtime files expected to change

- native/promoted-characters/PromotedCharactersIntegration.cs
- native/promoted-characters/NativeCommands.cs
- native/promoted-characters/LocalCommandQueue.cs
- native/enhanced/Commands/Contracts.cs
- native/enhanced/Commands/NativeSnapshot.cs
- native/enhanced/EnhancedHost.cs
- native/enhanced/Settings/EnhancedSettings.cs
- native/enhanced/Ui/NativeMenu.cs
- native/enhanced/Ui/ViewModels/MenuModels.cs
- native/enhanced/input-tests/*
- native/promoted-characters/*tests as appropriate
- tools/buildCharactersAddon.mjs only if the new files require explicit source inclusion
- packaged LSA.Enhanced.example.json
- docs/controller-setup.md

### Files that should not need changes

- OpenAI provider path
- STT/TTS code
- playback lifecycle
- P0/P1 schemas
- profile persistence
- PS perception contracts
- action registry
- Essential source patch manifest, provided T0 passes

## Suggested implementation commits

Keep implementation reviewable:

1. UX4 T0 probe and result documentation
2. Add native target selector and bridge
3. Add target indicator
4. Add held PTT input and relay
5. Add settings/controller docs/menu diagnostics
6. Add tests and GTA-fix corrections

Do not mix unrelated roadmap work into these commits.

## Definition of done

UX4 is done when a player can stand near several NPCs, tap the controller Talk button to visibly select/cycle among them, hold the same button to speak to the highlighted exact NPC, release to end PTT, and immediately use Follow/Wait/menu against that same target — including an NPC seated inside a vehicle — with no stale retargeting, accidental tap conversations or stuck input.
