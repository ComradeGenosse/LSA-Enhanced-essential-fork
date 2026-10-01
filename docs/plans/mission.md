# Mission

Refactor the already-implemented **E1 OpenAI/Luna integration** into the architecture we would have built if we had understood Los Santos Alive Essential Hotfix #3's internals from the beginning.

This is not a superficial compatibility patch.

This is an **architectural rebase of E1's Essential-facing lifecycle**.

Preserve the OpenAI/provider work that is still correct, but do not preserve E1-owned runtime machinery merely because it already exists.

Where Essential Hotfix #3 already provides an authoritative native mechanism for:

- turn identity,
- generation identity,
- playback ownership,
- playback completion,
- exact interruption,
- NPC/game state,
- context,
- action capabilities,
- action dispatch,

E1 should be redesigned to use that mechanism rather than maintaining a competing shadow implementation.

The end state should be simpler, more native, and suitable as the foundation for E2-E7 and the later perception/salience/scene-director work.

---

# Inputs

Use all available project source plus the supplied analysis document:

`LosSantosAlive_Hotfix3_Extension_API_Analysis.md`

Treat the DLL analysis as architectural evidence, but verify relevant signatures and behaviors against the actual Hotfix #3 binaries/source hooks available in the workspace.

Do not blindly assume every decompiled method name or signature is stable.

When the existing implementation and the analyzed native architecture disagree, determine which behavior is actually authoritative in Hotfix #3 and design around that.

---

# Primary objective

The resulting architecture should look conceptually like this:

```text
                     OPENAI SIDE
                         │
          ┌──────────────┼───────────────┐
          │              │               │
         STT          Luna/LLM           TTS
          │              │               │
          └──────────────┼───────────────┘
                         │
                  E1 adapter layer
                         │
             correlation / validation
                         │
                         ▼
              LOS SANTOS ALIVE
               HOTFIX #3 RUNTIME
                         │
        ┌────────────────┼─────────────────┐
        │                │                 │
   native context   native action      native turn /
     + hydration      dispatch        playback lifecycle
                                           │
                                           ▼
                                          GTA
```

The OpenAI layer should own AI-provider concerns.

Essential should own GTA runtime truth.

---

# Architectural rule

Use this rule aggressively:

> If E1 currently owns a state machine only because we previously did not know Essential already owned that state, replace the duplicate E1 state machine with a thin correlation/adapter layer around Essential.

Do not preserve duplicate architecture for backward compatibility unless removing it would break a required behavior that Hotfix #3 cannot replace.

Code deletion is acceptable and encouraged where it reduces duplicated ownership.

---

# What should generally be preserved

Do not rewrite these simply for stylistic reasons if the current implementation is sound:

```text
OpenAI authentication/configuration
private credential handling
OpenAI HTTP request infrastructure
Luna request construction
Responses API parsing
typed decision parsing
refusal/incomplete handling
STT request implementation
TTS request implementation
PCM decoding/conversion
AbortController/deadline primitives
mock API infrastructure
bounded history data structures
configuration schema
provider-specific error sanitization
```

They may still be modified where necessary to fit the new lifecycle.

---

# What may be substantially rewritten

You are explicitly authorized to substantially redesign or replace:

```text
Essential glue / bridge code

generation ownership

turn ownership

audio ownership

native audio transport glue

completion acknowledgement

assistant-history commit timing

action capability validation

action dispatch integration

interrupt/cancel integration

session/turn correlation

stale-result protection

legacy binary/audio compatibility paths

old assumptions inherited from the pre-Essential implementation
```

Do not optimize for minimizing diff size.

Optimize for having the correct architecture.

---

# Authoritative Essential ownership

The finished E1 architecture should treat these systems as Essential-owned:

```text
GTA/NPC context
actor hydration
world context
native conversation/turn state
native NPC state
native action capabilities
native action dispatch
native playback authorization
native audio ownership
native playback lifecycle
native interruption
native completion acknowledgement
```

E1 should not become a second GTA runtime.

---

# Hotfix #3 native lifecycle

The analysis identified native functionality equivalent to:

