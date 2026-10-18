// These are verification selections, NOT production activation presets.
const e1 = 'lsa-essential-e1-candidate/tests/';
const shared = 'lsa-shared-brain/tests/';
export const profiles = Object.freeze({
  inspector:{tier:'focused-inspector',files:[`${e1}memory-i2-inspector.test.mjs`,`${e1}memory/i2PauseForeground.test.mjs`],
    coverage:['authenticated P2 inspection/privacy','I1/H1/H2/M6/M7/M8 off','restart-only settings','live pause and stale request revocation'],
    limits:'Offline local administration tests; no physical GTA validation.'},
  'inspector-regression':{tier:'inspector-source-foreground-regression',files:[
    `${e1}p2-editor.test.mjs`,`${e1}memory-k-source-consumers.test.mjs`,
    `${e1}memory/d01OpenAIAcceptance.test.mjs`,`${e1}memory/d03OriginalDialogueJoin.test.mjs`,
    `${e1}memory/h1IndependentActivation.test.mjs`,`${e1}memory/h1ConversationHistory.test.mjs`,
    `${e1}memory/h1ConversationHistoryHardening.test.mjs`,`${e1}memory/h2ForegroundActivation.test.mjs`,
    `${e1}memory/h2FactualRecall.test.mjs`,`${e1}memory/h2RealAuthority.test.mjs`,`${e1}memory/h2Latency.test.mjs`,
    `${e1}m3-ws5b-production.test.mjs`,
  ],coverage:['original authenticated source/capture','existing local editor','unchanged H1/H2 behavior','M3 event/coverage'],
    limits:'Separate unchanged regression selection; privacy/recovery suite and native/package/GTA gates are independent.'},
  policy: {tier:'focused-policy', files:[`${e1}memory-capability-policy.test.mjs`],
    coverage:['off intent', 'dependency failures', 'sibling policy isolation'],
    limits:'No operational switch is certified by policy tests.'},
  storage: {tier:'focused-storage', files:[
    `${e1}m1-sqlite-foundation.test.mjs`, `${e1}m1-shared-memory-parity.test.mjs`,
    `${e1}m1-source-write-gate.test.mjs`, `${e1}m1-world-epoch-bridge.test.mjs`,
    `${shared}memory-k-ws4b-durability.test.mjs`, `${shared}memory-k-ws4b-review.test.mjs`,
    `${shared}memory-integrated-storage.test.mjs`, `${shared}memory-k-production-w04-sqlite.test.mjs`,
  ], coverage:['positive SQLite', 'restart/recovery', 'dependency/source failures'],
    limits:'Does not certify storage-only consumer isolation; E1 must add production tests.'},
  source: {tier:'focused-source', files:[
    `${e1}memory/d01OpenAIAcceptance.test.mjs`, `${e1}memory/d03OriginalDialogueJoin.test.mjs`,
    `${e1}memory/nativeCurrentOwnerAuthenticatedIntake.test.mjs`,
    `${e1}m3-ws5b-production.test.mjs`, `${e1}m3-ws5b-stress.test.mjs`,
  ], coverage:['positive authenticated capture', 'negative authority', 'source races'],
    limits:'Offline source proofs are not physical native or GTA acceptance.'},
  'original-scenarios': {tier:'original-runner-gate', select:file => /\/memory-k-original-S\d\d\.test\.mjs$/.test(file),
    limits:'Required source-blocked scenarios fail honestly; no expected-failure conversion.'},
  shared: {tier:'shared-unit-integration', select:file => file.startsWith(shared)},
  essential: {tier:'essential-unit-integration', select:file => file.startsWith(e1)},
  'essential-nested': {tier:'essential-memory-unit-integration', select:file => file.startsWith(`${e1}memory/`)},
  infrastructure: {tier:'verification-infrastructure', select:file => file.startsWith('tools/memory-k-verification/tests/')},
  all: {tier:'all-source-tests', select:() => true,
    limits:'Includes original red gates. Native build, package, physical GTA and soak remain separate.'},
});

export function selectProfile(name, files) {
  const profile = profiles[name];
  if (!profile) throw new Error(`Unknown verification profile: ${name}`);
  const selected = profile.files ?? files.filter(profile.select);
  if (!selected.length) throw new Error(`Empty verification profile: ${name}`);
  for (const file of selected) if (!files.includes(file)) throw new Error(`Missing profile test: ${file}`);
  return {profile, files:[...selected].sort()};
}
