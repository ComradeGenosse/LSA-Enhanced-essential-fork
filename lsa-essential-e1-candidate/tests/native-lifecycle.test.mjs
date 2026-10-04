import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { sameIdentity, observeNative } from '../src/integration/nativeDelivery.mjs';
import { DialogueHistory } from '../src/memory/dialogueHistory.mjs';
import { requestBytes, requestJson } from '../src/openai/request.mjs';
import { buildRequest } from '../src/context/essentialDecision.mjs';

const id = Object.freeze({ pedId: '17', turnId: 'native-40', generationId: 901, sessionNonce: 5 });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture({ decide, speak, authorize, emit, validateDecision, deadline = 1000, playbackDeadline = 1000 } = {}) {
  const config = { ...normalizeConfig({}, {}), providerWorkDeadlineMs: deadline, turnDeadlineMs: deadline,
    playbackCompletionMinMs: playbackDeadline, playbackCompletionMaxMs: playbackDeadline, playbackCompletionGraceMs: 5 };
  const runtime = createRuntime(config, { fetchImpl: () => { throw new Error('No network permitted'); } });
  const listeners = new Set(), events = [], failures = [], logs = [];
  let current = id;
  const native = (identity, type, fields = {}) => { for (const f of [...listeners]) f({ ...identity, type, ...fields }); };
  const complete = (identity = id, fields = {}) => native(identity, 'playback_ended', { reason: 'completed', wasInterrupted: false, hadAudio: true, playbackStarted: true, ...fields });
  const bridge = {
    assertCapabilities: () => true,
    isCurrent: identity => sameIdentity(identity, current),
    validateDecision: validateDecision || (decision => ({ identityValid: true, internalTranscript: decision.dialogue })),
    onNativeEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    authorize: identity => authorize ? authorize(identity, native) : (native(identity, 'audio_turn_accepted'), true),
    routePinnedEvent: async event => { events.push(event); if (emit) return emit(event, complete, native); if (event.type === 'turn_complete') complete(event); return true; },
    failMatchingTurn: (identity, error, details) => { failures.push({ identity, error, details }); return true; },
    log: (_, state, details) => logs.push({ state, details }),
  };
  runtime.attachBridge(bridge);
  runtime.services.decide = decide || (async () => ({ dialogue: 'Hello.', command: '' }));
  runtime.services.speak = speak || (async ({ onPcm }) => { await onPcm(new Uint8Array([1,2])); return { bytes: 2 }; });
  const connection = await runtime.createTransport(() => { throw new Error('Gemini constructed'); }).connect({ systemInstruction: 'stock', diagnosticContext: id });
  const begin = async (identity = id, source = 'player_text', inputText = 'Hello') => {
    current = identity;
    await connection.beginTurn({ identity, source, context: { inputText, contextText: source === 'special_event' ? inputText : '', systemInstruction: 'stock' } });
    await connection.sendText(inputText);
    return connection.whenSettled(identity);
  };
  return { runtime, connection, begin, events, failures, logs, complete, native, listeners, setCurrent: value => { current = value; } };
}

test('authorization must be accepted before the first tagged PCM; synchronous completion is retained', async () => {
  const gate = deferred();
  const f = await fixture({ authorize: async (identity, native) => { await gate.promise; native(identity, 'audio_turn_accepted'); return true; } });
  const done = f.begin(); await tick();
  assert.equal(f.events.filter(e => e.type === 'audio').length, 0);
  gate.resolve(); assert.equal((await done).status, 'completed');
  assert.equal(f.runtime.history.readForSession('17', 5).length, 2);
  assert.equal(f.events.filter(e => e.type === 'turn_complete').length, 1);
  assert.equal(f.listeners.size, 0);
});

