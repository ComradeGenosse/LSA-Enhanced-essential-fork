# OBS2 real-session health failure and outstanding LSA issues — 2026-10-18

**Incident:** `logs-20261018-192709-dc9bda.zip` collected 2026-10-18 at 19:27:09Z.
**E1 run:** `37855958-5ebc-4678-bebf-76710265348c`, event log `source-1/plugins/LosSantosAliveServer/logs/e1-run-20261018T192221Z-37855958-5ebc-4678-bebf-76710265348c.jsonl`.
**Fix:** [PR #274](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/274). **Source:** user-provided ZIP, not stored in this repository. All # numbers below denote E1 event sequence; times UTC.

## OBS2 problem being fixed in PR #274

- At 19:22:21.313Z, `run_started` (#1). At 19:22:21.314Z, `system_health_gap` with `code=inventory_unavailable` (#2). No `obs2-inventory-*.jsonl` in 197 collected files. This blocks the complete OBS3 matrix.
- Source diagnosis: `buildSystemInventory()` traps a missing source-only ACT capability registry and substitutes `null`, but the ACT loop subsequently calls `registry.get(id)`. The missing registry is plausible in packaged bundles; because the error was swallowed, **the ZIP does not itself prove this exact exception**. Fix the independently verified null-dereference and add classified, safe failure-stage evidence.
- PR #274 preserves all compiled `CAPABILITY_IDS` as inventory rows when source registry JSON is missing; marks ACT implementation `unknown` with `source=compiled_contract_fallback`, preserves configured mode without claiming operational proof; persists the manifest before starting health observers and emits one of `inventory_build_failed`, `inventory_write_failed`, or `health_monitor_attach_failed` for future errors.
- Acceptance is **not** merely a passing unit test: after deploying updated `main`, a real post-session ZIP must contain `obs2-inventory-<runId>.jsonl` and matching `system_health_manifest.manifestHash`; the offline analyzer must show all inventoried systems even if unexercised. Tracked in [#280](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/issues/280).

## Hand-off queue — all outstanding findings from this session

| Priority | Tracked item | Observed evidence | What must be distinguished |
| --- | --- | --- | --- |
| High | [#275 — Promoted character / F11 ownership](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/issues/275) | 6 `character_safe_failure`: `native_operation_failed` ×3 (#70, #72, #78); `owner_unavailable` ×3 (#77, #84, #90). Roster empty #69 → unavailable #71 → empty #75 → spawned #82, active count=1 #83, with failures afterward (#84/#90). | Successful spawn/roster enumeration is not proof later native commands have a valid owner lease. |
| High | [#276 — Perception/native owner stalls](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/issues/276) | 5 `intelligence_status:owner_stalled` (#31/#41/#51/#909/#920, 1501–1776 ms); 8 disconnected/8 connecting/5 connected/5 initialized; M3 coverage suspended/resumed. | Teardown `bridge_disconnected:session_closed` #908 may be intentional; don't conflate it with in-game stall. |
| High | [#277 — M3 journal refusals](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/issues/277) | 13 `memory_journal_not_committed`: native lease unavailable ×8, readiness timeout ×4, original actor unavailable ×1. **12** `memory_journal_committed` also observed. | Safe authority refusal may be correct; do not bypass privacy/ownership gates to force writes. |
| High | [#278 — Scene Director missing receipts](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/issues/278) | 5 `director_candidate`: delivered ×1 (#200), native_rejected ×4 (#89 unsafe; #449/#568/#824 missing receipt). `director_handoff:original_owner_unavailable` ×3 (#448/#566/#822). | Expected gate/rate/safety filtering is not automatically a bug; target missing native receipts and ownership. |
| Medium | [#279 — Native playback interruption](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/issues/279) | 9 native playback outcomes: 8 completed, 1 cleared/interrupted (#725 at 19:25:05.954Z); matching terminal #729 `playback_interrupted`, ~20.9 s, assistant not committed. | Cause not established; distinguish intended mic interruption from stuck completion. Logs do not prove audible output. |
| High | [#280 — Real ZIP acceptance / missing roots](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/issues/280) | Collector copied 197 files, 0 copy failures; source-3/source-6 missing, source-2 present with 0 files; no OBS2 inventory. ACT vehicle/waypoint execution not demonstrated. | Missing roots may be optional; unexercised ACT is not a failure. Validate actual post-fix GTA session and full matrix. |

## Positive evidence and exclusions

- Native RPH log `source-1/RagePluginHook.log` reports P2 host starting and essential host ready; deployment hash evidence lists RPH and promoted-character DLL files **present**, not necessarily loaded/operational.
- E1 event counts: `stt_completed` ×8, `native_playback_ended` ×9 (8 completed, 1 interrupted), `turn_terminal_summary` ×9 (8 completed), `assistant_history_committed` ×8, `memory_journal_committed` ×12, `memory_journal_not_committed` ×13. This proves meaningful portions of the provider/playback/history pipelines functioned, not whole-LSA health.
- Director has one delivered candidate (#200) and valid binding chain (#114–130), so not a global Director outage. PS0 successfully connected/initialized repeatedly, but had stalls; not a global perception outage.
- No conclusive successful ACT vehicle/waypoint operation in this session. Mark as unexercised/unknown pending appropriate test rather than inventing failure.
- Normal shutdown isn't proven by absence/presence of particular trailing messages. Distinguish app close, gameplay pause and actual unexpected native disconnect when investigating.

## Rules for follow-up agents

1. Claim only what the recorded events and any subsequent reproductions prove; label root-cause hypotheses clearly. The attached ZIP is NOT in the GitHub repository; obtain it from the original user for additional raw evidence.
2. Take one of #275–#280, preserve existing safety/ownership/privacy gates, add causal logging and deterministic tests; do not use this OBS2 inventory PR to silently change gameplay behavior.
3. Link subsequent PRs/issues and compare with this run's exact event sequences. Keep OBS2 success proof separate from mere readiness and transport acceptance.
4. After #274 deploy, collect one real GTA ZIP and run `tools/lsa-local/Analyze-Logs.py`. If `system_health_manifest` and inventory are still absent, the new stage-specific reason code identifies the failed phase; do not state every system is healthy.

**Status:** this document tracks observed outstanding findings, not fixes for #275–#280. PR #274 fixes the confirmed software null-dereference and observability error classification; independent real GTA validation remains outstanding.
