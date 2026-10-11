import { createServer } from 'node:http';
import { Phase2NativeClient } from '../src/native/phase2Wire.mjs';
import { handleNextTypedTurn, PendingDialogue } from '../src/conversation/typedTurn.js.mjs';
import { createStreamingResponsesProvider } from '../src/conversation/streamingResponses.mjs';
import { createConfiguredSpeechRouter } from '../src/audio/speechSetup.mjs';
import { stageNativeSpeechSegments } from '../src/conversation/segmentPipeline.mjs';

// TRUE native host process + streaming Luna-compatible SSE + Qwen-compatible
// PCM loopback HTTP. Deliberately withheld Luna final until first TTS request
// proves TTS starts before the answer is finished. No paid provider, no GTA.
const client = new Phase2NativeClient();
const pending = new PendingDialogue();
let firstTts = 0, completedModel = 0, ttsCalls = 0;
let finishLuna;
const luna = createServer((req,res) => {
  let input = '';
  req.on('data', bytes => { input += bytes.toString(); });
  req.on('end', () => {
    try {
      const p = JSON.parse(input);
      if (req.url !== '/v1/responses' || req.method !== 'POST' ||
          p.stream !== true || p.store !== false || !p.input ||
          req.headers.authorization !== 'Bearer fixture-key')
        throw Error('invalid_sse_request');
      res.writeHead(200, {'Content-Type':'text/event-stream'});
      res.write('data: ' + JSON.stringify({
        type:'response.output_text.delta', delta:'I heard a shot. '
      }) + '\n\n');
      finishLuna = () => {
        completedModel++;
        res.write('data: ' + JSON.stringify({
          type:'response.output_text.delta', delta:'Then someone ran.'
        }) + '\n\n');
        res.write('data: ' + JSON.stringify({
          type:'response.completed', response:{status:'completed'}
        }) + '\n\n');
        res.end();
      };
    } catch { res.writeHead(400); res.end(); }
  });
});
const qwen = createServer((req,res) => {
  let input = '';
  req.on('data', bytes => { input += bytes.toString(); });
  req.on('end', () => {
    try {
      const body = JSON.parse(input);
      if (req.url !== '/v1/audio/speech' || req.method !== 'POST' ||
          req.headers.authorization !== undefined ||
          body.model !== 'qwen3-tts' || body.voice !== 'nathan' ||
          body.response_format !== 'pcm')
        throw Error('invalid_qwen_request');
      ttsCalls++;
      if (ttsCalls === 1) {
        if (completedModel) throw Error('first_tts_after_model_completed');
        firstTts++;
        // Respond with PCM before finishing the model reply: this fixture
        // asserts actual model/TTS overlap rather than only method invocation.
      }
      res.writeHead(200, {'Content-Type':'audio/pcm', 'x-lsa-sample-rate':'24000'});
      res.end(Buffer.alloc(4000, 3));
      if (ttsCalls === 1) setImmediate(() => finishLuna?.());
    } catch { res.writeHead(400); res.end(); }
  });
});
try {
  await Promise.all([new Promise(resolve => luna.listen(0,'127.0.0.1',resolve)),
    new Promise(resolve => qwen.listen(0,'127.0.0.1',resolve))]);
  const ai = createStreamingResponsesProvider({
    apiKey:'fixture-key', model:'fixture-model',
    endpoint:'http://127.0.0.1:' + luna.address().port + '/v1/responses'
  });
  const tts = await createConfiguredSpeechRouter({
    LSA_STANDALONE_TTS_PROVIDER:'faster-qwen3-tts',
    LSA_STANDALONE_TTS_VOICE:'nathan', LSA_STANDALONE_QWEN_VOICES:'nathan',
    LSA_STANDALONE_QWEN_URL:'http://127.0.0.1:' + qwen.address().port + '/v1'
  });
  await client.connect();
  const output = await handleNextTypedTurn(client, {
    complete:async () => { throw Error('unexpected_full_reply'); },
    streamSpeechSegments:ai.streamSpeechSegments
  }, {
    pending, onStreamingSegments: args =>
      stageNativeSpeechSegments({ ...args, tts })
  });
  if (output.state !== 'speech_segments_sealed_not_played' ||
      output.segmentCount !== 2 || firstTts !== 1 ||
      completedModel !== 1 || ttsCalls !== 2 ||
      pending.pendingCount !== 1)
    throw Error('segment_fixture_incorrect');
  console.log(JSON.stringify({
    state:output.state, earlyTtsBeforeModelFinal:true,
    segments:output.segmentCount, ttsCalls,
    history:'uncommitted', device:'test_sink_only', audible:false
  }));
} catch(error) {
  console.error('early_speech_fixture_failed:' + error.message);
  process.exitCode = 1;
} finally {
  pending.retireAll();
  client.close();
  await Promise.all([
    new Promise(resolve => luna.close(resolve)),
    new Promise(resolve => qwen.close(resolve))
  ]);
}
