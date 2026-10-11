# Phase 2 — first independent host and transport increment

**Branch:** `feature/standalone-phase2-host-transport` stacked on Phase 1 PR #40. **State: coding started; no GTA deployment.** This is an intentionally **safe, health-only first increment**, not a completed Phase 2 or playable standalone replacement.

## Implemented now

- `native/standalone-host/LSA.Standalone.RageHost.csproj`: a separate .NET Framework 4.8.1 RPH plugin project referencing the independent Phase 1 core only. No Essential DLL, stock Node bundle, `ClrDomains`, `IntegrationManager` or original binary compiled into its closure.
- Entry/exit points with process/exclusive-profile check, a same-process native-controller mutex, single entry-fiber `NativeAuthority`, bounded dispatcher, monotonic clock, world safety gate, observed GTA tick regression, asynchronous shutdown signal and owner-fiber cleanup. Separate active control scope rejects off-owner activity and explicitly never spans `GameFiber.Sleep`.
- `UnverifiedRageActorResolver` deliberately always returns *false*. It prevents any NPC effects until a verified GTA entity incarnation signal is implemented. This is a safety gate, not a completed actor adapter.
- Independent `LSA.Standalone.Phase2.v1` current-user ACL duplex Windows named pipe with 4-byte LE length prefix, strictly bounded 8192-byte UTF-8 JSON metadata frames, versioned native host/session identity, per-connection transport nonce, independent monotonic inbound/outbound sequence, fail-closed disconnect and world-epoch rejection.
- Worker thread parses frames only. `host.snapshot` goes into a bounded worker-to-owner queue and is answered **only** by `NativeAuthority` on the game fiber. Native currently accepts only `health.ping` and `host.snapshot`; all actor/audio commands are intentionally unsupported.
- Independent Node companion health client with strict frame/parser/handshake/sequence validation, no resumable in-flight requests or hidden automatic replay. CLI `node lsa-standalone-companion/tools/health-check.mjs`.
- Offline fixture tests for valid handshakes, stream fragmentation, corrupted UTF-8, wrong world epoch/protocol, duplicate/out-of-order frames, transport backpressure and request death, and a genuine `net481` named pipe server ↔ independent Node CLI harness on Windows.
- Windows compile-only **RPH stub**, clearly separated from the production project; fake DLL never distributed or used as physical compatibility evidence. A real RPH build requires `-p:RphReferencePath=<path to locally approved RagePluginHook.dll>`.

## Important limitations and next implementation steps

1. **GTA SDK compatibility gate still open:** CI builds the host against a compile-only **fake RPH interface**. It must also compile against an actual supported GTA V Enhanced/RPH SDK and load/unload safely inside the game before marking the native host accepted.
2. **Actor-lifetime gate still open:** replace the intentionally rejecting `UnverifiedRageActorResolver` with verified entity-lifetime tags, and explicitly prove same-handle + same-address ABA can be detected. No actor effects are permitted until then.
3. **Transport is health-only:** implement authenticated/single-authority exact-turn admission, effect-lease lookup, PCM framing and queues, cancellation, provider bootstrap, backpressure receipts and replay protections on the **actual production** native/Node channel. Do not treat health tests as audio/turn acceptance.
4. **Exclusive profile is provisional:** `Plugins/LSA.Standalone.enabled` is an operator-controlled activation marker. Startup additionally refuses known original Essential/plugin paths and duplicate standalone controllers. This is **not** a universal detector for renamed or side-loaded third-party plugins; actual standalone installation/loader manifest and physical audit must ensure Essential is truly absent.
5. **Rollback and isolation:** existing `main` and the current Essential-based installation are untouched. Standalone mode intends *complete replacement*, not a fallback runtime or a mixed Essential/standalone system.
6. **Shutdown caveat:** if the game fiber is torn down before it can revoke native claims, the exit callback only safely stops managed IPC; pending game effects remain disabled in this increment. Real RPH unload ordering must be tested.

## Build/test

```powershell
node --test lsa-standalone-companion/tests/phase2-wire.test.mjs
dotnet build native/standalone/LSA.Standalone.Core.csproj -f net481 -c Release
dotnet run --project native/standalone/tests/LSA.Standalone.Core.Tests.csproj -f net10.0 -c Release
dotnet build native/standalone-host/tests/FakeRphSdk.csproj -c Release
dotnet build native/standalone-host/LSA.Standalone.RageHost.csproj -c Release -p:RphReferencePath="<approved installed RPH SDK DLL>" 
dotnet build native/standalone-host/tests/Phase2PipeHarness.csproj -c Release
```

Run the last harness and the Node health CLI concurrently on Windows to exercise a real server/client process boundary. The PR CI performs this smoke test against actual `net481` code.

**No deployment or Essential removal performed.** Physical acceptance and all audio/actor integration gates are still pending.
