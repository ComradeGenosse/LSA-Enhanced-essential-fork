import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { speak } from '../src/openai/speak.mjs';
import { DialogueHistory } from '../src/memory/dialogueHistory.mjs';

test('TTS keeps even PCM16 samples across odd HTTP chunk boundaries and sends fixed voice', async () => {
  const chunks = [Uint8Array.from([1]), Uint8Array.from([2, 3])];
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (chunks.length) controller.enqueue(chunks.shift());
      else controller.close();
    },
  }), { status: 200 });
  let observed;
  const received = [];
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'test-key' });
  const result = await speak({
    config, dialogue: 'Good evening.', signal: new AbortController().signal,
    fetchImpl: async (url, init) => { observed = { url, body: JSON.parse(init.body) }; return response; },
    onPcm: async bytes => received.push([...bytes]),
  });
  assert.equal(observed.url, 'https://api.openai.com/v1/audio/speech');
  assert.deepEqual(observed.body, { model: 'gpt-4o-mini-tts', voice: 'nova', input: 'Good evening.', response_format: 'pcm' });
  assert.deepEqual(received, [[1, 2]]);
  assert.equal(result.bytes, 2);
  assert.equal(result.discardedTrailingByte, true);
});

test('player history commits independently while assistant history waits for matching playback', () => {
  const history = new DialogueHistory({ maxMessages: 4 });
  const identity = { pedId: '17', turnId: 'turn-a', generationId: 4, sessionNonce: 2 };
  history.commitPlayerInput({ identity, input: 'Hello' });
  history.stage({ identity, spokenReply: 'Hi.' });
  history.markModelAndTtsSucceeded(identity);
  assert.equal(history.acceptPlaybackResult({ ...identity, playbackSucceeded: false, wasInterrupted: true, hadAudio: true, playbackStarted: true }), false);
  assert.deepEqual(history.readForSession('17', 2), [{ role: 'user', content: 'Hello' }]);
  history.stage({ identity, spokenReply: 'Hi.' });
  history.markModelAndTtsSucceeded(identity);
  assert.equal(history.commitPlayerInput({ identity, input: 'Hello' }), false);
  assert.equal(history.acceptPlaybackResult({ ...identity, playbackSucceeded: true, wasInterrupted: false, hadAudio: true, playbackStarted: true }), true);
  assert.deepEqual(history.readForSession('17', 2), [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi.' }]);
  assert.equal(history.acceptPlaybackResult({ ...identity, playbackSucceeded: true, wasInterrupted: false, hadAudio: true, playbackStarted: true }), false);
  history.clearSession('17', 2);
  assert.deepEqual(history.readForSession('17', 2), []);
});

test('player commit is idempotent and bounded history trims old turns', () => {
  const history = new DialogueHistory({ maxMessages: 3 });
  for (let i = 0; i < 3; i++) {
    const identity = { pedId: '17', turnId: `turn-${i}`, generationId: i, sessionNonce: 2 };
    assert.equal(history.commitPlayerInput({ identity, input: `Question ${i}` }), true);
    assert.equal(history.commitPlayerInput({ identity, input: `Question ${i}` }), false);
  }
  assert.deepEqual(history.readForSession('17', 2), [
    { role: 'user', content: 'Question 0' },
    { role: 'user', content: 'Question 1' },
    { role: 'user', content: 'Question 2' },
  ]);
});
