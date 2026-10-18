# LSA OBS0–OBS3 — Focused Logging, Comprehensive System Health and Offline Diagnostics

**Repository:** `ComradeGenosse/LSA-Enhanced-essential-fork`  
**Target:** Latest `main`  
**Status:** OBS0 completed and merged in PR #265; OBS1 implementation merged in PR #266; OBS2 and OBS3 planned.  
**Scope:** Repair existing logging, automatically capture critical gameplay diagnostics **and health evidence for every implemented runtime system**, and enable reliable post-session debugging from one collected ZIP.

**Relationship to other work:** GM0–GM6 and gameplay work proceed separately. Integrate with their current interfaces without duplicating F11/browser menus, changing gameplay behavior, or blocking other work. Rebase against current `main` before integrating.

**Canonical plan:** This document consolidates the previously agreed focused OBS0–OBS3 roadmap and adds comprehensive system health reporting **within OBS2 and OBS3**. It does not restart OBS0, add phases, or revive the superseded six-phase overhaul. See `OBS0-COVERAGE-AUDIT-20261018.md` and `OBS1-FOCUSED-DIAGNOSTICS-20261018.md` for evidence and implementation notes.

---

## Objective

Make LSA's most important gameplay failures and **the operational health of every implemented LSA runtime system** diagnosable from persistent, timestamped evidence alone.

After an ordinary GTA session, one collected archive should let an independent debugging agent determine:

1. What the player requested.
2. What Luna understood and decided.
3. What LSA attempted.
4. Whether native execution accepted, rejected, or failed the operation.
5. What actually happened in GTA, when observable.
6. Why an operation failed or stopped progressing, when the reason is known.
7. Whether the system recovered.
8. What relevant capabilities and effective configuration were active.
9. Which implemented systems were actually installed, enabled, disabled, unavailable, initialized, connected, blocked or degraded.
10. Which systems **demonstrably performed** their intended function and which were not exercised or lack proof.

**The user must not need to open a debugging dashboard, switch out of GTA, or manually refresh F11/browser diagnostic pages to capture information already known by the runtime.**

Use existing E1 structured JSONL telemetry, native/RPH messages, bounded sinks, capability/status read models and `tools/lsa-local/Collect-Logs.ps1`. Extend, do not replace, them. This is a targeted reliability and reporting improvement, not a new monitoring platform or logging framework.

**Evidence standard:** Distinguish request, validation, transport acceptance, execution start, observed progress, actual outcome, and recovery. Evidence of a successful transport or model response is not proof of a successful GTA action; generated PCM is not proof of audible speech. Unknown evidence must remain unknown.

---

## OBS0 — Repository-wide observability audit

**Status: COMPLETE.** Merged through PR #265. Do not repeat the full audit.

The source audit covers the existing logging, diagnostic/status views, error paths, telemetry, and relevant implementation across:

1. RPH, Essential native integration, promoted-character runtime and F11.
2. Native/companion pipes, handshake, heartbeat, lease, disconnect and recovery.
3. Player input and UX4 target selection/continuity.
4. STT, Luna, OpenAI/ElevenLabs TTS, PCM, streaming, playback and completion.
5. Scene Director, spontaneous speech, social scenes, admission and cooldowns.
6. PS0–PS6 perception, observations, salience, knowledge and speech.
7. Memory K M0–M9, SQLite, journaling, recall, M7 and M9.
8. ACT0–ACT6, activity/vehicle/navigation execution and receipts.
9. NPC reactions, emotional acting, character identity/state and ownership.
10. Configuration, capabilities, editor endpoints, build, deployment and startup.

The audit documents a coverage matrix, evidence locations, live/dashboard-only states, silently dropped events, swallowed failures, missing correlation, inconsistent errors, stale state and collection gaps.

Confirmed findings include discarded reaction/M9 telemetry events, lost ACT identity when counter deltas mimic individual receipts, unreasoned native IPC failures, query-only readiness, incomplete cross-component correlation, swallowed optional subsystem exceptions, sink-loss evidence gaps and a ZIP collector without an offline session manifest/report.

