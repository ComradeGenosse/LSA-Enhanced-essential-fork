# OBS2 — Automatic system health evidence (implementation notes)

**Plan:** [OBS0–OBS3](./OBS0-OBS3-FOCUSED-PLAN.md). The implementation focuses on the inventory and edge-triggered evidence layer; it does not add a dashboard, gameplay behavior or per-frame polling.

- Registry-derived inventory sources: real ACT capability registry, Memory K capability policy, reaction catalog and existing readiness registry, plus an explicitly audited core/runtime-resource list. CI verifies that all bootstrap-owned resource names remain covered.
- A bounded, sanitized `obs2-inventory-<runId>.jsonl` is written at companion startup, including disabled/experimental/unsupported/unexercised rows. It deliberately says `installed: unknown` and `initialization: unknown` for registry declarations; merely being in source is not evidence of native installation. File retention is bounded independently of E1 rotating telemetry. OBS3 must include these already-JSONL manifest files in the ZIP.
- Structured `system_health` events use a closed health/proof vocabulary and existing run timestamp/sequence. Data carries no transcript, prompts, API keys, actor names, memory text or IPC payloads.
- Existing E1 telemetry success/transport events are passively observed only **after** the source event is validated and accepted by its bounded sink. Repeated unchanged state is suppressed. The lifecycle owner emits resource initialization/failure/recovery/shutdown transitions. These must **not** be interpreted as successful gameplay.
- A native hello means ready, not action success; an ACT handler acceptance or counter delta is not proof of movement; only an ACT world-strong completed terminal event can certify a capability operation. M3 durable memory writes, native playback completion with a matching completed outcome, and successful provider replies each have separate proof boundaries. No audio is certified audible.
- Native host/RPH/DLL installation is still `unknown` until independently attested by a source; a companion registry does not prove a DLL was shipped or loaded. If logging is explicitly disabled or fails before writing, OBS3 must report the resulting evidence gap.
- The inventory and health events are **input** to the OBS3 offline analyst. They are not the full analyzer itself and do not claim to prove every subsystem's operation in sessions where it was not exercised.

Focused tests: `node --test tests/obs2-system-health.test.mjs tests/observability.test.mjs tests/activities-shadow.test.mjs`. Native GTA smoke validation remains outstanding.

M7 curation now reports deduplicated worker state changes directly from its status setter, plus a separately verified-operation marker only when a checkpoint reports processed work. Paused/consent-blocked/idle states do not prove curation succeeded.
