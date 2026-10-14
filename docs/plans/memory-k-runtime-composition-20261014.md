# Memory K C: instance composition and lifecycle ownership

Base: #138 `bd51fc180efa6babc597f99f4987ef0538b61854`, including the #160 policy foundation. This scoped PR targets the canonical integration branch, never main. No merge or GTA deployment is performed.

## Implemented ownership

`RuntimeResourceScope` owns one bundle runtime's acquisition/cleanup records. It tracks starting, operational, stopped and failed **resource lifecycle** states, supports partial-startup rollback to a checkpoint, disposes in reverse order, continues cleanup after a disposer fails, and coalesces repeated disposal. It creates no scheduler, store, bus, native executor or provider worker.

Bootstrap reuses the existing factories and records ownership of telemetry/trace it creates, Essential connections, P1 resolver subscription, the single P2 storage service, IntelligenceClient, D02 authority, M3 factory, host/world subscriptions, Director pump/subscription, ACT client/runtime, editor/endpoint and its process shutdown listener. Caller-owned telemetry/trace and injected P1 evidence remain caller-owned. The resolver unsubscribes and retires its bindings without closing shared injected evidence.

P2 initialization is deferred to bootstrap and awaited exactly once before consumer registration. Direct `createRuntime` callers preserve their auto-initialization behavior. SQLite initialization failure rejects with `p2_sqlite_startup_failed` after releasing partial resources; there is no JSON fallback. Consumers drain before storage closes; M3 drain errors are no longer swallowed. M3 factory failure removes its partially acquired subscriptions and authority.

`runtime.dispose()` / `shutdown()` revoke original acceptance, close existing OpenAI connections through their existing cancellation path, stop optional channels/consumers, remove subscriptions/editor and close the P2 writer, then close owned logs. Disposed runtimes reject new connections. `runtime.restart()` coalesces concurrent restart requests, awaits disposal, rejects if cleanup failed and constructs a fresh runtime from the same options/config path. It does not restart a closed SQLite object or reuse retired receipts. External injected stores must themselves support reinitialization or callers should construct a fresh runtime with fresh injected test resources.

## Requested policy versus operation

#160's registry, resolver, normalization and read-only diagnostics remain intact. `memoryKRuntimeDiagnostics()` adds **resource lifecycle** and the original policy projection. Healthy storage initialization has an explicit operational lifecycle receipt; it does not attest source freshness, timeline confirmation, native ownership or privacy operation. Those existing per-operation checks remain mandatory.

An explicit nonempty `memoryK.capabilities` request stops optional automatic Memory K consumers while independent production adapters remain unfinished. M2 bind/player/NPC ports return no result, the NPC speech recorder is not constructed, combined foreground journal/M4/M5/M8 preflight is not invoked, and M3 accepted-observation/coverage factory is not registered. Omitted optional requests are off in this modular path. Off rows report stopped/effective off; requested on/shadow without independent production wiring remains unavailable/blocked with null effective mode. This is an explicit operational decision, not a fake enable receipt.

With an omitted/empty modular request, the existing #138 opt-in SQLite legacy bundles remain unchanged. Ordinary Essential/P1/P2, D01/D02/source host/world validation, PS1–PS4/PS6 and ACT retain their own gates and authority. Off Memory K consumers do not switch off ordinary perception or Director. Experimental defaults are unchanged. E1 supplies the explicit storage-only preset and real storage/editor/migration isolation acceptance next.

**Limits:** This PR establishes lifecycle ownership and safe optional off enforcement. It does not independently enable M2 player/NPC, M3 events/coverage, journal/M4/M5/M8, M6/M7 workers or M9 callbacks/producers. Those require F/G/H/I/J/K/L/N and native source/producer work. PS1/PS2/PS3 remain coupled operationally until D1/D2. No live hot-switch, native command, global privacy pause, learned-memory inspector, cloud consent UX or complete S01–S10 is certified.

## Verification and integration

New `memory-runtime-composition.test.mjs` covers reverse/idempotent cleanup, partial initialization rollback, sibling isolation, cleanup failure visibility, duplicate ownership, unavailable activation, instance process-listener cleanup, restart coalescing, stale connection rejection, disabled consumer ports, source-channel independence and SQLite failure cleanup without closing external evidence. The focused development regression run passed 213/213 with zero skips. The existing pinned offline package builder succeeded with 70 AST edits; this is not the independent W09 package/native acceptance gate.

CI runs the exact PR head on Node24 Windows/Linux for new tests, #160 policy, perception/P2 lifecycle, every nested memory suite and the offline package builder. Existing source/native/release workflows remain unchanged. `tools/memory-k-verification/registrations/runtime-composition.json` adds this suite to A/O #162's inventory without copying/editing the baseline. A/O is a verification dependency, not a production runtime dependency.

Integrate A/O first, then C, then E1. Verify their combined head before acceptance. The PR body carries exact final head/test results. Original scenarios, native production SDK/build, independently verified package, physical GTA and soak remain separate open gates. No changes to native authority, D01/D02/D03 algorithms, PS4 assembly, schema/migrations, suppression or single-writer ownership are made here.