**OBS0 is the implementation reference for OBS1–OBS3, not a request to instrument every system exhaustively.** The audit was source-only; it does not establish GTA runtime success.

---

## OBS1 — Repair and connect existing logging

**Priority: Critical.**  
**Status:** Implementation merged through PR #266. Keep existing focused regression coverage; actual in-game acceptance is still separate.  
**Goal:** Make existing diagnostic event records reliably persist and become identifiable together.

### OBS1.1 Repair confirmed logging defects

At minimum:

- Fix valid telemetry producer events silently dropped by the event-name allowlist without permitting arbitrary names or unsafe data.
- Preserve ACT activity, goal, execution, command and request identifiers when the relevant producers actually have them.
- Treat native aggregate counters as **aggregate health evidence**, never individual action receipts.
- Persist safe, meaningful reasons for native connection, handshake, parsing, admission, timeout and sequence failures.
- Ensure important failures are not swallowed without durable, classified evidence.
- Preserve rejected, incomplete, interrupted and subsequently recovered operation evidence.

Do not instrument every catch block. Prioritize errors that influence gameplay, communication, or root-cause diagnosis.

### OBS1.2 Standardize essential diagnostic event fields

Extend E1 JSONL, not a replacement framework. Important events should carry, **where available and relevant**:

- UTC millisecond timestamp, monotonic time/native tick or ordered sequence where needed.
- Component, event name, severity and run/session identity.
- Correlation identifiers for player requests, turns, NPCs, scenes, activities, executions, commands and transport requests.
- Relevant verified native host/world epoch and actor ownership/incarnation where available.
- Old/new states for important transitions.
- Stable, safe failure/rejection codes; outcomes and evidence authority/source.

Preserve native causal boundaries; do not invent shared identities or join unrelated events merely because their timestamps are close. Existing OBS1 event conventions and schema compatibility are recorded in `OBS1-FOCUSED-DIAGNOSTICS-20261018.md`.

### OBS1.3 Connect critical execution chains

Support tracing:

- **Player speech → STT → Luna → intended action → native command → actual execution result.**
- **Scene trigger → Director decision → speech generation → native playback → delivery outcome.**
- **Gameplay observation → memory eligibility → persistence or callback outcome.**

Distinguish **received, validated, dispatched, accepted, started, completed, failed and interrupted**. Preserve authentic correlation IDs where possible; never report transport acceptance as gameplay completion.

### OBS1.4 Preserve performance and privacy

- Reuse bounded queues, rotation and existing opt-in dialogue tracing.
- Do not block native game fibers or let telemetry faults crash gameplay.
- Keep safe drop/failure indicators where practical; do not claim a complete record if the sink failed.
- Do not record secrets, private memory bodies, raw audio, full transcripts, arbitrary IPC/provider payloads or private dialogue by default.

### OBS1 acceptance criteria

- Confirmed discarded event names repaired without weakening sanitization.
- Important ACT receipts carry available valid identifiers; aggregate counters remain distinguishable from receipts.
- Important native/ACT channel failure paths retain safe reason codes.
- Major existing service boundaries retain available correlation context and can be linked without false completion claims.
- Focused regression tests cover event retention, reason codes, identity sanitization and ordinary failures.

**Deliverable:** Working, bounded, correlated diagnostic records within LSA's existing infrastructure. PR #266 is the phase's implementation record; no GTA smoke proof is implied by its offline tests.

---

## OBS2 — Automatically capture critical gameplay diagnostics **and comprehensive system health evidence**

**Priority: Critical.**  
**Goal:** Important gameplay failures **and the state of every implemented runtime system** leave automatic, durable, appropriately classified evidence without a live dashboard.

**Two complementary levels:** (a) detailed event chains for the demonstrated failure-prone gameplay paths below, and (b) lightweight inventory/lifecycle/health evidence for **all** inventoried systems. The second level **does not require** exhaustive per-operation instrumentation of low-risk features.

### OBS2.1 UX4 conversation targeting

