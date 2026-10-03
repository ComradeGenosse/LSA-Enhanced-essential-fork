// Offline characterization against unchanged main modules and patched stock
// session creation/close/bind code. Provider HTTP and native playback are doubles.
// No API keys, game I/O, private records, or dialogue are logged.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { stockHarness } from '../../../lsa-essential-e1-candidate/tests/stock-harness.mjs';
import { actorVoiceTraits } from '../../../lsa-essential-e1-candidate/src/voice/actorVoiceTraits.mjs';

assert.equal(actorVoiceTraits({ ageRange: 'old' }).ageBand, 'older');
const config = {
  speechVoices: ['nova', 'shimmer', 'ash', 'onyx'],
  voiceAssignment: 'character-aware-session', actingEnabled: true,
  speechVoiceProfiles: {
    nova: { genders: ['female'], ageBands: ['young', 'adult'] },
    shimmer: { genders: ['female'], ageBands: ['mature', 'older', 'senior'] },
    ash: { genders: ['male'], ageBands: ['young', 'adult'] },
    onyx: { genders: ['male'], ageBands: ['mature', 'older', 'senior'] },
  },
  retry: { baseDelayMs: 1, maxDelayMs: 1 },
};
const rows = [];
const concise = p => ({ profileId: p.profileId, voice: p.voice, gender: p.gender, ageBand: p.ageBand, matchReason: p.matchReason, selectionMode: p.selectionMode });

async function setup(configOverride = config) {
  const assigned = [], tts = [];
  let retryNextSpeech = false, releaseModel = null, modelStarted = null;
  let modelGate = null;
  const h = await stockHarness('openai', {
    config: configOverride, env: { OPENAI_API_KEY: 'offline-placeholder' },
    fetchImpl: async (url, options) => {
      if (url.endsWith('/responses')) {
        modelStarted?.();
        if (modelGate) await modelGate;
        return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ dialogue: 'Probe reply.', command: '' }) }] }] }), { status: 200 });
      }
      if (url.endsWith('/audio/speech')) {
        const body = JSON.parse(options.body);
        tts.push({ voice: body.voice, model: body.model });
        if (retryNextSpeech) {
          retryNextSpeech = false;
          return new Response(JSON.stringify({ error: { type: 'server_error' } }), { status: 503 });
        }
        return new Response(Uint8Array.from([0, 0, 1, 0]), { status: 200 });
      }
      throw new Error('Network denied: unexpected provider endpoint');
    },
  });
  const resolve = h.runtime.voiceResolver.resolve.bind(h.runtime.voiceResolver);
  h.runtime.voiceResolver.resolve = (id, actor) => {
    const profile = resolve(id, actor);
    assigned.push({ pedId: id.pedId, sessionNonce: id.sessionNonce, core: { gender: actor.gender, ageRange: actor.ageRange }, profile });
    return profile;
  };
  // Retain real Zi, WP, Ei, zP, qK, pd, Ed and Xn. Only unrelated prompt
  // presentation, Gemini voice selection, diagnostics and retired-turn sweeping
  // are replaced. Every turn is settled before forceNew invokes real Ei.
  h.context.probeTransport = h.runtime.createTransport(() => { throw new Error('Gemini forbidden'); });
  h.evaluate(`
    A.sessionOpenPromisesByPedId = new Map(); A.sessionMetadataByPedId = new Map();
    var DK = false; ct = () => {}; Gr = () => {}; fd = () => {};
    BK = () => 'Synthetic offline investigation prompt'; GK = () => 'unused-gemini-voice';
    kK = () => probeTransport; Ur = () => false;
  `);
  h.context.ack = message => {
    if (message.type === 'npcAudioTurnStart') queueMicrotask(() => h.context.by({ ...message, type: 'npcAudioTurnAccepted' }));
    if (message.type === 'npcAudioStreamEnded') queueMicrotask(() => h.context.by({ ...message, type: 'npcPlaybackEnded', reason: 'completed', hadAudio: true, playbackStarted: true, wasInterrupted: false }));
  };
  h.evaluate('Qt = (_, message) => { sent.push(message); ack(message); return 1; }');
  async function session(actor, forceNew = false) {
    h.context.probeActor = actor; h.context.probeForceNew = forceNew;
    return h.evaluate('Zi({ pedId: probeActor.pedId, actorContext: probeActor, forceNew: probeForceNew })');
  }
  async function begin(s) {
    h.context.probeSession = s;
    const turn = h.evaluate('var probeTurn = le.createTurn({ pedId: probeSession.pedId, source: Ht.PLAYER_TEXT }); Xn(probeTurn.id, { sessionRecord: probeSession }); probeTurn');
    return { pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: s.nonce };
  }
  async function launch(s, id) {
    await s.connection.sendText('Synthetic input');
    const result = await s.connection.whenSettled(id);
    assert.equal(result.status, 'completed');
    return result;
  }
  return { h, assigned, tts, session, begin, launch, retrySpeech: () => { retryNextSpeech = true; },
    holdModel() {
      modelGate = new Promise(resolve => { releaseModel = resolve; });
      const started = new Promise(resolve => { modelStarted = resolve; });
      return { started, release() { releaseModel(); modelGate = null; } };
    } };
}

