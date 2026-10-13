# EA118 R1 — Authenticated Native Protagonist Heartbeat Recovery Handoff

- Base: PR #118 / `4db9eeea534ddf90a1eb0a173c7b7167d363a784`.
- Workstream: R1.01–R1.10 from planning PR #124 (`bf7957510135f9956af8dc463a1b9be2f8d6cefa`).
- Branch: `fix/ea118-r1-protagonist-heartbeat-recovery-20261012`.
- Target: `integration/elevenlabs-emotional-acting-consolidated-20261012` (draft PR; not main).
- Last code-and-test change commit: `3be4f860d593196af24cc89f3bbaa54ed0a843af`. The documentation commit and final PR head are identified by GitHub's branch/PR metadata.

## Changed paths

1. `lsa-essential-e1-candidate/src/perception/protagonistAuthority.mjs`
2. `lsa-essential-e1-candidate/tests/ea118-protagonist-heartbeat-recovery.test.mjs` (new)
3. `lsa-essential-e1-candidate/tests/ea-final-a-native-intake.test.mjs`
4. `lsa-essential-e1-candidate/tests/ea7-emotional-continuity-completion.test.mjs`
5. This handoff file.

## Root cause, fix, boundaries

Prior `live()` called `drop()` on proof TTL expiry (>1500 ms), erasing the previous authenticated transport lineage while retaining `host/maxRevision`. A genuine unchanged-stream heartbeat at the same revision then failed the heartbeat predicate and `IntelligenceClient` could close the C-13 pipe.

The repair retains last authenticated stream/session/host/world/sequence and last *source-certified protagonist* through proof-only TTL expiry, while revoking `current`. Equal-revision heartbeat recovery requires the identical source stream, unchanged source protagonist, and a strictly greater independently accepted frame sequence. It mints an immutable **new** proof if the prior proof expired (even if no observer polled); fresh bounded heartbeat preserves proof identity. Malformed evidence, clock rollback, explicit revocation, source/session/host/world mismatch and replay retain fail-closed behavior and anti-ABA revision fencing.

No player emotional partition was added: native protagonist remains source authentication/provenance for the **same human player** across Franklin/Michael/Trevor. EA4 already pins each turn to a specific native proof reference, preventing delayed callbacks from committing after proof renewal; executable regression tests cover that and retained one-use soft mood. No native producer, capability negotiation, provider retry, default opt-in, Memory K, or GTA files changed.

## Reproduction and verification

Deterministic JavaScript regression file executed directly with the exact GitHub-fetched production protocol and authority sources in an isolated V8 harness (test assertions executed without a Node test runner):

| Source | Tests passed | Tests failed | Failures |
| --- | ---: | ---: | --- |
| Pinned baseline `4db9eeea` | 5 | 3 | R1.01 legitimate post-TTL heartbeat rejected; R1.03 expired proof object reused without intervening read; R1.06 native-clock regression accepted |
| Repaired authority `1dc07107` (included in final branch) | 8 | 0 | None |

The isolated harness executes the eight dedicated deterministic test cases (R1.01/02/03/04/05/06/09); it is **not** a replacement for the package's Node test runner. Additional socket-backed C-13 and EA4 mood integration regressions (R1.07/08/10) are committed, but must be verified with Node/CI before declaring those gates green.

### CI / real-system limits

- Full targeted Node test suites: pending external CI/test-run evidence; **not claimed as run** by the isolated harness.
- `npm test`, full EA0–EA9 acceptance, native pinned Windows ABI/package: not yet verified on this code head.
- Native GTA runtime, real physical source receipts, paid ElevenLabs audio, rollback rehearsal: **NOT PERFORMED**. Deployment: **NO GO**.
- Source-authenticated C-13 sequence validation and 60-second channel retirement are exercised by added socket fixtures; production GTA/native transport behavior remains unverified.
- Any CI failures must be repaired and rechecked before integration.

## Intentional deviations

- No modifications to native producers or negotiation: no evidence that they are defective.
- Additional clock-regression check on `acceptAuthenticatedFrame` itself: required to fail closed even if no intervening `readVerified()` call occurs.
- Dedicated regression file is added in addition to the planned existing tests to isolate the complex negative matrix.
