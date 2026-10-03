import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { buildRequest, extractResponseText, parseDecisionJson } from '../src/context/essentialDecision.mjs';
import { decide } from '../src/openai/decide.mjs';
import { transcribePcm, pcm16Wav } from '../src/openai/transcribe.mjs';
import { validateStockDecision } from '../src/context/decisionValidator.mjs';

test('config preserves Luna, the transcription alias, fixed TTS and bounded PTT defaults', () => {
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'unit-test-key' });
  assert.equal(config.provider, 'openai');
  assert.equal(config.reasoningModel, 'gpt-6-luna');
  assert.equal(config.reasoningEffort, 'low');
  assert.equal(config.transcriptionModel, 'gpt-transcribe');
  assert.equal(config.ttsModel, 'gpt-4o-mini-tts');
  assert.equal(config.ttsVoice, 'nova');
  assert.equal(config.maxMicPcmBytes, 960_000);
  assert.equal(config.providerWorkDeadlineMs, 45_000);
  assert.equal(config.turnDeadlineMs, 45_000);
  assert.equal(config.playbackCompletionMinMs, 60_000);
  assert.equal(config.structuredStreamingEnabled, false);
  assert.equal(config.earlyTtsEnabled, false);
  assert.equal(config.streamingMaxPcmBytes, 6_291_456);
  assert.throws(() => normalizeConfig({ streamingMaxPcmBytes: 47_999 }), /streamingMaxPcmBytes/);
  assert.throws(() => normalizeConfig({ earlyTtsEnabled: true }, {}), /requires structuredStreamingEnabled/);
  assert.throws(() => normalizeConfig({ structuredStreamingEnabled: true, provider: 'gemini' }, {}), /only by the OpenAI provider/);
  assert.equal(normalizeConfig({ turnDeadlineMs: 30_000 }, {}).providerWorkDeadlineMs, 30_000);
  assert.throws(() => normalizeConfig({ playbackCompletionMinMs: 90_000, playbackCompletionMaxMs: 60_000 }, {}), /greater than or equal/);
  assert.equal(config.reasoningKey, 'unit-test-key');
  assert.equal(normalizeConfig({ reasoningEffort: 'max' }, {}).reasoningEffort, 'max');
  assert.throws(() => normalizeConfig({ reasoningEffort: 'minimal' }, {}), /reasoningEffort/);
  assert.throws(() => normalizeConfig({ reasoningBaseUrl: 'file:///private' }, {}), /HTTP/);
  assert.throws(() => normalizeConfig({ maxMicDurationMs: 30_001 }, {}), /maxMicDurationMs/);
});

