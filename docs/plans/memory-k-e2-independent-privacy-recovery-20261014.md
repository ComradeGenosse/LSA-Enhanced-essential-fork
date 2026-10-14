# Memory K E2 — independent privacy and recovery

Integration base: PR #138, `458a2d400159c09e4baa2c4ddb3bb30668ac3552`.
Implementation: `6393bf0e3ce2a953c6b8acd3fa71ec75973d16bf`.
Architecture: PR #158, Workstream E2. This scoped change targets
`integration/memory-k-production-20261012`. No merge or GTA deployment.

## Findings and production changes

1. **Optional disable reopened RAM history.** The WS6 persistent-history
   repair in `essentialGlue.mjs` required `optionalMemoryEnabled`. The
   storage-only profile therefore stopped the journal preflight and also
   removed its mandatory protection against stale RAM conversation. Three
   original bundled-runner regressions reproduce forgotten, corrected and
   damaged-ledger history reaching the model with M2–M9 off. Remove only the
   optional-consumer condition: persistent SQLite characters always require
   authenticated journal history, or receive no historical conversation.
2. **Privacy readback trusted receipt JSON.** `verifyPrivacy` parsed the stored
   receipt without verifying its shape, target bundle, request hash or durable
   suppression. Reuse the existing operation request hashes and durable trash
   records to verify readback; preserve both current human-scoped and original
   avatar-bound hashes. Damaged metadata cannot certify a successful retry.
3. **Restore could clear a partially purged bundle.** Selecting only unpurged
   trash members and deleting the parent's entire suppression ledger could
   release a purged sibling's fingerprint. Restore now verifies every member,
   the complete permanent suppression set, source existence, original receipt,
   valid seven-day schedule and absence of restored/purged members before
   releasing anything. An interrupted or inconsistent bundle stays suppressed.
4. **Purge could destroy recoverable bytes with invalid privacy metadata.**
   Verify permanent suppression, due operation receipts and original retention
   schedules before deletion, in the same original P2 transaction. Existing
   physical deletion limits, closure, source cleanup and verification remain.
5. **Privileged reads could outlive authorization.** Inspection/export checked
   authorization before asynchronous queue admission. Recheck inside the
   serialized P2 read, before returning data; purge verification does likewise.
6. **Correction visibility accepted damaged metadata.** Shared correction
   reads now verify the existing text checksum and reject unknown persisted
   modes before calculating supersession. Preserve NULL legacy mode semantics,
   immutable source transcripts, and protection of NPC speech/witnessed events.

Only four production files change. P2's schema/migrations, single connection,
writer lock, source/timeline authority, transaction/savepoint implementation,
commit fences, M2/M3 recording controls and native contracts are unchanged.
No new privacy database, replay system, background worker or inspector is added.

## Capability matrix with M2–M9 disabled

Use the existing `memoryK: { profile: "storage-only" }` profile. The real
bootstrap test checks every optional `memory.*` and `events.*` catalog entry.

| Capability | Effective behavior | Mandatory privacy behavior |
|---|---|---|
| P2 SQLite / M1 | Existing sole writer, schema and retained data available | Source/timeline/owner checks remain per operation |
| `privacy.core` | Required; composition reports `guarded`, effective `on` | `scope_verification_required` explicitly avoids claiming global data/source health |
| M2 player / NPC recording | Off; no optional recorders activated | Retained evidence and suppression remain protected |
| M3 events / coverage | Off; no M3 factory | Existing event privacy and evidence validation remain |
| Journal context / M4 recall | Off | No stale RAM replacement for persistent SQLite characters |
| M5 conversational commands | Off | Existing privileged scoped P2 privacy services still forget/restore/purge/verify |
| M6 deterministic retention | Off | Direct retained-data write/replay contracts reject forgotten sources |
| M7 cloud curation | Off; no transport, scheduler or consent activation | A previously acquired lease cannot commit forgotten sources |
| M8 interpretations | Off | Existing history/derived-source checks retain suppression/correction semantics |
| M9 callbacks / producer requests | Off | No callback, native producer or physical authority activation |
| Source/native ownership | Existing independent prerequisite | Missing/retired source rejects reads and writes; restart requires fresh confirmation |

Composition's privacy status describes mandatory guards installed with P2,
not successful authentication or a blanket integrity certificate. No optional
request can switch these guards off. The existing capability policy still
rejects attempts to configure prerequisites as optional capabilities.

The human remains unified across Franklin, Michael and Trevor. NPC, world and
timeline are still separate ownership scopes. Avatar remains provenance and
current accepted-input authentication metadata, never a permanent privacy key.

## Validation and reproducibility