for (const outcome of ['rejected', 'timeout', 'superseded', 'abort']) test(`native authorization ${outcome} sends no PCM/end and retains only valid player history`, async () => {
  const f = await fixture({ deadline: 30, authorize: (identity, native) => {
    if (outcome === 'rejected') native(identity, 'audio_turn_rejected', { reason: 'spatial_rejected' });
    return true;
  } });
  const done = f.begin(); await tick();
  if (outcome === 'superseded') { f.setCurrent({ ...id, generationId: 902 }); f.native(id, 'audio_turn_accepted'); }
  if (outcome === 'abort') { f.connection.abortTurn(id); f.native(id, 'audio_turn_accepted'); }
  const result=await done;
  assert.notEqual(result.status, 'completed');
  if(outcome==='rejected') assert.equal(result.terminalReason,'native_auth_rejected');
  if(outcome==='timeout') assert.equal(result.terminalReason,'provider_timeout');
  if(outcome==='superseded') assert.equal(result.terminalReason,'superseded');
  if(outcome==='abort') assert.equal(result.terminalReason,'cancelled');
  assert.equal(f.events.some(e => ['audio','turn_complete','generation_complete'].includes(e.type)), false);
  assert.deepEqual(f.runtime.history.readForSession('17', 5), [{ role: 'user', content: 'Hello' }]);
  assert.equal(f.listeners.size, 0);
});

for (const [key, value] of [['pedId','18'],['turnId','native-41'],['generationId',902],['sessionNonce',6]]) test(`wrong ${key} completion is ignored without deleting staged history`, async () => {
  const f = await fixture({ emit: (event, complete) => { if (event.type === 'turn_complete') { complete({ ...event, [key]: value }); queueMicrotask(() => complete(event)); } return true; } });
  assert.equal((await f.begin()).status, 'completed');
  assert.equal(f.runtime.history.readForSession('17', 5).length, 2);
});

for (const fields of [{ wasInterrupted: true },{ hadAudio: false },{ playbackStarted: false },{ reason: 'playback_error' },{ reason: 'completed_no_audio' }]) test(`non-delivery discards history ${JSON.stringify(fields)}`, async () => {
  const f = await fixture({ emit: (event, complete) => { if (event.type === 'turn_complete') complete(event, fields); return true; } });
  assert.notEqual((await f.begin()).status, 'completed');
  assert.deepEqual(f.runtime.history.readForSession('17', 5), [{ role: 'user', content: 'Hello' }]);
});

test('missing completion expires only the playback watchdog and late completion cannot commit', async () => {
  const f = await fixture({ deadline: 1000, playbackDeadline: 25, emit: () => true });
  const result = await f.begin();
  assert.equal(result.status, 'ack_timeout');
  assert.equal(result.terminalReason, 'playback_ack_timeout');
  f.complete(); assert.deepEqual(f.runtime.history.readForSession('17', 5), [{ role: 'user', content: 'Hello' }]);
  assert.equal(f.listeners.size, 0);
});

test('duplicate completion and duplicate text submission each take effect once', async () => {
  const f = await fixture();
  const done = f.begin(); await tick();
  await done;
  assert.equal(await f.connection.sendText('duplicate'), false);
  f.complete(); f.complete();
  assert.equal(f.runtime.history.readForSession('17', 5).length, 2);
  assert.equal(f.events.filter(e => e.type === 'output_transcript').length, 1);
});

for (const phase of ['model','tts','pcm','completion','transcription']) test(`cancel during ${phase} retires exact work`, async () => {
  const gate = deferred(); let f;
  f = await fixture({
    decide: phase === 'model' ? async () => { await gate.promise; return { dialogue: 'Late.', command: '' }; } : undefined,
    speak: phase === 'tts' ? async ({ onPcm }) => { await gate.promise; await onPcm(new Uint8Array([1,2])); return { bytes: 2 }; } : undefined,
    emit: async event => { if (phase === 'pcm' && event.type === 'audio') await gate.promise; return true; },
  });
  f.runtime.services.transcribe = async () => { await gate.promise; return 'Late transcript'; };
  let done;
  if (phase === 'transcription') {
    await f.connection.beginTurn({ identity: id, context: { systemInstruction: 'stock' } });
    await f.connection.startRealtimeInput(); await f.connection.sendRealtimeAudio(new Uint8Array([1,2])); await f.connection.endRealtimeInput(); done = f.connection.whenSettled(id);
  } else done = f.begin();
  await tick(); f.connection.abortTurn(id); const count = f.events.length; gate.resolve();
  const result=await done;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.terminalReason, 'cancelled');
  assert.equal(f.events.length, count);
  f.complete(); assert.deepEqual(f.runtime.history.readForSession('17',5), phase === 'transcription' ? [] : [{ role: 'user', content: 'Hello' }]);
});

