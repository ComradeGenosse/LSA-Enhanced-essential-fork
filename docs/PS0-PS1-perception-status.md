# PS0 + PS1 shadow perception

Status update, October 5, 2026: **merged on `main` and exercised as part of the combined shadow runtime.** The October 5 UX4/PS3 run observed firing, injury-state, death, vehicle/state and transition activity from the PS0/PS1 producer layer while PS2/PS3 processed live facts. This is partial live evidence, not closure of the structured PS0/PS1 acceptance checklist; direct DamageTracker callback counters still require the controlled player/NPC/vehicle probe.

Historical implementation checkpoint, October 3, 2026: This implements only the foundation and core factual producers from [PR #10](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/10), at research commit `be6b56294894efb10eb2a07db1aa31eebcba9606`. The historical architectural source for that checkpoint is archived at `docs/research/archive/perception/perception-salience-scene-director-architecture-20261004.md`. Current architecture is governed by `docs/research/CURRENT.md`, `DECISIONS.md`, and the system contract register.

## What runs

The existing Core-free P2 RAGE loader hosts the optional `IntelligenceIntegration` in Essential's already-running AppDomain. Its sources are compiled into the existing private `LSA.PromotedCharacters.Runtime.dll`; there is no additional loader, Core copy, or tracker service. P2's retained roster provides explicit owner incarnation and revocation. Conversation participants and the player are sampled without allocating dialogue sessions, promoting ambient peds, hydrating extra actors or creating active NPC state.

PS0 supplies primitive version-1 raw signal, anchor/roster, episode and observation contracts; a retained native anchor table; bounded raw queues; monotonic expiry; strict sequence/revision validation; a separate current-user ACL factual pipe; configuration, optional capability pins and counters. Episode and observation stores are immutable storage primitives only. PS1 does not populate them from shared signals: observer witness attribution and correlation belong to PS2. No backend signal is automatically anyone's knowledge. Recognized CharacterIds remain empty, and no CharacterId crosses this channel or addresses an entity.

The factual endpoint is output-only `LSA.Intelligence.v1`. It has no command parser and cannot accept reserve/submit/control/audio requests. Native output is limited to 64 frames; the companion accepts at most 256 pending frames, processes 32 per pass and caps each newline-delimited UTF-8 frame at 8 KiB. A fresh stream UUID accompanies each connection and a fresh adapter epoch accompanies native restart/clock regression. The same-user OS ACL is the authentication boundary, as with the existing P1/P2 IPC; it is not authentication against another malicious process running under the same Windows user. Actor integration JSON is never an input to this endpoint.

Hello advertises closed capability flags. Ordered frames carry anchor batches, retirement batches, primitive signals or diagnostics. Frame sequence gaps or native output overflow invalidate the entire connection and its roster. Duplicate/out-of-order frames, producer sequences, wrong entity kinds, stale epochs and retired participants fail closed. Producer gaps report loss; they do not invent missing damage or outcomes. On reconnect the native roster is republished; queued facts are not replayed into a new native lifetime.

## Supported producers

| Source | PS1 fact and boundary |
| --- | --- |
| DamageTracker ped/player damage | Subscribe to the existing `OnPedTookDamage` and `OnPlayerTookDamage`. Copy health and armour damage, validated damage-class category and retained participants when supported. Receipt is not an engine strike timestamp or physical-outcome guarantee. |
| DamageTracker vehicle damage | Existing `OnVehicleTookDamage`; bounded damage, finite collision coordinates and supported attacker anchor. A collision/damage payload does not establish deliberate ramming, a crash cause or driver intent. |
| Existing PerceptionSnapshot | `TryGetSnapshot` only. Measure source age and changes in snapshot timestamp. A snapshot older than 1,000 ms is excluded from discovery; missing and stale snapshots are reported. No addon `Update`, `Capture` or world enumeration. |
| Firing | `IS_PED_SHOOTING` rising edges on player plus at most eight retained sources, at a proposed 50 ms cadence. Initial true establishes a baseline; sustained true does not repeat. A 500 ms per-source limiter bounds repeated edges. No gunshot stub or witness/hearing attribution. |
| Ped state | Baseline/current health, armour, injured/dead flags; retained alive-to-dead only. Disappearance retires the anchor without death. No update to player-editable P2 availability. |
| Location/activity | Canonical zone code with 1 s stable dwell; coarse stationary/walking/running/in-vehicle/directed state from current native reads and `TryGetState`. No private activity narrative or repeated actor hydration. |
| Vehicle associations/state | Entry/exit/driver association edges, current retained vehicle engine state and coarse speed/engine-health bands. Retiring a vehicle invalidates the old association baseline instead of manufacturing entry/exit. Vehicle-state reads are limited to current rides of sampled peds. |
| Presence | Live roster flags distinguish conversation/promoted presence; state edges use closed categories. These establish runtime presence, not recognition or what another NPC saw. |
| Action/playback callbacks | Handler-reported success, start/end and interruption/audio flags only. No action names outside the small allowlist, dialogue text, session/turn IDs, completion inference or heard-speech propagation. |

Conversation observer admission is deterministic and applies as one ordered set each discovery cycle: current conversation first, then promoted/owned participants ordered by lifetime token, then lower-priority retained entities. If conversation is not one of 16 promoted participants, it takes one of their observer slots; the displaced promoted anchor stays retained and owned but is demoted as an observer. Changing or returning to a conversation demotes/promotes the same retained lifetimes. No anchor token is retargeted, and native admission never exceeds 16. Wire publication tracks the last successfully sent state for each captureRef and sends observer/conversation demotions before stable updates and promotions. The companion preflights each anchor frame against a projected roster and commits the batch atomically, so a paired demotion/promotion never exposes a transient 17-observer roster; an unpaired seventeenth observer remains a protocol failure that closes and clears the runtime. Native integration tests exercise the 16-promoted-plus-conversation case, inspect the production pipe ordering for a changing target, check ownership and captureRef retention, and change/return the conversation target. Companion client/runtime tests exercise Q→R→Q without resets, the exact 16 cap, retained refs, and fail-closed rejection of a genuinely invalid seventeenth observer.

### Pinned player damage callback investigation

The pinned `DamageTrackerLib.dll` SHA-256 is `64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750`. A metadata-only IL decode of `DamageTrackerService.InvokePedDamageEvent` (RVA `0x3978`) shows the control flow after victim resolution: `Ped.get_IsPlayer` at `IL_0072` branches to the general ped callback at `IL_008E` only when false. That path loads `OnPedTookDamage`, invokes it if subscribed at `IL_009D`, then returns. The true/player path loads `OnPlayerTookDamage` at `IL_0079`, invokes it if subscribed at `IL_0088`, then returns at `IL_008D`. If the player-specific delegate is null, its conditional branch at `IL_007E` goes directly to the terminal return (`IL_00A2`); it does not fall through to the general ped callback. Thus one invocation of this method cannot emit both callbacks for the same player hit. This conclusion comes from the full branch and return flow, not event declarations or a partial excerpt.

Static inspection does not prove how often the detector invokes this method for one physical hit or how game/runtime callback timing behaves. No time-window deduplication was added. Bounded cumulative `damageCallbacks` diagnostics now report separate `ped_damage`, `player_damage` and `vehicle_damage` totals (saturated at `Int32.MaxValue`), alongside the existing queue/drop counts. They increment at callback entry before payload validation, participant mapping or queue admission, so invalid/dropped facts do not hide callback multiplicity. The payload shape and companion validator allow exactly those three callback counters. In GTA, record the counters immediately before and after one isolated player hit: one callback should increment `player_damage` only; any `ped_damage` increment on the same isolated hit would expose behavior outside the inspected single-invocation path and must be investigated before changing producer semantics. NPC hits should increment `ped_damage` only. Unknown attacker handling and per-producer sequence numbers remain unchanged.

Damage classification maps defined enum values for firearms, melee, explosives, vehicle damage and fire. Ambiguous less-than-lethal/electric/misc categories remain `unknown`; PS1 does not guess stun or a specific weapon. `IsRunning=false`, missing library or fingerprint mismatch means damage capability unavailable. The adapter never starts/stops DamageTracker. Deferred loading is handled by one background assembly pin read, followed by subscription on native Update; no pin file read occurs in Update.

At the PS1 baseline, witness/LOS/hearing, acoustic modeling, recognition, awareness corroboration, body discovery, explosions as a separate event source, theft/police semantics, salience, memories, context projection, Scene Director, directed exchange and new actions were unavailable. PS2's shadow-only implementation is recorded below; `awareness` stays false and player speech hearing remains gated off.

## Lifetime and loss policy

A captureRef is a random run-local UUID. The native table retains the original wrapper, full handle/address, validation closure and exact owner incarnation. Changed wrapper/address/owner, observed nonexistence, explicit revoke, expiry and clock regression retire it. New wrappers with the same handle/address receive new tokens; they never inherit old state. No handle lookup resolves old work to a replacement.

Callbacks perform no game/entity reads: payload primitives and object-reference comparisons against the previously validated immutable index only. Participants without an exact retained callback object stay unknown. Native Update validates original anchors again before publication; stale work is dropped. This conservative rule can lose attribution when the library supplies a fresh wrapper for the same ped. Wrapper churn can also reset transient baselines. Those losses are intentional until physical testing establishes wrapper behavior; the adapter does not weaken lifetime checks to improve apparent sensor coverage.

The anchor validates existence/address/full handle and owner currency where available. No public seam proves an unobserved destroy/recreate that reuses every native identifier while keeping the same retained wrapper apparently valid. Actual RPH/GTA lifetime behavior remains an acceptance unknown from PR #10; the implementation never resolves by handle or CharacterId to paper over it. If testing demonstrates that case, disable affected attribution and document the smallest additional lifetime seam before enabling later phases.

Initial state and shooting samples create no historical events. Native game ticks are uint32 source qualifiers; callbacks use the last game-path tick plus actual monotonic receipt time, not a purported engine timestamp. Monotonic time governs 30 s raw expiry and idle anchors; game-clock regression clears runtime state/queues and rotates the epoch. Companion roster leases expire after 3 s without fresh facts; pause/disconnect/restart cannot revive a roster or backlog. Restarting configuration uses a fresh GTA/native run, not a restored runtime address.

## Configuration and build

Both example configurations default to `off`. To test, add to the companion's existing `e1.config.json` and native `plugins/LSA.PromotedCharacters.json`:

```json
"intelligence": { "mode": "shadow", "pipeName": "LSA.Intelligence.v1" }
```

Keep the existing P2 host enabled with its existing world/pipe configuration. Restart GTA normally after configuration/package changes. Unknown modes, including `context`, `memory` and `initiative`, cannot activate later behavior. A missing companion contract disables only intelligence. Native feature failures do not shut down P2 or ordinary dialogue. `EnrichActor` emits no intelligence block; the runtime has no access to provider/store/action services.

Build the companion with `node tools/buildCandidate.mjs` from `lsa-essential-e1-candidate`. Build the existing P2 package with explicit compile-only references:

```powershell
$env:LSA_IDENTITY_RPH_REFERENCE = '<pinned SDK>\RagePluginHook.dll'
$env:LSA_IDENTITY_FRAMEWORK_ROOT = '<root containing .NETFramework\v4.8.1>'
$env:LSA_INTELLIGENCE_DAMAGE_REFERENCE = '<shipped pinned>\DamageTrackerLib.dll'
node tools/buildCharactersAddon.mjs
```

Core SHA-256 stays `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`; DamageTracker stays `64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750`; RPH SDK stays `5d439745604a5fedbf8fa401520d4f296c1b6800d77e2923ba3bf9772182c7e0`. Additional PE metadata artifacts are byte-pinned by `verifyPerceptionContract.mjs`, including exact snapshot, state, targeting, damage add/remove and playback signatures. Drift fails closed; similarly named methods are not used. The PE reader's `--intelligence` mode reproduces the artifacts without executing game assemblies. Existing source-pinned stock controller patches remain at 48.

The package contains only the existing loader/private runtime/P1 library and disabled example config. SDK, DamageTracker, framework and Essential DLLs are not deployed by the builder. No GTA installation/deployment or provider call is part of this offline validation.

## Bounds and diagnostics

| Resource | Implemented limit |
| --- | --- |
| Observers / anchors | 16 / 256; current conversation first, then promoted/owned; idle anchor expiry 30 s |
| Raw ingestion | 256; 64 slots reserved for critical involvement; routine maximum 192 |
| Discovery | Maximum 512 candidates per 200 ms cycle, sliced to at most 32 per Update; cursor on shared snapshot, 100 m cheap range rejection |
| Sampling | Player plus at most eight firing sources / 50 ms; at most 25 ped state samples / 200 ms; rotating cursor, defer after sampling budget |
| Native work | Discovery/cleanup stop between calls after their 1 ms budget; sampling has a separate 1 ms budget so discovery cannot starve player firing; at most 16 cleanup validations and 32 signals drained per Update |
| Transport | 8 KiB frame; native 64 / companion 256 queued frames; batches at most 32 anchors/revokes |
| Companion runtime | Raw TTL 30 s; roster lease 3 s; no transient disk storage |
| Episode/observation primitives | 64 open / 256 total episodes; 128 observations/observer, 2,048 total and 2 MiB serialized observation RAM; four claims/observation, eight/episode, four episode participants |

The count budgets match PR #10. The implementation separates discovery and sampling time guards to prevent sensor starvation, conservatively caps discovery slices and cleans incrementally. These guards cannot preempt an individual native call or all fixed roster/transport work; **≤1 ms p95 added total Update cost is an unverified GTA acceptance target**, not a measured claim. No actor×target polling or LOS queries run.

Native `[PS] native_adapter_loaded shadow` confirms installation. Every 10 s `[PS] shadow` logs bounded counts: anchors, observers, snapshot age/cadence, drops, stale rejections, retirements, deferred discovery, sampled Update cost, available capabilities, signal-kind counts and separate ped/player/vehicle damage callback totals. Diagnostics frames emit every second. Companion `[PS] companion_shadow` reports bounded admission/drop/gap/expiry/reset counters, capabilities and the latest separate damage callback totals every 10 s while connected. `snapshotAgeMs=2147483647` means unavailable. Damage callback totals count callback invocations, including unknown participants and facts later dropped by queue bounds; they are not proof of physical consequences or companion delivery. Saturated/drop counts and missing/stale snapshots make loss visible.

Telemetry omits prompts, dialogue, audio, profiles, memories, names, CharacterIds, owner proofs/aliases, native addresses, unrestricted handles and arbitrary action/reason strings. Diagnostic sink failure is isolated. Private signal payloads stay in bounded RAM; the existing RAGE/companion logging path carries only counters/reasons.

### Native lifecycle diagnostics

The existing P2 lifetime fiber emits `[PS] host_status` at startup and every 10 seconds while hosting intelligence, plus one final status before teardown. It observes availability and counters; it never invokes another Update or samples game entities. Essential's existing Core loop remains the sole regular Update caller. This independent status can therefore expose a stopped Core caller even when `[PS] shadow` stops appearing.

Status includes `p2_available`, `p2_reason`, intelligence `available`, saturated `update_calls` and `update_completed`, monotonic `last_update_age_ms` and `last_completed_age_ms`, `last_game_tick`, and `shutdown_reason`. Age `2147483647` means no matching receipt yet (or a saturated age). Entries are counted after the availability guard; completions only after the entire Update returns successfully. A growing age with unchanged counts identifies absent dispatch; entries without completions indicate work that has not completed, while `available=False` and a shutdown reason identify teardown. Two status reads can straddle an Update; an in-flight entry is not itself a failure. Counters survive shutdown for the final diagnostic and contain no entity identifiers.

`[P2] game_clock_reset` records recovery after invalidating old owner associations and pending requests. `[P2] shutdown`, `[P2] host_exit`, and `[PS] shutdown` identify shutdown causes; repeated shutdown remains idempotent. Status writes are best effort. P1 retains the production RAGE active-fiber authorization fix, allowing Core callbacks to run on a different managed thread while rejecting access outside an authorized game fiber. PS initializes on the host game fiber after registration so late loading does not leave it unavailable to Core's Update dispatcher. Collection cadence and output-only pipe schemas remain unchanged.

`native/promoted-characters/ps-host-tests` links the actual `RuntimeEntry` with explicit fiber/Core/integration substitutes. Run its executable with `continuous`, `stalled`, `stop`, and `failed`; the first two observe real startup/10-second/20-second status over approximately 21 seconds. The stalled case stops simulated Core updates after 4 seconds and proves status continues without an extra sampling pump. The dependency-loss case verifies the reason is observed before host teardown. Actual intelligence entry/completion/failure counters and shutdown idempotence are covered by `native/intelligence/integration-tests`. These are offline tests, not GTA acceptance.

## Offline verification

Companion suite: **321 passed, zero failed/cancelled/skipped**, including all 294 existing E1–E6/P0/P1/P2 tests and 27 PS0/PS1 production-source tests. Native production-source harnesses: P1 policy 16, P1 factual pipe 9, P2 policy 26, P2 control pipe 10, P2 host 22, intelligence policy/callback/pipe 70 and integration 26 assertions (**179 total**). The real .NET-to-Node Windows output-only pipe interoperability assertion also passed. The two existing duplex pipe harnesses required an unrestricted test process because the sandbox denied their test pipes; they passed without changes to production ACLs. The new cases verify observer priority/change/return and separately count the player/ped callback producer paths without applying time-window deduplication.

Coverage includes malformed/oversized/version/type frames, sequence replay/loss, 400 callbacks, reserved queue capacity, raw/anchor expiry, wrapper/handle reuse, revoke/recreate, restart/reset, disabled parity, unavailable source contracts, missing/stale snapshots, initial baselines, death versus disappearance, shooting edge/sustained state, unknown attacker, collision validation, vehicle/location/activity/presence state, immutable revisions and aggregate RAM bounds. Bootstrap spies prove no provider/profile/owner-command/model-context effect. Native harnesses link the actual production sources with explicit external game substitutes; they do not prove physical game behavior.

Reproduce with `node tools/runTests.mjs` in the candidate directory, and `dotnet run --project` on all native `tests`, `facts-tests`, `host-tests`, and `native/intelligence/integration-tests` projects. For net481 projects supply the explicit framework reference root. Both companion and native package builds pass; see their generated manifests for fingerprints. Physical cadence, callback reliability/threading, wrapper stability, attribution rate, vehicle/native results and total p95 Update cost remain unknown.

The real .NET-to-Node Windows interoperability gate also passes: `node tools/testPerceptionInterop.mjs` starts the compiled intelligence test helper on a unique ACL-restricted output-only pipe, then receives an anchor and firing fact through the actual production channel/client. This is one additional transport assertion, uses no game assemblies and may require an unrestricted process for Windows pipe/process-launch access.

## Physical GTA acceptance sequence — not run

1. Install the reviewed package using the existing P2 layout; set both intelligence configurations to `shadow`; start GTA normally.
2. Confirm the P2 host is ready and `[PS] native_adapter_loaded shadow` appears. Check capabilities, nonzero roster counts, snapshot age/cadence and continued ordinary dialogue.
3. Promote/use a character; inspect observer counts. Enabling/registration must not create injury, death or shooting history from the current baseline.
4. Fire one shot, then a sustained burst. Compare `firing` counters with observed shooting; sustained state must not generate a signal per frame. Record missed short edges and baseline resets.
5. Record `ped_damage` and `player_damage` totals; cause one isolated player hit and compare deltas. Expect `player_damage` +1 and no `ped_damage` increment. Then damage an NPC and expect `ped_damage` +1 only; arrange damage from another NPC and inspect unknown attacker and armour/melee/less-than-lethal cases. Unknown attribution must remain unknown. Static IL proves mutually exclusive callbacks per method invocation; this single-hit sequence checks detector/runtime call multiplicity.
6. Kill a retained NPC, then separately let one disappear/despawn. Only the observed alive-to-dead case should increment `death`; disappearance should retire, without fabricated cause/witness facts.
7. Cause vehicle damage/crash. Enter, exit and change vehicles/seats/drivers. Check vehicle damage, association and current vehicle-state counts without inferred intent.
8. Move between zones, including brief doorway/zone oscillation and a stable move. Check 1 s dwell and coarse activity changes.
9. Dismiss/recreate a promoted character. Confirm old anchors retire and stale queued signals cannot attach to the replacement, including reused handles/wrappers where observable.
10. Pause/reconnect/restart, disable the feature, and repeat ordinary P1/P2 dialogue/controls. Review lease/reset, capability-loss and bounds diagnostics; ordinary behavior must continue.
11. Confirm PS0/PS1 caused no Luna turn, automatic memory, autonomous dialogue/action or Scene Director activity. Existing player-requested dialogue and Essential reflexes remain ordinary behavior.
12. Review bounded diagnostics during a callback storm and 30-minute scene-changing soak. Record sensor misses, snapshot cadence, wrapper churn, queue drops/stale rejection and measured total p95 Update cost before declaring physical acceptance.

Save the package/Core/DamageTracker/RPH/game versions, sanitized counter logs and actual observations with the test result. Do not mark GTA acceptance complete from this offline report. If runtime evidence contradicts PR #10, record it and propose the smallest correction; PS3+ effects remain off.

## PS2 — witness rules and episode correlation (offline implementation)

Implementation is on `feature/ps2-witness-rules-episode-correlation`, based on latest main. Native `WitnessPolicy` and source-sample integration now emit bounded visual witness receipts for supported sampled firing, injury/death, location/activity and vehicle-transition changes. The existing retained anchor table admits ordinary nearby snapshot peds as transient observers under the same 16-observer cap used for promoted/current-conversation peds. It grants no promotion, P1 identity, P2 ownership, dialogue session, native action, durable memory or response selection. LOS work follows cheap distance/interior rejection and is capped at eight checks per Update; deferred, unknown and rejected checks have separate counters.

The companion's closed v1 receipt validator, `EpisodeCorrelator`, `EpisodeStore` and `ObservationStore` now correlate bounded incidents and create immutable observer-specific revisions. Self involvement, visual evidence, modeled auditory evidence and report evidence remain separate. Auditory evidence requires a verified sound source and known path/context; PS1 firing samples alone do not prove an audible gunshot, and the native implementation does not currently emit generic sound or report producers. A witness receipt never upgrades backend attacker attribution to an observer-known identity. Replayed signal IDs emit no second delta; incident continuations require compatible participant keys and stay within the 5 s/30 s and 8/4 claim bounds.

One post-STT accepted-player-input hook calls the shared transcript receiver once per mic turn. The RAM transcript store is reference-based, byte/count bounded, observer qualified, capture-time interval checked and idempotent. However, the current source does **not** link a native mic begin/end receipt to a capture UUID and matched game/monotonic times. Native `playerSpeech=false` and diagnostic `playerSpeechGate=unsupported_capture_receipt` therefore remain explicit; no transcript enters PS2 on today's code. A focused begin/end UUID/time, cancellation, delayed-STT, reconnect, player-switch and listener movement probe is listed in `docs/PS2-implementation-checklist.md`. Speech acoustics and all GTA acceptance remain unverified.