```csharp
NpcPlaybackCoordinator.TryAuthorizeTurn(...)
NpcPlaybackCoordinator.QueueTaggedAudioChunk(...)
NpcPlaybackCoordinator.MarkStreamEnded(...)
NpcPlaybackCoordinator.InterruptExactTurn(...)

PlaybackStarted
PlaybackEnded
```

and a playback identity centered around:

```text
pedId
turnId
generationId
```

Playback-completion information includes semantics equivalent to:

```text
SpeakerPed
PedId
TurnId
GenerationId
Reason
WasInterrupted
HadAudio
PlaybackStarted
```

Use the actual Hotfix #3 implementation as the authority for precise names/signatures.

The architecture must preserve this identity throughout the entire OpenAI job.

---

# 1. Build a real native-turn correlation model

Every E1 job must have immutable native identity.

Conceptually:

```js
const job = {
    pedId,
    turnId,
    generationId,
    sessionIdOrNonce,
    abortController,
    state
};
```

The precise representation is up to you.

The important property is that native identity is allocated/bound once and is never reconstructed later from global runtime state.

Never identify a response using:

```text
currentSpeaker
currentPed
activeConversation
latestTurn
currentlyFocusedPed
global owner
```

Late asynchronous work must retain the original identity that created it.

Example:

```text
Ped A
Turn 40
Generation 901
```

must never become attached to:

```text
Ped A
Turn 41
Generation 902
```

just because the same NPC is still selected.

---

# 2. Remove redundant E1 audio ownership where possible

Audit the current implementation for any independent E1 audio-owner state machine.

Examples could include concepts such as:

```text
activeAudioOwner
currentSpeakerGeneration
pendingAudioPed
currentPlaybackJob
retiringOwner
```

Do not assume these exact variables exist.

Determine what responsibilities they serve.

If Essential's native playback coordinator now provides the authoritative equivalent, replace the duplicate logic.

E1 may retain enough local state to correlate asynchronous provider work.

It should not compete with Essential over who actually owns playback.

The desired responsibility split is:

```text
E1:
"These PCM bytes belong to ped X / turn Y / generation Z."

Essential:
"Generation Z is/is not authorized to own playback in GTA."
```

---

# 3. Native authorization must gate playback

The audio path should conceptually be:

```text
Luna decision complete
        │
        ▼
decision validation
        │
        ▼
TTS generation
        │
        ▼
native authorization for exact generation
        │
     accepted?
      /     \
    no       yes
    │         │
discard      ▼
       native tagged PCM
             │
             ▼
       native stream-ended
             │
             ▼
       native completion
```

Do not bypass a native rejection.

If an exact turn/generation loses ownership:

```text
do not play it elsewhere
do not bind it to the newest turn
do not retry it under a different generation
do not commit it as spoken history
```

---

# 4. Use tagged audio end-to-end

PCM/audio transport should remain associated with:

```text
pedId
turnId
generationId
```

through every chunk.

Use Hotfix #3's tagged/native audio mechanism rather than legacy unowned binary broadcast where possible.

Eliminate obsolete parallel audio paths if they are no longer required.

The final architecture must have:

```text
one audio owner
one authoritative playback path
one stream-end signal
one terminal outcome
```

---

# 5. Stream-ended semantics

For each authorized generation, there must be exactly one logical stream-ended transition.

The equivalent of:

```text
MarkStreamEnded(
    pedId,
    turnId,
    generationId
)
```

must not be:

```text
sent twice
sent for a stale generation
sent after ownership was transferred
inferred from a global speaker
```

Ensure all normal/error/cancel paths converge cleanly.

The state machine must tolerate:

```text
TTS completion
partial TTS failure
abort during streaming
native rejection
disconnect
supersession
wrong acknowledgement
duplicate acknowledgement
```

without creating two terminal outcomes.

---

# 6. Native playback completion becomes semantic truth

This is a major architectural change.

Do not treat:

```text
LLM completion
TTS completion
all PCM bytes submitted
HTTP request resolved
```

as proof that an NPC successfully delivered a response.

The authoritative success boundary should be a matching native playback completion event.

Conceptually:

