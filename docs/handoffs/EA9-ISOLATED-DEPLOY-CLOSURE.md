# EA9 Isolated Deploy and Rollback — Repair Closure

Date: 2026-10-12. Independent isolated test tooling repair (no installed game touched).

- Base: EA PR #96, `b1a9b01b72c406706bb640daacbe30a56efd6d4e`.
- Draft [repair PR #112](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/112), branch `fix/ea9-isolated-deploy-acceptance-20261012`.
- Source commits `7a8d1c229f31b8abb53300ac443c8412924f70a4`, `c2c81e2dbad8a6ec9777871ed46cf4477c728c25`, `71ce05da9ecaf16082fe4c12e10d65cc4c8e13c4`.

## Actual repairs

1. `tools/ea9/isolated-deploy.mjs`: the `verify` operation now reads the *immutable backup receipt* and does not demand `--release-root`. Only `deploy` consumes staged release bytes.
2. Avoid mistaking Windows CI's ordinary short (8.3) TEMP path `RUNNER~1` for a filesystem symlink. Each existing ancestor is checked with `lstat` and link targets are rejected; canonical real path is still screened for Program Files/Steam active game directories; POSIX exact realpath check stays intact.
3. `lsa-essential-e1-candidate/tests/ea-final-b-timeline.test.mjs`: SQLite C-13 fixture cleanup now closes its database owner and WAL/SHM before Windows removes the temporary folder. This does NOT change the original PR #96 schema-v2 semantics; G's v4 semantics live in PR #108 and subsequent reconciliation.
4. New `.github/workflows/ea9-isolated-acceptance.yml` runs the source-bound isolated rollback suite on Ubuntu and Windows.

## Exact executed evidence

At source SHA `71ce05da9ecaf16082fe4c12e10d65cc4c8e13c4`:
- [Full EA0–EA9 offline acceptance workflow 38245793189](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38245793189): **PASS**, both Node 24 OS matrix jobs, native SDK/ABI job, Node 22 default JSON on both OS, separate Python/Essential suites.
- [Focused EA9 rollback workflow 38245793216](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38245793216): **PASS**, reversible isolated deploy/verify/rollback on both platforms.
- Original failing EA9 checks were `release_root_required` on Linux `verify`, `target_alias_or_symlink_forbidden` on Windows fixture, and Windows SQLite WAL EBUSY.
- This report changes documentation only; the above pass applies to the exact named source SHA. Final report HEAD should be verified separately.

## Limits / acceptance

EA9 **offline isolated release/rollback code: PASS** at the stated source SHA. Actual user game install, real GTA paths, run-time lag, save data migration and vendor-billed audio: **NOT RUN**. No deployment authorization. Repair PR targets the protected PR #96 branch, not main; Memory G/H branches remain independent.
