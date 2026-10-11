import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStreamingResponsesProvider } from '../src/conversation/streamingResponses.mjs';
import { stageNativeSpeechSegments } from '../src/conversation/segmentPipeline.mjs';
import { PendingDialogue, handleNextTypedTurn } from '../src/conversation/typedTurn.js.mjs';

const offer = () => ({
  status: 'ok', hostRunId: randomUUID(), worldEpoch: 1,
  transportId: randomUUID(), source: 'player_text', playerText: 'What happened?',
  turnId: randomUUID(), sessionNonce: randomUUID(),
  actorIncarnationId: randomUUID(), leaseId: randomUUID(),
  generation: '1', conversationId: randomUUID(), turnOrdinal: 1
});
function native(fixed, recorded) {
  let count = 0, chunks = 0, bytes = 0, marked = 0, stageCount = 0;
  return { closed: new Promise(() => {}),
    async request(type, claims = {}) {
      recorded.push({ type, claims });
      if (type === 'turn.next') return fixed;
      if (type === 'turn.confirm') return { status: 'ok' };
      if (type === 'turn.segment') {
        assert.equal(claims.segmentIndex, stageCount++);
        return { status: 'segment_staged_not_played' };
      }
      if (type === 'audio.open') {
        assert.ok(stageCount > 0);
        return { status: 'audio_authorized_not_playing',
          streamId: randomUUID(), audioLeaseId: randomUUID(),
          audioGeneration: '2', sampleRate: 24000 };
      }
      if (type === 'audio.chunk') {
        assert.equal(claims.chunkIndex, chunks++);
        const pcm = Buffer.from(claims.pcmBase64, 'base64');
        bytes += pcm.length;
        return { status: 'buffered_not_played' };
      }
      if (type === 'audio.segment') {
        assert.equal(claims.segmentIndex, marked++);
        assert.equal(claims.totalBytes, bytes);
        return { status: 'segment_audio_buffered_not_played' };
      }
      if (type === 'turn.segments.end') {
        assert.equal(claims.segmentCount, marked);
        return { status: 'segments_final_not_played' };
      }
      if (type === 'audio.end') {
        assert.equal(claims.chunkCount, chunks);
        assert.equal(claims.totalBytes, bytes);
        return { status: 'sealed_not_played' };
      }
      if (type === 'audio.cancel' || type === 'turn.cancel')
        return { status: 'ok' };
      throw new Error('unexpected_command_' + type);
    }
  };
}
function provider(events, first, after) {
  return createStreamingResponsesProvider({
    apiKey: 'test', model: 'test-model', fetchImpl: async (_url, init) => {
      assert.equal(JSON.parse(init.body).stream, true);
      const encoder = new TextEncoder();
      return {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(
              'data: ' + JSON.stringify({type:'response.output_text.delta',
                delta:'I heard a shot. '}) + '\n\n'));
            first();
            after(controller, encoder);
          }
        })
      };
    }
  });
}
test('first TTS clause begins while Luna response is still streaming, ordered PCM markers', async () => {
  const events = [], a = offer(), rec = [];
  let started, release;
  const first = new Promise(resolve => { started = resolve; });
  const rest = new Promise(resolve => { release = resolve; });
  const ai = provider(events, started, (controller, encoder) => {
    rest.then(() => {
      controller.enqueue(encoder.encode(
        'data: ' + JSON.stringify({type:'response.output_text.delta',
          delta:'Then somebody ran.'}) + '\n\n' +
        'data: ' + JSON.stringify({type:'response.completed',
          response:{status:'completed'}}) + '\n\n'));
      controller.close();
    });
  });
  const tts = {
    async *streamPcm({text}) {
      events.push(['tts', text]);
      yield Buffer.from([1]);
      yield Buffer.from([2, 3, 4]);
    }
  };
  const client = native(a, rec), pending = new PendingDialogue();
  const task = handleNextTypedTurn(client, {
    complete: async () => { throw Error('full_reply_path_called'); },
    streamSpeechSegments: ai.streamSpeechSegments
  }, {
    pending, onStreamingSegments: args =>
      stageNativeSpeechSegments({ ...args, tts })
  });
  await first;
  // Drain microtasks to allow first native+TTS segment without the final model event.
  for (let i = 0; i < 20 && !events.length; i++)
    await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [['tts', 'I heard a shot.']]);
  assert.equal(rec.filter(v => v.type === 'audio.segment').length, 1);
  assert.equal(rec.some(v => v.type === 'turn.segments.end'), false);
  release();
  const out = await task;
  assert.equal(out.state, 'speech_segments_sealed_not_played');
  assert.equal(out.segmentCount, 2);
  assert.equal(pending.pendingCount, 1);
  assert.deepEqual(events, [
    ['tts', 'I heard a shot.'],
    ['tts', 'Then somebody ran.']
  ]);
  assert.equal(rec.filter(v => v.type === 'audio.open').length, 1);
  assert.equal(rec.filter(v => v.type === 'audio.segment').length, 2);
  assert.equal(rec.filter(v => v.type === 'audio.end').length, 1);
  assert.equal(typeof pending.commit, 'undefined');
});

