# Memory K live deployment repair reconciliation — 2026-10-15

## Branch boundaries
- Starting point: PR #138 integration head `6eb50775fe2302157f1bc510d7e93c5d6a511331`.
- Proven GTA repair sources: PR #184 head `57fe1c5fc5d9f268f5751f17c31ecf9967100f48` (includes Claude's H1/H2 archive vs recall regression test commit).
- This is a separate *review candidate*, not a deployment or an automatic merge. PR #184 is intentionally left open and unchanged.
- Exactly 33 previously nonoverlapping #184 files are transplanted unchanged; four shared files (`bootstrap.mjs`, `editorServer.mjs`, `essentialGlue.mjs`, `sqliteProfileStore.mjs`) are reconciled with current I1/I2 changes.
- Original #138 capabilities I1 conversational commands and I2 inspector/learned-memory pause are retained.
- PR #183 M6 J-A remains independent and is **not** included here.

## Manual reconciliation
1. Editor constructor retains I2 privileged inspectorControls and adds the read-only `memory_status` diagnostics endpoint from the live repair branch.
2. Editor HTML retains the inspector sections/actions while adding live-memory status, correct new-run manual confirmation wording, and same-host pause status.
3. Foreground runtime retains independent M5 commands and I2 learned-memory pause while adding authenticated admission wait, D03 diagnostics and current registered actor recovery.
4. P2 keeps the I2 AsyncLocalStorage optional-operation fence and privacy/command APIs; same-host/world temporary source loss can resume only a previously explicitly confirmed selection. New host/epoch or ambiguous boundaries still require manual confirmation.
5. Every other #184 change is reused byte-for-byte by Git blob identity.

## Boundaries
- No live GTA/SQLite files, `.env`, private logs or credentials are included; no installed files are modified.
- `memory.recall: on` is currently an **installed config value**, not a hard-coded repo setting or a new feature in this integration.
- The separate deployment-only ElevenLabs compatibility overlay is *not* ported: do not deploy a full build from this candidate over the working game installation until the voice overlay is reconciled and retested.
- No automatic startup timeline resume. Keep user confirmation on each new launch.
- Tests/CI and native build must be checked against the combined head. Passing offline tests does not certify the actual installed GTA combination.