```text
Luna output
    │
    ▼
stage assistant message
    │
    ▼
TTS
    │
    ▼
native playback
    │
    ▼
matching PlaybackEnded
    │
    ├── interrupted / failed → discard staged assistant response
    │
    └── successful → commit assistant response
```

Match completion using the full native identity:

```text
pedId
turnId
generationId
```

Never only `pedId`.

---

# 7. History commit model

Refactor dialogue history around staged delivery if necessary.

Desired model:

```text
user turn
   │
   ▼
Luna result
   │
   ▼
assistant response STAGED
   │
   ▼
native delivery
   │
   ├── successful matching completion
   │       │
   │       ▼
   │     COMMIT
   │
   └── interruption/rejection/failure
           │
           ▼
         DISCARD
```

Do not later tell the model that an NPC said something the player never actually heard.

A completed native event should only commit once.

Duplicate completion events must be harmless.

Wrong-generation events must be ignored.

---

# 8. Exact interruption

Refactor interruption/cancellation to target the exact native generation whenever possible.

Prefer the semantic equivalent of:

```text
InterruptExactTurn(
    pedId,
    turnId,
    generationId
)
```

over generic operations like:

```text
stop current speaker
stop current ped
clear all audio
```

The broader operations may remain for global shutdown if necessary.

Normal turn supersession must be exact.

Once a job is stale/superseded it must permanently lose the ability to:

```text
dispatch an action
emit PCM
mark stream ended
commit history
change native ownership
```

---

# 9. Cancellation must follow async work all the way down

Audit cancellation after every asynchronous boundary.

A stale check before the HTTP request is insufficient.

Check job validity after operations such as:

```text
LLM response
stream/body read
JSON parsing
TTS request
TTS body read
PCM conversion
native authorization
audio chunk submission
completion callbacks
```

A job that became stale while awaiting I/O must not resume with authority.

Avoid unhandled background promises.

All readers/bodies/promises must settle cleanly after abort.

---

# 10. Current Essential action capability model

Audit how E1 currently validates actions.

Do not preserve an old capability enum solely because E1 previously used it.

Hotfix #3 exposes action architecture equivalent to:

```csharp
NpcActionRegistry.HasAction(...)
NpcActionRegistry.TryExecute(...)
RoleActionRouter.TryExecute(...)
```

and the server contains a larger current action vocabulary than the old implementation.

Build E1 validation around the capabilities of the current Hotfix #3 build.

Preferred hierarchy:

```text
native/runtime capability discovery
        or
source-pinned generated capability manifest
        or
verified current capability table
```

Avoid manually maintaining a legacy shadow enum when the actual runtime can be interrogated or deterministically extracted.

---

# 11. Luna remains constrained

Do not interpret this refactor as permission to expose arbitrary GTA execution to Luna.

E1 still produces a tightly validated decision.

Conceptually:

```json
{
  "dialogue": "I'll wait here.",
  "action": "wait",
  "parameters": {}
}
```

The exact schema may remain whatever the current E1 implementation uses.

Rules remain:

```text
one complete decision
dialogue required/allowed according to current schema
zero or one stock action
only currently supported action
validated target
validated parameters
validated weapon/vehicle where applicable
no arbitrary script execution
```

---

# 12. Native action dispatch remains authoritative

Do not recreate GTA behavior inside E1.

The OpenAI layer selects an allowed intent/action.

Essential executes it.

Preferred architecture:

```text
Luna
  │
  ▼
validate against Essential capability set
  │
  ▼
Essential action dispatcher
  │
  ▼
GTA
```

Do not introduce a second implementation of:

```text
follow
wait
enter vehicle
exit vehicle
attack
weapon handling
movement
interaction
```

when Essential already owns it.

---

# 13. Determine correct action timing

Audit the current relationship between:

```text
action dispatch
speech playback
history completion
```

Do not preserve accidental timing.

Determine Hotfix #3's expected semantics and preserve stock behavior.

Examples:

```text
action before speech
action alongside speech
action after speech
```

may differ by action.

Do not force everything into one ordering unless that is actually the native contract.

Whatever ordering is used, the action must remain bound to the exact generation and may execute no more than once.

A stale generation must never execute its action.

---

