# OBS0 — Repository-wide observability coverage audit

**Audit date:** 2026-10-18  
**Repository:** `ComradeGenosse/LSA-Enhanced-essential-fork`  
**Audited baseline:** `main` at `1528399d45dae43edca0486e1553222ccc586554`  
**Project:** OBS0–OBS6 diagnostic architecture overhaul; independent of concurrently implemented GM0–GM6.  
**Status:** OBS0 static source audit complete; runtime/log-only acceptance remains OBS6 work.

## 1. Executive verdict

LSA already has a useful *partial* diagnostic system. Essential's companion persists strict, sanitized per-run JSONL events and can optionally persist bounded dialogue traces; the native host emits RPH text logs; ACT and perception channels publish structured receipts/counters; Memory K has operational read models. Those pieces **do not yet constitute a single durable, correlated account of gameplay**.

The largest gaps are (a) actual producer events silently rejected by the telemetry allowlist; (b) per-command/per-activity evidence losing its identity when reduced to counters; (c) live-only readiness, idle/consent, and ownership states; (d) native IPC and optional failures caught without durable reason evidence; (e) distinct native text, JSONL, dialogue, and dashboard views without shared causal ordering; and (f) a collector that copies raw logs but does not include the effective capability/configuration state or analyze timelines.

**Do not replace the existing E1.1 sink, security allowlists, native authority model, or collector. Extend them.** Browser diagnostics may remain useful, but none should be required to reconstruct information the runtime already knew.

### Concurrent GM0–GM6 integration note

Before integration, `main` advanced through gameplay-menu changes, including `NativeMenu.cs` gaining an Activities & Navigation page with explicit readiness requests/polling, and `navigationReadiness.mjs` gaining `inspectGameplayMenuReadiness()`. Reviewed these changed source paths and the accompanying character/editor changes. This adds another **on-demand F11 readiness consumer** but does not make the state a persistent, automatic diagnostic event. OBS3 must retain the same evidence independently of both browser and F11 refresh. The audit remains separate from GM development.

### Audit evidence and confidence

This is a **source-path audit**, not a claim that GTA execution was observed. Reviewed the default-branch repository tree and relevant current implementations across `native/{promoted-characters,enhanced,activities,intelligence}`, `lsa-essential-e1-candidate/src/{observability,bootstrap,openai,providers,perception,activities,memory,characters,reactions}`, `lsa-shared-brain/src/{events,memory,characters}`, local collection/deployment tooling, focused tests and documents. Cross-checked producers against the persisted contract and traced the most important read-only status endpoints to their sources. A named October 18 reference archive (`logs-20261018-171331-4d362b.zip`) was **not supplied for this audit**; no behavior was inferred from that archive. No GTA, RPH, node tests, PowerShell scripts, or game-specific smoke tests were executed here. Conclusions below distinguish directly established code behavior from unverified runtime implications.

Relevant prior specifications and source summaries: `lsa-essential-e1-candidate/docs/observability-implementation-plan.md`, `docs/diagnostics/ELEVENLABS-STREAM-RECOVERY-20261018.md`, `docs/diagnostics/NATIVE-PLAYBACK-COMPLETION-20261018.md`, and `docs/gm-menu-consolidation/GM0-action-inventory.md`.

## 2. Existing evidence and locations