// A: native helper output for nonconventional addon name, through real stock ia
// normalization. Use the shipped bridge's identity shape (no gender member).
{
  const p = await setup();
  const core = { pedId: '17', pedModel: 'custom', gender: 'unknown', ageRange: 'unknown' };
  p.h.context.rawProbeActor = { ...core, exists: true, integrations: { policingRedefined: { detected: true, identity: { modelAge: 'SYNTHETIC_CATEGORY', birthday: '01/01/1990', fullName: 'SYNTHETIC_PRIVATE_SENTINEL' } } } };
  const actor = p.h.evaluate('ia(rawProbeActor, "speaker")');
  assert.equal(actor.gender, 'unknown'); assert.equal(actor.ageRange, 'unknown');
  const s = await p.session(actor);
  const first = await p.begin(s);
  const profile = p.assigned[0].profile;
  assert.deepEqual(profile, p.h.runtime.voiceResolver.resolve(first, core));
  // The explicit counterfactual resolve above is not a connection assignment.
  const count = p.assigned.length;
  assert.equal(JSON.stringify(profile).includes('SYNTHETIC_PRIVATE_SENTINEL'), false);
  await p.launch(s, first);
  const second = await p.begin(s); await p.launch(s, second);
  assert.equal(p.assigned.length, count);
  assert.ok(p.tts.every(t => t.voice === profile.voice));
  rows.push({ case: 'A_unknown_custom', pedId: first.pedId, sessionNonce: first.sessionNonce, profile: concise(profile), completedTurns: 2, connectionAssignments: 1, integrationIdentityIgnored: true, tts: p.tts });
  s.connection.close();
}