Record the established conversation target, acquisition/retention/replacement/retirement, verified NPC identity and ownership, and why routing changed or failed. The logs must explain an incident where speech intended for Nathan was routed to an ambient NPC. Do not repeatedly emit unchanged target state.

### OBS2.2 ACT commands, vehicles and navigation

Capture the meaningful chain:

**Player request → resolved intent → actor/vehicle/destination resolution → capability gate → native command → observed progress/outcome.**

Retain invalid references, unresolved destinations, disabled/missing capabilities, native rejection, execution start/interruption/terminal state, movement/arrival proof where available, and timeouts/stalls. A failed waypoint request must identify the failing stage. Do not implement new ACT gameplay or infer arrival from dispatch.

### OBS2.3 Conversation, STT, Luna, TTS and playback

Persist microphone interaction/target, STT result, Luna request/outcome/latency, TTS result, PCM transport, native playback start, observed terminal outcome, watchdog/stuck state and recovery.

Distinguish **no Luna answer; TTS failure; generated but unplayed audio; playback that started but did not finish; interruption; and a stale busy state preventing a new turn**. Only explicitly enabled, bounded dialogue tracing may include dialogue content.

### OBS2.4 Scene Director and spontaneous speech

Record proposed trigger/category, relevant admission gate and rejection reason, speech-generation attempt/outcome, native playback/delivery outcome, and scene completion/cancellation. Preserve scene/actor/turn linkage sufficient to diagnose repetition and improper routing without recording every routine proposal candidate. Rate-limit repetitive diagnostics.

### OBS2.5 Memory K critical failures

Prioritize dependencies/capabilities becoming unavailable, missing source authority, memory write/recall outcomes, M7 eligibility/queue transitions/failed processing, and M9 detection/journal/callback failures. Record reason codes and bounded metadata, **never private memory content**. Do not create another Memory K diagnostics platform.

### OBS2.6 Native connections and recovery

Record meaningful initialization/shutdown, connection establishment/loss, handshake/admission failure, capability changes, detected native-update stalls, game pause/resume where directly observed, recovery, and last-proven-good state becoming stale. Do not mislabel an unobserved pause as a confirmed native stall or assume a disconnect means a particular capability was disabled.

### OBS2.7 Persist critical dashboard-only transitions

Reuse existing ACT6 readiness, Director, native channel, capabilities, ownership, Memory K and F11/editor status providers. Capture initialization, significant changes, blocks, recoveries and retirement **as they happen**, independently of any browser/F11 refresh. Preserve the browser/editor and gameplay menu as optional consumers; do not dump entire dashboards or poll continuously.

### OBS2.8 Complete installed-system and capability inventory (new mandatory health layer)

Build or maintain a **versioned, machine-readable inventory of every implemented LSA runtime subsystem and capability** for the shipped build, including optional, experimental, shadow, feature-gated and intentionally disabled components.

Inventory coverage must include at least the ten OBS0 areas: native/RPH/P2/F11, companion IPC, UX4/input, STT/reasoning/TTS/playback/providers, Director/spontaneous scenes, PS0–PS6, Memory K M0–M9, ACT0–ACT6, NPC reaction/emotion/identity/ownership, and configuration/capability/editor/build/deployment. Include separately distinguishable sub-capabilities when they can be enabled or fail independently (e.g. ACT6 `drive_to` vs `walk_to`, provider selections, individual Memory K activation gates).

Each stable inventory entry should identify:

- System/capability ID, human-readable name, owning component and applicable build/contract version.
- Whether it is implemented in the build, and where runtime installation/deployment can be proven.
- Configured mode (e.g. `off`, `shadow`, `on`, `experimental`, or an actual supported mode), required dependencies and relevant gates.
- What constitutes **initialization**, **readiness/connection**, **successful operation**, **failure/recovery**, and shutdown for that system.
- Evidence type/source and any explicit limits of verification (e.g. a model response does not prove native movement).

Derive the inventory from existing build manifests, capability registries, config activation/read models and native registration sources. Keep it maintainable alongside their evolution, preferably by generating or validating a compact inventory against real registries and builds. Do **not** hand-maintain a duplicated implementation of all capability rules. Add a focused consistency test so newly implemented systems do not silently disappear from reporting.

