import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateObservation, CAPABILITIES } from '../src/perception/contracts.mjs';
import { SalienceCache, evaluateSalience, normalizeSalienceSituation, orderSalienceDecisions, situationFromCharacterView, SALIENCE_BOUNDS } from '../src/perception/salienceEngine.mjs';
import { ShadowRuntime } from '../src/perception/shadowRuntime.mjs';
import {selectDirectorIntent} from '../src/perception/sceneDirector.mjs';

const NOW = 1000;
function claim(patch) {
  const evidence = { channel: patch.channel, basis: patch.basis, sampledGameTick: patch.tick ?? 1 };
  if (patch.reportRef) evidence.reportRef = patch.reportRef;
  const value = { claimId: randomUUID(), kind: patch.kind, certainty: patch.certainty || 'supported', evidence };
  if (patch.source) value.source = { captureRef: patch.source, kind: patch.sourceKind || 'ped' };
  if (patch.target) value.target = { captureRef: patch.target, kind: patch.targetKind || 'ped' };
  value.details = patch.kind === 'injured' && !patch.eventSignalId
    ? { damageDelta: 1, armourDelta: 0 }
    : { eventSignalId: patch.eventSignalId || randomUUID(), reason: 'fixture' };
  return value;
}
function observation(patch = {}) {
  const observer = patch.observer || randomUUID();
  const value = {
    version: 1,
    observationId: patch.observationId || randomUUID(),
    episodeId: patch.episodeId || randomUUID(),
    revision: patch.revision || 1,
    observer: { captureRef: observer, kind: 'ped' },
    observedAt: { nativeRun: patch.nativeRun || randomUUID(), gameTick: patch.gameTick ?? 10, receivedUtc: '2026-10-04T00:00:00.000Z' },
    expiresAtMonotonicMs: patch.expiresAtMonotonicMs ?? NOW + 60000,
    eventType: patch.eventType || 'injury',
    severity: patch.severity || 'danger',
    claims: patch.claims,
    recognizedCharacterIds: [],
  };
  assert.equal(validateObservation(value), true, patch.eventType || 'observation');
  return value;
}
function view(patch = {}) {
  return situationFromCharacterView({
    nowMonotonicMs: NOW,
    profile: { revision: patch.revision ?? 1, relationship: { state: patch.playerRelationship || 'neutral' }, personality: { description: patch.description || '', traits: patch.traits || [] }, memories: patch.memories || [] },
    bindings: patch.bindings || [],
    activity: patch.activity || 'idle',
    playerCaptureRef: patch.playerCaptureRef || null,
    lifetimeCurrent: patch.lifetimeCurrent,
    channelHealthy: patch.channelHealthy,
    perceptionSupported: patch.perceptionSupported,
    distanceBand: patch.distanceBand,
  });
}
function injuryOf(target, channel = 'visual') {
  return claim({ kind: 'injured', channel, basis: channel === 'self' ? 'native_callback' : 'sampled_state', target, targetKind: target ? 'ped' : undefined });
}

test('missing activity evidence stays unknown in normalization and shadow salience', () => {
  assert.equal(normalizeSalienceSituation({}).activity, 'unknown');
  const seen = observation({ claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] });
  const runtime = new ShadowRuntime({ mode: 'shadow', now: () => NOW });
  runtime.epoch = 'test-run';
  runtime.anchors.set(seen.observer.captureRef, { captureRef: seen.observer.captureRef, kind: 'ped', expires: NOW + 60000 });
  let salienceSituation;
  runtime.salience.evaluate = (_observation, situation) => { salienceSituation = situation; return null; };
  runtime.noteSalience(seen);
  assert.equal(salienceSituation.activity, 'unknown');
});

test('urgent self-danger is priority only and does not authorize an effect', () => {
  const cache = new SalienceCache();
  const seen = observation({ claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] });
  const decision = cache.evaluate(seen, view());
  assert.equal(decision.response, 'urgent');
  assert.equal(decision.context, 'must_include');
  assert.equal(decision.memory, 'stage');
  assert.ok(decision.reasons.includes('safety_self_danger'));
  assert.deepEqual(Object.keys(decision), ['observationId', 'revision', 'decisionKey', 'policyVersion', 'context', 'memory', 'response', 'reasons', 'expiresAtMonotonicMs']);
  assert.equal('action' in decision, false);
  assert.throws(() => { decision.response = 'none'; });
  const replay = cache.evaluate(seen, view());
  assert.equal(replay.response, 'none');
  assert.equal(replay.context, 'must_include');
  assert.ok(replay.reasons.includes('repetition_suppressed'));
});

