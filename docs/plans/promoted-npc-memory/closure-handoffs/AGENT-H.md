# Agent H — M7 consented Luna off-turn closure handoff

**Repository:** \`ComradeGenosse/LSA-Enhanced-essential-fork\`  
**Pinned parent:** draft PR #75, \`8443a8adec9433626902b46b81bd3e58fc382fb2\` (NOT main).  
**Feature branch:** \`feature/m7-closure-h-consented-curation-20261011\`.  
**PR:** #86, targeting \`integration/memory-completion-h-review-20261011\`; DO NOT MERGE.  
**Exact implementation/test SHA before this documentation commit:** \`b5cd20caf342a1565c01accad7f7a74bd74b4f04\`. The handoff itself is a subsequent commit; its own SHA cannot be embedded in its content. The PR head metadata is authoritative for the final full-tree SHA.

## Scope actually implemented

Changed only H-owned M7 files:
1. \`lsa-shared-brain/src/memory/m7Consent.mjs\` **new**: fail-closed consent validation, operator-verified price/model contract, short-lived native owner/idle proof validator.
2. \`lsa-shared-brain/src/memory/idleCurationScheduler.mjs\`: one bounded optional off-turn worker; explicit consent, authenticated synchronous native idle+selected promoted owner proof, timely mic/player/Director and native lifetime cancellation, busy/same-store exclusions, no timer when off/shadow, no work on import; conservative reboot reservation reconciliation before claims.
3. \`lsa-shared-brain/src/memory/lunaCurator.mjs\`: strict production cost-estimator requirement BEFORE claim, strict committed CAS acknowledgment, over-budget provider cost reporting and no false cheap settlement, retains typed source/evidence boundaries.
4. \`lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs\`: existing Essential \`requestJson\` transport ONLY, lazy provider use, complete cost-estimator forwarding, verified exact Luna pricing requirement, explicit disclosure and durable P2 budget attestation.
5. \`lsa-shared-brain/tests/memory-m7-completion.test.mjs\`: extends real SQLite and mock-provider offline coverage with consent, idle authority, cancellation, retry/uncertainty, deterministic outage retrieval and pricing defenses.

**No edits** to \`curationSqlite.mjs\`, existing P2 migrations, central bootstrap/config, M6/PS4/PS6, or native code. No new database/daemon, local LLM, GPU worker or paid calls. M7 only adds subjective appraisals under immutable evidence IDs; existing M6 facts do not depend on it.

## Integrator K API contracts (MUST connect; otherwise remain OFF)

### 1. Explicit consent & exact cost configuration

\`\`\`js
import {validateM7Consent,validateM7Pricing} from
  'lsa-shared-brain/src/memory/m7Consent.mjs';

const consent = validateM7Consent({
  mode: 'experimental', // or 'off' / 'shadow', default OFF
  cloudOptIn: true,
  consentSource: 'explicit_player_settings',
  offTurnEvidenceUploadAccepted: true,
  consentedAtUtc: '<trusted persisted ISO UTC>',
  dailyUsd: 0.20, monthlyUsd: 2.00, maxBatchUsd: 0.02
}); // example values ONLY, NOT suggested defaults

const existingLunaConfig = {
  provider: 'openai',
  reasoningModel: '<existing configured Luna model>',
  reasoningBaseUrl: '<existing HTTPS OpenAI Responses endpoint>',
  reasoningKey: '<existing credential, do not log>',
  curatorMaxOutputTokens: 1200,
  curatorPricing: {
    model: '<MUST equal reasoningModel>',
    source: 'operator_verified',
    verifiedAtUtc: '<ISO UTC verification receipt>',
    inputUsdPerMillionTokens: '<trusted positive NUMBER>',
    outputUsdPerMillionTokens: '<trusted positive NUMBER>'
  }
};
\`\`\`

K must source user consent from a **real persisted, explicit** cloud evidence-upload+cost UX. A provider key, config flag, mode toggle, game dialogue, or generic TTS consent is NOT sufficient. Do not hard-code the example caps or infer Luna prices. \`setMode('experimental', {optIn:true})\` intentionally fails; use \`scheduler.setConsent(validatedConsent)\` after an actual settings action. Off/shadow perform zero queue claims/reservations/provider calls.

### 2. Native authenticated idle owner API

\`\`\`js
const nativeIdle = {
  snapshot() {
    return {
      kind: 'verified_native_idle_v1',
      nativeVerified: true, // established by AUTHENTIC native evidence, never guessed
      observedAtUtc: '<fresh source receipt ISO UTC, <= 3s old>',
      hostRunId: '<UUID>', worldEpoch: 1, sessionId: '<UUID>',
      incarnationId: '<UUID>', encounterId: '<UUID>', observerIndex: 0,
      characterId: '<P2 current promoted CharacterId UUID>',
      worldProfileId: '<current P2 WorldProfileId UUID>',
      timelineId: '<current P2 active TimelineId UUID>',
      idle: true, idleForMs: 3000,
      micActive: false, playerSpeechActive: false, directorBusy: false,
      gamePaused: false
    };
  },
  subscribeInvalidation(fn) {
    // Subscribe SYNCHRONOUSLY to mic start, player turn/stock speech start,
    // PS6 Director activity, owner loss/switch, host run, world epoch,
    // encounter/incarnation, game session, timeline/save change, pause.
    // CALL fn() immediately on any invalidation. Always return unsubscribe.
    return () => {};
  }
};
\`\`\`

This is an **adapter contract**, not proof that the pinned GTA-native owner already exports these verified fields. K/A must construct and audit the real authentication/selection mapping. The current PR #75 lacks that source producer: do not fake a \`nativeVerified\` bit or infer identity/protagonist from actor metadata/proximity. Idle is source-certified, not absence of chat. The same proof is re-read at each awaited boundary and before P2 completion; activity subscription aborts the in-flight provider. The store also provides \`worldProfileId\`, \`activeTimelineId\`, \`timelineWritable\`, \`verifiedHostContext\` and synchronous \`get(characterId)\`.

K must NOT call \`checkpoint()\` on a player-turn path, and must NOT enable curation through an M9 cue, PS3 observation, or bypass of stock player/Director priority. \`start()\` is optional and starts only when consented experimental; it uses one bounded unref'd idle timer. \`notifyActivity()\` is a secondary explicit fail-safe; do not substitute it for the native subscription.

### 3. One P2-owned durable adapter, plus Agent B port

\`\`\`js
import {createDurableCurationAdapters} from
  'lsa-shared-brain/src/memory/integrationPorts.mjs';
import {createEssentialM7Scheduler} from
  'lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs';

const {queue,ledger:baseLedger}=createDurableCurationAdapters(store,{
  dailyUsd:consent.dailyUsd,monthlyUsd:consent.monthlyUsd
});
const ledger=Object.freeze({
  ...baseLedger,
  budgetLimits:Object.freeze({dailyUsd:consent.dailyUsd,monthlyUsd:consent.monthlyUsd}),
  reconcile:({beforeUtc,worldProfileId}) =>
    store.reconcileCurationBudget({beforeUtc,worldProfileId})
});
const scheduler=createEssentialM7Scheduler({
  config:existingLunaConfig,store,queue,ledger,consent,nativeIdle,
  ownerId:'<stable scheduler-run UUID>'
});
// On explicit host lifecycle startup ONLY after native provider and P2 scope
// verified: scheduler.start(); optional scheduler.checkpoint() at idle event.
// On exit/owner transition: scheduler.notifyActivity(); await scheduler.stop().
\`\`\`

The \`store.reconcileCurationBudget\` shown above **does not exist yet in the pinned P2 public port**. Agent **B** owns adding it under the P2 serialized transaction gate around existing \`reconcileCurationBudgets(db,{beforeUtc,worldProfileId})\`. It must settle **uncertain expired reservations at the full reserved maximum**, never silently refund them. K owns adapter composition, persistence and activation, and must serialize reconciliation with all other worker instances for the same P2 world.

Existing \`queue.claimDue\` leases are SQLite CAS, max 4, one promoted CharacterId per batch; stale lease cannot commit, expired leases are recovered on restart. Existing \`retryLeased\` retains retries, Retry-After and dead letters; all queue and budget writes must stay behind the same source-fenced P2 connection. For stronger native-epoch fencing, B/K must re-check actual session/owner/world/timeline inside the **same P2 write transaction as \`completeLeased\`**, since H's asynchronous preflight alone cannot prevent a host transition during a DB await. Unavailable native proof => no transport.

### 4. Completion, opinion and out-of-scope hooks

- \`createEssentialLunaCurator(config,{fetchImpl})\` returns \`curateBatch\` and \`estimateMaxCostUsd\`, using existing Essential OpenAI Responses \`requestJson\`; it does not call the network on creation.
- \`createEssentialM7Scheduler({config,store,queue,ledger,consent,nativeIdle,...})\` returns \`setConsent\`, \`checkpoint\`, \`start\`, \`cancel\`, \`notifyActivity\`, \`stop\` and read-only \`mode/running/busy\`.
- \`validateLunaAppraisal\` returns an appraisal of an immutable deterministic proposal; only \`candidate/notability/inCharacterTake\` can be accepted as modeled opinion. \`curationSqlite.readCurationAppraisals\` keeps \`epistemicStatus:'character_opinion'\`, \`verifiedWorldFact:false\`, and source IDs; K/I must avoid blending that text into source-fact authority or a second PS4 frame.
- \`cost_overrun\` or \`settlement_pending\` suspends this scheduler's further paid work. The existing SQL ledger conservatively settles at reserved max, **not necessarily actual invoice**. B/K should add a durable audit/administrative hold for a real overrun or failed settlement before activation; never report a ceiling as confirmed billed spend.
- All memory ingestion and deterministic M6 recall remain independent of M7. The single PS4 frame is solely K/E's integration responsibility.

## Offline tests and honest result record

Commands exercised by existing GitHub CI definitions (no real paid transport):

\`\`\`sh
node --check lsa-shared-brain/src/memory/m7Consent.mjs
node --check lsa-shared-brain/src/memory/idleCurationScheduler.mjs
node --check lsa-shared-brain/src/memory/lunaCurator.mjs
node --check lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs
node --test lsa-shared-brain/tests/memory-m7-completion.test.mjs \
  lsa-essential-e1-candidate/tests/memory-agent-e.test.mjs \
  lsa-shared-brain/tests/memory-integrated-storage.test.mjs
\`\`\`

**Status at initial handoff creation:** PR #86 GitHub \`M7 Completion Offline\`, combined \`Memory H\`, and other memory checks were **queued** at exact source/test SHA \`b5cd20caf342a1565c01accad7f7a74bd74b4f04\`. No successful Node invocation or exact-head CI receipt has yet been observed. There is no local repository clone in the agent environment. Do not label queued workflows passed. K should inspect exact PR #86 head workflow jobs/logs, including Windows/Ubuntu Node22/24, and rerun after integrating B's port.

New adversarial fixture coverage: consent missing/disputed; missing pricing/model mismatch; source proof stale/unknown/cross-NPC; no paid work off/shadow; delayed provider completion after mic cancellation; concurrent checkpoint blocked; session/incarnation/encounter/epoch/timeline changes during provider await; durable budget rejection; failure followed by original deterministic permanent memory read; orphaned budget reconciliation and cost overrun hold; Essential cost ceiling stopping mock fetch before reservation. Earlier original M7 tests cover SQLite expired lease double-claim, max attempt/dead-letter, 429 Retry-After and source-forgetting fences. All tests are offline mocks or Node SQLite; the fake cloud provider has **no paid endpoint calls**.

## Blockers / NO-GO

1. Pinned native host does not yet furnish the real authenticated idle+owner/priority proof required above. Fixture \`nativeVerified:true\` is not game-world proof.
2. No complete persisted player cloud-evidence consent and model-price attestation UI exists in PR #75. Remain dormant OFF.
3. Agent B/K P2 reconciliation public method, budget caps attestation and transactional native write-time fencing have not yet been integrated; do not spoof their presence.
4. No real provider pricing/usage/invoice, real paid request, controlled GTA physical acceptance, or four-hour/three-NPC soak was performed.
5. M4's sole PS4 knowledge frame and M8 opinion/relationship integration remain K/E/I-owned; M7 alone does not make NPC memory end-to-end playable.

**Decision: GO for offline review only; NO-GO for GTA install, paid opt-in, merge to main or claimed source acceptance.**
