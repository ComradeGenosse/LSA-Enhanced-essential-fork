import { createServer } from 'node:http';
import { Phase2NativeClient } from '../src/native/phase2Wire.mjs';
import { createResponsesProvider } from '../src/conversation/responsesProvider.mjs';
import { PendingDialogue, handleNextTypedTurn } from '../src/conversation/typedTurn.js.mjs';

// Offline fixture only. --http-stub exercises production Responses adapter
// over a REAL loopback HTTP request, not an OpenAI connection. No GTA audio
// playback or durable dialogue completion is claimed.
const useHttpStub = process.argv.includes('--http-stub');
let stub, stubRequests = 0;
const client = new Phase2NativeClient();
const pending = new PendingDialogue();
try {
  let provider = {
    async complete({ text }) { return 'Fixture understood: ' + text; }
  };
  if (useHttpStub) {
    stub = createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => {
        raw += chunk.toString('utf8');
        if (raw.length > 8192) req.destroy();
      });
      req.on('end', () => {
        try {
          const request = JSON.parse(raw);
          if (req.method !== 'POST' || req.url !== '/v1/responses' ||
              req.headers.authorization !== 'Bearer fixture-token' ||
              request.store !== false || request.model !== 'fixture-model' ||
              request.input !== 'Can you describe the scene?')
            throw new Error('incorrect_model_request');
          stubRequests++;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'completed', output: [{
            type: 'message', role: 'assistant',
            content: [{ type: 'output_text', text: 'Fixture HTTP answer.' }]
          }] }));
        } catch {
          res.writeHead(400); res.end('invalid_request');
        }
      });
    });
    await new Promise((resolve, reject) => {
      stub.once('error', reject);
      stub.listen(0, '127.0.0.1', resolve);
    });
    provider = createResponsesProvider({
      apiKey: 'fixture-token', model: 'fixture-model',
      endpoint: 'http://127.0.0.1:' + stub.address().port + '/v1/responses'
    });
  }
  await client.connect();
  const outcome = await handleNextTypedTurn(client, provider, { pending });
  if (outcome.state !== 'staged_not_played' || pending.pendingCount !== 1)
    throw new Error('fixture_incomplete');
  if (useHttpStub && stubRequests !== 1)
    throw new Error('response_adapter_not_called_exactly_once');
  console.log(JSON.stringify({ result: outcome.state, pending: pending.pendingCount,
    playback: 'not_attempted', history: 'uncommitted',
    provider: useHttpStub ? 'loopback_responses_stub' : 'deterministic_fixture' }));
} catch (error) {
  console.error('typed_fixture_failed:' + error.message);
  process.exitCode = 1;
} finally {
  pending.retireAll();
  client.close();
  if (stub) await new Promise(resolve => stub.close(resolve));
}