test('salience separates response grants from consumer acknowledgement', () => {
  const cache = new SalienceCache();
  const seen = observation({ eventType: 'death_seen', severity: 'critical', claims: [claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: randomUUID() })] });
  const first = cache.evaluate(seen, view());
  assert.equal(first.response, 'eligible');
  assert.equal(first.policyVersion, 1);
  assert.equal(typeof first.decisionKey, 'string');
  assert.equal(cache.ledger.get(seen.observationId).consumed, false);

  const pendingReplay = cache.evaluate(seen, view());
  assert.equal(pendingReplay.response, 'none');
  assert.ok(pendingReplay.reasons.includes('repetition_suppressed'));

  assert.equal(cache.acknowledge(first.decisionKey, 'ps6_ticket', 'rejected'), true);
  const retried = cache.evaluate(seen, view());
  assert.equal(retried.response, 'eligible');
  assert.notEqual(retried.decisionKey, first.decisionKey);
  assert.equal(cache.acknowledge(first.decisionKey, 'ps6_ticket', 'delivered'), false);

  assert.equal(cache.acknowledge(retried.decisionKey, 'ps6_ticket', 'expired'), true);
  assert.equal(cache.ledger.get(seen.observationId).consumed, false);
  const expiredRetry = cache.evaluate(seen, view());
  assert.equal(expiredRetry.response, 'eligible');
  assert.notEqual(expiredRetry.decisionKey, retried.decisionKey);
  assert.equal(cache.acknowledge(retried.decisionKey, 'ps6_ticket', 'delivered'), false);

  assert.equal(cache.acknowledge(expiredRetry.decisionKey, 'ps6_ticket', 'delivered'), true);
  assert.equal(cache.ledger.get(seen.observationId).consumed, true);
  const consumedReplay = cache.evaluate(seen, view());
  assert.equal(consumedReplay.response, 'none');
  assert.ok(consumedReplay.reasons.includes('repetition_suppressed'));
  assert.equal(cache.acknowledge('missing', 'ps6_ticket', 'delivered'), false);
});

test('recognized relationship differs from a backend-only identity', () => {
  const observer = randomUUID(), victim = randomUUID(), characterId = randomUUID();
  const seen = observation({ observer, eventType: 'death_seen', severity: 'critical', claims: [claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: victim })] });
  const recognized = new SalienceCache().evaluate(seen, view({ bindings: [{ captureRef: victim, characterId, recognized: true, relationship: 'friend' }] }));
  const backend = new SalienceCache().evaluate(seen, view({ bindings: [{ captureRef: victim, characterId, recognized: false, relationship: 'trusted' }] }));
  const omittedAuthority = new SalienceCache().evaluate(seen, view({ bindings: [{ captureRef: victim, characterId, relationship: 'trusted' }] }));
  assert.equal(recognized.memory, 'stage');
  assert.ok(recognized.reasons.includes('relationship_close'));
  for (const unrecognized of [backend, omittedAuthority]) {
    assert.equal(unrecognized.memory, 'none');
    assert.equal(unrecognized.reasons.includes('relationship_close'), false);
    assert.equal(unrecognized.reasons.includes('relationship_conflict'), false);
    assert.equal(unrecognized.context, 'must_include');
  }
});

test('player harm and self harm stay distinct', () => {
  const observer = randomUUID(), player = randomUUID();
  const self = observation({ observer, claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] });
  const playerHit = observation({ observer, claims: [claim({ kind: 'injured', channel: 'visual', basis: 'sampled_state', target: player, targetKind: 'player' })] });
  const selfDecision = evaluateSalience(self, view());
  const playerDecision = evaluateSalience(playerHit, view({ playerCaptureRef: player }));
  assert.equal(selfDecision.response, 'urgent');
  assert.ok(selfDecision.reasons.includes('involvement_self'));
  assert.equal(playerDecision.response, 'eligible');
  assert.notEqual(playerDecision.response, 'urgent');
  assert.ok(playerDecision.reasons.includes('involvement_player'));
  assert.ok(playerDecision.reasons.includes('safety_player_harm'));
});

test('verified gunfire and stranger injury permit a bounded spontaneous reaction while following', () => {
  const observer=randomUUID(),player=randomUUID(),stranger=randomUUID();
  const following=view({activity:'following',playerCaptureRef:player});
  const gunfire=observation({observer,eventType:'firing_burst',severity:'routine',
    claims:[claim({kind:'firing',channel:'auditory',basis:'audibility_model',
      source:player,sourceKind:'player'})]});
  const cache=new SalienceCache({now:()=>NOW});
  const first=cache.evaluate(gunfire,following);
  assert.equal(first.response,'eligible','verified nearby shots need no relationship binding');
  assert.equal(first.context,'candidate');
  assert.equal(first.memory,'none');
  assert.ok(first.reasons.includes('safety_nearby_threat'));
  assert.ok(!first.reasons.includes('relationship_close'));
  assert.equal(cache.evaluate(gunfire,following).response,'none',
    'repeated PS3 evaluation cannot grant a second reaction');
  assert.equal(cache.acknowledge(first.decisionKey,'ps6_ticket','delivered'),true);
  assert.equal(cache.evaluate(gunfire,following).response,'none',
    'successful speech consumes that event response');

  const injured=observation({observer,eventType:'injury',severity:'danger',
    claims:[injuryOf(stranger)]});
  const injuryDecision=evaluateSalience(injured,following);
  assert.equal(injuryDecision.response,'eligible','someone getting shot merits a response');
  assert.equal(injuryDecision.context,'must_include');
  assert.equal(injuryDecision.memory,'none','strangers do not gain a fabricated memory link');

  const uncertain=observation({observer,eventType:'firing_burst',severity:'routine',
    claims:[claim({kind:'firing',channel:'auditory',basis:'audibility_model',
      certainty:'uncertain'})]});
  assert.equal(evaluateSalience(uncertain,following).response,'none',
    'unverified shots cannot cause unsolicited speech');
  assert.equal(evaluateSalience(gunfire,view({activity:'following',lifetimeCurrent:false,
    playerCaptureRef:player})).response,'none','retired actor cannot speak');
});