# 14. Keep native context and hydration

Do not build another perception pipeline for E1.

Use Essential's existing context/hydration system.

The analysis identified systems equivalent to:

```text
ActorHydrationCoordinator
ConversationHydrationCoordinator
ActorContextProvider
NearbyPersonContextProvider
VehicleContextProvider
WeaponContextProvider
WorldContextProvider
PerceptionSystem
```

For E1, keep the current native context builder as the source of truth.

Our Luna adapter consumes that context.

It does not recreate it.

---

# 15. PTT architecture

Keep PTT native-first.

Desired path:

```text
Essential/native microphone control
        │
        ▼
capture/drain PCM
        │
        ▼
bounded E1 transcription input
        │
        ▼
OpenAI transcription
        │
        ▼
current Essential context
        │
        ▼
Luna
```

Preserve existing protections such as:

```text
bounded duration
bounded PCM bytes
16 kHz mono where expected
single WAV wrapping
single STT submission
duplicate start/stop handling
capture drain before creating turn
no prefix loss
```

Do not create a new microphone subsystem unless the current one is fundamentally broken.

---

# 16. Gemini isolation

OpenAI and Gemini must remain isolated provider branches.

An OpenAI turn must not unexpectedly trigger:

```text
Gemini TTS
Gemini replay
Gemini watchdog
Gemini exact-speech synthesis
Gemini retry path
```

Likewise, this refactor must not break the stock Gemini route.

If OpenAI-specific state is introduced, scope it explicitly.

---

# 17. Capability/version contract

Create a clear E1 ↔ Essential compatibility contract.

The OpenAI path should verify that the required native primitives exist.

Required capabilities include the functional equivalents of:

```text
native turn identity
generation identity
tagged playback authorization
tagged audio chunks
stream-ended acknowledgement
exact-generation interruption
playback completion events
native context/hydration
stock action dispatch
```

Prefer deterministic build-time verification where possible.

The existing system uses source-pinned input hashes and AST hooks.

Keep that safety model.

If Hotfix #3 changes in a way that invalidates an expected hook:

```text
FAIL CLOSED
```

Do not silently patch "something similar."

Do not silently downgrade into the legacy lifecycle.

---

# 18. Delete obsolete lifecycle code

After the new implementation is working and covered by tests, identify redundant code made obsolete by native lifecycle ownership.

Delete it rather than leaving two implementations active.

Examples may include:

```text
old generation owner maps
legacy audio broadcaster
old completion timers
server-estimated playback success
duplicate action capability tables
legacy Phase 9 code
speaker-based late-response recovery
obsolete Gemini/OpenAI crossover paths
```

Only delete code after confirming it has no remaining required use.

The target is not:

```text
old architecture + new architecture
```

The target is:

```text
new architecture
```

---

# 19. Avoid timeout-based correctness

Timeouts are allowed for failure recovery.

They are not allowed as proof of successful state transitions when Essential provides an acknowledgement.

Bad:

```text
wait 5 seconds
assume NPC finished talking
commit history
```

Good:

```text
wait for matching PlaybackEnded
use bounded timeout only to detect missing acknowledgement
```

If a required acknowledgement never arrives:

```text
fail safely
do not pretend success
release/retire local state deterministically
```

---

# 20. Formalize the E1 turn state machine

Implement or document an explicit state machine.

It does not have to use these exact enum names, but the lifecycle should be understandable.

For example:

```text
CREATED
  ↓
BOUND_TO_NATIVE_IDENTITY
  ↓
MODEL_RUNNING
  ↓
DECISION_VALIDATED
  ↓
TTS_RUNNING
  ↓
WAITING_NATIVE_AUTHORIZATION
  ↓
PLAYBACK_STREAMING
  ↓
STREAM_ENDED
  ↓
WAITING_PLAYBACK_COMPLETION
  ↓
COMPLETED
```

Terminal alternatives may include:

```text
CANCELLED
SUPERSEDED
REJECTED
FAILED
INTERRUPTED
```

Terminal states must be idempotent.

No transition should resurrect a terminal job.

---

# 21. Separate provider job state from native runtime state

Do not mirror every LSA field in JavaScript.

