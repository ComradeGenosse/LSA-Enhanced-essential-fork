import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { validateObservation } from '../src/perception/contracts.mjs';
import { resolveDelivery, SCENE_DELIVERY_BOUNDS } from '../src/voice/emotion/sceneDelivery.mjs';

const freeze = value => {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
};
const uuid = () => randomUUID();
function actor() {
  return freeze({
    characterId: uuid(), observerCaptureRef: uuid(), incarnationId: uuid(),
    ownerProofRevision: 1, hostRunId: uuid(), worldEpoch: 2,
    nativeRun: uuid(), pedId: '1a', sessionNonce: 5,
    turnId: 'turn-2', generationId: 3, timelineId: uuid(),
  });
}
const CONFIG = freeze({ mode: 'experimental', intensity: 'normal', maxTaggedSegmentsPerTurn: 2 });
function observation(identity, {
  type = 'firing_burst', kind = 'firing', channel = 'auditory',
  basis = channel === 'auditory' ? 'audibility_model' : channel === 'self' ? 'native_callback' :
    channel === 'report' ? 'dialogue_report' : 'sampled_state',
  certainty = 'supported', observer = identity.observerCaptureRef,
  nativeRun = identity.nativeRun, tick = 810, severity = 'danger',
  expiresAt = 100000, target, source, details,
} = {}) {
  const claim = {
    claimId: uuid(), kind, certainty,
    evidence: {
      channel, basis, sampledGameTick: tick,
      ...(channel === 'report' ? { reportRef: uuid() } : {}),
    },
    ...(target ? { target: { captureRef: target, kind: 'ped' } } : {}),
    ...(source ? { source: { captureRef: source, kind: 'ped' } } : {}),
    ...(details === false ? {} : {
      details: details || { eventSignalId: uuid(), reason: 'tested_receipt' },
    }),
  };
  return {
    version: 1, observationId: uuid(), episodeId: uuid(), revision: 1,
    observer: { captureRef: observer, kind: 'ped' },
    observedAt: { nativeRun, gameTick: tick, receivedUtc: '2026-10-11T22:05:00.000Z' },
    expiresAtMonotonicMs: expiresAt, eventType: type, severity,
    claims: [claim], recognizedCharacterIds: [],
  };
}
function projection(identity, observations = [], overrides = {}) {
  return freeze({
    verifiedOwner: true, lifetimeCurrent: true, channelHealthy: true,
    identity: { ...identity },
    observations: observations.map(item => {
      const entry = item?.observation ? item : { observation: item, observedAtMonotonicMs: 9000 };
      return { ...entry };
    }),
    ...overrides,
  });
}
function call(identity, evidence = projection(identity), overrides = {}) {
  return resolveDelivery({
    identity, segmentText: 'Get down!', source: 'player_text', nowMonotonicMs: 10000,
    currentSceneEvidence: evidence, actorTraits: null,
    priorEphemeralMood: null, config: CONFIG, ...overrides,
  });
}
const expectNeutral = result => {
  assert.deepEqual(result, {
    version: 1, value: 'neutral', source: 'neutral',
    confidence: 'soft', intensity: 'subtle', evidenceRef: null,
  });
  assert.equal(Object.isFrozen(result), true);
};