test('driving suppresses routine presence and keeps vehicle danger', () => {
  const observer = randomUUID(), other = randomUUID();
  const parked = observation({ observer, eventType: 'character_present', severity: 'routine', claims: [claim({ kind: 'presence', channel: 'visual', basis: 'sampled_state', target: other })] });
  const impact = observation({ observer, eventType: 'vehicle_impact', severity: 'danger', claims: [injuryOf(other)] });
  const selfHit = observation({ observer, claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] });
  const ignored = evaluateSalience(parked, view({ activity: 'driving' }));
  const danger = evaluateSalience(impact, view({ activity: 'driving' }));
  const urgent = evaluateSalience(selfHit, view({ activity: 'driving' }));
  assert.equal(ignored.context, 'omit');
  assert.equal(ignored.response, 'none');
  assert.ok(ignored.reasons.includes('situation_occupied'));
  assert.equal(danger.context, 'must_include');
  assert.equal(danger.response, 'eligible');
  assert.equal(danger.reasons.includes('situation_occupied'), false);
  assert.equal(urgent.response, 'urgent');
  assert.equal(urgent.reasons.includes('situation_occupied'), false);
});

test('relevant prior memory raises routine presence without staging a new memory', () => {
  const friend = randomUUID(), characterId = randomUUID();
  const seen = observation({ eventType: 'character_present', severity: 'routine', claims: [claim({ kind: 'presence', channel: 'visual', basis: 'sampled_state', target: friend })] });
  const binding = [{ captureRef: friend, characterId, recognized: true, relationship: 'friend' }];
  const plain = evaluateSalience(seen, view({ bindings: binding }));
  const remembered = evaluateSalience(seen, view({ bindings: binding, memories: [{ memoryId: randomUUID(), importance: 70, category: 'event', relatedCharacterIds: [characterId] }] }));
  assert.equal(plain.context, 'omit');
  assert.equal(plain.reasons.includes('prior_memory'), false);
  assert.equal(remembered.context, 'candidate');
  assert.equal(remembered.memory, 'none');
  assert.equal(remembered.response, 'none');
  assert.ok(remembered.reasons.includes('prior_memory'));
});

test('repeated observations stay suppressed until a material escalation', () => {
  const cache = new SalienceCache();
  const observer = randomUUID(), victim = randomUUID();
  const first = observation({ observer, eventType: 'death_seen', severity: 'critical', claims: [claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: victim })] });
  const repeat = observation({ observer, eventType: 'death_seen', severity: 'critical', claims: [claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: victim })] });
  const initial = cache.evaluate(first, view());
  assert.equal(initial.response, 'eligible');
  assert.equal(cache.ledger.get(first.observationId).consumed, false);
  assert.equal(cache.acknowledge(initial.decisionKey, 'ps6_ticket', 'delivered'), true);
  assert.equal(cache.ledger.get(first.observationId).consumed, true);
  const suppressed = cache.evaluate(repeat, view());
  assert.equal(suppressed.response, 'none');
  assert.ok(suppressed.reasons.includes('repetition_suppressed'));
  const episodeId = randomUUID(), observationId = randomUUID(), nativeRun = randomUUID(), friend = randomUUID(), characterId = randomUUID();
  const binding = [{ captureRef: friend, characterId, recognized: true, relationship: 'trusted' }];
  const injured = claim({ kind: 'injured', channel: 'visual', basis: 'sampled_state', target: friend });
  const revision1 = observation({ observationId, episodeId, nativeRun, revision: 1, claims: [injured] });
  const revision2 = observation({ observationId, episodeId, nativeRun, revision: 2, eventType: 'death_seen', severity: 'critical', gameTick: 80, claims: [injured, claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: friend })] });
  const opened = cache.evaluate(revision1, view({ bindings: binding }));
  const escalated = cache.evaluate(revision2, view({ bindings: binding }));
  const stale = cache.evaluate(revision1, view({ bindings: binding }));
  assert.equal(opened.response, 'eligible');
  assert.equal(escalated.response, 'eligible');
  assert.ok(escalated.reasons.includes('novelty_escalation'));
  assert.equal(stale.response, 'none');
  assert.ok(stale.reasons.includes('revision_stale'));
});

test('profile and relationship revision changes recompute without replaying a stale category', () => {
  const cache = new SalienceCache();
  const victim = randomUUID(), characterId = randomUUID();
  const seen = observation({ claims: [injuryOf(victim)] });
  const binding = relationship => [{ captureRef: victim, characterId, recognized: true, relationship }];
  const neutral = cache.evaluate(seen, view({ revision: 1, bindings: binding('neutral') }));
  const trusted = cache.evaluate(seen, view({ revision: 2, bindings: binding('trusted') }));
  const bumped = cache.evaluate(seen, view({ revision: 3, bindings: binding('trusted') }));
  assert.equal(neutral.memory, 'none');
  assert.equal(neutral.context, 'candidate');
  assert.equal(trusted.context, 'must_include');
  assert.equal(trusted.memory, 'stage');
  assert.equal(trusted.response, 'eligible');
  assert.ok(trusted.reasons.includes('relationship_close'));
  assert.equal(bumped.response, 'none');
  assert.equal(bumped.context, 'must_include');
  assert.equal(cache.latestById.get(seen.observationId).profileRevision, 3);
  assert.notEqual(bumped.context, neutral.context);
});

