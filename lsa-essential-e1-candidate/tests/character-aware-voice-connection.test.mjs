import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIConnection } from '../src/openai/openaiConnection.mjs';

function identity(turnId = 'turn-a', generationId = 1) {
  return { pedId: '17', turnId, generationId, sessionNonce: 3 };
}

test('OpenAIConnection resolves one session voice from hydrated actor context and freezes it', async () => {
  const calls = [];
  const events = [];
  const initialActor = { gender: 'Male', ageRange: '65-75' };
  const profile = Object.freeze({
    profileId: 'vp_test',
    provider: 'openai',
    model: 'gpt-4o-mini-tts',
    voice: 'onyx',
    speed: 1,
    instructions: '',
    assignmentVersion: 2,
    selectionMode: 'character-aware-session',
    gender: 'male',
    ageBand: 'older',
    matchReason: 'character-aware-exact',
  });
  const runtime = {
    voiceResolver: {
      resolve(nativeIdentity, actor) {
        calls.push({ nativeIdentity: { ...nativeIdentity }, actor: { ...actor } });
        return profile;
      },
    },
    telemetry: {
      beginTurn() {
        return { event(name, data) { events.push({ name, data }); } };
      },
    },
  };

  const connection = new OpenAIConnection({
    runtime,
    onEvent: () => {},
    options: { systemInstruction: 'test', actorContext: initialActor, targetContext: null },
    diagnosticContext: { pedId: '17', sessionNonce: 3 },
  });

  await connection.beginTurn({
    identity: identity(),
    source: 'player_text',
    context: { actor: initialActor, inputText: 'Hello' },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].actor, initialActor);
  const assigned = events.find(event => event.name === 'voice_profile_assigned');
  assert.equal(assigned.data.voice, 'onyx');
  assert.equal(assigned.data.gender, 'male');
  assert.equal(assigned.data.ageBand, 'older');
  assert.equal(assigned.data.selectionMode, 'character-aware-session');

  await connection.beginTurn({
    identity: identity('turn-b', 2),
    source: 'player_text',
    context: { actor: { gender: 'Female', ageRange: '20-25' }, inputText: 'Hello again' },
  });

  assert.equal(calls.length, 1);
});