| Evidence source | Real implementation | Persisted location / limitation |
| --- | --- | --- |
| E1 structured telemetry | `src/observability/eventContract.mjs`, `telemetry.mjs`, `fileSink.mjs`; constructed by `src/bootstrap.mjs:82-110` | Companion `logs/e1-run-<UTC>-<runId>.jsonl` when started as `server.bundle.mjs`, enabled, and the sink initializes; otherwise no-op. Rotating, bounded, async writes. |
| E1 dialogue trace | `src/observability/dialogueTrace.mjs`; `bootstrap.mjs:112-129` | Separate `logs/dialogue/` files **only when explicitly configured**, provider is OpenAI, and writable. Bounded/sanitized but may contain opt-in dialogue text. |
| Native GTA/RPH messages | `native/promoted-characters/EntryPoint.cs`, `RuntimeEntry.cs`; `native/intelligence/IntelligenceIntegration.cs:209-254`; `native/enhanced/EnhancedHost.cs`; `native/promoted-characters/ActivityDispatch.cs` | RPH's native logs through `Game.LogTrivial`; e.g. `[P2]`, `[PS]`, `[UX]`, `[ACT]`. Separate text vocabulary with inconsistent correlation. |
| ACT native diagnostics | `native/activities/ActivityChannel.cs:169-229`; `StepRunner.cs` | Structured pipe frames/counters while connected, and some activity companion events. Not a native durable event stream by itself. |
| Perception/PS/Director | `src/perception/intelligenceClient.mjs`, `directorProduction.mjs`, `sceneDirectorOrchestrator.mjs`; native `IntelligenceIntegration.cs` | Selected `intelligence_status`, `companion_shadow`, `director_gate`, `director_candidate`, `director_handoff` events; native text logs and transient admission state. |
| AI/voice | `src/openai/runSequentialTurn.mjs`; `src/providers/elevenlabs/speechProvider.mjs`; `src/observability/telemetry.mjs` | Turn/provider/TTS/playback event vocabulary; dialogue trace optional. Still needs native-end-to-end matching. |
| Memory K | `src/bootstrap.mjs:199-298`; `src/memory/m7RuntimeCuration.mjs`, `m9Activation.mjs`, `m9Callbacks.mjs`; shared brain stores/schedulers | Detailed *read models* and selectively emitted outcomes. Many consent, queue, idle, journal, recall and callback decisions are not necessarily durable transitions. |
| F11 / editor | `native/enhanced/Ui/NativeMenu.cs`; `src/characters/editorServer.mjs:97-104,153-175` | F11 Diagnostics/Activities & Navigation and POST API (`act6_readiness`, `inspector_status`, `memory_status`); query-time snapshots, not retained history. |
| Collection | `tools/lsa-local/Collect-Logs.ps1`; `lsa-tools.example.json`; `README.md` | One ZIP of matching raw log extensions under configured roots, `inventory.csv` hashes and `collection.json` with copy failures. No analysis, snapshots, manifest join, or content sanitization. |

Relative `src/` paths in this table refer to `lsa-essential-e1-candidate/src/`. **Storage caveat:** log file existence is conditional; successful code initialization does not prove the file was deployed or collected.

## 3. OBS0 coverage matrix

Legend: **P0** = prevents answering a critical ordinary gameplay diagnosis from one ZIP; **P1** = materially improves reliability/completeness; **P2** = secondary/noise/ergonomics. “Partial” means there is a working producer or counter, **not** end-to-end proof.

