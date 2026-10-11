import { createServer } from 'node:http';
import { Phase2NativeClient } from '../src/native/phase2Wire.mjs';
import { handleNextTypedTurn, PendingDialogue } from '../src/conversation/typedTurn.js.mjs';
import { createConfiguredSpeechRouter } from '../src/audio/speechSetup.mjs';
import { stageNativePcmStream } from '../src/audio/nativePcm.mjs';

// Cross-process production pipeline, with only the real OpenAI endpoint
// replaced by a loopback HTTP fixture. Native output is simulated and cannot
// produce playback receipts, so history is always UNCOMMITTED.
const client = new Phase2NativeClient();
const pending = new PendingDialogue();
let requestCount = 0;
const speech = createServer((req, res) => {
  let json = '';
  req.on('data', bytes => { json += bytes.toString('utf8'); });
  req.on('end', () => {
    try {
      const body = JSON.parse(json);
      if (req.method !== 'POST' || req.url !== '/v1/audio/speech' ||
          req.headers.authorization !== undefined ||
          body.response_format !== 'pcm' || body.voice !== 'nathan' ||
          body.model !== 'qwen3-tts' ||
          body.input !== 'Fixture generated answer.')
        throw new Error('incorrect_speech_request');
      requestCount++;
      res.writeHead(200, {
        'Content-Type': 'audio/pcm', 'x-lsa-sample-rate': '24000'
      });
      const pcm = Buffer.alloc(336000);
      for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(i % 32000, i);
      // Deliberately odd frame sizes to exercise PCM sample reassembly.
      for (let i = 0; i < pcm.length; i += 1187)
        res.write(pcm.subarray(i, i + 1187));
      res.end();
    } catch {
      res.writeHead(400); res.end();
    }
  });
});
try {
  await new Promise((resolve, reject) => {
    speech.once('error', reject);
    speech.listen(0, '127.0.0.1', resolve);
  });
  const tts = await createConfiguredSpeechRouter({
    LSA_STANDALONE_TTS_PROVIDER: 'faster-qwen3-tts',
    LSA_STANDALONE_TTS_VOICE: 'nathan',
    LSA_STANDALONE_QWEN_VOICES: 'nathan',
    LSA_STANDALONE_QWEN_URL:
      'http://127.0.0.1:' + speech.address().port + '/v1'
  });
  await client.connect();
  const result = await handleNextTypedTurn(client, {
    async complete() { return 'Fixture generated answer.'; }
  }, {
    pending,
    onReplyStaged: ({ client: native, claims, replyText, signal }) =>
      stageNativePcmStream(native, claims,
        tts.streamPcm({ text: replyText, identity: offer, signal }), { signal })
  });
  if (result.state !== 'pcm_sealed_not_played' || requestCount !== 1 ||
      pending.pendingCount !== 1 || typeof pending.commit !== 'undefined')
    throw new Error('speech_pipeline_not_truthful');
  console.log(JSON.stringify({
    state: result.state, qwenTtsHttpRequests: requestCount,
    nativeOutput: 'test_sink_only', npcAudible: false, historyCommitted: false
  }));
} catch (error) {
  console.error('qwen_tts_http_native_fixture_failed:' + error.message);
  process.exitCode = 1;
} finally {
  pending.retireAll();
  client.close();
  await new Promise(resolve => speech.close(resolve));
}
