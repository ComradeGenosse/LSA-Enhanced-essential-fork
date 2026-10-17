// Drives the PRODUCTION sequential runner with scripted provider/native seams to
// prove the cosmetic-reaction hook (a) fires from the validated line plus the
// matching native playback_started, (b) never alters the turn, and (c) cannot
// break a turn when it throws or when reactions are not configured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSequentialTurn } from '../src/openai/runSequentialTurn.mjs';
import { createReactionService } from '../src/reactions/reactionService.mjs';

const identity = Object.freeze({ pedId: '17', turnId: 'reaction-hook-turn', generationId: 3, sessionNonce: 1 });
const ended = Object.freeze({ ...identity, type: 'playback_ended', reason: 'completed', playbackStarted: true, hadAudio: true, wasInterrupted: false, ok: true });

async function run({ dialogue, command = '', actionCount = 0, reactions, nativeScript = 'normal', source = 'player_text' }) {
  const handoffs = [];
  const controller = new AbortController();
  let observed = () => {}; let terminal = () => {};
  const host = {
    assertCapabilities() {}, isCurrent: () => true, async authorize() { return true; },
    observe(_id, _signal, onTerminal, onObserved) {
      observed = onObserved; terminal = onTerminal;
      return {
        async authorization() { observed({ ...identity, type: 'audio_turn_accepted' }); observed({ ...identity, type: 'playback_started' }); return { ok: true }; },
        async completion() {
          if (nativeScript === 'interrupt') {
            const event = { ...identity, type: 'interrupt', reason: 'player_barge_in' };
            observed(event); terminal(event); return { ...event, ok: false };
          }
          observed(ended); terminal(ended); return ended;
        },
        dispose() {},
      };
    },
    async emit(event) { handoffs.push(event.type); return true; },
    async validateDecision(decision) { return { identityValid: true, internalTranscript: decision.dialogue, actionCount }; },
    async failTurn() {},
  };
  const history = {
    readForSession: () => [], commitPlayerInput: () => true, stage() {}, markModelAndTtsSucceeded() {},
    acceptPlaybackResult: () => true, discard: () => true,
  };
  const services = {
    config: { structuredStreamingEnabled: false, providerWorkDeadlineMs: 10000, playbackCompletionMinMs: 1000, playbackCompletionMaxMs: 10000, playbackCompletionGraceMs: 1000 },
    providerStack: { reasoning: { id: 'test.reasoning' }, speech: { id: 'test.speech' } },
    decide: async () => ({ dialogue, command }),
    async speak({ onPcm }) { await onPcm(Uint8Array.of(1, 2, 3, 4)); return { bytes: 4, chunks: 1 }; },
    ...(reactions === undefined ? {} : { reactions }),
  };
  const outcome = await runSequentialTurn({ connection: { detachAbort() {} }, turn: { identity, source, input: 'Hey.', context: {} }, services, history, host, controller });
  return { outcome: { status: outcome.status, terminalReason: outcome.terminalReason }, handoffs };
}

function recorder() {
  const sent = [];
  const service = createReactionService({ config: { mode: 'on' }, client: { send(frame) { sent.push(frame); return true; } } });
  return { service, sent };
}

test('turn hook: validated exasperated line plus matching playback_started sends one exact-identity frame', async () => {
  const { service, sent } = recorder();
  const withHook = await run({ dialogue: 'Are you kidding me right now?', reactions: service });
  assert.equal(withHook.outcome.status, 'completed');
  assert.deepEqual(sent, [{ reaction: 'facepalm', tuple: { pedId: '17', turnId: 'reaction-hook-turn', generationId: 3 } }]);
});

test('turn hook: the turn is byte-for-byte unchanged with, without, or with a throwing hook', async () => {
  const baseline = await run({ dialogue: 'Are you kidding me right now?' });
  const { service } = recorder();
  const enabled = await run({ dialogue: 'Are you kidding me right now?', reactions: service });
  const broken = await run({ dialogue: 'Are you kidding me right now?', reactions: { openTurn() { throw new Error('boom'); } } });
  const brokenTurn = await run({ dialogue: 'Are you kidding me right now?', reactions: { openTurn: () => ({ native() { throw new Error('x'); }, validated() { throw new Error('y'); }, release() { throw new Error('z'); } }) } });
  assert.deepEqual(enabled, baseline);
  assert.deepEqual(broken, baseline);
  assert.deepEqual(brokenTurn, baseline);
});

test('turn hook: ordinary lines, commands and non-player sources send nothing', async () => {
  for (const options of [
    { dialogue: 'The diner is open late.' },
    { dialogue: 'Are you kidding me?', command: 'followtarget', actionCount: 1 },
    { dialogue: 'Are you kidding me?', source: 'scene_director' },
  ]) {
    const { service, sent } = recorder();
    // Whether the scripted turn itself completes is not the point here (a Director
    // source needs a ticket); a reaction frame must simply never be produced.
    await run({ ...options, reactions: service });
    assert.equal(sent.length, 0, JSON.stringify(options));
  }
});

test('turn hook: an interrupted turn still completes its terminal handling and does not re-send', async () => {
  const { service, sent } = recorder();
  const result = await run({ dialogue: 'Fuck off.', reactions: service, nativeScript: 'interrupt' });
  assert.notEqual(result.outcome.status, 'completed');
  assert.equal(sent.length, 1, 'frame was sent when playback genuinely began, never again afterwards');
});