| OBS0 subsystem | Existing evidence | Specific uncovered state / failure / correlation | Priority → implementation |
| --- | --- | --- | --- |
| 1. RPH, Essential native, P2, F11 | `EntryPoint.cs` logs start/stop/errors; `RuntimeEntry.cs:119-132,172-175` logs periodic native state; `EnhancedHost.cs` logs UI startup/failure; `NativeMenu.cs:459-471` exposes diagnostics. | Native text has no unified event schema/session join. Native `ControlChannel.cs:79` suppresses all request/handshake/timeout exception classes; F11 reads recent reasons/status without retaining changes. Separate “paused”, update-stalled, and disconnected evidence is not uniform. | **P0 → OBS1/2/3** |
| 2. Native↔companion transport | Intelligence stream reports `intelligence_status` and rate-limited invalid frames (`intelligenceClient.mjs:819-842,915-954`); ACT native publishes diagnostics frames and lease counters; control channel uses request IDs. | `activityClient.mjs:81-83` closes/retries without a cause-coded persistent channel event; many ACT validation/sequence/hello and control-pipe rejects destroy connection or catch errors with no durable *why*. No shared authenticated handshake/lease/recovery timeline. | **P0 → OBS1/2/5** |
| 3. Input, UX4 target/continuity | `TalkTargetInput.cs` logs commit failure/PTT end; E1 has `target_changed`, `target_missing`, microphone, turn lifecycle events. | Native player intent, target candidate→commit→retire and exact turn/encounter continuity are split across native text, telemetry and UI. State can change on movement/alt-tab without an independently joinable reasoned receipt. Distinguish requested vs actual recipient. | **P0 → OBS1/2** |
| 4. STT, Luna, TTS, ElevenLabs, playback | Rich event names (`provider_request_*`, `elevenlabs_stream_stage`, `native_playback_*`, watchdog, terminal summary), implementation in `runSequentialTurn.mjs`, opt-in dialogue trace. | Strongest partial coverage but no standardized cross-native causal parent/session/epoch. Model-generated speech must remain distinct from PCM sent, native accepted, audible completion and history committed; interruptions and recovery require independent native receipts. Opt-in text is deliberately not guaranteed. | **P0 → OBS1/2/6** |
| 5. Director/spontaneous social scenes | `directorProduction.mjs` diagnoses candidate vetoes; `sceneDirectorOrchestrator.mjs:57-139` returns detailed stages; native logs handoff/veto + one-way trace code. | Some return statuses are transient; when no candidate is proposed, reasoned *no-scene* evidence must be retained. Admission, Luna generation and actual spoken terminal outcome need a single joinable scene chain. Do not treat reservation/dispatch as speech delivered. | **P0 → OBS1/2/3** |
| 6. PS0–PS6 perception/knowledge | `intelligenceClient.mjs` has bounded scalar PS2/PS3 reports, `knowledge_frame_projected`, `perception_trace`, `radio_trace`; native `EventTrace` rate limits. | Periodic counters alone do not identify which authenticated observation, ownership proof, salience grant and speech decision belonged to a failed interaction. Native rate-limit suppression and dropped captures need durable aggregates and joins to PS4/Director. | **P1 → OBS1/2** |
| 7. Memory K M0–M9 | M2 dialogue journal status events, M3 coverage callbacks/counters, capability registration/read models, M7 status and M9 counters. | `m7RuntimeCuration.mjs:104` mutates `status` without emitting transition events; `diagnostics():291-312` is on-demand. Queue/consent/budget/idle proof/checkpoint and M9 detected→witnessed→journaled→callback outcomes cannot consistently be reconstructed from ZIP. SQLite exceptions are intentionally sanitized; preserve safe codes. | **P0 → OBS1/2/3** |
| 8. ACT0–ACT6 vehicle/navigation | `activityEngine.mjs` emits admit/reject/step/receipt/terminal; ACT6 readiness returns specific missing probes; native `ActivityDispatch.cs` logs vehicle/seat movement sampling. | `activityClient.mjs:63-66` derives `activity_receipt` from aggregate counter deltas **without activityId, executionId, commandId, or requestId**. ACT6 readiness is a browser refresh rather than a durable gate transition. Native motion samples and completion need joins; do not promote “accepted” to “arrived”. | **P0 → OBS1/2/3** |
| 9. NPC reaction/emotional acting/identity | `characterService.mjs` emits promotion/spawn/dismiss events; voice/emotion/identity code uses state/ownership gates; native P2 voice-presence status exists. | **Confirmed dropped events:** `reactionClient.mjs:88,118,122,126` emits reaction channel `closed`, `mode_mismatch`, `ready`, `ack`, but these names are **absent** from `eventContract.mjs:1-29`; `Telemetry.emit()` catches the unknown-name failure, so JSONL loses the events. `m9Callbacks.mjs:406` similarly uses unregistered `m9_callback_shadow`. Character events often lack scoped identifiers after sanitization; emotional acting delivery and voice presence need joinable actor/turn evidence. | **P0 → OBS1/2** |
| 10. Config/capabilities/editor/build/deploy | `bootstrap.mjs:98-104` captures some provider/build fields; `capabilityHealth.mjs` projects build+runtime prerequisites; `editorServer.mjs` and F11 expose readiness; deployment tools exist. | No automatic effective sanitized configuration/dependency/version *transition* records or per-session collector attachments. A live dashboard knows more about missing probes, timeline writable state, M7, and deployment than the ZIP reliably does. Detect enabled vs intentionally off vs unsupported vs initializing vs not evidenced. | **P0 → OBS1/3/4** |