**A system present in source but absent from a shipped binary is not proven installed.** Record `implemented`, `installed`, `enabled`, `initialized` and `operational` as different claims. Source/manifest-only assertions and incomplete deployment evidence must remain clearly labeled. Disabled and experimental features must remain rows, not disappear because no runtime events were emitted.

### OBS2.9 Automatic lifecycle and operation-health evidence (new mandatory health layer)

At startup, when the source is available, record a bounded **sanitized effective configuration and build/inventory snapshot** (or referenced versioned manifest plus hash), including actual feature modes and dependency/capability gate outcomes. Do not persist secrets, full config documents or memory databases. Identify the native host/companion run, relevant world epochs and code/package versions where available.

At **meaningful changes**, not on a tight polling loop, persist:

- Initialization attempted/succeeded/failed/unsupported; intentional disabled mode.
- Dependency and native capability readiness, block reason, connection establishment/disconnect/stale status.
- Transition to ready/degraded/blocked and return to ready after recovery.
- Startup and shutdown outcomes, including forced/incomplete shutdown where evidence permits.
- **Successful actual operations** when already observable in the existing event paths, with timestamp, safe correlation ID, operation class, and a **proof boundary** describing what was genuinely verified.
- Last-known-success/last-failure timestamps and safe reason codes **as evidence derived from events**, without treating a successful check as successful gameplay.

A successful operation should be meaningful for that capability: e.g. verified native execution/arrival for an ACT movement capability when observable, a completed authenticated memory write for persistence, a verified final playback event for speech playback, or a successfully handled Director scene with its known delivery caveat. Do not claim audible output, physical results, memory persistence or observed GTA state if the evidence only proves request acceptance, queueing, model generation or provider output.

Use existing status/readiness providers, subscribed state transitions, existing operation terminals and bounded counters. Emit startup/changes/recovery/terminal facts, deduplicate unchanged state, limit repetition and handle component unloading without adding invasive heartbeats or expensive scans. Features that do not run during the session remain **not exercised**, not broken.

Preserve **health evidence completeness**: if telemetry was disabled, failed, dropped records, source disconnected before collecting health state, or a component had no instrumented outcome, record/report the missing or stale evidence as far as independently observable. Health evidence failure must not interfere with gameplay.

### OBS2 acceptance criteria

Existing high-value failure scenarios must be distinguishable from recorded evidence:

1. UX4 routes player speech to the wrong NPC.
2. Vehicle/waypoint command is rejected, capability-blocked or never executed.
3. Native activity is accepted but does not progress.
4. TTS generates audio but native playback does not finish.
5. Director speech is proposed but rejected, undelivered or interrupted.
6. Memory processing is blocked by capability/authority or fails to persist.
7. Native communications disconnect and later recover.

**Additionally, for every inventoried system/capability:**

- The shipped build/session inventory includes it even if disabled, experimental, uninstalled or unexercised; omitted runtime evidence cannot erase it.
- Available safe effective config, initialization, readiness/dependency, connection, failure, recovery and shutdown evidence is automatically persisted, without dashboard use.
- Where an actual successful operation is observed, the event identifies the operation and supported proof level; mere readiness never becomes demonstrated functionality.
- Where success or readiness was not observed, evidence remains absent/unknown or ready-but-unexercised rather than fabricated.
- Instrumentation is bounded, privacy-preserving, does not block game fibers, and does not require continuous polling.

**Deliverable:** Automatic durable gameplay diagnostics **plus a complete low-overhead system-health evidence feed** consumed by OBS3.

---

## OBS3 — One-ZIP offline debugging, comprehensive system-health report and acceptance

**Priority: Critical.**  
**Goal:** A single collected archive is sufficient both to investigate important gameplay failures **and** to report every implemented system's operational condition from available evidence.

### OBS3.1 Improve the existing collector

Extend `tools/lsa-local/Collect-Logs.ps1` rather than replacing it.

