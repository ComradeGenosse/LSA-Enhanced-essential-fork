# E0 unattended GTA smoke results — 2026-10-19

The suite ran automatically in GTA V Enhanced 1.0.1158.16 under RPH 1.132.1428.17748, completing at 07:29:07 America/New_York (11:29:07 UTC). RPH logged the lab DLL loading at 07:29:00. No player movement or shooting was needed. Startup already contained `ReloadAllPlugins`, so no launcher selection change was necessary.

| Probe | Actual verdict | Scope / prerequisite |
|---|---|---|
| E0.0 | GTA_VERIFIED | Environment inventory and DOES_ENTITY_EXIST observation captured. |
| E0.1 | GTA_VERIFIED | Ten read-only matrix entries callable with no reported errors. Uncalibrated local ray completed with no hit; this verifies callability only. |
| E0.2 | BLOCKED | Requires 30 CodeWalker ground-truth surfaces; reference count 0. |
| E0.3 | BLOCKED | Requires 10 CodeWalker measured walls. |

Suite `4b4651f7ad214abdbc0204c5bd7e75cc` finished `completed_with_blockers`. Every probe recorded successful cleanup, zero lab-owned entities remaining, and restored state. All destructive permission flags stayed false. The recorded frame-time percentiles are zero with zero timing samples, so they do not establish performance.

## Evidence

[Sanitized evidence bundle](2026-10-19-runtime.evidence.json) contains all four original JSONL logs, four summaries, suite manifest, config, build receipt, deployment fingerprints, startup command, and relevant RPH startup/plugin/suite excerpts. File contents are preserved as strings under the `files` map. Personal paths in RPH excerpts were replaced with placeholders; unrelated logs were excluded.

## Launch correction

The initial restricted-shell launches exited with `0xE0434352`. The .NET Runtime stack identified a Win32Exception in `Process.StartWithShellExecuteEx` during RPH application startup. Retrying the authorized launch outside the restricted shell resolved it; GTA then reached story mode and the suite ran. The earlier NOT RUN report described only those failed attempts and is superseded by these actual results.

## Fingerprints and provenance limits

- Runtime DLL SHA-256: `9fbdb4c7082bd8341ed2149f25fe0c58447b0770d707923dcb564d15793daf46` (matches embedded receipt and runtime inventory).
- Config SHA-256: `362972034bc6201abababd20c1d9e8e6f749f7aff987596b655882d8f6d01752`.
- Supplied ZIP SHA-256: `4b4ead5a80bf870ff7a08ae72cc4cc92c6ff827f63fee5b3bc0b490ffc26faa4`.
- Successful workflow inspected: [39240965340](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/39240965340), commit `f5740c662ffd9a250da32dad5e8a97ca38d72337`.
- Artifact 12181496567 digest: `d89bf23d68b45e4bb670a4192799f1805d1b978d46a313e6965def48e4e98157`. It differs from the supplied ZIP, so exact correspondence to that CI archive remains unresolved. Embedded-receipt matching alone does not prove CI provenance.
- The original build receipt's `gtaTested:false` is retained unchanged as build-time metadata; the new runtime logs document this run.

## Next steps

Provide real CodeWalker references for E0.2/E0.3 and rerun the safe suite. Reconcile the supplied archive with its originating CI artifact for exact build provenance. E0.1's fallback ray does not establish material correctness or wall thickness, and deferred destructive native calls remain untested.