test('expired, ended, and unhealthy evidence cannot stay relevant', () => {
  const seen = observation({ expiresAtMonotonicMs: NOW, claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] });
  const expired = evaluateSalience(seen, view());
  const ended = evaluateSalience(observation({ claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] }), view({ lifetimeCurrent: false }));
  const unhealthy = evaluateSalience(observation({ claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] }), view({ channelHealthy: false }));
  assert.equal(expired.context, 'omit');
  assert.equal(expired.response, 'none');
  assert.ok(expired.reasons.includes('evidence_expired'));
  assert.ok(ended.reasons.includes('evidence_lifetime_ended'));
  assert.ok(unhealthy.reasons.includes('evidence_channel_unhealthy'));
  assert.equal(evaluateSalience({ version: 1 }, view()), null);
});

test('free-form personality text is neutral and only exact trait policies change a threshold', () => {
  const friend = randomUUID(), characterId = randomUUID();
  const seen = observation({ eventType: 'character_present', severity: 'routine', claims: [claim({ kind: 'presence', channel: 'visual', basis: 'sampled_state', target: friend })] });
  const bindings = [{ captureRef: friend, characterId, recognized: true, relationship: 'friend' }];
  const prose = evaluateSalience(seen, view({ bindings, description: 'protective loyal aggressive', traits: ['brave and reckless', 'kind-hearted'] }));
  const other = evaluateSalience(seen, view({ bindings, description: 'quiet', traits: ['curious'] }));
  const policy = evaluateSalience(seen, view({ bindings, traits: ['Protective'] }));
  assert.deepEqual(prose, other);
  assert.equal(prose.context, 'omit');
  assert.equal(policy.context, 'candidate');
  assert.ok(policy.reasons.includes('trait_policy'));
});

test('ordering is deterministic, fair, and distance cannot outrank injury', () => {
  const self = observation({ gameTick: 5, claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] });
  const player = randomUUID();
  const playerSeen = observation({ gameTick: 5, claims: [claim({ kind: 'injured', channel: 'visual', basis: 'sampled_state', target: player, targetKind: 'player' })] });
  const farUrgent = evaluateSalience(self, view({ distanceBand: 1 }));
  const playerDecision = evaluateSalience(playerSeen, view({ playerCaptureRef: player }));
  const low = '00000000-0000-4000-8000-000000000001';
  const high = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const tie = id => observation({ observationId: id, eventType: 'firing_burst', severity: 'routine', gameTick: 20, claims: [claim({ kind: 'firing', channel: 'auditory', basis: 'audibility_model' })] });
  const lowSeen = tie(low), highSeen = tie(high);
  const lowDecision = evaluateSalience(lowSeen, view());
  const highDecision = evaluateSalience(highSeen, view({ traits: ['loyal'] }));
  const firingSeen = observation({ eventType: 'firing_burst', severity: 'routine', gameTick: 90, claims: [claim({ kind: 'firing', channel: 'auditory', basis: 'audibility_model' })] });
  const nearRoutine = evaluateSalience(firingSeen, view({ distanceBand: 3 }));
  const ordered = orderSalienceDecisions([
    { decision: nearRoutine, observation: firingSeen, situation: view({ distanceBand: 3 }) },
    { decision: playerDecision, observation: playerSeen, situation: view({ playerCaptureRef: player }) },
    { decision: farUrgent, observation: self, situation: view({ distanceBand: 1 }) },
    { decision: highDecision, observation: highSeen, situation: view({ traits: ['loyal'] }) },
    { decision: lowDecision, observation: lowSeen, situation: view() },
  ]);
  const reversed = orderSalienceDecisions([...ordered].reverse());
  assert.deepEqual(ordered.map(entry => entry.decision.observationId), reversed.map(entry => entry.decision.observationId));
  assert.deepEqual(ordered.slice(0, 2).map(entry => entry.decision.response), ['urgent', 'eligible']);
  assert.ok(ordered.findIndex(entry => entry.decision.observationId === high) < ordered.findIndex(entry => entry.decision.observationId === low));
  assert.ok(ordered.findIndex(entry => entry.decision === farUrgent) < ordered.findIndex(entry => entry.decision === nearRoutine));
});

test('decision cache stays bounded and eviction does not restore reaction entitlement', () => {
  const cache = new SalienceCache();
  const observer = randomUUID();
  const kept = [];
  for (let index = 0; index < 40; index += 1) {
    const seen = observation({ observer, eventType: 'death_seen', severity: 'critical', claims: [claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: randomUUID() })] });
    kept.push(seen);
    assert.equal(cache.evaluate(seen, view()).response, 'eligible');
  }
  assert.equal([...cache.decisions.values()].filter(entry => entry.observer === observer).length, SALIENCE_BOUNDS.perObserver);
  const many = new SalienceCache();
  const first = observation({ eventType: 'death_seen', severity: 'critical', claims: [claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: randomUUID() })] });
  assert.equal(many.evaluate(first, view()).response, 'eligible');
  for (let index = 0; index < 299; index += 1) {
    many.evaluate(observation({ eventType: 'death_seen', severity: 'critical', claims: [claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: randomUUID() })] }), view());
  }
  assert.equal(many.decisions.size, SALIENCE_BOUNDS.decisions);
  assert.ok(many.latestById.size <= SALIENCE_BOUNDS.decisions);
  assert.equal(many.ledger.size, 300);
  const replay = many.evaluate(first, view());
  assert.equal(replay.response, 'none');
  assert.ok(replay.reasons.includes('repetition_suppressed'));
  const full = new SalienceCache();
  let oldestGrant = null;
  for (let index = 0; index < SALIENCE_BOUNDS.suppression; index += 1) {
    const seen = observation({ eventType: 'death_seen', severity: 'critical', claims: [claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: randomUUID() })] });
    if (index === 0) oldestGrant = seen;
    assert.equal(full.evaluate(seen, view()).response, 'eligible');
  }
  const overflow = full.evaluate(observation({ eventType: 'death_seen', severity: 'critical', claims: [claim({ kind: 'dead', channel: 'visual', basis: 'sampled_state', target: randomUUID() })] }), view());
  const urgentOverflow = full.evaluate(observation({ claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] }), view());
  assert.equal(full.ledger.size, SALIENCE_BOUNDS.suppression);
  assert.equal(overflow.response, 'none');
  assert.ok(overflow.reasons.includes('suppression_capacity'));
  assert.equal(urgentOverflow.context, 'must_include');
  assert.equal(urgentOverflow.response, 'none');
  assert.ok(urgentOverflow.reasons.includes('suppression_capacity'));
  const replayFull = full.evaluate(oldestGrant, view());
  assert.equal(replayFull.response, 'none');
  assert.ok(replayFull.reasons.includes('repetition_suppressed'));
});