test('superseding slow model does not block the next native job and late result cannot dispatch', async () => {
  const gate = deferred(); let count = 0;
  const f = await fixture({ decide: async () => { if (++count === 1) await gate.promise; return { dialogue: 'Reply', command: '' }; } });
  const old = f.begin(); await tick();
  const next = { ...id, turnId: 'native-41', generationId: 902 };
  assert.equal((await f.begin(next)).status, 'completed');
  gate.resolve();
  const oldResult=await old;
  assert.equal(oldResult.status, 'cancelled');
  assert.equal(oldResult.terminalReason, 'superseded');
  assert.ok(f.events.every(e => e.generationId === 902));
  assert.deepEqual(f.runtime.history.readForSession('17',5), [
    {role:'user',content:'Hello'},{role:'user',content:'Hello'},{role:'assistant',content:'Reply'},
  ]);
});

for (const mode of ['empty','partial_error','late_chunk']) test(`audio ${mode} preserves one terminal outcome`, async () => {
  let saved;
  const f = await fixture({ speak: async ({ onPcm }) => {
    saved = onPcm;
    if (mode === 'empty') return { bytes: 0 };
    await onPcm(new Uint8Array([1,2]));
    if (mode === 'partial_error') throw new Error('broken stream');
    await onPcm(new Uint8Array([3,4])); return { bytes: 4 };
  } });
  const result = await f.begin();
  if (mode === 'late_chunk') {
    assert.equal(result.status, 'completed'); const count = f.events.length;
    await assert.rejects(saved(new Uint8Array([5,6]))); assert.equal(f.events.length, count);
  } else {
    assert.notEqual(result.status, 'completed'); assert.equal(f.events.some(e => e.type === 'turn_complete'), false);
    assert.deepEqual(f.runtime.history.readForSession('17',5), [{ role: 'user', content: 'Hello' }]);
  }
});

test('wrong generation discard and acknowledgement preserve the matching staged entry', () => {
  const h = new DialogueHistory({ maxMessages: 4 });
  h.stage({ identity: id, input: 'a', spokenReply: 'b' }); h.markModelAndTtsSucceeded(id);
  assert.equal(h.discard({ ...id, generationId: 902 }), false);
  assert.equal(h.acceptPlaybackResult({ ...id, generationId: 902 }), false);
  assert.equal(h.acceptPlaybackResult({ ...id, playbackSucceeded: true, hadAudio: true, playbackStarted: true }), true);
  for (let n = 1; n <= 4; n++) {
    const next = { ...id, turnId: `t${n}`, generationId: 902+n };
    h.stage({ identity: next, input: 'a', spokenReply: 'b' }); h.markModelAndTtsSucceeded(next);
    h.acceptPlaybackResult({ ...next, playbackSucceeded: true, hadAudio: true, playbackStarted: true });
  }
  assert.equal(h.readForSession('17',5).length,4);
});

test('reader abort during pending body read cancels the reader and sends no late chunk', async () => {
  const controller = new AbortController(); let cancelled = false, chunks = 0;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const done = requestBytes({ key: 'mock', url: 'mock', body: {}, signal: controller.signal,
    fetchImpl: async () => response, onChunk: () => { chunks++; } });
  await tick(); controller.abort(); await assert.rejects(done);
  assert.equal(cancelled,true); assert.equal(chunks,0);
});

test('body finishing after cancellation cannot return JSON success', async () => {
  const controller = new AbortController(), gate = deferred();
  const done = requestJson({ key: 'mock', url: 'mock', body: {}, signal: controller.signal,
    fetchImpl: async () => ({ ok: true, json: async () => { await gate.promise; return {}; } }) });
  await tick(); controller.abort(); gate.resolve(); await assert.rejects(done);
});