// Counterexample to a universal "private integration gender is ignored" claim:
// hO accepts nonempty identity.gender, and EO/Ev flatten it into core gender.
// The inspected shipped bridge omits it; this is a supported-schema fixture,
// not a claim that a real PR record emitted it during this audit.
{
  const p = await setup();
  const raw = { pedId: '17', exists: true, pedModel: 'custom', gender: 'unknown', ageRange: 'unknown', integrations: { policingRedefined: { detected: true, identity: { gender: 'female' } } } };
  p.h.context.rawProbeActor = raw;
  const normalized = p.h.evaluate('ia(rawProbeActor, "speaker")');
  assert.equal(raw.gender, 'unknown'); assert.equal(normalized.gender, 'female');
  const s = await p.session(normalized), id = await p.begin(s), assigned = p.assigned[0].profile;
  assert.equal(assigned.gender, 'female');
  const withoutIdentity = p.h.runtime.voiceResolver.resolve(id, raw);
  assert.equal(withoutIdentity.gender, 'unknown');
  assert.notEqual(assigned.voice, withoutIdentity.voice);
  const paired = { ...raw, gender: 'male', ageRange: 'old', integrations: { fixtureAddon: { gender: 'female', ageRange: 'young' } } };
  p.h.context.rawProbeActor = paired;
  const beforeGuard = p.h.evaluate('ia(rawProbeActor, "speaker")');
  assert.equal(beforeGuard.gender, 'female'); assert.equal(beforeGuard.ageRange, 'young');
  // Validate the separately proposed guard using the same unmodified stock
  // normalizer plus a VM-only wrapper. Do not patch production or the build.
  p.h.evaluate('var originalPrivateMergeExclusion = _O; _O = t => (globalThis.__LSA_E1_RUNTIME.config.provider === "openai" && (t === "gender" || t === "ageRange")) || originalPrivateMergeExclusion(t)');
  const protectedPair = p.h.evaluate('ia(rawProbeActor, "speaker")');
  assert.equal(protectedPair.gender, 'male'); assert.equal(protectedPair.ageRange, 'old');
  p.h.context.rawProbeActor = raw;
  const guarded = p.h.evaluate('ia(rawProbeActor, "speaker")');
  assert.equal(guarded.gender, 'unknown');
  rows.push({ case: 'A_supported_schema_private_gender_counterexample', scope: 'Synthetic accepted schema; inspected bridge does not emit identity.gender', nativeGender: raw.gender, normalizedGender: normalized.gender, assignedProfile: concise(assigned), directCoreProfile: concise(withoutIdentity), proposedGuardPreservesCore: true, additionalSyntheticAddonGuard: { native: { gender: paired.gender, ageRange: paired.ageRange }, before: { gender: beforeGuard.gender, ageRange: beforeGuard.ageRange }, guarded: { gender: protectedPair.gender, ageRange: protectedPair.ageRange } } });
  s.connection.close();
}

// B: PR arrives after beginTurn, while reasoning is held. Real qK refreshes the
// connection, then a later turn uses that session without reassigning its voice.
{
  const p = await setup();
  const raw = { pedId: '18', exists: true, gender: 'female', ageRange: 'old', archetypeDescription: 'Synthetic description', integrations: { policingRedefined: { recordStatus: 'pending' } } };
  p.h.context.rawProbeActor = raw;
  const actor = p.h.evaluate('ia(rawProbeActor, "speaker")');
  // Pinned native serializer omits the model and archetype fields while
  // retaining their descriptions. Confirm stock defaults at this boundary.
  assert.equal(actor.pedModel, 'unknown'); assert.equal(actor.archetype, 'unknown');
  assert.equal(actor.personaDescription, 'Synthetic description');
  const s = await p.session(actor), id = await p.begin(s), profile = p.assigned[0].profile;
  const gate = p.holdModel();
  const completing = p.launch(s, id); await gate.started;
  p.h.context.rawProbeActor = { ...raw, integrations: { policingRedefined: { recordStatus: 'ready', identity: { modelAge: 'SYNTHETIC_CATEGORY', birthday: '01/01/2000' } } } };
  const later = p.h.evaluate('ia(rawProbeActor, "speaker")');
  const refreshed = await p.session(later);
  assert.equal(refreshed, s); assert.equal(s.actorContext.integrations.policingRedefined.recordStatus, 'ready');
  gate.release(); await completing;
  const next = await p.begin(s); await p.launch(s, next);
  assert.equal(p.assigned.length, 1); assert.equal(profile.gender, 'female'); assert.equal(profile.ageBand, 'older');
  assert.ok(p.tts.every(t => t.voice === profile.voice));
  rows.push({ case: 'B_delayed_optional_PR', pedId: id.pedId, sessionNonce: id.sessionNonce, coreAtBeginTurn: p.assigned[0].core, profile: concise(profile), prAtAssignment: 'pending', prAtNextTurn: 'ready', refreshedConnectionReused: true, connectionAssignments: 1, tts: p.tts });
  s.connection.close();
}

