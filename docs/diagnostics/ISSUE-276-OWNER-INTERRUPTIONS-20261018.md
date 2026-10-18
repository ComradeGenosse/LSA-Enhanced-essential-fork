# Issue #276 — native-owner pauses, reconnects, and recovery

Scope: latest `main` at branch creation, 2026-10-18. Read-only diagnostics and tests; no ownership, memory, Director, action, timeout, or retry policy changes.

## What is actually established

Issue #276 records five `owner_stalled` notifications (1,501–1,776 ms), eight disconnect events, five successful reconnect/initialization pairs, and at least one explicit `bridge_disconnected: session_closed` in `logs-20261018-192709-dc9bda.zip`. These are issue-level observations, **not an independent reanalysis of raw ZIP content**. The original archives `logs-20261018-192709-dc9bda.zip` and `logs-20261018-200333-6c2016.zip` were not accessible in the investigation environment; the second archive cannot be independently classified yet.

The source has two distinct thresholds:
- `ShadowRuntime.OWNER_STALL_BOUNDS.startMs = 1500`: *warning/presentation-lease suspension*, not a connection failure.
- `ShadowRuntime.sourceSilenceMs() = 3000` when native Memory K owner proof is negotiated (or PS2 observations absent), otherwise `resetMs = 60000`: expires stale channel evidence; companion then closes and reconnects.

Native `IntelligenceChannel` assigns a new `streamId` for each accepted pipe. Native `HostContext` holds a `hostRunId` and monotonically advances `worldEpoch` for genuine world boundaries. Companion `IntelligenceClient` retires authenticated memory/owner samples and Director reservations on disconnection and world transitions, then accepts a new owner only from a validated hello and fresh stream-bound evidence. Thus an alt-tab can **plausibly** cause a short stall or source-silence reconnect, but a timeout is not itself proof of the alt-tab. Nor does a clean hello alone prove subsequent NPC command/memory operation completed.

## New diagnostic evidence

- Native RPH logs: `[P2] focus_changed observed_utc=... foreground=yes|no|unknown host_run=... world_epoch=...` sampled from Windows foreground process every 250ms on an OS timer, not by calling GTA APIs off-fiber. Samples have their *observation timestamp* and are drained on the existing owner fiber after any pause.
- Native RPH logs: `[P2] owner_fiber_gap observed_utc=... gap_ms=... host_run=... world_epoch=... cause=unverified` for a lifetime-fiber wake gap >=1,500ms; reports elapsed monotonic wall time only.
- Companion E1 JSONL `intelligence_status`: `owner_stalled`, `owner_resumed` with duration and host/world identity; `owner_timeout` with `source_silence`; and `disconnected` with a bounded cause (`source_silence`, `hello_timeout`, `invalid_json`, `invalid_order`, `invalid_contract`, `econnreset`, `epipe`, `etimedout`, `transport_error`, `session_closed` or `unverified`). Unknown is intentionally not labeled a transport defect.
- No raw private messages, arbitrary pipe errors, player dialogue, ped refs, or credentials are emitted. Diagnostic callbacks cannot grant ownership.

**Interpretation:** `foreground=no` temporally overlapping native owner gaps/silence strongly supports a focus-related interruption. `foreground=yes` with a stalled owner suggests another problem but is not definitive if there were missed samples or process suspension. `foreground=unknown` or no focus records leaves the cause unresolved. Focus loss does not prove game pause; focus recovery does not prove command completion. The memory and Director fail-closed gates are preserved.

## Automated acceptance / remaining blockers

Focused Node regression tests simulate (1) a 1.8s stall with restored native frames and no disconnect; (2) >3s source silence, invalidation and new authenticated stream using the same host/world context; (3) a genuine connection reset and recovery; (4) deliberate shutdown reason; (5) bounded sanitization of diagnostic fields. Native net481 offline tests simulate foreground/background/resume, timestamp fidelity, owner-fiber gap threshold, and host/world isolation.

**Do not close #276 on offline tests alone.** Final GTA acceptance requires both original sessions plus a new instrumentation-enabled play session with deliberate alt-tab of ~2s and >3s, longer idle, and an actual socket/host stop; correlate RPH focus/wake evidence with E1 monotonic/UTC statuses and verify new verified stream/owner, Nathan command execution receipts, Memory K D02/M3 resumption, Director gate/reservations, and world epoch truth after each return. If an interruption lasts across a world/owner change, old claims must be rejected rather than silently reused. Close only after this evidence establishes no lasting gameplay issues.