Collect native/RPH logs, companion service logs, structured telemetry, relevant provider/application error records, available versions/builds, sanitized effective configuration and capability/inventory snapshots, and session/source identity. Retain existing copy inventory, SHA-256 hashing and `collection.json` behavior.

Add a concise source/session evidence manifest with collection time, available sources, missing/unreadable roots, incomplete/truncated streams, drops and source-to-session linkage where available. Missing an optional source must not fail the whole archive. Preserve collector privacy rules; do not indiscriminately package secrets, databases or dialogue logs without explicit opt-in and safeguards. Do not create an always-running collection service.

### OBS3.2 Create an offline session analyzer

Build a lightweight developer-side analyzer that needs **only the collected ZIP**. It must:

- Identify available gameplay sessions, build/inventory versions and log sources.
- Normalize timestamps and correlate authenticated run, host, world epoch, turn, actor, scene, activity and command IDs where possible.
- Reconstruct meaningful gameplay chains and separate observed completion from admission or intent.
- Highlight failures, interrupted/timed-out/unclosed operations and verified recovery.
- Group recurring problems by safe reason codes.
- Indicate missing correlation, source, terminal events and other insufficient evidence.
- Produce readable Markdown and structured JSON reports; **no new GUI, server, database or monitoring service**.

Do not use live GTA connections, browser endpoints or F11 refresh. Do not infer causality merely from adjacent timestamps.

### OBS3.3 Gameplay diagnostic report

Include:

- **Session overview:** session identity/time span, build/version, supported effective configuration and sources present/missing.
- **Important operations:** player requests, related execution chains, NPC/scene/activity relationships, major failures and recoveries.
- **Diagnosis:** failing stage, exact recorded reason where known, supporting event IDs/timestamps and whether recovery was observed.
- **Coverage gaps:** missing logs/sessions, correlation failures, records dropped, operations without terminal evidence and stale state.

A generated report must not equate missing records with failure or success.

### OBS3.4 Complete per-system health matrix (new mandatory report)

Join the **full versioned OBS2 inventory** to safe configuration/build evidence, initialization records, state transitions and successful-operation evidence. Produce one row **for every inventoried system and independently gated capability**, even if there were no session events for it.

The report must show, at minimum:

| Field | Meaning |
| --- | --- |
| System/capability | Stable inventory ID, component, implementation/build version and installation evidence |
| Configured mode | Actual `off`/`shadow`/`on`/`experimental`/other mode, or `unknown` if not evidenced |
| Initialization | Not attempted/disabled, succeeded, failed, in progress at last evidence, or unknown |
| Operational state | One of the six strictly defined health labels below |
| Dependencies/connections | Last verified readiness, blocked prerequisites, disconnected/stale state and time, when known |
| Last successful operation | Timestamp, operation class, correlation and **proof type**, or `none observed` |
| Failures/recovery | Most recent safe reason(s), timestamps, transition/recovery evidence or `none observed` |
| Supporting evidence | Exact source file + event/line/sequence IDs and known collection/coverage gaps |

Health labels are **evidence-based**, not a simplistic count of errors:

- **`operational`** — installed/initialized and **at least one relevant successful operation is demonstrably verified** within the session and applicable host/world scope, with no later recorded unresolved state that invalidates the claim. State the last success and proof boundary. A prior success does not guarantee the system is healthy at shutdown.
- **`ready but not exercised`** — positive initialization/readiness and required dependency/connection evidence exists, but **no verified relevant successful operation** is available for the session. A mere configured `on` is insufficient.
- **`disabled`** — explicitly configured off/disabled and supported by effective configuration and/or runtime evidence. Do not interpret absence of events as disabled.
- **`blocked`** — observed activation or operation prevented by a known failed prerequisite, capability/authority gate, initialization failure or explicit unavailable/unsupported condition. Include the exact known reason.
- **`degraded`** — observed partial/intermittent failure, stale/recovering connection, or unresolved failure following prior successful readiness/operation. Do not silently label a subsystem operational when later failure evidence contradicts it.
- **`unknown`** — evidence is missing, incomplete, contradictory or insufficient to establish any other label; includes unproven installation, missing startup records and unsourced status.