## 4. Confirmed cross-cutting findings

### OBS0-01 — Event producers and event allowlist disagree (P0)

`eventContract.mjs:1-29` is a closed set. `Telemetry.emit()` (`telemetry.mjs:22-33`) catches failures and returns false by design, correctly avoiding gameplay disruption. However actual producers `reactions/reactionClient.mjs` (`reaction_channel_ready`, `reaction_channel_closed`, `reaction_channel_mode_mismatch`, `reaction_ack`) and `memory/m9Callbacks.mjs` (`m9_callback_shadow`) use names **not registered** there. Their proposed records are therefore **not written** through the normal E1 telemetry path. Scope-safe contract registration, data projection, unit coverage and producer-vocabulary linting belong to OBS1/OBS2. Preserve redaction; do not simply allow arbitrary keys/events.

### OBS0-02 — Aggregate-only ACT receipts sever causality (P0)

`native/activities/ActivityChannel.cs:169-229` publishes counters, but `src/activities/activityClient.mjs:63-66` converts increases into `activity_receipt` carrying just `receiptState`. The companion engine has richer `activityId` receipts (`activityEngine.mjs:461`). The aggregated synthetic event can tell that *a* receipt happened, not whose native execution it describes. Persist native request/step/encounter/command/lease correlations separately from aggregate health counters.

### OBS0-03 — Important native IPC causes disappear (P0)

`native/promoted-characters/ControlChannel.cs:45-80` catches malformed requests, denied admission, timeout and transport faults in the same broad catch and cancels them without a reasoned log. `src/activities/activityClient.mjs:34-55,81-83` similarly destroys connections after parse, validation, sequence or handshake failure and retries with no cause-coded channel outcome. Preserve reason codes and observed boundaries; do not persist arbitrary exception text/IPC payloads.

### OBS0-04 — Status refreshed on request is not history (P0)

`src/characters/editorServer.mjs:97-104,153-175` only returns ACT6 readiness/inspector/memory status when the client requests it. `src/bootstrap.mjs:199-298,673-686` builds Memory K/authority/capability read models; `m7RuntimeCuration.mjs:97-104,291-312` exposes evolving state via snapshot. Some native ACT diagnostics are sent only when `ClientReady` (`ActivityChannel.cs:169-171`). An observer cannot infer from an absent read whether a condition was healthy, stale, or never checked. Emit initialization/change/block/recovery/retirement records *without a browser request*, preserving time of last proven good state.

### OBS0-05 — The current schema is not yet a cross-host causal envelope (P0)

E1 records contain `schemaVersion`, UTC `timestamp`, per-file `runId`, `sequence`, `elapsedMs`, `event`, `provider`, optional Essential `{pedId, turnId, generationId, sessionNonce}`, optional `source`, sanitized `data` (`eventContract.mjs:225-231`). Missing *envelope-level* fields: component/subsystem, severity, native host run, world epoch, timeline, current encounter/incarnation, scene/activity/command IDs, parent event/causal sequence, old/new state, observed outcome/evidence authority. Native Game.LogTrivial lines live in another clock/format. A nonce/hash that joins one PS signal is useful (`IntelligenceIntegration.TraceCode`) but not a universal causal chain.

### OBS0-06 — Silent or context-poor catch paths are widespread (P1)

Examples: `EntryPoint.cs:40-41` replaces exceptions with generic initialization messages; `PromotedCharactersIntegration.cs:289` suppresses ACT tick exception before disabling ACT; `bootstrap.mjs:176,197` warns only generic M6/M7 startup failure; `activityRuntime.mjs:37` swallows engine tick faults; `m7RuntimeCuration.mjs:209` ignores refresh errors; `recallEngine.mjs:222` returns an unavailable bundle. Correct behavior is fail-closed, but observable **code-classified** reasons and state-change outcomes must still be emitted where safe. Never log raw SQL, memory text, credentials, stack data with secrets, or arbitrary provider bodies.

### OBS0-07 — Logging failures can themselves be invisible (P1)