E1 only needs enough state to correlate provider activity.

For example, this is reasonable:

```text
job knows its:
pedId
turnId
generationId
provider request
abort state
staged history
TTS progress
```

This is not desirable:

```text
E1 duplicates:
NPC runtime mode
movement state
combat state
interaction ownership
activity state
native audio owner state
world state
```

Read/use Essential's state instead.

---

# 22. Preserve one-way authority

When possible:

```text
OpenAI proposes
Essential validates/owns/executes
```

Avoid:

```text
OpenAI state and Essential state continually trying to synchronize each other
```

This principle should guide design decisions throughout the refactor.

---

# 23. Prepare for E2-E7

The resulting architecture must make these future stages easier:

```text
E2 — provider/TTS abstraction
E3 — cancellation/retry/reliability
E4 — playback lifecycle/metrics hardening
E5 — structured streaming
E6 — early TTS
E7 — full regression/GTA acceptance
```

In particular, E5/E6 should not require replacing the ownership model again.

Future streaming should merely feed chunks belonging to an already-authorized:

```text
pedId + turnId + generationId
```

---

# 24. Prepare for later LSA extension work

Do not implement these now, but structure the adapter so later stages can use the discovered Hotfix #3 extension seams:

```text
IIntegration
IntegrationManager.Register(...)
EnrichActor(...)
OnPedControlChanged(...)
OnNpcActionExecuted(...)
IActionStateModifier
NpcActionRegistry.Register(...)
NpcStateStore
ReflexSystem
DirectedInteractionManager
SpecialGeminiTurnScheduler
PerceptionSystem
NpcItemStore
LocationRegistry
activity registries
```

These will later support:

```text
PERCEPTION
SALIENCE
SESSION_IDENTITY
SCENE_DIRECTOR
custom gameplay behaviors
```

Do not pull these concerns into E1.1 prematurely.

---

# Required architecture audit before implementation

Before modifying code, inspect the complete existing E1 implementation.

Produce an internal working audit of:

```text
current state owner
native Essential equivalent
keep / replace / simplify
reason
affected files
risk
```

Do not stop after producing the audit.

Use it to implement the rebase.

Areas to inspect include:

```text
turn creation
session identity
generation numbering
provider routing
LLM completion
action validation
action dispatch
TTS generation
PCM streaming
audio ownership
playback completion
history staging
history commit
cancellation
supersession
disconnect
reconnect
PTT
Gemini path
build hooks
capability tables
```

---

# Likely relevant files

Inspect actual paths first.

Likely E1 files include:

```text
src/integration/essentialGlue.mjs

src/openai/openaiTransport.mjs
src/openai/openaiConnection.mjs
src/openai/request.mjs
src/openai/decide.mjs
src/openai/runSequentialTurn.mjs
src/openai/speak.mjs
src/openai/transcribe.mjs

src/context/essentialDecision.mjs

src/memory/dialogueHistory.mjs

tests/generationOwnership.test.mjs
tests/sequentialText.test.mjs
tests/nativeAudio.test.mjs
tests/stockActions.test.mjs
tests/pttInput.test.mjs
tests/sessionHistory.test.mjs
tests/minimumFailure.test.mjs

tools/buildCandidate.mjs
tools/checkIsolation.mjs

patches/essential-hooks.json

build-manifest.json
```

Do not blindly create `V2` replacements.

Prefer replacing/refactoring the existing implementation unless an actual module boundary deserves to be split.

---

# Required test coverage

The refactor is incomplete without tests.

## Native identity

Test:

```text
same ped, newer turn
same ped, newer generation
different ped
wrong turn
wrong generation
wrong session nonce
late LLM completion
late TTS completion
late PCM chunk
late native completion
```

No stale result may attach itself to a newer turn.

---

## Native authorization

Test:

```text
authorization accepted
authorization rejected
authorization delayed
job superseded before authorization
job superseded immediately after authorization
```

Rejected/stale audio must never reach playback.

---

## Audio streaming

Test:

```text
zero-byte TTS
single chunk
multiple chunks
odd PCM byte boundary
partial chunk failure
abort during body read
abort during PCM submission
duplicate end request
late chunk after end
late chunk after interruption
```

