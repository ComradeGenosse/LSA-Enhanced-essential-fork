# EA Final Fix A — authenticated native protagonist intake handoff

**Branch:** `feature/ea-final-a-native-intake-20261011`  
**Immutable baseline:** PR #68, `4cad39198478d7f03bb8ec6657b674e52fa659dd`  
**Imported EA5 source:** PR #80, `0c817d40efe3660faa2d5c08eb06ab4c7a97b8dc`  
**M1 C-13 reference:** PR #52, `1ca219fd8b95ba2dbf2d1f8031d40fe93308a404`  
**Implementation commit:** `af40b578de960c7d51003ddbeca41c0209486cc6`

## Implemented

- Reused all 12 **exact EA5 blob objects** from PR #80: native source sensor, channel/integration, native project/test registration, protocol and adapter, dedicated EA5 Node tests and upstream handoff. Native story-player detection and opt-in/default-disabled semantics were not rewritten.
- `src/perception/contracts.mjs` recognizes the strict `protagonist_model` v1 frame only via the original frame envelope and the EA5 payload validator. Unknown frame types and all existing schema validation remain closed.
- `src/perception/shadowRuntime.mjs` admits the event after existing authenticated caller, hello, epoch/stream, exact monotonic sequence and native world rules. Source host/epoch mismatches fault/reset the whole native runtime. The event is never treated as a PS2 witness, ActorRef, action or Director proof.
- `src/perception/intelligenceClient.mjs` privately creates `createProtagonistAuthority`. Only an *accepted* actual socket hello mints an opaque per-socket token. A same-frame `ShadowRuntime.ingest` success **precedes** the sole private `acceptAuthenticatedFrame` call. Accepted sequence, epoch, stream and host are read from that runtime, never the event's self-asserted proof. Bad identity frames revoke and close. Disconnect, stop, timeout and actual world transition revoke.
- Backported M1's C-13 `subscribeVerifiedHostContext` and `subscribeWorldBoundary` against the newer PR #68 client, retaining its Director/PS2/PS3/EA owners. Notifications arise only from admitted hello/actual incrementing `world_epoch`. Null is delivered on disconnect, stop and runtime loss. No callback on duplicate/no-op or invalid epoch frame.
- Added `tests/ea-final-a-native-intake.test.mjs` for socket hello, ABA, unknown, read-only API, C-13 boundary, malformed/self-asserted/duplicate/gap/foreign-host frames and staleness.

## Explicit interface for Agent B — C-13 timeline bridge

```js
const unsubscribeContext=intelligenceClient.subscribeVerifiedHostContext(
  value => memoryStorage.setVerifiedHostContext(value)); // verified host context or null
const unsubscribeBoundary=intelligenceClient.subscribeWorldBoundary(
  boundary => memoryStorage.onBoundary({reason:boundary.reason}));
```

- `value` is the native `readHostContext(hello)`-validated `{hostRunId,worldEpoch,...}` context from **accepted transport**, or `null` after loss; never any protagonist payload.
- `boundary` is frozen `{reason,hostRunId,previousEpoch,worldEpoch}`, emitted only once for an accepted consecutive epoch increment. Its source is the old/current admitted native hello and accepted world-change event, not an arbitrary JSON callback.
- Hooks are bounded at 16 listeners per type, return unsubscribe functions, and catch listener errors. Subscribe before `start()`. Agent B owns P2 SQLite and player confirmation; callbacks alone do not authorize save writes.

## Explicit interface for Agent F — EA4 runtime and native registration

```js
const intelligenceClient=new IntelligenceClient(config.perception, options);
const protagonistAuthority=intelligenceClient.protagonistAuthority;
const moodRuntime=createMoodRuntime({getRuntime,protagonistAuthority});
const stream=intelligenceClient.getNativeStream(); // diagnostic/authority source only
```

- `protagonistAuthority` is a frozen **read-only** `{readVerified(),isCurrent(record)}` facade. A current known record is deeply frozen; unknown, disconnected, stale (1500 ms), changed native lineage, expired/host-replaced/ABA proof returns null or false.
- `getNativeStream()` is an immutable snapshot `{connected,authenticated,sessionToken,adapterEpoch,streamId,hostRunId,worldEpoch,lastSequence}`. A new opaque token is minted per admitted socket; it is not derived from the protagonist event. It reports unauthenticated during legacy/no-host hello, off mode, close, timeout or teardown.
- There is **no public protagonist ingress**. The adapter's `acceptAuthenticatedFrame` is private to `IntelligenceClient` and invoked after exact accepted v1 frame ordering.
- Native `IntelligenceIntegration(..., protagonistEvidenceEnabled:false)` retains the **default-disabled** producer. Agent F must explicitly enable the final optional constructor argument only after verifying the deployed companion receiver accepts this event, with an upgrade/rollback plan. No hello capability was added that would break legacy companions.
- Agent F owns `bootstrap.mjs`, `essentialGlue.mjs`, `runSequentialTurn.mjs`, M1 store initialization and EA4 playbacks. This branch deliberately does not wire or activate EA4 in live runtime.

## Test evidence, constraints and gates

- Exact imported EA5 Node 7/7 and Windows native SDK/ABI/owner/intelligence integration test evidence is in PR #80 and `docs/handoffs/EA5.md`, at its **earlier exact source commit**. This does **not** prove this new branch.
- New EA-A Node test cases are **source-committed**, not claimed as locally executed. The available GitHub integration workflow does not trigger for an EA-A PR targeting the PR #68 integration branch; the restricted connector cannot dispatch workflows. Native Windows CI and all existing PS2/PS3/Director/ABI suites require exact-head CI before this can be considered verified.
- PR #68 also contains a pre-existing EA4 syntax error in `tests/ea4-runtime-integration.test.mjs` reported by EA5; it is outside EA-A ownership. This must be fixed by its owner and exact-head rerun.
- GTA game-fiber receipts, companion packaged release, timeline confirmation, and any paid ElevenLabs delivery remain untested and **not authorized**. No merge to main, GTA modification or paid calls were performed.