`fileSink.mjs:59-85` bounds files and queue, increments dropped count, and disables its sink on write failures; `Telemetry.flush()` tries to emit `telemetry_records_dropped` (`telemetry.mjs:50-54`). If the sink is already disabled, the dropout event cannot reach that same JSONL. The `onFailure` path writes to console only (`bootstrap.mjs:96-107`). OBS5 needs a separate bounded fallback marker and a manifest indication that evidence is incomplete. Keep nonblocking game fibers.

### OBS0-08 — Log ZIP is not a session manifest (P0)

`tools/lsa-local/Collect-Logs.ps1:11-40` recursively copies extension-matched files from configured roots, indexes SHA256, and reports failed copies. It deliberately excludes config/databases and promises “Raw logs only; no analysis.” It does **not** include a sanitized effective config/capability/dependency/version snapshot, structured source/session linkage, completeness/dropped-event indicators, collector clock, known missing sources, or offline timeline report. It also searches for standalone package layouts rather than proving each active Essential companion log directory was found. Raw arbitrary logs are copied without content-aware redaction; collector privacy policy must be explicit and conservative. OBS4 must enhance this command, not break it.

### OBS0-09 — Native update/paused/disconnected diagnoses risk conflation (P1)

`EnhancedHost.cs` can read `Game.IsPaused`; native `RuntimeEntry.cs:172-175` logs `update_calls`, `update_completed`, last update ages and tick; companion logs some connected/disconnected states. But a current-status getter cannot retrospectively distinguish paused GTA, no native update, lost pipe, wrong capability, unloaded addon, or intentionally disabled function in every session. Record observed update/tick changes and transport transitions with last-good-state time; label unproven inferred causes as unknown.

### OBS0-10 — Rich existing correctness tests are not log-only acceptance (P1)

`tests/observability.test.mjs`, `tests/dialogue-trace.test.mjs`, `tests/ps-troubleshooting-observability.test.mjs`, `tests/intelligence-frame-rejection-telemetry.test.mjs`, activity, Director, M7/M9 and native C# test suites demonstrate portions of validation/sanitization/logic. They do not by themselves establish that a ZIP reconstructs a mixed native→companion→provider→GTA session or that a disconnected client leaves a complete durable outcome. OBS6 must include independent cold-ZIP replay and fault-injection verification.

## 5. Dashboard-only / ephemeral evidence inventory

These are *specific read paths*, not proof that none of their individual fields are logged elsewhere. OBS3 must map **every field** to a retained event and show whether it is current, last-known, or unavailable.

| UI/read model | Current source | Must be retained |
| --- | --- | --- |
| ACT6 Navigation Readiness | `editorServer.mjs:97-104,153-154` → `activities/navigationReadiness.mjs` | Mode, act5 flag, advertised drive/walk, missing probe IDs/counts, no native connection, per-capability reason, last transition/observation. Never “navigation worked” from readiness alone. |
| Memory K Runtime Controls / cloud curation | `bootstrap.mjs:199-298`; `m7RuntimeCuration.mjs:291-312`; inspector controls | Capability registration, config mode, consent *state* (no private content), queue depth, budget reservation/outcome, idle proof availability, processing, failures and safe reason, suspension/resume. |
| Native channel / dependencies | `intelligenceClient` runtime and ACT hello/diagnostics; `capabilityHealth.mjs` | Authenticated native run/epoch, lease/heartbeat, last-good sample, capability advertising, source failure, state retirement, cause/uncertainty. |
| Director admission / spontaneous speech | `directorProduction.mjs`; `sceneDirectorOrchestrator.mjs` | None/proposed/rejected/reserved/dispatched/generated/delivered/failed/interrupted, correlated reasons and actual observed playback. |
| Character/save/timeline | `editorServer.mjs:172-189`; `bootstrap.mjs:678-686`; character service/source bridge | Native authority proof lost/restored, timeline selection/writability change, profile event accepted vs persisted, privacy blocks and failure codes. |
| F11 Diagnostics | `NativeMenu.cs:459-471` | Current host/bridge, UI router state, last reason transitions; do not use the menu as a logging trigger. |

## 6. Reference failure reconstruction tests for subsequent phases