test('model never completing cancels exact stream and does not stage completed history', async () => {
  const nativeTurn = offer(), rec = [], abort = new AbortController();
  const ai = {
    async *streamSpeechSegments() {
      yield 'One full clause.';
      throw new Error('provider_incomplete');
    },
    async complete() { throw Error('not_called'); }
  };
  const tts = { async *streamPcm() { yield Buffer.from([1,2]); } };
  const staged = new PendingDialogue();
  await assert.rejects(handleNextTypedTurn(native(nativeTurn, rec), ai, {
    pending: staged, signal: abort.signal,
    onStreamingSegments: args => stageNativeSpeechSegments({...args,tts})
  }), /provider_incomplete/);
  assert.equal(staged.pendingCount, 0);
  assert.equal(rec.filter(x => x.type === 'audio.cancel').length, 1);
  assert.equal(rec.filter(x => x.type === 'turn.cancel').length, 1);
  assert.equal(rec.some(x => x.type === 'audio.end'), false);
});

test('rejects structured tool stream before authorizing NPC sound', async () => {
  const ai = createStreamingResponsesProvider({
    apiKey:'test', model:'test-model',
    fetchImpl: async () => ({ ok:true, body: new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode('data: ' + JSON.stringify({
          type:'response.output_item.added', item:{type:'function_call'}
        }) + '\n\n'));
        c.close();
      }
    }) })
  });
  await assert.rejects((async () => {
    for await (const _ of ai.streamSpeechSegments({text:'Hello'})) {}
  })(), /provider_unsupported_output/);
});

test('rejects excessive unpunctuated stream before native segment staging', async () => {
  const ai = createStreamingResponsesProvider({
    apiKey:'test', model:'test-model',
    fetchImpl:async () => ({ok:true,body:new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({
          type:'response.output_text.delta',delta:'a'.repeat(501)
        }) + '\n\n'));
        c.close();
      }
    })})
  });
  await assert.rejects((async () => {
    for await (const _ of ai.streamSpeechSegments({text:'Hi'})) {}
  })(), /speech_segment_capacity/);
});

test('Luna reasoning item is ignored; SSE CRLF fragmentation still emits only prose', async () => {
  const event = p => 'data: ' + JSON.stringify(p) + '\r\n\r\n';
  const stream = event({
    type:'response.output_item.added', item:{type:'reasoning'}
  }) + event({
    type:'response.output_text.delta', delta:'A car drove away.'
  }) + event({
    type:'response.completed',
    response:{status:'completed',output:[
      {type:'reasoning',summary:[]},
      {type:'message',role:'assistant',
        content:[{type:'output_text',text:'A car drove away.'}]}
    ]}
  });
  const encoded = new TextEncoder().encode(stream);
  const ai = createStreamingResponsesProvider({
    apiKey:'test', model:'test-model', fetchImpl: async () => ({
      ok:true, body: new ReadableStream({
        start(c) {
          for (let i=0; i<encoded.length; i+=7)
            c.enqueue(encoded.subarray(i, i+7));
          c.close();
        }
      })
    })
  });
  const segments = [];
  for await (const s of ai.streamSpeechSegments({text:'Where did it go?'}))
    segments.push(s);
  assert.deepEqual(segments,['A car drove away.']);
});

test('model-produced action JSON is not sent to TTS', async () => {
  const ai = createStreamingResponsesProvider({
    apiKey:'test', model:'test-model', fetchImpl:async () => ({
      ok:true,body:new ReadableStream({
        start(c) {
          const out = 'data: ' + JSON.stringify({
            type:'response.output_text.delta',
            delta:'{"action":"attack"}. '
          }) + '\n\n';
          c.enqueue(new TextEncoder().encode(out));
          c.close();
        }
      })
    })
  });
  await assert.rejects((async () => {
    for await (const _ of ai.streamSpeechSegments({text:'Do something'})) {}
  })(), /provider_unsupported_output/);
});
