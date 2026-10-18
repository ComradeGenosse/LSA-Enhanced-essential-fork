# D2 native source-only and independent producer gates

D1 contract/base: `0fd2442f87ca25d8b16f05d2ccdf2c1a98767a85`.
Integration ancestor: #138 `505e9d0a827d3e633297cefc07b7ab2f3b1033b4`.
This is a focused stack on D1; integrate D1 first, then retarget/reconcile D2 to
`integration/memory-k-production-20261012`. Never merge this stack to `main`.

The native-owned startup configuration uses the existing `ps1.producers`
descriptor and a closed per-family gate at the existing integration/sensor
boundary. No commands or fields are added to the strict v1 wire. Example native
`Plugins/LSA.PromotedCharacters.json` configuration (no installation performed):

```json
{"enabled":true,"worldProfileId":"<existing-world-profile-uuid>",
 "intelligence":{"mode":"shadow"},
 "memoryK":{"capabilities":{"ps1.producers":"off"}}}
```

Pair this with D1's companion PS2/PS3 off requests. Source transport still uses
`intelligence.mode=shadow`; source-only is the operational result of producer
gates, not a second endpoint or authority. Root host enable and the existing
Core/identity pins remain required. Mandatory host/world, player/owner roster,
index, owner incarnation/encounter, situation and current-owner/player samples
remain on the original Core owner update. Witness-authority sample failure does
not prevent the separately available current-owner/player sample.

To operate exactly one existing native family, use `ps1.producers: "on"` and
`intelligence.producers: {"shooting":"on"}` (or `shadow`). Nonempty per-family
configuration defaults unspecified families off. Supported keys are
`ped_damage`, `player_damage`, `vehicle_damage`, `shooting`, `state`, `action`,
`playback`, `radio`. The master off gate always wins. Radio also retains its
existing `intelligence.radio: "shadow"` opt-in. Invalid literal modes and unknown
family keys are rejected before acquiring the host start claim. With no modular
or per-family configuration, existing producer behavior is unchanged, including
radio default off. A nonempty native capability request set defaults unspecified
PS1 off, matching B's explicit-request convention.

Disabled callbacks are not registered. Damage pin loading/registration,
shooting/state/vehicle/radio sampling and Core action/playback producer routes
respect immutable gates. `SensorAdapters.Enqueue` independently denies disabled
families even if another registration attempts to use the queue, and publication
rechecks the policy. Off adapters create no hidden edge baselines or witness
work. Source-only skips optional snapshot discovery, using the existing P2 roster
and controlled-player retention. It creates no scanner, polling owner, fiber or
IPC authority. Existing sequence, world reset, retirement, incarnation and
bounded queue/channel loss behavior is retained.

The policy and callback registration are startup-only. Native restart is required;
live producer switching needs a separately reviewed protocol/lifecycle design.
The existing native host `startClaim` and integration initialization guard remain
in charge, and producer registration is idempotent. Original shutdown still
disposes callbacks/queues/channel on its existing lifetime path.

Native local status distinguishes `producer_request`, `producer_mode`, configured
families, fresh completed source updates, and actual available native capabilities.
The companion retains authenticated v1 capability advertisements. Those flags do
not echo the native requested mode or radio gate: exact remote native mode
confirmation remains unsupported in v1 and must not be inferred from companion
configuration or zero observed events. Inspect the native status for configured
source-only mode. No unknown field is appended to legacy envelopes.

The production MSBuild Compile item list includes `NativeProducerPolicy.cs`,
`RuntimeEntry.cs`, `IntelligenceIntegration.cs` and the existing sensor sources.
All affected harness projects include the policy exactly once. M9 rollover,
Wasted and Busted sources remain outside the production project; no availability
claim or registration is added for them.

Tests compile actual policy/sensor code on net8 Windows/Linux and the production
integration/channel on net481 Windows with offline game adapters. Source-only
native wire is additionally passed through D1's complete validator and private
D02 port: post-bind and next-world samples verify current ownership with both
semantic stores absent. Original native assertions are preserved; stale host
test doubles are updated for existing current-owner/sample/constructor symbols.
The registration and pin-failure tests remain separate from physical GTA proof.

Production compile limitation: the available RPH SDK 1.124.0 rejects the inherited
radio `NativeFunction.CallByName<string>` call with CS0453. The exact same error
is reproduced before D2; the supported Windows net481 build otherwise resolves
the actual Essential/DamageTracker dependencies. The RPH reference SHA-256 is
`5d439745604a5fedbf8fa401520d4f296c1b6800d77e2923ba3bf9772182c7e0`; DamageTracker is
the pinned `64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750`.
No SDK stub is substituted for the production build. Matching approved RPH API
support or a separately reviewed radio adapter repair is still required for a
complete production DLL/package. This PR does not deploy or modify GTA.

| Mode | Confirmed scoped independence | Remaining dependency/limit |
|---|---|---|
| Source + D02, all optional producers/PS2/PS3 off | Yes, production source/queue/pipe/authority harnesses | Existing native/build pins, current P2/profile/timeline; production SDK/package/GTA gates |
| PS2 on, PS3 off | Yes | Compatible PS1 source and strict observer-qualified native signal |
| PS3 on, PS2 off | Blocked; neither is implicitly initialized | PS3 requires PS2 per B |
| PS2 + independently requested PS3 | Yes | Same validated source; PS3 request cannot create PS2 |
| Each existing native producer alone | Yes, policy/queue and registration gates | Master PS1 request; radio separate opt-in; actual physical producer validation remains |
| D02 on older peer without negotiated source version | Unavailable | No fallback to transport flags or names/handles |
| Live native gate switching / exact v1 remote mode echo | Unsupported | Restart required; negotiation is separate work |
| M9 rollover/Wasted/Busted | Unavailable | Actual production inclusion/qualification deferred |

F can now consume D02 without PS2/PS3 or optional native events; G can consume
PS2 without PS3. Their independent capture switches and E2 privacy remain their
own workstreams. M9 family qualification has a foundational producer gate;
callbacks, PS4/PS6 activation and foreground contributors remain separate.
No WS6 benchmark, original dialogue runner, M4 preparation or PS4 final-send
file is edited. D2 owns native project inclusion/config/integration and bounded
test adapter changes; coordinate those shared files when reconciling the stack.