These scenarios are **acceptance questions**, not claims of proven root cause from the unsupplied October 18 ZIP:

1. **Nathan does not drive to waypoint.** From a ZIP alone identify the player's input and intended actor, resolved target/vehicle/waypoint, ACT6 mode and native probes, model output vs accepted command, native preflight/dispatch and task samples, actual movement, terminal reason, and recovery. A browser “ACT6 ready” snapshot is insufficient.
2. **UX4 recipient silently changes mid-drive.** Rebuild old/current target, host epoch, explicit selection or supersession, mic/turn identity, native recipient and actual response. Do not confuse nearby ambient actors with the committed recipient.
3. **ElevenLabs generation ends but playback hangs.** Join TTS PCM generation, chunk forwarding, native reception/start, end-marker, watchdog, interrupt, terminal outcome, history commit/discard and next player turn. Distinguish “generated”, “forwarded” and “heard”.
4. **Spontaneous chatter repeats.** With optional bounded dialogue tracing, see which recent *delivered* speech was in Luna context; if tracing disabled, still see history-included and dialogue-delivered evidence flags, no-scene/reject vs interrupted/said.
5. **M7 says unavailable and M9 silently skips.** Establish persisted consent state, validated native idle proof, queue/budget/checkpoint decision, source availability and any journal/callback failure without exposing memory text.
6. **GTA paused/alt-tab/disconnect.** Establish native pause *observation* separately from a stalled tick, dead process, pipe loss, authentication failure and capability gate. Mark ambiguous cause unknown, with last-good timestamp.
7. **Collected ZIP missing evidence.** Manifest must show unavailable source, disabled logging, queue overflow, sink failure, log rotation loss and collector copy errors without inventing successful execution.

## 7. Ordered OBS1–OBS6 handoff

- **OBS1 / first:** Versioned event envelope with stable identity, host/world/timeline, subsystem, severity, state transition, causal/parent links, bounded reason codes, authoritative evidence level. Validate registration of actual producer event names/keys using static producer-contract tests. Preserve sanitization, event ordering and old E1 JSONL compatibility.
- **OBS2 / native+companion:** Instrument native handshakes/rejections/lease recovery, owner/UX4 target transitions, ACT full execution chain, TTS/native playback closure, PS/Director, Memory M2–M9, reaction/identity, and configuration/capability gate transitions. Each event must distinguish intent, acceptance, observed effect and final outcome.
- **OBS3:** Inventory each browser/F11 field and add push-based persisted state changes or bounded snapshots at startup/change/shutdown. Browser must remain optional, and inspector privacy/destructive confirmations must remain intact.
- **OBS4:** Extend `Collect-Logs.ps1` with source completeness, sanitized runtime/build/config snapshots, session manifest, privacy controls, and an **offline ZIP analyzer** for correlated timelines, grouped reason codes, incompletes and unknowns.
- **OBS5:** Measure queue/rotation/performance under long sessions; make dropped/disabled-sink evidence visible in an independent bounded fallback; preserve crash/shutdown records where technically possible, without disk I/O on GTA fibers.
- **OBS6:** Add contract, transport fault-injection, empty/no-op telemetry detection, missing-event validation, and independent log-only scenario acceptance. A gameplay visual/audio check is still necessary to verify actual GTA/audible behavior; never claim it based on offline tests.

## 8. Deliverable boundary / outstanding validation

**OBS0 produces this audit and a prioritized implementation handoff; it is not OBS1–OBS6 implementation.** It changes no game capability, network admission, storage/privacy guarantee, production logging default, diagnostic UI behavior, or existing GM0–GM6 work.

Before declaring the eventual **OBS0–OBS6** overhaul complete: run source/contract linting, automated regressions, a real GTA session with supported settings, gather the one ZIP, and have a separate agent diagnose the above cases **using only that ZIP**. Reconcile any findings that differ from this static audit; never manufacture native outcomes.

**Definition of done for OBS0:** concrete source-path inventory, coverage matrix for all ten requested domains, dashboard/transient evidence register, verified producer-contract and silent-failure examples, priority assignments, a staged OBS1–OBS6 handoff, and explicit declaration of untested live behavior. All included above.
