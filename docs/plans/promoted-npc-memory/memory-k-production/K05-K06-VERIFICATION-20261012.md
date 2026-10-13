# K-05 / K-06 implementation and verification

Scope: permanent forgetting and suppression integrity only. Based on integration
head `2a164120926c1d743cbd382044639edff07d97d9` (PR #138). This change does not
complete WS-4a, address K-07/K-12, alter K-01 packaging, or establish GTA readiness.

## Production changes

- `suppressionSqlite.mjs` owns one suppression closure shared by M4 recall, M5
  commands, P2/M6 replay, deterministic persistence, and Luna authorization.
  Forgotten memories suppress ancestral evidence and every dependent memory.
- Forgetting commits scoped evidence IDs, source keys, and content SHA-256
  fingerprints with integrity digests in `memory_suppressions`, inside the
  original P2 writer transaction. There is no second store or connection.
  Fingerprints contain no dialogue, summaries, or model takes.
- Trash bundles include the complete source closure. Purge physically removes
  original journals, derivatives, replay entries and linked curation/command
  content. Permanent suppression and tombstones survive deletion and restart.
- Journal intake rejects matching IDs, original turn/observation keys, and exact
  content fingerprints, including replay under a different ID or avatar and
  later revisions of a forgotten observation. Read suppression also recognizes
  already-stored matching fingerprints under other IDs.
- Deterministic writes check suppression before idempotent replay and insertion.
  Luna enqueue, claim, pre-transport verification, completion, and appraisal
  reads use the same closure. Forgotten sources reject with
  `curation_source_forgotten`; invalid/absent source integrity cannot authorize
  transport or a commit. An in-flight response after forgetting cannot commit.
- Explicit restore within seven days clears only that operation's suppression
  receipts, verifies metadata before clearing it, and re-offers preserved
  journal evidence after previously consumed replay cursors. A different
  forgetting operation remains effective. Expired/purged trash cannot restore.
- Startup upgrades legacy target-only forgetting transactionally. If an older
  purge already destroyed the provenance required to reconstruct fingerprints,
  an unresolved suppression receipt makes that NPC/world/timeline fail closed.
  Other NPCs and confirmed timelines remain usable. Removing or altering a
  permanent receipt also fails closed; purge verification checks suppression.
- Original journals stay immutable until authorized purge. Avatar provenance,
  timeline/source fences, provider consent/budgets, and unpromotion cleanup
  remain under their existing owners.

## Offline verification

Windows, Node **24.19.0**, real production SQLite stores. Native source receipts
and Luna transport are offline fixtures; no cloud inference or GTA was used.
The existing atomic database creation requires Windows hard links, so these
tests ran outside the desktop filesystem sandbox.

| Check | Result |
| --- | --- |
| New `memory-k05-k06-forgetting.test.mjs` | **17 / 17 pass** |
| Original W04 K-05 production privacy regression | **1 / 1 pass**; fails on untouched base |
| M6 stale acknowledgement after production forgetting | **1 / 1 pass** |
| Adjacent M4, M7, integrated-store and unified-avatar suites | **77 / 77 pass** |
| Adjacent Essential explicit-command and Luna adapter suites | **33 / 33 pass** |
| All shared-brain `memory-*.test.mjs` on untouched base | **206 / 210 pass**, 4 failures |
| Same glob with this change | **224 / 227 pass**, 3 inherited failures |

The new regressions cover forget → purge → restart → replay/curation, deterministic
replay and transitive siblings, preexisting and expired Luna leases, budget and
provider races, completed appraisals, atomic forgetting, replay with changed
identities, event revisions, restore/cursor replay, overlapping content hashes,
scope isolation, legacy migration/lost provenance, corrupt or deleted receipts,
unverifiable source bytes, and transactional rollback. All local commands used by
the dedicated Windows/Linux Node 24 workflow are green. Remote CI is separate
evidence; adding the workflow does not assert a remote CI pass.

## Remaining blockers

The identical three failures reproduce on the untouched integration head:

1. W04 compound commands: K-07's missing `commitCommandBatch` binding.
2. W04 clarification: K-07's missing `findPendingClarification` binding.
3. W06 authority negative: the fixture expects a timeline error but production
   rejects first with `m6_native_authority_required` (audit K-08).

They are outside K-05/K-06 and remain unchanged. Existing lost-provenance legacy
purges cannot be reconstructed automatically; their affected scopes are denied
rather than silently re-enabled. The integration plan's packaging, other source
implementation, native build, and GTA acceptance blockers remain open. There
was no deployment, merge, or modification of Claude's K-01 packaging files.
