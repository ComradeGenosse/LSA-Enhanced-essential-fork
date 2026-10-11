import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectContextualBallistics, BALLISTICS_R0_LIMITS} from '../src/perception/contextualBallistics.mjs';

function fixture() {
  const player = randomUUID(), signalId = randomUUID();
  const firing = {producer: 'shooting', kind: 'firing', signalId, sourceCaptureRef: player, gameTick: 500};
  const witness = {status: 'witnessed', observerCaptureRef: randomUUID(), firingSignalId: signalId,
    sampledGameTick: 500, channel: 'visual', knowsSource: true, knowsTarget: true,
    sawImpact: true, sawDirection: true};
  const row = (kind, fields = {}) => ({kind, evidenceId: randomUUID(), firingSignalId: signalId,
    sourceCaptureRef: player, gameTick: 550, ...fields});
  return {verifiedPlayerCaptureRef: player, firing, witness, row};
}

test('player firing and a verified visible head injury can be attributed', () => {
  const f = fixture();
  const impact = f.row('ped_damage', {proof: 'native_damage_callback', classification: 'bullet', targetCaptureRef: randomUUID(),
    bodyRegion: 'head', boneVerified: true});
  const result = projectContextualBallistics({...f, evidence: [impact]});
  assert.deepEqual(result, {event: 'gunfire_context', witnessedAs: 'seen',
    shooter: 'player', impact: {kind: 'person_hit', bodyRegion: 'head'}});
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.impact), true);
  assert.ok(!JSON.stringify(result).includes(f.firing.sourceCaptureRef));
});

test('sound alone does not identify player, target, surfaces or direction', () => {
  const f = fixture();
  const evidence = [f.row('ped_damage', {proof: 'native_damage_callback', classification: 'bullet', targetCaptureRef: randomUUID(),
    bodyRegion: 'head', boneVerified: true})];
  const result = projectContextualBallistics({...f,
    witness: {...f.witness, channel: 'auditory'}, evidence});
  assert.deepEqual(result, {event: 'gunfire_context', witnessedAs: 'heard',
    shooter: 'unidentified', impact: {kind: 'unconfirmed'}});
});

test('visual gunfire with no verified impact is never labeled a miss', () => {
  const f = fixture();
  const result = projectContextualBallistics({...f, evidence: []});
  assert.equal(result.impact.kind, 'unconfirmed');
  assert.equal('miss' in result, false);
});

test('native impact evidence is required for wall/ground, and has to be seen', () => {
  const f = fixture();
  const evidence = [f.row('world_impact', {proof: 'native_impact', surface: 'wall'})];
  assert.deepEqual(projectContextualBallistics({...f, evidence}).impact,
    {kind: 'surface_hit', surface: 'wall'});
  assert.equal(projectContextualBallistics({...f,
    witness: {...f.witness, sawImpact: false}, evidence}).impact.kind, 'unconfirmed');
  assert.equal(projectContextualBallistics({...f,
    evidence: [f.row('world_impact', {proof: 'raycast_guess', surface: 'wall'})]}).impact.kind,
    'unconfirmed');
});

test('trajectory is qualified geometry, not a verified hit or shooter intention', () => {
  const f = fixture();
  const result = projectContextualBallistics({...f,
    witness: {...f.witness, sawImpact: false},
    evidence: [f.row('trajectory', {proof: 'native_geometry_sample', direction: 'toward_person'})]});
  assert.equal(result.trajectory, 'toward_person');
  assert.equal(result.impact.kind, 'unconfirmed');
  assert.equal('intent' in result, false);
});

test('non-bullet damage never becomes a confirmed ballistic hit', () => {
  const f = fixture();
  const result = projectContextualBallistics({...f,
    evidence: [f.row('ped_damage', {proof: 'native_damage_callback', classification: 'explosion',
      targetCaptureRef: randomUUID(), bodyRegion: 'head', boneVerified: true})]});
  assert.deepEqual(result.impact, {kind: 'unconfirmed'});
});

test('unverified bone never becomes headshot but confirmed injury remains', () => {
  const f = fixture();
  const result = projectContextualBallistics({...f,
    evidence: [f.row('ped_damage', {proof: 'native_damage_callback', classification: 'bullet', targetCaptureRef: randomUUID(),
      bodyRegion: 'head', boneVerified: false})]});
  assert.deepEqual(result.impact, {kind: 'person_hit'});
});

test('wrong player anchor, source visibility, or original correlation cannot fabricate attribution', () => {
  const f = fixture();
  const evidence = [f.row('ped_damage', {proof: 'native_damage_callback', classification: 'bullet', targetCaptureRef: randomUUID()})];
  assert.equal(projectContextualBallistics({...f, verifiedPlayerCaptureRef: randomUUID(), evidence}).shooter,
    'another_person');
  assert.equal(projectContextualBallistics({...f, verifiedPlayerCaptureRef: null, evidence}).shooter,
    'unidentified');
  assert.equal(projectContextualBallistics({...f,
    witness: {...f.witness, knowsSource: false}, evidence}).shooter, 'unidentified');
  const other = {...evidence[0], firingSignalId: randomUUID()};
  assert.equal(projectContextualBallistics({...f, evidence: [other]}).impact.kind, 'unconfirmed');
  assert.equal(projectContextualBallistics({...f,
    evidence: [{...evidence[0], sourceCaptureRef: randomUUID()}]}).impact.kind, 'unconfirmed');
  assert.equal(projectContextualBallistics({...f,
    evidence: [{...evidence[0], gameTick: 2050}]}).impact.kind, 'unconfirmed');
});

test('invalid receipt, too many evidence rows, and mismatched observer epoch fail closed', () => {
  const f = fixture();
  assert.equal(projectContextualBallistics({...f, witness: {...f.witness, firingSignalId: randomUUID()}}), null);
  assert.equal(projectContextualBallistics({...f, witness: {...f.witness, sampledGameTick: 501}}), null);
  assert.equal(projectContextualBallistics({...f,
    evidence: Array.from({length: BALLISTICS_R0_LIMITS.maxEvidence + 1}, () => f.row('trajectory'))}), null);
  assert.equal(projectContextualBallistics({...f, firing: {...f.firing, sourceCaptureRef: 'player'}}), null);
});

test('crossing native uint gameTick wrap still permits a brief verified callback', () => {
  const f = fixture();
  const firing = {...f.firing, gameTick: 0xfffffffe};
  const witness = {...f.witness, sampledGameTick: 0xfffffffe};
  const evidence = [f.row('world_impact', {proof: 'native_impact', surface: 'ground', gameTick: 2})];
  assert.deepEqual(projectContextualBallistics({...f, firing, witness, evidence}).impact,
    {kind: 'surface_hit', surface: 'ground'});
});