Exactly one valid stream-end transition.

---

## Playback completion

Test:

```text
successful playback
never started playback
interrupted playback
wrong ped completion
wrong turn completion
wrong generation completion
duplicate completion
completion after local timeout
completion after supersession
```

Only the exact valid job may transition to successful completion.

---

## History

Test:

```text
successful playback commits once
TTS success but native rejection does not commit
partial playback interruption does not commit full response
wrong completion does not commit
duplicate completion does not duplicate
failed turn leaves prior history valid
bounded message count still works
new turn receives refreshed context
```

---

## Actions

Test:

```text
valid current stock action
unknown action
invalid target
invalid weapon
invalid vehicle
dialogue-only decision
stale job action
duplicate action dispatch
current Hotfix capability beyond legacy action list
```

One exact job may execute at most one action.

---

## Cancellation

Test:

```text
cancel during model
cancel after model
cancel during TTS
cancel during PCM
cancel while waiting for native completion
disconnect
reconnect
supersession by next turn
```

After cancellation/supersession:

```text
no more action
no more PCM
no stream completion
no history commit
```

unless native semantics explicitly require a final cleanup signal.

---

## Gemini regression

Test:

```text
stock Gemini text path
stock Gemini audio path
Gemini ownership
Gemini completion
OpenAI failure followed by Gemini turn
Gemini failure followed by OpenAI turn
```

The new OpenAI lifecycle must not corrupt Gemini behavior.

---

## PTT

Test:

```text
press/release
release before hydration
duplicate start
duplicate stop
maximum duration
maximum buffer
overflow behavior
single transcription
single turn creation
abort during transcription
```

---

# Offline safety

Automated tests must not:

```text
make real OpenAI requests
load production credentials
start GTA
attach to GTA
modify installed GTA
modify the stock Essential reference
use production ports/microphone unexpectedly
```

Mock external providers.

---

# Build isolation

Preserve the existing isolated-candidate model.

The refactor must still honor:

```text
candidate-only writes
source-pinned upstream archive
known DLL hash
deterministic hooks
exact AST match counts
failure on changed upstream input
no deployment during normal build/tests
```

Update hashes/manifests only when appropriate and clearly document why.

Do not weaken source-pinning merely to make the new hooks easier.

---

# Compatibility discovery

If Hotfix #3's actual native interface makes one of the proposed integration points impossible from the current JS/server boundary, investigate the cleanest bridge.

Allowed approaches include:

```text
existing native message route
existing bridge DLL
small source-pinned hook
small interop bridge
native event forwarding
```

Do not jump directly to invasive binary patching.

Prefer the smallest stable bridge that exposes the native authority to E1.

Document every new hook.

---

# Critical design question: server vs plugin responsibility

During the audit, explicitly determine where each lifecycle operation should live:

```text
server/OpenAI adapter
interop/bridge
LosSantosAlive.dll
```

Do not put logic on the server merely because JavaScript is easier.

If correctness depends on actual GTA runtime state, prefer the native side to own the decision and send an acknowledgement to the server.

---

# Logging

Improve correlation logging enough to debug lifecycle issues.

Every important E1 event should be traceable using identifiers equivalent to:

```text
pedId
turnId
generationId
provider
```

Examples:

```text
turn-bound
model-start
model-complete
decision-valid
tts-start
tts-complete
native-authorize
audio-start
audio-end-sent
playback-started
playback-ended
history-commit
cancel
supersede
reject
```

Do not log:

```text
API keys
full credentials
secret headers
unnecessarily sensitive prompt contents
```

Avoid excessive per-PCM-chunk logs unless debug mode is enabled.

---

# Remove accidental complexity

As part of this rebase, simplify code where complexity only exists because of the old ownership model.

Examples:

```text
race workaround timers
generation guessing
speaker repair logic
duplicate owner maps
manual playback-duration estimation
legacy compatibility forwarding
state repair after stale completion
```

Do not perform unrelated stylistic cleanup across the whole repository.

Focus simplification on the lifecycle being replaced.

---

# Documentation

Update the E1 architecture documentation.