test('strict decisions reject refusals, extra keys, multiple commands and command text in dialogue', () => {
  assert.throws(() => extractResponseText({ status: 'incomplete', output: [] }), /not completed/);
  assert.throws(() => extractResponseText({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), /refused/);
  assert.deepEqual(parseDecisionJson('{"dialogue":"Hello.","command":""}'), { dialogue: 'Hello.', command: '' });
  assert.throws(() => parseDecisionJson('{"dialogue":"Hello.","command":"","extra":true}'), /only dialogue and command/);
  assert.throws(() => parseDecisionJson('{"dialogue":"Hello.","command":"DO Follow P001\\nDO WaitHere"}'), /one complete DO command/);
  assert.throws(() => parseDecisionJson('{"dialogue":"Hello.\\nDO Arrest P001","command":""}'), /control command/);
});

test('stock action validator enforces the actor allow list, target and available weapon snapshot', () => {
  const common = {
    identity: { pedId: '17', turnId: 't1', generationId: 1, sessionNonce: 1 },
    actor: { availableWeapons: ['Pistol'], nearbyPersonReferences: { P001: '23' } },
    referenceSnapshot: { persons: { P001: '23' }, vehicles: {} },
    parseActions: command => command.includes('Attack') ? [{ actionName: 'attacktargetwithweapon', target: command.match(/AttackTargetWithWeapon\s+(P\d{3})/i)?.[1] || 'P001', parameter: command.match(/USING\s+(\w+)/i)?.[1] || 'Pistol' }] : [{ actionName: 'waithere', target: '', parameter: '' }],
    allowedActionNames: new Set(['attacktargetwithweapon', 'waithere']),
    resolvePerson: reference => reference === 'P001',
    resolveVehicle: () => false,
  };
  const validated = validateStockDecision({ dialogue: 'Stay close.', command: 'DO WaitHere' }, common);
  assert.equal(validated.actionCount, 1);
  assert.equal(validated.internalTranscript, 'DO WaitHere|Stay close.');
  assert.throws(() => validateStockDecision({ dialogue: 'Wait.', command: 'DO WaitHere' }, { ...common, allowedActionNames: new Set() }), /available to this actor/);
  assert.equal(validateStockDecision({ dialogue: 'Ready.', command: 'DO AttackTargetWithWeapon P001 USING Pistol' }, { ...common, actor: { equippedWeaponDescription: 'Pistol' } }).actionCount, 1);
  assert.throws(() => validateStockDecision({ dialogue: 'Stay close.', command: 'DO AttackTargetWithWeapon P001 USING Rifle' }, common), /weapon/);
  assert.throws(() => validateStockDecision({ dialogue: 'Stay close.', command: 'DO AttackTargetWithWeapon P001 USING Pistol' }, { ...common, actor: { availableWeaponsContext: 'Available weapons: none' } }), /weapon/);
  assert.throws(() => validateStockDecision({ dialogue: 'Stay close.', command: 'DO AttackTargetWithWeapon P001 USING Pistol' }, { ...common, actor: {} }), /weapon/);
  assert.throws(() => validateStockDecision({ dialogue: 'Stay close.', command: 'DO AttackTargetWithWeapon P999 USING Pistol' }, common), /target/);
  assert.throws(() => validateStockDecision({ dialogue: 'Follow them.', command: 'DO Follow P001' }, {
    ...common, parseActions: () => [{ actionName: 'followtarget', target: 'P001', parameter: '' }],
    allowedActionNames: new Set(['followtarget']), resolvePerson: () => '24',
  }), /changed after reasoning/);
  assert.throws(() => validateStockDecision({ dialogue: 'Follow them.', command: 'DO Follow P001' }, {
    ...common, parseActions: () => [{ actionName: 'followtarget', target: 'P001', parameter: '' }],
    allowedActionNames: new Set(['followtarget']), resolvePerson: () => null,
  }), /no longer available/);
  assert.deepEqual(validateStockDecision({ dialogue: 'Follow them.', command: 'DO Follow P001' }, {
    ...common, parseActions: () => [{ actionName: 'followtarget', target: 'P001', parameter: '' }],
    allowedActionNames: new Set(['followtarget']), resolvePerson: () => '23',
  }).referenceBindings, { persons: { P001: '23' }, vehicles: {} });
  assert.throws(() => validateStockDecision({ dialogue: 'Drive there.', command: 'DO DriveTo V999' }, {
    ...common, parseActions: () => [{ actionName: 'drivetodestination', target: '', parameter: 'V999' }],
    allowedActionNames: new Set(['drivetodestination']),
  }), /vehicle/);
  assert.throws(() => validateStockDecision({ dialogue: 'Stay close.', command: 'DO WaitHere, DO WaitHere' }, common), /one stock action/);
});

test('Responses request uses one completed strict JSON decision and extracts output across content blocks', async () => {
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'test-key' });
  let observed;
  let tracedRequest;
  const tracedReplies = [];
  const fakeFetch = async (url, init) => {
    observed = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', content: [{ type: 'output_text', text: '{"dialogue":"' }, { type: 'output_text', text: 'Hi there.","command":""}' }] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await decide({
    config,
    context: { systemInstruction: 'stock prompt', actor: { roleName: 'Civilian' }, input: 'hello' },
    input: 'hello', history: [], signal: new AbortController().signal, fetchImpl: fakeFetch,
    dialogueAttempt: { request: value => { tracedRequest = value; }, outputText: (text, meta) => tracedReplies.push({ text, ...meta }) },
  });
  assert.deepEqual(result, { dialogue: 'Hi there.', command: '' });
  assert.equal(observed.url, 'https://api.openai.com/v1/responses');
  assert.equal(observed.init.headers.authorization, 'Bearer test-key');
  assert.equal(observed.body.model, 'gpt-6-luna');
  assert.equal(observed.body.reasoning.effort, 'low');
  assert.equal(observed.body.store, false);
  assert.equal(observed.body.stream, false);
  assert.equal(observed.body.text.format.strict, true);
  assert.equal(observed.body.text.format.schema.additionalProperties, false);
  assert.match(observed.body.input[0].content, /stock prompt/);
  assert.deepEqual(tracedRequest, observed.body);
  assert.equal(tracedReplies.map(item => item.text).join(''), '{"dialogue":"Hi there.","command":""}');
});

test('dialogue trace captures malformed model decision text before strict parsing rejects it', async () => {
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'test-key' }); const replies = [];
  await assert.rejects(decide({
    config, context: { systemInstruction: 'stock', actor: null }, input: 'hello', history: [], signal: new AbortController().signal,
    fetchImpl: async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{bad json' }] }] }), { status: 200 }),
    dialogueAttempt: { request() {}, outputText: text => replies.push(text) },
  }), /invalid decision JSON/);
  assert.deepEqual(replies, ['{bad json']);
});

test('missing actor/world and unavailable listener context are explicit in the request', () => {
  const request = buildRequest({ model: 'test', effort: 'low', systemInstruction: 'stock', actor: null, listener: null, world: null, input: 'Hello' });
  assert.match(request.input[0].content, /CURRENT ACTOR DATA\s*\{"status":"unknown"\}/);
  assert.match(request.input[0].content, /CURRENT LISTENER DATA\s*\{"status":"unavailable"\}/);
  assert.match(request.input[0].content, /CURRENT WORLD DATA\s*\{"status":"unknown"\}/);
});

test('PTT PCM is wrapped once as a mono 16-bit WAV upload', async () => {
  const pcm = Uint8Array.from([1, 2, 3, 4]);
  const wav = pcm16Wav(pcm, 16_000);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 4);
  let observed;
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'test-key' });
  const transcript = await transcribePcm({ pcm, sampleRate: 16_000, config, signal: new AbortController().signal, fetchImpl: async (url, init) => {
    observed = { url, init, fields: [...init.body.keys()] };
    return new Response(JSON.stringify({ text: 'Where am I?' }), { status: 200 });
  } });
  assert.equal(transcript, 'Where am I?');
  assert.equal(observed.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.deepEqual(observed.fields.sort(), ['file', 'model']);
  assert.equal(observed.init.body.get('model'), 'gpt-transcribe');
});

test('vehicle parameters must be verified references, not arbitrary names', () => {
  for (const parameter of ['V999','random vehicle']) assert.throws(() => validateStockDecision({dialogue:'Okay.',command:'DO EnterDriverSeat '+parameter},{
    identity:{pedId:'17',turnId:'t',generationId:1,sessionNonce:1},actor:{},
    parseActions:()=>[{actionName:'enterdriverseatoftargetvehicle',target:'',parameter}],
    allowedActionNames:new Set(['enterdriverseatoftargetvehicle']),resolvePerson:()=>true,resolveVehicle:()=>false,
  }),/vehicle/);
});
