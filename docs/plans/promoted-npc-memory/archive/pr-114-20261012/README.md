# PR #114 historical EA shared-player memory source

Original PR [#114](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/114) head `6eb288f5f1d6f02f9db7d2cb959c3a985adc4613`.

Three original added source blobs are preserved byte-identically under this directory with their original relative paths:
- `.github/workflows/ea-shared-player-memory.yml` — `e147bec266340ae33adb60541300eb7a5604fd94`
- `docs/handoffs/EA-MEMORY-UNIFIED-PLAYER-CLOSURE.md` — `5ccbddac2ad6c88a7471c058a85bd67eb609cc92`
- `lsa-essential-e1-candidate/tests/ea-shared-player-memory.test.mjs` — `76e1eac164c25c069096f2a319cb0cf43c223209`

These documents, tests, and inactive archived CI reflect the **old EA G branch**, not the active Memory K production implementation. The six original tests are adapted on this repair branch against contemporary #138 APIs and extended with source-revocation and forged replay-token checks. No old workflow is activated by this archive. Controlled GTA and main release gates remain unchanged.

**Known architecture tradeoff:** #138 trusted one-argument `confirmTimeline(id)` is retained for existing bootstrap/editor callers; the optional `{confirmation:id}` form checks a supplied token. Enforcing an unforgeable user-selected confirmation capability at the UI boundary remains a separately reviewed M1/F11 source authorization contract and is **not claimed solved** merely by accepting an argument.