The documentation should state clearly:

## OpenAI owns

```text
STT
model inference
decision parsing
TTS generation
provider-level deadlines
bounded conversational history
```

## Essential owns

```text
GTA context
NPC runtime state
turn/generation authority
action dispatch
playback authority
playback completion
interruption semantics
```

## Adapter owns

```text
correlation
validation
provider/native translation
staged history
failure handling
```

---

# Acceptance architecture

The final flow should be approximately:

```text
USER INPUT / PTT
       │
       ▼
Essential native input/context
       │
       ▼
bind exact native turn identity
       │
       │ pedId
       │ turnId
       │ generationId
       ▼
OpenAI STT if needed
       │
       ▼
Luna decision
       │
       ▼
validate against CURRENT Essential capability set
       │
       ├──── optional stock action ────► Essential dispatcher
       │
       ▼
stage assistant dialogue
       │
       ▼
OpenAI TTS
       │
       ▼
request native authorization for exact generation
       │
       ▼
tagged PCM
       │
       ▼
one native stream-ended marker
       │
       ▼
Essential playback
       │
       ▼
matching native PlaybackEnded
       │
   ┌───┴─────────────┐
   │                 │
success          interrupted/failure
   │                 │
   ▼                 ▼
commit           discard staged
history          assistant history
```

---

# Important invariant

At every stage ask:

> Can an old asynchronous result affect a newer GTA turn?

The answer must always be:

```text
NO
```

---

# Deliverables

Do the implementation, not just analysis.

When complete, produce:

## A. Architectural audit

Summarize:

```text
Old E1 subsystem
Old responsibility
Hotfix #3 native replacement
Final implementation
Removed code
Remaining local state
```

---

## B. Implementation

Make the actual repository changes necessary to perform the native lifecycle rebase.

---

## C. Deleted/replaced legacy machinery

Explicitly identify which old systems were removed and why they are no longer needed.

This is important because we do not want hidden dual ownership remaining.

---

## D. Native dependency contract

Document every Hotfix #3 method/event/capability on which E1 now relies.

Separate:

```text
hard dependency
optional enhancement
fallback-safe capability
```

There should be no silent fallback for hard lifecycle dependencies.

---

## E. Test results

Run the complete relevant E1 suite and new tests.

Report:

```text
passed
failed
skipped
reason for skip
```

Do not claim GTA/runtime success from mocked tests.

---

## F. Remaining GTA verification

Produce a short manual smoke-test checklist covering at least:

```text
typed conversation
PTT conversation
follow-up turn
speech interruption
new turn while old TTS is pending
follow
wait
weapon/action command
vehicle-related action if supported
reconnect
same NPC multiple turns
two NPCs in quick succession
```

---

# Decision authority

You have permission to change the current E1 architecture substantially if the Hotfix #3 analysis demonstrates that the existing design duplicates or conflicts with Essential's native lifecycle.

Do not ask for approval simply because a larger refactor is needed.

Use engineering judgment.

However:

- do not broaden scope into later gameplay features,
- do not rewrite unrelated provider code without cause,
- do not deploy into the user's live GTA installation,
- do not make real API requests during tests,
- do not weaken safety/hash/isolation protections.

---

# Definition of done

This work is complete when E1 no longer behaves like an external system trying to mimic Essential's runtime lifecycle.

Instead:

```text
OpenAI is the intelligence provider.

E1 is the adapter.

Essential is the runtime authority.
```

Specifically:

```text
Essential owns turn identity.
Essential owns generation identity.
Essential owns playback authorization.
Essential owns actual playback state.
Essential owns completion.
Essential owns GTA action execution.

E1 retains immutable correlation to that identity.
E1 performs OpenAI inference/STT/TTS.
E1 validates model output.
E1 stages history.
E1 commits history only after matching native success.
E1 cleanly discards stale or interrupted work.
```

There must be no meaningful duplicate playback/turn state machine left in E1 unless a specific technical limitation of Hotfix #3 makes one unavoidable.

If such duplication remains, document exactly why it is required.

The goal is to produce the **best E1 architecture for Hotfix #3**, not the smallest possible patch to the previous E1 implementation.