test('salience performs no model call and shadow ingestion grants no native effect', async () => {
  const source = await readFile(new URL('../src/perception/salienceEngine.mjs', import.meta.url), 'utf8');
  const runtimeSource = await readFile(new URL('../src/perception/shadowRuntime.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /openai|providers|profileStore|characterService|sceneDirector|fetch\(|writeFile|SpecialGemini|NpcAction/);
  assert.doesNotMatch(runtimeSource, /SpecialGeminiTurnScheduler|NpcActions\.|\.request\(/);
  const cache = new SalienceCache();
  cache.evaluate(observation({ claims: [claim({ kind: 'injured', channel: 'self', basis: 'native_callback' })] }), view());
  let now = 0, sequence = 0, producerSequence = 0;
  const epoch = randomUUID(), stream = randomUUID(), ped = randomUUID(), player = randomUUID();
  const runtime = new ShadowRuntime({ mode: 'shadow', now: () => now });
  const caps = Object.fromEntries(CAPABILITIES.map(key => [key, !['awareness', 'playerSpeech'].includes(key)]));
  const frame = (type, payload) => ({ version: 1, type, adapterEpoch: epoch, streamId: stream, sequence: ++sequence, payload });
  assert.equal(runtime.ingest({ version: 1, type: 'hello', adapterEpoch: epoch, streamId: stream, capabilities: caps }, { authenticated: true }), true);
  assert.equal(runtime.ingest(frame('anchors', [{ captureRef: ped, kind: 'ped', observer: true }, { captureRef: player, kind: 'player', observer: false }]), { authenticated: true }), true);
  assert.equal(runtime.ingest(frame('signal', { signalId: randomUUID(), producer: 'ped_damage', producerSequence: ++producerSequence, kind: 'damage', target: ped, source: player, gameTick: 1, ageMs: 0, facts: { damage: 5, armour: 0, classification: 'bullet' } }), { authenticated: true }), true);
  const decision = [...runtime.salience.latestById.values()][0]?.decision;
  assert.equal(decision.response, 'urgent');
  assert.equal(runtime.ps3Diagnostics.urgent, 1);
  assert.equal(runtime.ps3Diagnostics.faults, 0);
  assert.equal(runtime.signals.length, 1);
});


test('expired pair payloads are released without retiring their suppression entitlement',()=>{
 const observer=randomUUID(),cache=new SalienceCache({now:()=>NOW});
 const value=observation({observer,expiresAtMonotonicMs:NOW+100,claims:[claim({kind:'injured',channel:'self',basis:'sampled_state',target:observer})]});
 const decision=cache.evaluate(value,{nowMonotonicMs:NOW});assert.equal(cache.acknowledge(decision.decisionKey,'ps4_context','delivered'),true);
 const ledger=cache.ledger.get(value.observationId),granted=ledger.granted;assert.ok(ledger.pair);
 cache.expire(NOW+100);assert.equal(cache.ledger.get(value.observationId),ledger);assert.equal(ledger.pair,undefined);assert.equal(ledger.pairBytes,undefined);assert.equal(ledger.granted,granted);assert.ok(ledger.consumedBy.has('ps4_context'));assert.equal(ledger.consumed,false);
});
test('retired references release all paired payload views without consuming or regranting entitlements',()=>{
 const observer=randomUUID(),target=randomUUID(),cache=new SalienceCache({now:()=>NOW});
 const value=observation({observer,claims:[claim({kind:'injured',channel:'visual',basis:'sampled_state',target})]});
 const decision=cache.evaluate(value,{nowMonotonicMs:NOW}),ledger=cache.ledger.get(value.observationId),granted=ledger.granted;
 cache.releaseReference(target);
 assert.equal(ledger.pair,undefined);assert.equal(cache.decisions.get(value.observationId).pair,undefined);assert.equal(cache.latestById.get(value.observationId).pair,undefined);assert.equal(ledger.granted,granted);assert.equal(ledger.consumedBy.size,0);assert.equal(ledger.decisionKey,decision.decisionKey);
});


test('paired store pressure preserves urgent evidence and suppression without rebuilding evicted pairs',()=>{
 const cache=new SalienceCache({now:()=>NOW}),observer=randomUUID();
 const urgent=observation({observer,claims:[claim({kind:'injured',channel:'self',basis:'native_callback',target:observer})]});
 const urgentDecision=cache.evaluate(urgent,view());
 let admittedBytes=cache.ledger.get(urgent.observationId).pairBytes,firstRoutine;
 for(let index=0;index<SALIENCE_BOUNDS.suppression-1;index++){
  const claims=Array.from({length:4},()=>claim({kind:'presence',channel:'visual',basis:'sampled_state',source:randomUUID(),target:randomUUID()}));
  const seen=observation({observer,eventType:'character_present',severity:'routine',claims,gameTick:index+20});
  if(!firstRoutine)firstRoutine=seen;
  cache.evaluate(seen,view());
  // Measure the admitted immutable pair even when the pressure pass removes its payload.
  admittedBytes+=Buffer.byteLength(JSON.stringify({observation:seen,situation:view(),decision:cache.ledger.get(seen.observationId).pair?.decision??cache.latestById.get(seen.observationId)?.decision}));
 }
 const pairs=new Map([...cache.decisions.values(),...cache.ledger.values(),...cache.latestById.values()].filter(entry=>entry.pair).map(entry=>[entry.pair,entry.pairBytes]));
 assert.ok(admittedBytes>2*1024*1024,'fixture must exercise the byte limit');
 assert.ok([...pairs.values()].reduce((sum,bytes)=>sum+bytes,0)<=2*1024*1024);
 assert.equal(cache.ledger.size,SALIENCE_BOUNDS.suppression);
 assert.equal(cache.ledger.get(urgent.observationId).pair.decision.decisionKey,urgentDecision.decisionKey);
 assert.equal(cache.ledger.get(urgent.observationId).consumedBy.size,0);
 const retired=cache.ledger.get(firstRoutine.observationId);
 assert.equal(retired.pair,undefined);
 assert.equal(cache.needsSituationRefresh(firstRoutine,view({revision:2})),false);
 const counts={};
 assert.deepEqual(cache.snapshotForObserver(observer,{entries:new Map([[firstRoutine.observationId,{value:firstRoutine}]])},NOW,counts),[]);
 assert.equal(counts.noMatchingSalience,1);
 assert.equal(retired.consumedBy.size,0);
 assert.equal(cache.acknowledge(urgentDecision.decisionKey,'ps4_context','delivered'),true);
 assert.equal(cache.ledger.get(urgent.observationId).consumed,false);
 const replay=cache.evaluate(urgent,view());
 assert.equal(replay.response,'none');
 assert.ok(replay.reasons.includes('repetition_suppressed'));
});

test('PS6 read-only candidate uses native source age and an unconsumed exact PS3 grant',()=>{
  let time=NOW;
  const ps=new ShadowRuntime({mode:'shadow',now:()=>time});
  const speaker=randomUUID(),player=randomUUID();
  ps.epoch=randomUUID();ps.lastReceipt=time;
  ps.anchors.set(speaker,{captureRef:speaker,kind:'ped',expires:NOW+30000});
  ps.anchors.set(player,{captureRef:player,kind:'player',expires:NOW+30000});
  ps.observerIndex.set(speaker,{captureRef:speaker,kind:'ped',owned:true,incarnationId:randomUUID()});
  const seen=observation({
    observer:speaker,nativeRun:ps.epoch,eventType:'death_seen',severity:'critical',
    claims:[claim({kind:'dead',channel:'visual',basis:'native_awareness',target:player,targetKind:'player'})],
  });
  assert.equal(ps.observations.put(seen,{sourceAgeMs:800}),true);
  ps.noteSalience(seen,ps.situationFor(speaker,player));
  const rows=ps.directorCandidatesFor(speaker);
  assert.equal(rows.length,1);
  assert.equal(rows[0].entitlementCurrent,true);
  assert.equal(rows[0].observedAtMonotonicMs,NOW-800);
  assert.equal(rows[0].decision.response,'eligible');
  assert.equal('handle' in rows[0],false);
  assert.equal('prompt' in rows[0],false);
  assert.equal(ps.salience.ledger.get(seen.observationId).consumed,false);
  // Re-evaluating the situation does not renew the original evidence age.
  time=NOW+9000;ps.lastReceipt=time;
  ps.refreshSalience(speaker);
  assert.equal(ps.directorCandidatesFor(speaker)[0].observedAtMonotonicMs,NOW-800);
  const decision=rows[0].decision.decisionKey;
  assert.equal(ps.salience.acknowledge(decision,'ps6_ticket','delivered'),true);
  assert.deepEqual(ps.directorCandidatesFor(speaker),[]);
});

test('PS6 candidate cannot be inferred for an unowned speaker or missing player',()=>{
  const ps=new ShadowRuntime({mode:'shadow',now:()=>NOW});
  ps.epoch=randomUUID();
  const speaker=randomUUID();ps.anchors.set(speaker,{captureRef:speaker,kind:'ped',expires:NOW+30000});
  ps.observerIndex.set(speaker,{captureRef:speaker,kind:'ped',owned:false});
  assert.deepEqual(ps.directorCandidatesFor(speaker),[]);
  ps.observerIndex.set(speaker,{captureRef:speaker,kind:'ped',owned:true,incarnationId:randomUUID()});
  assert.deepEqual(ps.directorCandidatesFor(speaker),[]);
});

test('Phase 13a validates exact original PS2/PS3 grant and P2 source proof without claiming native authorization',()=>{
  let time=NOW;
  const ps=new ShadowRuntime({mode:'shadow',now:()=>time});
  const speaker=randomUUID(),player=randomUUID(),hostRunId=randomUUID(),incarnation=randomUUID();
  ps.epoch=randomUUID();ps.lastReceipt=time;
  ps.hostContext=Object.freeze({hostRunId,worldEpoch:1});
  ps.anchors.set(speaker,{captureRef:speaker,kind:'ped',observer:true,owned:true,expires:NOW+30000});
  ps.anchors.set(player,{captureRef:player,kind:'player',expires:NOW+30000});
  ps.observerIndex.set(speaker,Object.freeze({captureRef:speaker,kind:'ped',owned:true,incarnationId:incarnation,encounterId:randomUUID()}));
  const sourceOwner={owner:'none',mode:'idle',since:10};
  const nativeChallenge=randomUUID();
  ps.observerSituations.set(speaker,Object.freeze({
    captureRef:speaker,sampledGameTick:10,situationRevision:1,activity:'idle',
    primaryOwner:sourceOwner,ownerProofRevision:3,ps3Challenge:nativeChallenge,expires:NOW+30000,
  }));
  const seen=observation({
    observer:speaker,nativeRun:ps.epoch,eventType:'death_seen',severity:'critical',
    claims:[claim({kind:'dead',channel:'visual',basis:'native_awareness',target:player,targetKind:'player'})],
  });
  assert.equal(ps.observations.put(seen,{sourceAgeMs:100}),true);
  ps.noteSalience(seen,ps.situationFor(speaker,player));
  const candidates=ps.directorCandidatesFor(speaker);
  assert.equal(candidates.length,1);
  const proposal=selectDirectorIntent(candidates,{
    speakerCaptureRef:speaker,playerCaptureRef:player,nowMonotonicMs:time});
  assert.ok(proposal);
  const stamp={hostRunId,worldEpoch:1,speakerCaptureRef:speaker,playerCaptureRef:player,
    ownerIncarnationId:incarnation,proofRevision:3,playerTurnVersion:0,policyVersion:1};
  const checked=ps.directorOriginalEntitlementFor(proposal,stamp);
  assert.ok(checked);
  assert.equal(checked.source,'original_companion_ps2_ps3');
  assert.equal(checked.decisionKey,candidates[0].decision.decisionKey);
  assert.equal(checked.ownerIncarnationId,incarnation);
  assert.equal(checked.proofRevision,3);
  assert.equal(checked.challenge,nativeChallenge);
  assert.equal(checked.signalId,seen.claims[0].details.eventSignalId);
  assert.equal(checked.situationRevision,1);
  assert.equal(checked.ageMs,100);
  // Native samples tick frequently even when policy and P2 owner have not
  // changed. A fresh sample must not retire/re-grant the original PS3 key.
  ps.observerSituations.set(speaker,Object.freeze({
    ...ps.observerSituations.get(speaker),situationRevision:2,sampledGameTick:11}));
  ps.refreshSalience(speaker);
  const sampled=ps.directorOriginalEntitlementFor(proposal,stamp);
  assert.equal(sampled?.decisionKey,checked.decisionKey);
  assert.equal(sampled?.situationRevision,2);
  assert.equal(sampled?.ageMs,100);
  assert.equal(ps.salience.ledger.get(seen.observationId).consumed,false);
  assert.notEqual(checked.signalId,proposal.observationId,
    'original native signal identity differs from companion-issued observation UUID');
  assert.ok(Object.isFrozen(checked));
  assert.equal(ps.salience.ledger.get(seen.observationId).consumed,false);

  // All request-controlled and cross-world substitutions are read-only denials.
  for(const [key,bad] of [
    ['decisionKey','different-ps3-key'],['observationId',randomUUID()],
    ['observationRevision',proposal.observationRevision+1],
    ['expiresAtMonotonicMs',proposal.expiresAtMonotonicMs+1],
    ['urgency','urgent'],['policyVersion',2],['playerCaptureRef',randomUUID()],
  ]) assert.equal(ps.directorOriginalEntitlementFor({...proposal,[key]:bad},stamp),null,key);
  for(const [key,bad] of [
    ['hostRunId',randomUUID()],['worldEpoch',2],
    ['speakerCaptureRef',randomUUID()],['playerCaptureRef',randomUUID()],
    ['ownerIncarnationId',randomUUID()],['proofRevision',2],['policyVersion',2],
  ]) assert.equal(ps.directorOriginalEntitlementFor(proposal,{...stamp,[key]:bad}),null,key);

  // A native ownership ABA transition advances its source revision. Old PS3
  // situation inputs do NOT automatically authorize a new incarnation state.
  ps.observerSituations.set(speaker,Object.freeze({
    ...ps.observerSituations.get(speaker),ownerProofRevision:4,situationRevision:2}));
  assert.equal(ps.directorOriginalEntitlementFor(proposal,stamp),null);
  assert.equal(ps.directorOriginalEntitlementFor(proposal,{...stamp,proofRevision:4}),null,
    'owner revision matching alone cannot bypass stale original PS3 situation');
  ps.observerSituations.set(speaker,Object.freeze({
    ...ps.observerSituations.get(speaker),ownerProofRevision:3,situationRevision:1}));
  assert.ok(ps.directorOriginalEntitlementFor(proposal,stamp));
  const granted=candidates[0].decision.decisionKey;
  assert.equal(ps.salience.acknowledge(granted,'ps6_ticket','delivered'),true);
  assert.equal(ps.directorOriginalEntitlementFor(proposal,stamp),null,
    'already consumed original PS3 response cannot be borrowed again');
  ps.retire(speaker);
  assert.equal(ps.directorOriginalEntitlementFor(proposal,stamp),null);
});
test('Phase 13a original PS3 proof rejects expired native source evidence without renewing its clock',()=>{
  let time=NOW;const ps=new ShadowRuntime({mode:'shadow',now:()=>time});
  const speaker=randomUUID(),player=randomUUID(),incarnation=randomUUID(),hostRunId=randomUUID();
  ps.epoch=randomUUID();ps.hostContext={hostRunId,worldEpoch:1};ps.lastReceipt=time;
  ps.anchors.set(speaker,{captureRef:speaker,kind:'ped',observer:true,owned:true,expires:NOW+30000});
  ps.anchors.set(player,{captureRef:player,kind:'player',expires:NOW+30000});
  ps.observerIndex.set(speaker,{captureRef:speaker,kind:'ped',owned:true,incarnationId:incarnation});
  ps.observerSituations.set(speaker,{captureRef:speaker,activity:'idle',situationRevision:1,
    primaryOwner:{owner:'none',mode:'idle',since:1},ownerProofRevision:2,expires:NOW+30000});
  const seen=observation({observer:speaker,nativeRun:ps.epoch,
    claims:[claim({kind:'injured',channel:'self',basis:'native_callback'})]});
  assert.equal(ps.observations.put(seen,{sourceAgeMs:100}),true);
  ps.noteSalience(seen,ps.situationFor(speaker,player));
  const candidates=ps.directorCandidatesFor(speaker);
  const proposal=selectDirectorIntent(candidates,{
    speakerCaptureRef:speaker,playerCaptureRef:player,nowMonotonicMs:time});
  assert.ok(proposal);
  const stamp={hostRunId,worldEpoch:1,speakerCaptureRef:speaker,playerCaptureRef:player,
    ownerIncarnationId:incarnation,proofRevision:2,playerTurnVersion:0,policyVersion:1};
  assert.ok(ps.directorOriginalEntitlementFor(proposal,stamp));
  time=NOW+1901;ps.lastReceipt=time;
  assert.equal(ps.directorOriginalEntitlementFor(proposal,stamp),null,
    'original urgent source timestamp expires despite valid original PS3 ledger');
});

test('PS4 frozen decision acknowledges the same live observation after PS3 changes its policy key',()=>{
  const cache=new SalienceCache({now:()=>NOW}),victim=randomUUID();
  const seen=observation({eventType:'death_seen',severity:'critical',claims:[claim({kind:'dead',channel:'visual',basis:'sampled_state',target:victim})]});
  const original=cache.evaluate(seen,view({activity:'idle'}));
  const frozen=cache.ledger.get(seen.observationId).pair;
  const refreshed=cache.evaluate(seen,view({activity:'conversation'}));
  assert.notEqual(refreshed.decisionKey,original.decisionKey);
  assert.equal(cache.acknowledge(original.decisionKey,'ps4_context','delivered'),false,'old key was retired in the current ledger');
  assert.equal(cache.acknowledgeFrozenContext(original.decisionKey,frozen,'delivered'),true);
  assert.equal(cache.ledger.get(seen.observationId).decisionKey,refreshed.decisionKey);
  assert.equal(cache.ledger.get(seen.observationId).consumedBy.has('ps4_context'),true);
  assert.equal(cache.ledger.get(seen.observationId).consumed,false,'PS4 cannot consume a PS6 ticket');
  assert.equal(cache.acknowledge(original.decisionKey,'ps6_ticket','delivered'),false);
});

test('PS4 frozen acknowledgment refuses expired, retired, changed-revision, and substituted evidence',()=>{
  const setup=()=>{let time=NOW;const victim=randomUUID(),cache=new SalienceCache({now:()=>time});
    const seen=observation({eventType:'death_seen',severity:'critical',expiresAtMonotonicMs:NOW+100,
      claims:[claim({kind:'dead',channel:'visual',basis:'sampled_state',target:victim})]});
    const original=cache.evaluate(seen,view()),frozen=cache.ledger.get(seen.observationId).pair;
    cache.evaluate(seen,view({activity:'conversation'}));
    return {cache,victim,seen,original,frozen,setTime:value=>{time=value;}};
  };
  const expired=setup();expired.setTime(NOW+100);
  assert.equal(expired.cache.acknowledgeFrozenContext(expired.original.decisionKey,expired.frozen,'delivered'),false);
  const retired=setup();retired.cache.releaseReference(retired.victim);
  assert.equal(retired.cache.acknowledgeFrozenContext(retired.original.decisionKey,retired.frozen,'delivered'),false);
  const revised=setup();const s=revised.seen;
  revised.cache.evaluate(observation({observationId:s.observationId,episodeId:s.episodeId,observer:s.observer.captureRef,
    nativeRun:s.observedAt.nativeRun,revision:2,eventType:s.eventType,severity:s.severity,claims:s.claims}),view());
  assert.equal(revised.cache.acknowledgeFrozenContext(revised.original.decisionKey,revised.frozen,'delivered'),false);
  const replaced=setup();
  assert.equal(replaced.cache.acknowledgeFrozenContext('not-the-frozen-key',replaced.frozen,'delivered'),false);
  const reset=setup();reset.cache.clear();
  assert.equal(reset.cache.acknowledgeFrozenContext(reset.original.decisionKey,reset.frozen,'delivered'),false);
  for(const fixture of [expired,retired,revised,replaced,reset])
    assert.equal([...fixture.cache.ledger.values()].some(row=>row.consumedBy.has('ps4_context')),false);
});
