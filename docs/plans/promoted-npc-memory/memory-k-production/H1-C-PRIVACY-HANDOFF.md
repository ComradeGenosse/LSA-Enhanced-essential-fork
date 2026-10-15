# Memory K H1-C — privacy and regression handoff

**Review target:** H1-A PR #172, then the #138 Memory K integrator. H1-C draft PR #174 is not a deployable release.

## Boundary and severity

- **Moderate (localized, fixed):** outer journal arrays were frozen but each projected item remained mutable. Mutation after preparation could change model-visible bytes without changing the captured baseline journal seal. The flat items are now frozen too.
- **Moderate (localized, fixed):** an accepted row could change, or P2's source read-fence could advance, between awaited suppression/correction and dialogue reads during preparation. Preparation now rechecks the pinned fence and exact original accepted-row seal before declaring a ready result.
- **Moderate (localized, fixed):** replacing a turn's active profile/owner alias after preparation was not checked separately from its stored-profile and M2 current-owner checks. The current turn's character and owner alias must remain the one authenticated at open.
- **Integration authority requirement (H1-B; not a demonstrated exploit in original production):** `acceptedReceipt` is an internal D03-issued object, not a standalone bearer credential. H1-A's direct interface checks a durable P2 row, M2 current proof, source/host/scope/text and the receipt's record ID; it does *not* cryptographically authenticate arbitrary receipt-like objects submitted by an untrusted caller. H1-B must wire **only** the original D03 accepted receipt and may not generate one from player text, STT partials or an arbitrary P2 row. If future external callers can supply receipts, provenance verification needs a separate explicitly scoped decision before activation.

## Required H1-B ordering

1. Accept the original D03 receipt only after real original accepted typed/STT input has been durably recorded. Retain the authentic owner/world/timeline proof.
2. Use `prepareH1ConversationHistory()` (or the already opened H1 source's `prepare()` after durable commands), never another history reader, no M4/M5/M8 requirement for standalone H1.
3. Project optional H1 into the PS4 immutable frame, without any RAM fallback on denial.
4. **Before every provider attempt and again at the actual provider submission boundary**, `await verifyPrepared()`. Immediately after the final awaited check, require `sendCurrent()` synchronously when submitting. Never cache `true` across retries.
5. On **any** failed check, prune/discard all stale H1 content from the outgoing frame and use only explicitly authorized current input. Do not submit a frame whose journal was prepared before forget, correction, reconnect, owner retirement, timeline change or source-generation change.
6. No H1 activation controls are implemented by H1-C; shared-runtime corrections belong to H1-B or the #138 integrator.

## Test receipts and limitations

- Added `h1ConversationHistoryHardening.test.mjs`: real original P2 SQLite, original M2 journal recorder and original M5 privacy services; D03/native proof is simulated at the protocol boundary. It covers exact Unicode, scoping, negative receipt values, immutability, archived/recent deletion and restart, STT correction, async read race, revalidation failure/retry, avatar continuity, and owner-projection retirement.
- One parity test directly imports original `assembleJournalConversation` from **exact #138 commit** `3f4138d6f108ae6feda6d03ed54ac7c5e4e9c04a` and compares matching SQLite-backed inputs against extracted H1. It is only enabled when `H1C_ORIGINAL_138_PATH` points to that original checkout.
- Two-OS workflow `memory-k-h1c-privacy.yml` asserts three original regression tests are byte-for-byte unchanged, separately runs the new H1-C suite (including original parity), and runs identical original WS6 suites on baseline and candidate with raw logs archived. Candidate-only tests are not sent to the original revision.
- **Validation status must be read from Actions for the exact H1-C head.** Queued/pending workflows are not successes. Inherited, environmental and newly introduced failures must remain failures in receipts. The previously accepted 10,000-write Windows heartbeat overload is unchanged, outside this gameplay-focused suite and not reclassified as passing.
- No physical GTA, native packaging, streaming latency soak, or release acceptance was attempted. Do not merge or deploy H1-C automatically.

## Completion gate

H1-C can be marked independently complete only after the new suite and original parity pass on Windows/Linux, no newly introduced original regression is found, and H1-B verifies the D03-origin, final-send and retry boundary requirements above.