test('duplicate PTT start/stop preserves prefix and transcribes once', async () => {
  const f = await fixture(); let calls = 0, bytes,accepted=0,acceptedText,receipt='unset';
  f.runtime.services.transcribe = async ({ pcm }) => { calls++; bytes = [...pcm]; return 'hello'; };
  f.runtime.services.acceptPlayerTranscript = input => {accepted++;acceptedText=input.text;receipt=input.receipt;};
  await f.connection.beginTurn({ identity: id, source:'player_mic', context: { systemInstruction: 'stock' } });
  assert.equal(await f.connection.startRealtimeInput(),true);
  await f.connection.sendRealtimeAudio(new Uint8Array([1,2]));
  assert.equal(await f.connection.startRealtimeInput(),false);
  await f.connection.sendRealtimeAudio(new Uint8Array([3,4]));
  assert.equal(await f.connection.endRealtimeInput(),true);
  assert.equal(await f.connection.endRealtimeInput(),false);
  await f.connection.whenSettled(id);
  assert.equal(calls,1); assert.equal(accepted,1);assert.equal(acceptedText,'hello');assert.equal(receipt,null);assert.deepEqual(bytes,[1,2,3,4]);
  assert.equal(await f.connection.startRealtimeInput(),false);
});

test('accepted microphone hearing hook fires once before a later response failure and cannot change the native lifecycle',async()=>{
  const f=await fixture({decide:async()=>{throw new Error('test response failure');}});let accepted=0,transcribed=0;
  f.runtime.services.transcribe=async()=>{transcribed++;return 'heard once';};
  f.runtime.services.acceptPlayerTranscript=({text,receipt})=>{accepted++;assert.equal(text,'heard once');assert.equal(receipt,null);};
  await f.connection.beginTurn({identity:id,source:'player_mic',context:{systemInstruction:'stock'}});
  await f.connection.startRealtimeInput();await f.connection.sendRealtimeAudio(new Uint8Array([1,2]));await f.connection.endRealtimeInput();
  const result=await f.connection.whenSettled(id);
  assert.notEqual(result.status,'completed');assert.equal(transcribed,1);assert.equal(accepted,1);
  assert.equal(f.events.some(event=>event.type==='audio'),false);assert.equal(f.runtime.history.readForSession('17',5)[0].content,'heard once');
});

test('disconnect cancels provider and isolates history on reconnect', async () => {
  const gate = deferred();
  const f = await fixture({ decide: async () => { await gate.promise; return { dialogue: 'late', command: '' }; } });
  const done = f.begin(); await tick(); f.connection.close(); gate.resolve();
  const result=await done;
  assert.equal(result.status,'cancelled');
  assert.equal(result.terminalReason,'disconnected');
  f.complete();
  assert.deepEqual(f.runtime.history.readForSession('17',5),[]);
  assert.deepEqual(f.events,[]);
});

test('native interruption cancels provider even while TTS is waiting for another chunk', async () => {
  let signal;
  const f=await fixture({ speak: async ({ onPcm, signal: value }) => {
    signal=value; await onPcm(new Uint8Array([1,2]));
    await new Promise((_,reject)=>value.addEventListener('abort',()=>reject(new Error('abort')),{once:true}));
  } });
  const done=f.begin(); await tick();
  f.complete(id,{ reason:'player_barge_in',wasInterrupted:true });
  const result=await done;
  assert.equal(result.status,'cancelled'); assert.equal(result.terminalReason,'playback_interrupted'); assert.equal(signal.aborted,true);
  assert.equal(f.events.some(e=>e.type==='turn_complete'),false);
});

test('long valid audio may outlast provider deadline and succeeds only on matching PlaybackEnded', async () => {
  const f = await fixture({ deadline: 100, playbackDeadline: 500,
    speak: async ({ onPcm }) => { await onPcm(new Uint8Array([1,2])); return { bytes: 2_880_000 }; },
    emit: (event, complete) => { if (event.type === 'turn_complete') setTimeout(() => complete(event), 150); return true; },
  });
  const started = Date.now();
  const result = await f.begin();
  assert.equal(Date.now() - started >= 130, true);
  assert.equal(result.terminalReason, 'completed');
  assert.equal(f.runtime.history.readForSession('17', 5).filter(message => message.role === 'assistant').length, 1);
});

