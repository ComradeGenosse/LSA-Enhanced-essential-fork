import { loadConfig } from '../src/config/e1Config.mjs';
import { loadPrivateEnvironment } from '../src/config/privateEnvironment.mjs';
import { decideStreaming } from '../src/openai/decide.mjs';

if (process.env.LSA_E5_LIVE_API_SMOKE !== '1') {
  throw new Error('Set LSA_E5_LIVE_API_SMOKE=1 to authorize one billable Responses streaming smoke request.');
}
const env = await loadPrivateEnvironment();
const config = await loadConfig({ env });
if (!config.reasoningKey) throw new Error('No reasoning API credential is configured; no request was sent.');
const started = performance.now();
const segments = [];
const result = await decideStreaming({
  config,
  source: 'player_text',
  input: 'In one brief sentence, say hello. Do not request or perform an action.',
  history: [],
  signal: new AbortController().signal,
  context: {
    source: 'player_text', actor: null, listener: null, world: null, internalEvent: '', contextText: '',
    systemInstruction: 'You are an NPC in a game. Reply in one brief spoken sentence. Use dialogue_only and leave command empty.',
  },
  onSegment: segment => segments.push({ sequence: segment.sequence, atMs: Math.round(performance.now() - started), chars: segment.text.length }),
});
const terminalAtMs = Math.round(performance.now() - started);
console.log(JSON.stringify({
  status: 'completed', model: config.reasoningModel, mode: result.mode,
  segments, segmentCount: result.segments.length, firstSegmentBeforeTerminal: segments.length > 0 && segments[0].atMs < terminalAtMs,
  terminalAtMs, commandEmpty: result.decision.command === '',
}, null, 2));