// B disabled/unavailable: real normalizer with no PR block and no native wait.
{
  const p = await setup();
  p.h.context.rawProbeActor = { pedId: '18', exists: true, gender: 'female', ageRange: 'old' };
  const actor = p.h.evaluate('ia(rawProbeActor, "speaker")');
  const s = await p.session(actor), id = await p.begin(s);
  await p.launch(s, id);
  assert.equal(p.assigned.length, 1); assert.equal(p.assigned[0].profile.ageBand, 'older');
  rows.push({ case: 'B_optional_PR_omitted', coreAtBeginTurn: p.assigned[0].core, profile: concise(p.assigned[0].profile), completedTurns: 1, connectionAssignments: 1 });
  s.connection.close();
}

// C: use real stock forceNew path. Ei advances the nonce, and WP advances it
// again. Retry HTTP 503 before PCM on the old connection; do not fake a reroll.
{
  const p = await setup();
  const actor = { pedId: '17', pedModel: 'custom', gender: 'unknown', ageRange: 'unknown' };
  const s = await p.session(actor), oldId = await p.begin(s), old = p.assigned[0].profile;
  p.retrySpeech(); await p.launch(s, oldId);
  assert.equal(p.tts.length, 2); assert.equal(p.tts[0].voice, p.tts[1].voice);
  const fresh = await p.session(actor, true);
  assert.notEqual(fresh.nonce, s.nonce); assert.equal(s.connection.closed, true);
  const freshId = await p.begin(fresh); await p.launch(fresh, freshId);
  const newer = p.assigned.at(-1).profile;
  assert.notEqual(old.profileId, newer.profileId);
  assert.equal(p.assigned.length, 2);
  p.h.context.staleId = oldId;
  assert.equal(await p.h.evaluate('by({ ...staleId, type: "npcAudioTurnAccepted" })'), false);
  rows.push({ case: 'C_stock_force_new_session', pedId: oldId.pedId, oldSessionNonce: s.nonce, newSessionNonce: fresh.nonce, oldProfile: concise(old), newProfile: concise(newer), recoveryReason: s.closeReason, retryVoices: p.tts.slice(0, 2), voiceChanged: old.voice !== newer.voice, staleNativeEventRejected: true });
  fresh.connection.close();
}

// Default configuration is a singleton pool: replacement changes profileId but
// cannot change the voice. This bounds the multi-voice result above.
{
  const p = await setup({});
  const actor = { pedId: '17', gender: 'unknown', ageRange: 'unknown' };
  const s = await p.session(actor), id = await p.begin(s); await p.launch(s, id);
  const fresh = await p.session(actor, true), newId = await p.begin(fresh); await p.launch(fresh, newId);
  assert.equal(p.assigned[0].profile.voice, p.assigned[1].profile.voice);
  rows.push({ case: 'C_default_singleton', oldSessionNonce: s.nonce, newSessionNonce: fresh.nonce, oldProfile: concise(p.assigned[0].profile), newProfile: concise(p.assigned[1].profile), voiceChanged: false });
  fresh.connection.close();
}

const report = { scope: 'Offline main code; synthetic optional PR refresh, stub provider HTTP and native playback acknowledgements; no GTA, actual PR delay, real API or audible playback.', baselineAgeOld: 'older', config, results: rows, status: 'passed' };
const output = process.argv[2];
if (!output) throw new Error('Usage: node openai-edges.mjs <output.json>');
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: 'passed', cases: rows.length, results: rows.map(r => ({ case: r.case, voiceChanged: r.voiceChanged, profile: r.profile, oldSessionNonce: r.oldSessionNonce, newSessionNonce: r.newSessionNonce })) }));
