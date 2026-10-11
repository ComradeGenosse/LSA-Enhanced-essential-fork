# Phase 2 preflight — independent host, exclusion, transport and actor lifetime (2026-10-11)

**Scope:** Source and public-API investigation for draft [PR #40](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/40), base [PR #38](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/38), head at review `a28ab29b2503d1010786c08934599e2e45a1bf01`. No new RAGE host, protocol, GTA deployment, or production gameplay change is claimed. Phase 1 offline acceptance remains distinct from Phase 2 and physical acceptance.

## Decision summary

**Phase 2 implementation can begin** on the independent foundation, using these contracts. It **cannot** be marked fully accepted or GTA-safe until the explicitly blocked physical/runtime checks below are satisfied. There is no need to reverse-engineer another Essential class to write the first host.

| Investigation | Source/API finding | Phase 2 engineering decision | Evidence status |
|---|---|---|---|
| RAGE hosting | Existing `native/promoted-characters/EntryPoint.cs` is a real RPH plugin with entry/exit, update fiber and cleanup; `RuntimeEntry.cs` shows another fiber but is Essential-domain-specific. The standalone core contains no entry point. RPH documents entry fiber, `GameFiber.Yield/Sleep`. | Independent `LSA.Standalone.RageHost` targeting net481, separate `[Plugin]` with explicit entry/exit. Use **entry fiber itself** as the single authority dispatcher initially; it initializes and updates `NativeAuthority` and drains an inbound queue. Network workers never call game APIs. No `ClrDomains.FindEssential` / `DomainHost` / `IntegrationManager`. | Source/API design established; current Enhanced RPH SDK compilation and load/unload **UNTESTED** |
| Exclusive runtime | `PrefersSingleInstance` can be overridden by forced plugin load and applies only to the same plugin. The existing Essential DLL does not take a standalone mutex; process-wide mutex alone cannot exclude it. | Separate **mutually exclusive installation/runtime modes**, prelaunch allowed-module/profile manifest and independent node bootstrap. Runtime named mutex guards duplicate standalone; check for detectable Essential residency before and during activation; refuse control on ambiguity. Never attempt auto-stop/steal from Essential. No hot switching. | Fail-closed deployment contract; cross-controller real enforcement depends on isolated profile, **UNTESTED** |
| Native↔Node IPC | Existing `ControlChannel.cs` and `IntelligenceChannel.cs` demonstrate named pipes, SID ACL, queues, worker parsing, sequence/stream IDs. They are stock-coupled protocols, **not** a complete standalone duplex audio/turn protocol. | New independently named **duplex Windows named pipe**, length-prefixed frames for binary PCM plus strict versioned canonical metadata. Native creates world/run/actor/effect authority and controls admission. Node requests work and returns results but cannot confer a lease. | Feasible implementation seam; real net481↔Node interop, ordering and reconnect **NOT IMPLEMENTED** |
| Actor lifetime | `NativeAuthority.TryRegister` treats identical handle+address as the same actor. `Reconcile` can only retire observed changes. `SimulatedGame` has no hidden replacement with identical handle+address. Existing `EntityAnchors` and P2 encounter logic use captured ped references/lifetime and `Exists/MemoryAddress`, but cannot prove an unseen ABA event. | Real RAGE resolver observes ped existence/dead/address/script restrictions **and** must require a trusted per-entity lifetime marker (candidate: native DECORATOR cookie, subject to GTA Enhanced proof) before granting effects. Explicit local spawn/delete/retire notifications; per-fiber sweep, world change invalidation. No effect authority on ambiguous reused identities. | Observed-state design established; reliable Enhanced per-entity cookie / missing-destroy-event behavior **BLOCKED ON PHYSICAL SPIKE** |

## 1. Host startup and shutdown contract

1. A separate host assembly declares `[assembly: Plugin(... EntryPoint=..., ExitPoint=..., PrefersSingleInstance=true)]`. Use the configured GTA directory, not `Assembly.Location`, because RPH may shadow-copy plugin assemblies (observed in current EntryPoint comments).
2. Preflight **before any NPC effects**: verify `GTA5_Enhanced.exe`, explicit standalone profile/manifest, Essential absent from enabled load list, supported RPH/SDK runtime, required `LSA.Standalone.Core`, one process-local controller claim. If a predicate cannot be evaluated with sufficient certainty, refuse authority, log a stable reason, and exit.
3. On entry fiber, construct game adapters and `NativeAuthority`; publish `hostRunId`, `worldEpoch` and transport epoch only after successful initialization.
4. Run one dispatcher loop: sample world/timeline, reconcile current actors, drain **bounded** transport requests into validated decisions, execute only on the entry fiber, write immutable outbound receipts, then `GameFiber.Sleep`/yield. No await, worker callback, or arbitrary game call in the pipe thread.
5. `IOwnerContext.IsOwner` cannot equal `GameFiber.CanSleepNow` alone: that only establishes *a* game fiber. Enforce owner-only synchronous scope around each dispatcher operation, prohibit yielding inside that scope, and retain the core's constructing OS-thread check. Ensure reentrancy is rejected.
6. Exit callback signals stopping; actual retirement/game cleanup runs on owner fiber if still alive. Stop admission, revoke leases, cancel playback/actions, terminate queue, close pipe, bound worker join. If owner fiber is unavailable, off-fiber teardown must perform only safe managed-resource cleanup, **never GTA natives**. Idempotent failure/exit path, zero resuming old lease.

RPH source documentation (older API, current compatibility not proven):
- https://docs.ragepluginhook.net/html/4c04eafe-2474-4f41-9087-ac47bb16d491.htm
- https://docs.ragepluginhook.net/html/Properties_T_Rage_Attributes_PluginAttribute.htm
- https://docs.ragepluginhook.net/html/Properties_T_Rage_GameFiber.htm

**Acceptance tests:** compile real Release net481 against the user's actual supported RPH references; stub plugin load/exit with failure at each initialization stage; wrong owner context, background worker invokes native operation, duplicate startup, unload during pending IPC, unload during audio, repeated unload, host restart with stale callbacks. Physical load/unload/hot-reload and timing remain an explicit later GTA gate.

## 2. Mutual exclusion limits

- A mutex, a `standalone.enabled` flag and RPH `PrefersSingleInstance` are **insufficient** to exclude an unmodified Essential controller. Even assembly scanning is only a snapshot; later Essential loading could race.
- Use two **separately activatable** game profiles; standalone profile should not load original `LosSantosAlive.dll`, `LSA.PromotedCharacters` Essential bootstrap/runtime, or the old patched Node server. The existing profile remains untouched for rollback.
- A prelaunch manifest/installer validates the entire enabled RPH plugin list (not just one filename); runtime verifies what it can observe, refuses both modes if mixed, and periodically checks for incompatible module activity. Runtime checks are defense in depth, not a substitute for a profile that truly excludes Essential.
- Exclusive lock is for duplicate standalone processes/instances; independently authored host must not invoke Essential or migrate its active game tasks.
- `NativeAuthority` guarantees one claimant **per lease lane** inside our host, not cross-mod global arbitration. Standalone cannot safely accept production actor effects unless the exclusive-profile gate is satisfied.

**Acceptance:** pure-mode launch scenarios (both permutations), duplicate-force plugin load, stale lock recovery, rollback, noncooperating Essential injected after standalone starts (refuse/deactivate; do not claim perfect race-free detection). To *guarantee* nonoverlap, test with original host disabled at the loader/profile boundary, rather than relying on detection after both are running.

## 3. Exact independent duplex IPC contract

Recommended `lsa.standalone/1` **distinct from stock pipe version 1** and stock channel names. One native-server duplex pipe with current-user SID ACL; Node client has no direct game access. Validate path/name and maximum lengths; use length-delimited envelopes and binary PCM payloads, not newline JSON with base64 for audio. The byte parser must enforce strict schema, content length and endianness before allocation.

**Handshake:** native `host.hello {protocol, supportedVersions, serverNonce, hostRunId, worldEpoch, transportEpoch, capabilities}` → Node `client.hello {selectedVersion, echoedNonce, clientRunId, capabilities}` → native `host.ready`. Before ready, no commands. Reject duplicate, incorrect version, missing field, wrong run/epoch or stale transport epoch. The nonce is connection freshness, **not** authentication against malicious same-user processes; SID ACL and dedicated local launch/profile remain security prerequisites.

**Every effect-bearing message** names its `messageId`, `transportEpoch`, `hostRunId`, `worldEpoch`, `actorIncarnationId`, `conversationId`, `turnId`, `generationId`, `sessionNonce`, `kind`, `sequence`, with an opaque `leaseId` as appropriate. Native privately maps `leaseId` to an actual `OwnershipLease`, re-evaluates `NativeAuthority.IsLeaseCurrent`, correct lane, actor ref (including handle/address), session, turn, generation, sender-owned sequence and deadline **immediately before executing each effect**. Node never creates an `ActorRef` or authoritative lease. The wire may carry the native-incarnation UUID and a compatibility handle, but may not reconstruct authority from a handle/profile name.

**Representation trap:** `ActorRef.Address` is `ulong`, generations/deadlines are `long`; Javascript JSON numbers lose exact precision beyond 2^53. Keep raw native address private or encode it canonically as hex; use bounded safe integer sequences and canonical decimal string 64-bit values if sent. Native monotonic deadlines are not comparable to Node `Date.now()`: convert explicit bounded relative TTL at the receiving authority and reject stale epochs.

**Ordering:** independent monotonic outbound and inbound per-connection sequences, starting fresh after handshake; gaps, reorders, duplicate IDs and unauthorised repetitions fail closed. `turn.request` is only a proposal: native allocates/accepts the **one authoritative** turn before provider start. PCM carries `playbackId`, chunk index, validated sample profile, bytes and one EOS. Playback completion must carry actual native start+audible bytes+noninterrupted drain; requests cannot mark their own completion. Native mutation receipts must be idempotent and cross-checked with exact original claim; terminal effects are never replayed.

**Disconnect/backpressure:** disconnect *retires* connection-owned in-flight turns, stream leases and queued commands; native sends cancel/retirement to effects and marks callbacks stale. Reconnect gets a new transport epoch, fresh hello and snapshot; **no resume of old audio/actions or turn IDs**. Bound both metadata and PCM queues, length and age; full critical queue disconnects/retire rather than silently dropping a retirement or granting replay. Best-effort telemetry may drop with counted diagnostics. Heartbeats/expiry detect silent peers.

**Real two-process tests on Windows:** launch actual net481 pipe host with actual Node client; fragmented reads, partial length prefix, binary PCM, Unicode/invalid UTF-8, oversized frames, ordered/reordered/missing/duplicate indexes, reconnect during hello/turn/PCM/EOS/ack, wrong actor run/epoch/generation, actor killed during queued effect, invalid 64-bit numbers, competing clients, node kill/restart and clean host shutdown. Use finite test clocks and deterministic trace IDs.

## 4. Actor lifecycle — strongest unresolved physical signal

Current `native/standalone/NativeAuthority.cs` has `TryRegister(handle)`, `IsActorCurrent`, `Reconcile`, `RetireActor`, `WorldChanged`. `ActorObservation` includes `Handle`, `Address`, `IsAlive`, `IsScriptControlled`, **no stable native lifetime ID**. `TryRegister` intentionally treats matching handle/address as idempotent. Therefore:

- A destruction + replacement with reused identical handle and address **between polls** is not observable to this interface. The current simulator does not exercise that hidden ABA pattern. `Ped.Exists` after a yield is necessary but not sufficient proof of unchanged lifetime.
- Existing P2 `EncounterFor` additionally compares the specific `Ped` wrapper, `MemoryAddress`, anchors and registration claims, but wrappers/addresses are not a documented universal native destruction counter.
- Do **not** fabricate a definitive global RPH destroyed-event hook. The inspected public RPH Entity API documents `Exists`, `IsDead`, `MemoryAddress`, `Delete` and `Dismiss`; it does not establish a reliable global death/despawn callback before all handle reuse.
- Candidate: register dedicated collision-resistant GTA decorators before decorating is locked; write per-actor native-owned random cookie(s) on adoption/spawn and recheck native readback at **every** authority decision. If the same handle/address now lacks or changes the cookie, retire without authorizing a lease. Verify decorators actually attach/clear on GTA Enhanced entity death/despawn/reallocation and survive ordinary scene/summon transitions as expected. Do not substitute `Ped.Metadata` without proving it maps to physical lifetimes, not managed wrappers.
- When the cookie cannot be set/read reliably or another mod/mission takes scripted control, deny actor effect capability instead of enabling a 'weak identity' bypass. Adopted/ambient peds may need to be gated separately from our own spawned peds.
- Locally initiated `Delete`, `Dismiss`, death, despawn, profile release, world/timeline transition and exit call `RetireActor` on the owner fiber and publish `actor.retired` before allowing a new incarnation. Sweep tracked actors once each owner update; revalidate after **every** yield and before effect dispatch. No callback from native to Node can revive retired identity.

**Spike needed:** using installed RPH/GTA Enhanced, instrument a single throwaway test ped: register native marker, move far enough for cleanup, kill/despawn, delete, respawn same model, handle/address reuse under load, world reload, mission takeover, and compare cookie/handle/address/ped-wrapper before/after. Attempt both locally created and adopted NPCs. Capture only neutral IDs/lifecycle reasons, no user voices or profiles. If reliable native lifetime evidence cannot be demonstrated, Phase 5 physical effects remain **BLOCKED** even if Phase 2 transport tests are green.

RPH/entity evidence:
- https://docs.ragepluginhook.net/html/9b89eeec-ee62-421e-90d1-9785ac20ef09.htm
- https://docs.ragepluginhook.net/html/Properties_T_Rage_Ped.htm
- https://www.lcpdfr.com/resources/nativedb/index/decorator/

## Phase 2 implementation checklist and go/no-go

1. **P2-H1:** independent Release net481 RAGE host+SDK compilation; entry/exit, owner-scope, bounded dispatcher and fail-closed teardown.
2. **P2-X1:** explicit nonoverlapping Essential/standalone profile and duplicate-standalone exclusion. Mixed profile rejects activation before any NPC effect.
3. **P2-T1:** independently bootstrapped Node companion and real two-process Windows duplex wire; version negotiation, exact origin/lease lookup, strict parser, monotonic ordering, backpressure, broken connection, no replay.
4. **P2-L1:** adapter hooks for real world gate, game clock, actor observations, retirement and native incarnation evidence. Test hidden handle+address ABA. If physical signal cannot be tested before Phase 2 PR, label **physical gate blocked** and keep actor effects disabled pending explicit later acceptance.
5. Retain independent Phase 1 tests unchanged and extend deterministic/process tests only where they exercise the **actual production implementation**; don't count a simulator run as game/fiber proof.
6. Never alter old `main` plugin or GTA installation from this research PR. No Essential binary or stock Node server in standalone packaging.

**Disposition:** **GO to begin Phase 2 engineering**, **NO-GO for declaring a deployable or accepted standalone RAGE runtime** until live SDK/plugin compatibility, isolated profile and actor lifetime source are proven. The newly selected transport rules are a design contract, not completed code.
