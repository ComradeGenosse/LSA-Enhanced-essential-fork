# E2 — Provider Abstraction, Voice Assignment, and Acting

E2 is about taking the working E1.1 OpenAI integration and turning it from a mostly hard-wired OpenAI pipeline into a **clean provider architecture**, without changing the native Essential lifecycle that E1.1 already got right.

The goal is not to add a bunch of providers immediately. The goal is to create the correct seams now so reasoning, transcription, and speech can evolve independently later.

E2 should separate the AI stack into clear responsibilities such as:

```text
ReasoningProvider
TranscriptionProvider
SpeechProvider
VoiceResolver
```

The current OpenAI implementations should simply become the first provider implementations behind those interfaces.

Essential must continue to own:

```text
native turn identity
generation identity
NPC/GTA state
action execution
playback authorization
playback completion
interruption
```

E2 should not replace or duplicate any of that.

The most visible gameplay improvement in E2 is **stable NPC voice assignment**.

Right now the OpenAI TTS path effectively uses one configured voice for everyone. E2 should assign each active NPC/native session a deterministic voice profile and keep that voice stable across repeated turns with that NPC.

The voice profile can include:

```text
voice
speed
bounded acting/style instructions
```

The acting layer should make NPC speech sound more natural and character-like, but it should not modify the actual dialogue text Luna generated.

E2 is intentionally **not** the long-term character identity system. Voice assignment should be stable for the current native NPC/session only. Later SESSION_IDENTITY work can make voice identity persist across longer-lived characters.

The desired result of E2 is:

> The same E1.1 native lifecycle still works exactly as before, but the OpenAI side is modular, NPC sessions can have stable distinct voices, and TTS can receive natural acting/style guidance.

---

# E3 — Reliability, Retries, and Failure Recovery

E3 is about making the provider side resilient to real-world API and network failures without ever compromising the native lifecycle guarantees established by E1.1.

Typical failures include:

```text
429 rate limits
408 timeouts
500/502/503/504 provider errors
connection resets
temporary network failures
STT failures
reasoning request failures
TTS failures
```

The central rule is:

> E3 may retry provider operations, but it must never retry or replay native/gameplay side effects.

Retries must be **stage-aware**.

For example:

```text
STT
```

can usually be retried safely before a transcript is accepted.

```text
Reasoning
```

can usually be retried safely before a validated decision leaves the provider stage.

```text
TTS
```

can only be retried before the first usable PCM has been handed to Essential/native playback.

Once native playback or another gameplay side effect has started, automatic retry is no longer safe.

E3 must never retry an entire turn from the beginning.

That is critical because a whole-turn retry could duplicate:

```text
stock actions
native playback
history changes
stream-end signals
```

Instead, retries should happen only around the individual provider operation that failed.

Every retry must also remain bound to the exact original:

```text
pedId
turnId
generationId
sessionNonce
```

Before each retry, E3 must verify that:

```text
the turn is still current
the generation is not stale
the job has not been cancelled
the job has not been superseded
the original provider deadline still has time remaining
```

If the player starts a newer turn while an old retry is waiting, the old retry must die permanently.

Retries must also consume the **same original provider deadline**. They must not restart a fresh 45-second budget on every attempt.

E3 should initially be conservative:

```text
one original attempt
+
at most one automatic retry
```

for clearly transient failures.

It should not retry:

```text
bad credentials
invalid requests
model refusals
invalid decisions
native authorization rejection
playback interruption
stale generations
```

Observability should record retry behavior so we can later see:

```text
how often retries happen
which stage needed them
which errors caused them
whether they recovered
how much latency they added
```

The desired result of E3 is:

> Temporary provider/network problems can recover automatically when it is safe, while stale turns, native playback, actions, history, and generation ownership remain impossible to duplicate or resurrect.

---

# Combined intent

Together, E2 and E3 are meant to transform the working E1.1 foundation from:

```text
one working OpenAI integration
```

into:

```text
a clean provider platform
+
stable NPC voice behavior
+
safe provider-level reliability
```

without changing the core rule established by E1.1:

```text
OpenAI provides intelligence.

E1.1/E2/E3 adapt and validate provider work.

Essential remains the authoritative GTA runtime.
```