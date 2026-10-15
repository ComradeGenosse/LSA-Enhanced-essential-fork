# Memory K H1-A — authenticated journal history seam

**Base:** `3f4138d6f108ae6feda6d03ed54ac7c5e4e9c04a` (PR #138, `integration/memory-k-production-20261012`).
**Scope:** extraction only; no runtime feature switch, new writer, new DB connection, native code, H1-B/H1-C or H2.

## API and ownership

`src/memory/h1ConversationHistory.mjs` exports:

- `prepareH1ConversationHistory({store,turn,acceptedReceipt,input,source,isCurrent,nowUtc})`: independently calls the H1 source gate and prepares read-only SQLite CONVERSE, without requiring or running M4/M5/M8. A valid empty history is **ready**.
- `openH1ConversationSource(args)`: same authenticated gate, returning a source with `{status:'ready',scope,line,characterId,stamp,current,prepare()}`. The existing combined foreground pipeline opens this **before** M5, then calls `prepare()` **after** M5 durable processing. H1-B should use the one-call API when M5 is off. This shared open/readback can be reused by other contributors; it is not a minting API.
- Ready history: `{status:'ready',conversationJournal,stamp,verifyPrepared(),sendCurrent()}`. History preserves exact player/NPC source words and roles, recent window (5 minutes, 20 messages / 12 KiB), and separately labelled archived entries (4 / 2 KiB). The current accepted line is excluded. Failed/interrupted NPC speech, suppressed and corrected sources are excluded. Previous accepted lines from other legitimate player avatars remain eligible **within the same NPC/world/timeline**, consistent with D-021 unified-player history.
- Unavailable history: `{status:'unavailable',reason,conversationJournal:null}`; reasons `source_authority_missing` (D03/M2/current native owner/timeline/source denial) and `history_unavailable` (journal or suppression read failed, accepted source suppressed, or projection denied). No RAM fallback.
- `await ready.verifyPrepared()` returns `{status:'ready'}` or `{status:'invalidated',reason}`: `source_authority_revoked`, `accepted_line_changed`, `history_changed`, or `history_read_failed`. It re-reads P2 accepted line, suppression/correction overlays and bounded journal, and pins the current SQLite read fence. This must be awaited before **each** attempt/retry and at the actual provider boundary. `ready.sendCurrent()` is a **synchronous** last-moment check against that fence and source authority; do not call it before successful verification, or cache its true result. On `unavailable` or `invalidated`, discard H1 and do not project prior RAM.
- Source authority is furnished **only** by existing durable D03 accepted receipts plus `turn.m2Capture.openMemoryCurrent()/verifyMemoryCurrent()`, P2 stored-line readback, source type, exact input/record ID, owner alias, host run/world epoch, writable timeline and character identity. H1 never issues a receipt, persists a dialogue event, supplies native proof or authorizes privacy independently.

## Combined path and final send

`prepareLiveTurnMemory()` continues to require M4 store ports and execute existing M5 processing, M4 recall/evidence and M8 reader in the same order. It now reuses `openH1ConversationSource()` for original admission and `source.prepare()` for the post-M5 journal. Its `verifyPrepared()` composes **H1's independent revalidation** with the unchanged M4 evidence/count/witness/visibility and M8 revalidation; its synchronous `sendCurrent()` additionally requires H1's fence. `essentialGlue`, PS4 sole assembly, legacy and storage-only paths are unchanged.

## H1-B/H1-C handoff

H1-B may independently select whether an authorized prepared H1 contribution enters PS4, but must retain D03/M2/P2/privacy gate and must never substitute in-memory history on failure. H1-C must cover immutable-snapshot pruning and revalidation across retry, delete/forget, correction, host/timeline/owner retirement, SQLite fence changes and restarts. Neither capability is activated by this extraction. The original combined path remains the baseline behavior.

## Regression and evidence notes

Focused tests in `tests/memory/h1ConversationHistory.test.mjs` cover recent/archive bounds, exact Unicode/punctuation and roles, current exclusion, interrupted speech, cross-session/character/world/timeline/avatar, privacy suppression/correction, source revalidation and integration-equivalence of history construction. The existing WS6 CI workflow is extended to include new syntax/contract tests *without removing or relaxing* its original tests or informational 10,000-write stress step. Strict recursive test discovery also found the baseline's original 10,000-write test unregistered alongside the new H1 test; the scoped H1-A inventory registration lists **both** rather than concealing an inherited test. All-profile verification still preserves its stress failure as an actual failure when selected; the dedicated WS6 CI step remains informational as before. Windows source-heartbeat starvation under unrealistic 10k-write load remains an inherited limitation; its existing stress receipt is informational. Record actual run outcomes in the PR rather than inferring green status.