test('otherwise handle-free provider work is terminated by the referenced provider deadline', async () => {
  const f = await fixture({ deadline: 25, decide: async ({ signal }) => await new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const result = await f.begin();
  assert.equal(result.terminalReason, 'provider_timeout');
  assert.equal(result.status, 'deadline');
  assert.deepEqual(f.runtime.history.readForSession('17',5), [{ role:'user',content:'Hello' }]);
  assert.equal(f.failures.at(-1).details.reason, 'provider_timeout');
});

for (const request of [requestJson, requestBytes]) test(`${request.name} timeout keeps an otherwise pending provider request alive`, async () => {
  let timeoutSignal;
  const pendingFetch = async (_url, options) => {
    timeoutSignal = options.signal;
    return await new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };
  await assert.rejects(request({ key: 'mock', url: 'mock', body: {}, timeoutMs: 20, fetchImpl: pendingFetch,
    onChunk: async () => {} }), error => error.code === 'timeout');
  assert.equal(timeoutSignal.aborted, true);
});

async function observeTurnSource(source, { inputText, contextText, internalEvent }) {
  let seen;
  const f = await fixture({ decide: async options => { seen = options; return { dialogue: 'Acknowledged.', command: '' }; } });
  await f.connection.beginTurn({ identity: id, source, context: { inputText, contextText, internalEvent, systemInstruction: 'stock' } });
  await f.connection.sendText(inputText);
  assert.equal((await f.connection.whenSettled(id)).status, 'completed');
  return seen;
}

test('SPECIAL_EVENT removes only an exact normalized duplicate of its internal trigger', async () => {
  const seen = await observeTurnSource('special_event', { inputText: 'Run', contextText: '  Run  ', internalEvent: 'Run' });
  assert.equal(seen.source, 'special_event');
  assert.equal(seen.input, '');
  assert.equal(seen.context.internalEvent, 'Run');
  assert.equal(seen.context.contextText, '');
});

test('SPECIAL_EVENT "Run" preserves the unrelated context "Runner seen near the store"', async () => {
  const seen = await observeTurnSource('special_event', { inputText: 'Run', contextText: 'Runner seen near the store', internalEvent: 'Run' });
  assert.equal(seen.context.contextText, 'Runner seen near the store');
});

test('SPECIAL_EVENT partial trigger substrings do not delete unrelated context', async () => {
  const contextText = 'A witness said Run near the store';
  const seen = await observeTurnSource('special_event', { inputText: 'Run', contextText, internalEvent: 'Run' });
  assert.equal(seen.context.contextText, contextText);
});

test('normal PLAYER_TEXT source and context are unaffected by event deduplication', async () => {
  const seen = await observeTurnSource('player_text', { inputText: 'Run', contextText: 'Runner seen near the store', internalEvent: 'Run' });
  assert.equal(seen.source, 'player_text');
  assert.equal(seen.input, 'Run');
  assert.equal(seen.context.contextText, 'Runner seen near the store');
});

test('normal PLAYER_MIC source and context are unaffected by event deduplication', async () => {
  const seen = await observeTurnSource('player_mic', { inputText: 'Run', contextText: 'Runner seen near the store', internalEvent: 'Run' });
  assert.equal(seen.source, 'player_mic');
  assert.equal(seen.input, 'Run');
  assert.equal(seen.context.contextText, 'Runner seen near the store');
});

test('timeout, cancellation, and PlaybackEnded races retain exactly the first terminal outcome', async () => {
  const waitUntil = async predicate => {
    for (let n=0;n<200;n++) { if(predicate()) return; await new Promise(resolve=>setTimeout(resolve,1)); }
    assert.fail('playback completion phase did not start');
  };
  const completionWins = await fixture({ emit: () => true, playbackDeadline: 200 });
  const success = completionWins.begin();
  await waitUntil(() => completionWins.logs.some(entry => entry.state === 'playback_completion'));
  completionWins.complete();
  completionWins.connection.abortTurn(id, 'cancelled');
  const successResult = await success;
  assert.equal(successResult.terminalReason, 'completed');
  assert.deepEqual(completionWins.runtime.history.readForSession('17',5), [
    {role:'user',content:'Hello'},{role:'assistant',content:'Hello.'},
  ]);
  assert.equal(completionWins.logs.filter(entry => entry.state === 'terminal').length,1);

  const cancelWins = await fixture({ emit: () => true, playbackDeadline: 200 });
  const cancelled = cancelWins.begin();
  await waitUntil(() => cancelWins.logs.some(entry => entry.state === 'playback_completion'));
  cancelWins.connection.abortTurn(id, 'cancelled');
  cancelWins.complete();
  const cancelResult = await cancelled;
  assert.equal(cancelResult.terminalReason, 'cancelled');
  assert.deepEqual(cancelWins.runtime.history.readForSession('17',5), [{role:'user',content:'Hello'}]);
  assert.equal(cancelWins.logs.filter(entry => entry.state === 'terminal').length,1);

  const timeoutWins = await fixture({ emit: () => true, playbackDeadline: 20 });
  const timedOut = await timeoutWins.begin();
  timeoutWins.complete();
  assert.equal(timedOut.terminalReason, 'playback_ack_timeout');
  assert.deepEqual(timeoutWins.runtime.history.readForSession('17',5), [{role:'user',content:'Hello'}]);
  assert.equal(timeoutWins.logs.filter(entry => entry.state === 'terminal').length,1);
});

test('source semantics preserve typed, microphone, and special-event history policies', async () => {
  const typed = await fixture();
  let typedOptions;
  typed.runtime.services.decide = async options => { typedOptions = options; return { dialogue: 'Typed reply.', command: '' }; };
  assert.equal((await typed.begin(id, 'player_text', 'typed question')).status, 'completed');
  assert.equal(typedOptions.source, 'player_text');
  assert.deepEqual(typed.runtime.history.readForSession('17',5), [
    { role:'user',content:'typed question' }, { role:'assistant',content:'Typed reply.' },
  ]);

  const mic = await fixture();
  let micOptions;
  mic.runtime.services.transcribe = async () => 'spoken question';
  mic.runtime.services.decide = async options => { micOptions = options; return { dialogue: 'Mic reply.', command: '' }; };
  await mic.connection.beginTurn({ identity:id, source:'player_mic', context:{systemInstruction:'stock'} });
  await mic.connection.startRealtimeInput(); await mic.connection.sendRealtimeAudio(new Uint8Array([1,2]));
  await mic.connection.endRealtimeInput();
  assert.equal((await mic.connection.whenSettled(id)).status,'completed');
  assert.equal(micOptions.source,'player_mic');
  assert.deepEqual(mic.runtime.history.readForSession('17',5), [
    {role:'user',content:'spoken question'},{role:'assistant',content:'Mic reply.'},
  ]);

  const internal = await fixture();
  let eventOptions;
  internal.runtime.services.decide = async options => { eventOptions=options; return {dialogue:'Event reply.',command:''}; };
  await internal.connection.beginTurn({identity:id,source:'special_event',context:{systemInstruction:'stock',inputText:'INTERNAL_ALARM',contextText:'INTERNAL_ALARM'}});
  await internal.connection.sendText('INTERNAL_ALARM');
  assert.equal((await internal.connection.whenSettled(id)).status,'completed');
  assert.equal(eventOptions.source,'special_event');
  assert.equal(eventOptions.input,'');
  assert.equal(eventOptions.context.contextText,'');
  assert.equal(eventOptions.context.internalEvent,'INTERNAL_ALARM');
  assert.deepEqual(internal.runtime.history.readForSession('17',5), [{role:'assistant',content:'Event reply.'}]);
  const request=buildRequest({model:'test',effort:'low',systemInstruction:'stock',contextText:eventOptions.context.contextText,
    internalEvent:eventOptions.context.internalEvent,source:eventOptions.source,input:eventOptions.input,history:eventOptions.history});
  assert.equal(request.input[0].content.split('INTERNAL_ALARM').length-1,1);
  assert.match(request.input.at(-1).content,/No player utterance was received/);
});

for (const [name, setupOptions, source, expected] of [
  ['STT error', { speak: undefined }, 'player_mic', 'stt_error'],
  ['model timeout', {}, 'player_text', 'provider_timeout'],
  ['model refusal', { decide: async () => { throw new TypeError('Luna refused the request.'); } }, 'player_text', 'model_refusal'],
  ['invalid decision', { validateDecision: () => ({ identityValid:false, internalTranscript:'' }) }, 'player_text', 'invalid_decision'],
  ['TTS error', { speak: async () => { throw Object.assign(new Error('TTS failed'),{code:'network_error'}); } }, 'player_text', 'tts_error'],
  ['native authorization rejection', { authorize: (identity,native) => { native(identity,'audio_turn_rejected',{reason:'spatial_rejected'}); return true; } }, 'player_text', 'native_auth_rejected'],
  ['playback failure', { emit: (event,complete) => { if(event.type==='turn_complete') complete(event,{reason:'playback_error'}); return true; } }, 'player_text', 'playback_error'],
]) test(`${name} retains its semantic terminal reason`, async () => {
  const f=await fixture(setupOptions);
  if(name==='STT error') f.runtime.services.transcribe=async()=>{throw Object.assign(new Error('STT failed'),{code:'stt_failed'});};
  if(name==='model timeout') f.runtime.services.decide=async()=>{throw Object.assign(new Error('model timeout'),{code:'timeout'});};
  if(source==='player_mic') {
    await f.connection.beginTurn({identity:id,source,context:{systemInstruction:'stock'}});
    await f.connection.startRealtimeInput(); await f.connection.sendRealtimeAudio(new Uint8Array([1,2])); await f.connection.endRealtimeInput();
  } else {
    await f.connection.beginTurn({identity:id,source,context:{systemInstruction:'stock',inputText:'Hello'}});
    await f.connection.sendText('Hello');
  }
  const result=await f.connection.whenSettled(id);
  assert.equal(result.terminalReason,expected);
  assert.equal(f.logs.find(entry=>entry.state==='terminal')?.details?.reason,expected);
  if(name==='playback failure') assert.equal(f.logs.find(entry=>entry.state==='terminal')?.details?.cause?.nativeReason,'playback_error');
  assert.deepEqual(f.runtime.history.readForSession('17',5), name==='STT error' ? [] : [{role:'user',content:'Hello'}]);
});

test('supersession immediately after acceptance sends neither PCM nor end', async () => {
  let f;
  f=await fixture({ authorize: (identity,native)=>{ native(identity,'audio_turn_accepted'); f.setCurrent({...id,generationId:902});return true; } });
  assert.notEqual((await f.begin()).status,'completed');
  assert.equal(f.events.some(e=>e.type==='audio'||e.type==='turn_complete'),false);
});

test('two NPC jobs retain their own identities and histories',async()=>{
  const first=await fixture(); const second=await fixture();
  // A second connection/session to the same adapter can also use an independent ped.
  const other={...id,pedId:'18',turnId:'other'};
  const conn=await second.runtime.createTransport(()=>{}).connect({systemInstruction:'stock',diagnosticContext:other});
  second.setCurrent(other);await conn.beginTurn({identity:other,context:{systemInstruction:'stock',inputText:'Hi'}});
  await conn.sendText('Hi');
  const results=await Promise.all([first.begin(),conn.whenSettled(other)]);
  assert.ok(results.every(r=>r.status==='completed'));
  assert.ok(first.events.every(e=>e.pedId==='17')); assert.ok(second.events.every(e=>e.pedId==='18'));
});

test('refreshed actor context is used on the follow-up; failed reply leaves prior history intact', async () => {
  const f=await fixture(); assert.equal((await f.begin()).status,'completed');
  f.connection.refreshContext({systemInstruction:'fresh',actorContext:{pedId:'17',weather:'rain'}});
  let observed;
  f.runtime.services.decide=async options=>{observed=options;throw new Error('failure');};
  assert.notEqual((await f.begin({...id,turnId:'next',generationId:902})).status,'completed');
  assert.equal(observed.context.actor.weather,'rain');
  assert.equal(observed.history.length,2);
  assert.equal(f.runtime.history.readForSession('17',5).length,3);
});

test('PCM duration cap accepts the exact bound and rejects any excess without submitting a prefix',async()=>{
  const f=await fixture();
  await f.connection.beginTurn({identity:id,context:{systemInstruction:'stock'}});
  await f.connection.startRealtimeInput();
  await f.connection.sendRealtimeAudio(new Uint8Array(f.runtime.config.maxMicPcmBytes));
  assert.throws(()=>f.connection.sendRealtimeAudio(new Uint8Array([0,0])),/exceeded/);
  assert.throws(()=>f.connection.sendRealtimeAudio(new Uint8Array([0,0])),/exceeded/);
  assert.throws(()=>f.connection.endRealtimeInput(),/no truncated/);
  assert.deepEqual(f.events,[]);f.connection.close();
});