`node tools/memory-k-verification/e2-suite.mjs --output work/e2-validation`
runs 22 unchanged original suite files and then the three new E2 files in a
separate result. Original M5 completion imports its existing closure/cross-avatar
suites. Results retain exact test-file SHA-256s, host/runtime information,
counts, failures and full TAP logs. There are no skips, assertion edits,
test-only production bypasses or relaxed native/source checks. Every failure
stays red. The verification registration adds all three new files to inventory.

The E2 CI workflow runs exact PR-head Node 24 Windows/Linux jobs, uploads their
logs/receipts even on failure, and runs the original offline package builder.
Other existing native/source/release workflows are retained unchanged.

Local validation uses Node 24.19.0 on Windows and Ubuntu/WSL2 Linux x86_64.
The baseline is an immutable Git archive of the pinned #138 commit; the Linux
candidate is an exact Git archive of the implementation commit. The same new
tests are also copied into the baseline test tree to reproduce the defects
without changing baseline production code or original assertions.

| Gate | Baseline | Candidate |
|---|---:|---:|
| Windows original privacy/replay/retention/WS6/storage/10k suites | 264/264 | 264/264 |
| Windows identical E2 adversarial tests | 6/22 (16 failures reproduced) | 22/22 |
| Linux original suites | 264/264 first complete run; 263/264 final repeat (inherited K07 failure) | 264/264 |
| Linux identical E2 adversarial tests | 6/22 (same 16 failures reproduced) | 22/22 |
| Original source-verified package builder | Existing contract retained | Windows and Linux passed, 70 expected AST edits |

The 22 original entrypoint files have identical SHA-256s between baseline and
candidate. Exact implementation archive SHA-256:
`75e6fdfa07e9296c2f173f72a6481df2b7750098ffadbef09f6c58308742cf2f`.
Pinned baseline archive SHA-256:
`5a632400bec8b80e9d584377ff157ee629efe055f574a7a7df066f5f2779910c`.
Both package builds produced bundle SHA-256
`eb5b3cd45c4c9b8de51c476e30e956854375e353da664e88a18e1677b7427233`.
The runtime changes are companion/shared sources copied alongside the bundle;
the identical patched bundle hash is not a claim that the entire payload is
identical. No native package/deployment acceptance is inferred from this build.

Coverage includes actual child-process exit after suppression/trash inserts but
before receipt/COMMIT, WAL rollback and stale-writer reclamation, exit after
durable commit, idempotent retry after restart, concurrent cross-avatar retries,
queued source retirement, corrupt receipts/expiry/corrections, partial bundles,
forget/restore/purge, derivation and leased curation, replay revocation, strict
scope/cursor isolation and old-backup metadata-only recovery. Existing K12
NPC/event counter-claim and transcript correction assertions still run.

An initial Windows sandbox run could not create P2's atomic hard link. Native
Windows execution resolved that environment restriction without source changes.
Early Linux probes observed a D02 settling timeout on the Windows mount and a
K07 rejection on baseline. One complete Linux-native baseline passed 264/264;
the final repeat failed the unchanged `K07 stale, replayed, predated and forged
replies never resolve a clarification` test with `memory_source_forgotten` while
accepting its later reply. This is directly observed on the original base and
also appeared in an earlier baseline probe. It is retained as an inherited red
test, not waived or attributed to E2. The final candidate original suite passes
264/264; that does not explain or erase the baseline failure.
An intermediate candidate archive incorrectly excluded vendored Acorn `dist`
files and failed module loading; the exact Git archive fixes the test packaging,
without modifying production, tests or verification contracts.

## Compatibility, remaining risks and F/G contracts

- Existing JSON P2 and ordinary unpromoted conversation behavior are unchanged.
  For persistent SQLite characters with optional memory off, conversation now
  omits unverified historical RAM. This conservative loss of historical context
  is intentional; H1 can independently supply authenticated journal context.
- No schema version bump or downgrade, writer change or migration rewrite.
  Legacy valid receipts and correction rows remain readable. Damaged metadata
  may now make an operation unavailable rather than reporting success.
- The seven-day authorized trash restore remains explicit. Purged fingerprints
  survive restart and reject fresh IDs/rederived content. Privileged archive
  access during the recovery window intentionally retains immutable source
  bytes; it is not a model-visible recall path.
- An arbitrary old backup is not a privacy-safe live restore. Existing recovery
  remains metadata-only and never auto-restores dialogue or overwrites a damaged
  database. A future live restore requires a trustworthy current suppression
  ledger and separate reviewed recovery procedure.
- F/G must reuse the existing scoped P2 ports, immutable source/evidence
  contracts and source/timeline generation fences. Recording admission cannot
  substitute for durable acceptance or enable optional consumers. E2 adds no
  recording activation and no native authority shortcuts.
- This is offline foundation evidence, not full Memory K release acceptance.
  Native SDK/build/package acceptance, original S01–S10, physical GTA and soak
  remain separate gates. No GTA files were deployed, no live provider was
  called, and no automatic merge is authorized.