**Precedence and caveats:** Time-order authoritative evidence by session, run, and world epoch; do not carry old successes across a reset or unload without proof. Explicit `off` takes precedence where the effective configuration is verified; otherwise later observed blockers/failures can override earlier success/readiness. A recovered component may become operational again **only on new demonstrated operation evidence**, or ready-but-not-exercised with verified readiness. When evidence cannot resolve competing states, report unknown with the conflict rather than choosing a convenient label.

Keep `implemented/installed` and `configured mode` as separate dimensions from these six health labels: a build-included but uninstalled feature must not be reported operational or simply disabled without deployment/config evidence. Clearly label shadow/experimental implementations and any limits of authority, including that shadow observation never proves enabled execution.

The matrix must allow a quick answer to **"Is every system switched on and working?"** while truthfully showing which functions are intentionally off, which were enabled but never used, and which were actually proven to work. Summarize counts for the six categories, but **retain every inventory row**, including systems with zero events.

### OBS3.5 Representative fault-injection and non-exercise tests

Use available automated tests, synthetic log fixtures and controlled failure scenarios to validate:

1. Unexpected conversation target switching.
2. Navigation resolution, capability and native rejection.
3. Activity accepted but stuck.
4. ElevenLabs/TTS failure or uncompleted native playback.
5. Director rejection/interruption.
6. Memory dependency, write or recall failure.
7. Native disconnect, stale state and recovery.
8. Partially collected or corrupted logs and missing terminal/correlation evidence.
9. **An implemented feature configured off appears as disabled; an enabled feature with verified readiness but no use appears as ready but not exercised.**
10. **A verified operation appears operational with evidence; a later failure makes it degraded/blocked until recovery is proven.**
11. **A missing build/installation marker, missing log source, unknown config, dropped events or unobserved feature appears as unknown rather than success/failure.**
12. **All inventory entries appear in the matrix even with zero events; inventory drift/new features cause an explicit check failure or unknown coverage notice rather than silent omission.**

At least one test must require the analyzer to say **"insufficient evidence"** rather than fabricate a root cause or health state. Keep tests local/offline; never claim they prove GTA behavior.

### OBS3.6 Log-only final acceptance

An independent debugging agent, using **only one real collected post-session ZIP**, must be able to determine:

1. Which LSA systems/capabilities are **implemented in the build and proven installed**, and which installation claims remain unverified.
2. Which were enabled, disabled, experimental, blocked or unavailable from the actual effective configuration.
3. Which initialized and connected successfully, and when.
4. Which **demonstrably performed their intended functions**, with evidence for real terminal outcomes.
5. Which failed, stopped progressing, became blocked/degraded, or later recovered.
6. Which were ready but never exercised, and which remain unknown because logs, build/installation proof or success evidence are missing.
7. What the player requested; what model/native subsystems did; where significant operations failed; what reasons and recovery were recorded.

No live browser dashboard, GTA connection or F11 interaction is required to interpret evidence the runtime already had. Real GTA-only tests are reported **separately** from synthetic/offline coverage.

### OBS3 acceptance criteria

OBS3 is complete when:

- The existing collector creates a consistent archive with an inventory/version-aware evidence manifest.
- Offline analysis reconstructs meaningful operation timelines, failures, recovery, and evidence gaps.
- A **comprehensive per-system health matrix** covers all inventoried installed/implemented capabilities, even disabled and unexercised ones.
- Every status and success claim is tied to a supporting safe source/event and verified proof boundary; the six specified labels are not conflated.
- Representative fault, non-exercise, inventory-coverage and missing-evidence tests pass.
- One real post-session ZIP supports independent review of gameplay failures and all systems' evidenced operational states.
- No live diagnostic dashboard is required.

**Deliverable:** One troubleshooting ZIP and an offline Markdown/JSON report that covers both gameplay diagnostics and **system-wide operational health**.

---

## Explicitly out of scope

To keep this targeted, **do not**:

- Replace the existing logging framework, sinks, telemetry contract or log collector.
- Exhaustively instrument every internal event or subsystem operation to attain artificial "perfect coverage."
- Continuously poll native systems, collect unchanged snapshots, or introduce gameplay overhead.
- Rebuild dashboards, add a new UI, deploy a new observability server or external monitoring platform.
- Reimplement ACT, Director, Memory K, AI providers, native controls or gameplay functionality.
- Change feature gates/capabilities merely for observability.
- Record secrets, audio, full dialogues, memory bodies or personal information by default.
- Add a fourth phase or restart OBS0.
- Treat an unexercised system as failed solely to force a status, or label a feature working just because it is configured on.
- Delay the focused project to cover hypothetical failures with no demonstrated diagnostic value.

**Complete system inventory and lightweight lifecycle evidence are in scope; exhaustive instrumentation of every invented failure path is not.** Additional deep instrumentation must address an OBS0 finding, a demonstrated gameplay failure, or evidence necessary for the agreed OBS3 acceptance.

---

## Implementation and delivery rules

1. OBS0 is complete and OBS1 merged. Continue with **OBS2, then OBS3**; do not repeat the audit.
2. Each phase must leave independently useful improvements. Implement inventory/lifecycle reporting as an OBS2 extension and the health matrix as an OBS3 extension.
3. Reuse E1/RPH logging, capability registries, activation/status providers, telemetry fields and `Collect-Logs.ps1`.
4. Preserve actual source evidence, correlation, event-time authority and the distinction between readiness and successful operation.
5. Keep **all systems inventoried**, including disabled and experimental ones, but concentrate detailed instrumentation on real high-value failure paths.
6. Make gameplay logic changes minimal and only for diagnostic correctness; no new gameplay functionality.
7. Implement privacy/retention/performance safety and focused regressions alongside each change.
8. Maintain compatibility with concurrently developed GM0–GM6 and latest `main`.
9. Parallelize only independent slices; avoid simultaneous conflicting edits to common registries or telemetry.
10. Review integration diffs, run available targeted/CI tests, rebase as needed and merge verified, focused PRs.
11. Report whether evidence comes from source inspection, synthetic fixtures, CI or actual GTA; never substitute one for another.
12. Do not broaden scope merely because a system could theoretically emit more logging.

---

## Final deliverables

| Phase | Status / output |
| --- | --- |
| **OBS0** | Completed repository-wide observability audit; merged PR #265 |
| **OBS1** | Existing telemetry/ACT/native failure repair and correlation improvements; merged PR #266; GTA validation remains separate |
| **OBS2** | Automatic diagnostics for demonstrated high-value gameplay failures **plus complete installed-system/capability inventory and bounded lifecycle/success evidence** |
| **OBS3** | Improved ZIP collector; offline session analyzer; gameplay diagnostic report; **full per-system health matrix**; focused log-only acceptance |

Each implementation phase includes focused tests, what can now be diagnosed, observed coverage and remaining evidence gaps.

---

## Final definition of done

After any **ordinary** GTA session, the user can collect **one ZIP**. An independent debugging agent can use **that ZIP alone** to:

- Reconstruct important player requests and their actual observed AI/native outcomes, identify failures and recoveries, and distinguish recorded root causes from unknown ones.
- Enumerate **every implemented LSA runtime system and capability**, including disabled/experimental systems with no emitted runtime events.
- Establish which were built/installed, enabled/disabled/unavailable, initialized, connected, blocked or recovering **only where supporting evidence exists**.
- Show which demonstrably performed an intended function, including **last successful operation and its proof boundary**, versus those merely ready/not exercised.
- Report a comprehensive evidence-linked status matrix with **`operational`, `ready but not exercised`, `disabled`, `blocked`, `degraded`, and `unknown`**; state missing evidence and never imply an unknown feature is healthy or broken.
- Answer what was and was not verifiable without connecting to live GTA or opening F11/browser debugging views.

**Success is measured by how much easier LSA becomes to debug and how reliably its real operational state can be established, not the number of telemetry events or dashboards added.**

**OBS3 is the stopping point** unless real gameplay testing uncovers another important evidence gap.