# OBS1 — Critical telemetry and failure diagnostics

**Baseline:** OBS0 audit, merged PR #265. **Scope:** focused phase 1 of the reduced OBS0–OBS3 plan.

## Durable event conventions

- The existing E1 JSONL `schemaVersion: 1` record remains authoritative for companion telemetry. It includes UTC timestamp, monotonically increasing per-sink sequence, `elapsedMs`, `runId`, producer event name, and optional validated native turn identity.
- New optional `component` and `severity` fields are emitted only from a closed vocabulary. Existing emitters and readers remain compatible.
- ACT events retain closed-vocabulary `reason` codes plus validated opaque `activityId`, `goalId`, `executionId`, and `requestId` UUIDs when producers have them. Correlation is **not** inferred from coincident timestamps.
- ACT native aggregate diagnostics are `activity_channel_counter` with a count delta; they are **not** per-command receipts or evidence of physical completion.
- Individual `activity_receipt` events originate from the engine's validated receipt path and are separate from `activity_terminal` and physical arrival observation. `PHYSICALLY_COMPLETED` remains excluded from generic telemetry's `receiptState` vocabulary.
- ACT channel parser, contract, handshake, sequence and transport failures emit `activity_channel_failure` with safe reason codes and available opaque host/run/epoch IDs. Repeated identical failures are suppressed for 10 seconds per client. Expected world reset does not claim a failure.
- P2 player ControlChannel emits bounded `[P2 OBS1] control_channel_failure` RPH messages with safe categorical causes, validated native host-run/epoch and suppression counts. No request payload or exception body is logged.
- Valid reaction pipe events and M9 shadow callbacks now pass the strict E1 event-name gate; reaction modes/names are restricted to closed catalogs.

## Security and operational constraints

Do not record transcripts, model prompts, API tokens, raw IPC frames, actor names, private memory text, exception messages or provider bodies. All additions use existing nonblocking/bounded logging. Component `speech` and the original verified turn tuple provide voice-path correlation; this phase does **not** create cross-host causal proof by joining timestamps.

## Tests and limits

Run `node --test tests/observability.test.mjs tests/activities-shadow.test.mjs` in `lsa-essential-e1-candidate` and the existing ACT/native CI suites. Focused regression coverage checks event retention, redaction, case-sensitive native receipt states, IDs, aggregate-counter honesty, sequence gaps, and malformed frames.

**OBS2 work remains:** automatic runtime snapshot transitions for UX4, Director, playback, Memory K and readiness. **OBS3 work remains:** one-ZIP offline reconstruction and session-wide acceptance. GTA-in-game behavior is not established by CI.