test('verified actor-scoped gunshot yields exact immutable EA0 intent and provenance', () => {
  const a = actor();
  const o = observation(a);
  assert.equal(validateObservation(o), true);
  const scene = projection(a, [o]);
  const result = call(a, scene);
  assert.deepEqual(result, {
    version: 1, value: 'fearful', source: 'verified_scene', confidence: 'supported',
    intensity: 'normal', evidenceRef: o.observationId,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(scene), true);
  assert.equal(Object.isFrozen(scene.observations[0].observation), true);
});

test('one NPC hearing gunfire never grants another nearby NPC awareness', () => {
  const a = actor(), b = actor();
  const sound = observation(a);
  assert.equal(call(a, projection(a, [sound])).value, 'fearful');
  expectNeutral(call(b, projection(b)));
  expectNeutral(call(b, projection(b, [sound])));
  // Spoofing a new observer in a data copy without new native ownership proof
  // cannot pass both the bound run/source and PS2 observer fences.
  expectNeutral(call(b, projection(a, [sound])));
});

test('report/hearsay is never direct witness even with critical severity', () => {
  const a = actor();
  for (const row of [
    observation(a, { kind: 'report', channel: 'report', severity: 'critical' }),
    observation(a, { kind: 'firing', certainty: 'uncertain', severity: 'critical' }),
    observation(a, { kind: 'firing', channel: 'report', severity: 'critical' }),
    observation(a, { kind: 'injured', type: 'injury', channel: 'report' }),
  ]) {
    if (validateObservation(row)) expectNeutral(call(a, projection(a, [row])));
    else expectNeutral(call(a, projection(a, [row])));
  }
});

test('native proof, observer lifetime, channel health and exact turn ownership are mandatory', () => {
  const a = actor(), o = observation(a);
  for (const patch of [
    { verifiedOwner: false }, { lifetimeCurrent: false },
    { channelHealthy: false }, { verifiedOwner: undefined },
    { identity: { ...a, characterId: uuid() } },
    { identity: { ...a, observerCaptureRef: uuid() } },
    { identity: { ...a, incarnationId: uuid() } },
    { identity: { ...a, ownerProofRevision: 2 } },
    { identity: { ...a, hostRunId: uuid() } },
    { identity: { ...a, worldEpoch: 3 } },
    { identity: { ...a, nativeRun: uuid() } },
    { identity: { ...a, timelineId: uuid() } },
    { identity: { ...a, turnId: 'old-turn' } },
    { identity: { ...a, generationId: 99 } },
    { identity: { ...a, sessionNonce: 9 } },
    { identity: { ...a, pedId: 'new-actor' } },
  ]) expectNeutral(call(a, projection(a, [o], patch)));
  expectNeutral(call({ ...a, ownerProofRevision: undefined }, projection(a, [o])));
  expectNeutral(call(a, null));
  const mutable = { ...projection(a, [o]) };
  expectNeutral(call(a, mutable));
});

test('stale, expired, future, wrong-run and invalid evidence do not survive', () => {
  const a = actor();
  expectNeutral(call(a, projection(a, [observation(a, { expiresAt: 10000 })])));
  expectNeutral(call(a, projection(a, [{ observation: observation(a), observedAtMonotonicMs: -1 }])));
  expectNeutral(call(a, projection(a, [{ observation: observation(a), observedAtMonotonicMs: 10001 }])));
  expectNeutral(call(a, projection(a, [{ observation: observation(a), observedAtMonotonicMs: 3999 }])));
  expectNeutral(call(a, projection(a, [observation(a, { nativeRun: uuid() })])));
  expectNeutral(call(a, projection(a, [observation(a, { basis: 'sampled_state' })])));
  const stale = observation(a);
  stale.claims[0].evidence.sampledGameTick = 809;
  expectNeutral(call(a, projection(a, [stale])));
  const malformed = observation(a);
  malformed.claims[0].details = null;
  assert.doesNotThrow(() => call(a, projection(a, [malformed])));
  expectNeutral(call(a, projection(a, [malformed])));
});

test('strong supported threat beats sarcasm; recent death beats dialogue humor', () => {
  const a = actor();
  const trait = freeze({ characterId: a.characterId, traits: ['sarcastic'] });
  const urgent = call(a, projection(a, [observation(a)]), {
    actorTraits: trait, segmentText: 'Yeah, right. Hahaha!',
  });
  assert.equal(urgent.value, 'fearful');
  assert.equal(urgent.source, 'verified_scene');
  const mourn = observation(a, { type: 'death_seen', kind: 'dead', severity: 'critical', channel: 'visual' });
  assert.equal(call(a, projection(a, [mourn]), { actorTraits: trait, segmentText: 'Haha, sure.' }).value, 'sad');
  assert.equal(call(a, projection(a, [observation(a), mourn]), { segmentText: 'Haha!' }).value, 'fearful');
});

test('self injury and witnessing injury are concerned, not inferred from unverified threats', () => {
  const a = actor();
  const self = observation(a, { type: 'injury', kind: 'injured', channel: 'self' });
  assert.equal(call(a, projection(a, [self])).value, 'concerned');
  const other = observation(a, { type: 'injury', kind: 'injured', channel: 'visual', target: uuid() });
  assert.equal(call(a, projection(a, [other])).value, 'concerned');
  const unknown = observation(a, { type: 'threat', kind: 'presence', channel: 'visual' });
  expectNeutral(call(a, projection(a, [unknown])));
});

test('vehicle impact is not proof of a rollover, injury, or generic engine-state impact', () => {
  const a = actor();
  const impact = observation(a, { type: 'vehicle_impact', kind: 'injured', channel: 'auditory' });
  assert.equal(call(a, projection(a, [impact])).value, 'concerned');
  const state = observation(a, { type: 'vehicle_impact', kind: 'sound', channel: 'auditory' });
  expectNeutral(call(a, projection(a, [state])));
  const overturned = observation(a, { type: 'vehicle_impact', kind: 'injured' });
  overturned.claims[0].details.rollover = true;
  expectNeutral(call(a, projection(a, [overturned])));
});

test('personality modifies bounded delivery, never creates missing observations', () => {
  const a = actor(), scene = projection(a, [observation(a)]);
  const bold = freeze({ characterId: a.characterId, personality: { traits: ['bold'] } });
  const stoic = freeze({ characterId: a.characterId, traits: ['stoic', 'bold'] });
  const wrong = freeze({ characterId: uuid(), traits: ['bold'] });
  assert.equal(call(a, scene, { actorTraits: bold }).value, 'excited');
  assert.equal(call(a, scene, { actorTraits: stoic }).intensity, 'subtle');
  assert.equal(call(a, scene, { actorTraits: wrong }).value, 'fearful');
  expectNeutral(call(a, projection(a), { actorTraits: bold }));
  assert.equal(call(a, scene, { actorTraits: freeze({ characterId: a.characterId, traits: ['bold', 'cautious'] }) }).value, 'fearful');
});

test('explicit NPC dialogue cues can change acting style without claiming witnessing', () => {
  const a = actor(), scene = projection(a);
  const laugh = call(a, scene, { segmentText: 'Haha, that was clever.' });
  assert.deepEqual([laugh.value, laugh.source, laugh.confidence, laugh.evidenceRef],
    ['amused', 'dialogue_cue', 'soft', null]);
  const sympathy = call(a, scene, { segmentText: 'Are you okay?' });
  assert.deepEqual([sympathy.value, sympathy.source], ['concerned', 'dialogue_cue']);
  const sardonic = call(a, scene, {
    segmentText: 'Yeah, right.', actorTraits: freeze({ characterId: a.characterId, traits: ['sarcastic'] }),
  });
  assert.equal(sardonic.value, 'sarcastic');
  expectNeutral(call(a, scene, { segmentText: 'The player reported a shooting.' }));
  expectNeutral(call(a, scene, { segmentText: 'He laughed at them, and someone got angry.' }));
  expectNeutral(call(a, scene, { segmentText: 'Yeah, right.' }));
});

test('bounded budget, owner-bound cooldown and no emotion bleed after promotion/recycling', () => {
  const a = actor(), b = actor(), scene = projection(a, [observation(a)]);
  const prior = freeze({
    identity: { ...a }, taggedSegmentsInTurn: 1,
    lastValue: 'fearful', lastTaggedAtMonotonicMs: 9900,
  });
  expectNeutral(call(a, scene, { priorEphemeralMood: prior }));
  assert.equal(call(a, scene, { priorEphemeralMood: freeze({ ...prior, lastTaggedAtMonotonicMs: 1000 }) }).value, 'fearful');
  expectNeutral(call(a, scene, { priorEphemeralMood: freeze({ ...prior, taggedSegmentsInTurn: 2 }), nowMonotonicMs: 18000 }));
  assert.equal(call(a, scene, { priorEphemeralMood: freeze({ ...prior, identity: { ...b } }) }).value, 'fearful');
  assert.equal(call(a, scene, { priorEphemeralMood: prior, segmentText: 'Haha!' }).value, 'neutral');
  expectNeutral(call({ ...a, incarnationId: uuid() }, scene, { priorEphemeralMood: prior }));
  expectNeutral(call({ ...a, generationId: 9 }, scene, { priorEphemeralMood: prior }));
});

test('off, unknown source, invalid config and evidence budget fail closed', () => {
  const a = actor(), scene = projection(a, [observation(a)]);
  expectNeutral(call(a, scene, { config: { ...CONFIG, mode: 'off' } }));
  expectNeutral(call(a, scene, { config: { ...CONFIG, mode: 'not-a-mode' } }));
  expectNeutral(call(a, scene, { config: { ...CONFIG, maxTaggedSegmentsPerTurn: -2 } }));
  expectNeutral(call(a, scene, { config: { ...CONFIG, maxTaggedSegmentsPerTurn: 0 } }));
  expectNeutral(call(a, scene, { source: 'untrusted_external_input' }));
  expectNeutral(call(a, scene, { segmentText: '[angry]' }));
  expectNeutral(call(a, scene, { segmentText: 'x'.repeat(3001) }));
  const tooMany = Array.from({ length: SCENE_DELIVERY_BOUNDS.maxObservations + 1 }, () => observation(a));
  expectNeutral(call(a, projection(a, tooMany)));
});

test('resolver does not mutate canonical dialogue, validated PS observation or profile', () => {
  const a = actor(), record = observation(a), p = projection(a, [record]);
  const personality = freeze({ characterId: a.characterId, traits: ['bold'] });
  const words = 'Haha, a shot!';
  const originalObservation = JSON.stringify(p);
  const originalProfile = JSON.stringify(personality);
  const first = call(a, p, { segmentText: words, actorTraits: personality });
  const second = call(a, p, { segmentText: words, actorTraits: personality });
  assert.deepEqual(first, second);
  assert.equal(words, 'Haha, a shot!');
  assert.equal(JSON.stringify(p), originalObservation);
  assert.equal(JSON.stringify(personality), originalProfile);
  assert.equal(first.evidenceRef, record.observationId);
});

test('pure scene selection is bounded and sub-millisecond on ordinary fixtures', () => {
  const a = actor(), scene = projection(a, [observation(a)]);
  for (let i = 0; i < 100; i++) call(a, scene);
  const measurements = [];
  for (let i = 0; i < 250; i++) {
    const start = performance.now(); call(a, scene);
    measurements.push(performance.now() - start);
  }
  measurements.sort((x, y) => x - y);
  assert.ok(measurements[Math.floor(measurements.length * 0.9)] < 1,
    'p90 scene selector should stay under 1ms per segment on a small fixture');
});
