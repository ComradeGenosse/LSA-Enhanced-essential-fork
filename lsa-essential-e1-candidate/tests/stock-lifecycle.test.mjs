import test from 'node:test';
import assert from 'node:assert/strict';
import { stockHarness } from './stock-harness.mjs';

test('patched stock allocates identity without Gemini owner maps for OpenAI', async () => {
  const h = await stockHarness(); const identity = h.create();
  assert.equal(h.runtime.host.isCurrent(identity),true);
  assert.equal(h.evaluate('A.outputOwnerByPedId.size'),0);
  assert.equal(h.evaluate('A.retiringOutputOwnerByPedId.size'),0);
  assert.equal(h.evaluate('bound.identity.generationId'),identity.generationId);
});

test('patched native route waits for acceptance and uses tagged PCM/end with exact completion', async () => {
  const h = await stockHarness(); const identity = h.create();
  assert.equal(h.runtime.host.authorize(identity),true);
  assert.equal(h.sent[0].type,'npcAudioTurnStart');
  assert.equal(h.evaluate('turn.audio.accepted'),false);
  await assert.rejects(h.evaluate('CP(turn,Buffer.from([1,2]))'),/authorization/);
  h.context.identity = identity;
  await h.evaluate('by({ ...identity, type: "npcAudioTurnAccepted" })');
  await h.runtime.host.routePinnedEvent({ ...identity, provider: 'openai', type: 'audio', chunk: new Uint8Array([1,2]) });
  await h.runtime.host.routePinnedEvent({ ...identity, provider: 'openai', type: 'generation_complete' });
  await h.runtime.host.routePinnedEvent({ ...identity, provider: 'openai', type: 'turn_complete' });
  await h.runtime.host.routePinnedEvent({ ...identity, provider: 'openai', type: 'turn_complete' });
  assert.deepEqual(h.sent.map(e => e.type),['npcAudioTurnStart','npcAudioChunk','npcAudioStreamEnded']);
  assert.ok(h.sent.every(e => e.turnId === identity.turnId && e.generationId === identity.generationId));
  assert.equal(h.evaluate('A.geminiAudioChunks.length'),0);
  const observed = []; const remove = h.runtime.host.onNativeEvent(event => observed.push(event));
  await h.evaluate('by({ ...identity, type: "npcPlaybackEnded", reason: "completed", hadAudio: true, playbackStarted: true, wasInterrupted: false })');
  assert.equal(h.evaluate('turn.status'),'completed');
  assert.equal(observed.at(-1).type,'playback_ended');
  assert.equal(observed.at(-1).sessionNonce,identity.sessionNonce);
  remove();
});

test('rejected native authorization cannot queue PCM or end and failure interrupts exact requested identity', async () => {
  const h = await stockHarness(); const identity = h.create(); h.context.identity = identity;
  h.runtime.host.authorize(identity);
  await h.evaluate('by({ ...identity, type: "npcAudioTurnRejected", reason: "spatial_rejected" })');
  assert.equal(h.evaluate('turn.status'),'failed');
  assert.equal(await h.runtime.host.routePinnedEvent({ ...identity, provider:'openai',type:'audio',chunk:new Uint8Array([1,2]) }),false);
  assert.deepEqual(h.sent.map(e => e.type),['npcAudioTurnStart','npcSpeechInterrupted']);
  assert.equal(h.sent[1].turnId,identity.turnId);
});

test('pre-audio E1 failure uses provider terminal reason; attempted audio uses native playback failure', async () => {
  const h = await stockHarness();
  const beforeAudio = h.create();
  h.runtime.host.failMatchingTurn(beforeAudio, new Error('model failed'), { reason: 'model_error' });
  assert.equal(h.evaluate('turn.endReason'), 'gemini_error');

  const withAudio = h.create('18', 1);
  h.context.identity = withAudio;
  h.runtime.host.authorize(withAudio);
  await h.evaluate('by({ ...identity, type: "npcAudioTurnAccepted" })');
  await h.runtime.host.routePinnedEvent({ ...withAudio, provider: 'openai', type: 'audio', chunk: new Uint8Array([1,2]) });
  h.runtime.host.failMatchingTurn(withAudio, new Error('playback failed'), { reason: 'playback_error' });
  assert.equal(h.evaluate('turn.endReason'), 'playback_error');
});

for (const operation of ['Qi(turn.id)','hK(turn.id)','Zt(turn.id,ke.PLAYBACK_ERROR)']) test(`native ${operation} interrupts exact turn even before first PCM`, async () => {
  const h = await stockHarness(); const identity = h.create(); h.runtime.host.authorize(identity);
  await h.evaluate(operation); await h.evaluate(operation);
  assert.equal(h.sent.filter(e => e.type === 'npcSpeechInterrupted').length,1);
  assert.equal(h.sent.at(-1).generationId,identity.generationId);
  assert.equal(h.evaluate('A.retiringOutputOwnerByPedId.size'),0);
});

test('old native event cannot alter a newer generation or session', async () => {
  const h = await stockHarness(); const old = h.create();
  await h.evaluate('Qi(turn.id)');
  const next = h.create('17',2); h.context.old = old;
  assert.equal(await h.evaluate('by({ ...old, type: "npcAudioTurnAccepted" })'),false);
  assert.equal(h.evaluate('turn.audio.accepted'),false);
  assert.equal(h.runtime.host.isCurrent(old),false);
  assert.equal(h.runtime.host.isCurrent(next),true);
});

test('missing protocol capability fails closed before authorization', async () => {
  const h = await stockHarness(); const identity = h.create();
  for (const name of ['ready','connected','supportsTurnIdentity','supportsStreamEnded','supportsExactInterrupt','supportsPlaybackStarted','supportsStaleGenerationRejection']) {
    h.context.flag = name; h.evaluate('A.audioEndpoint[flag] = false');
    assert.throws(() => h.runtime.host.authorize(identity),/contract/);
    h.evaluate('A.audioEndpoint[flag] = true');
  }
  assert.deepEqual(h.sent,[]);
});

test('Gemini still registers output ownership and retains stock tagged audio/completion', async () => {
  const h = await stockHarness('gemini'); const identity = h.create(); h.context.identity=identity;
  assert.equal(h.evaluate('A.outputOwnerByPedId.size'),1);
  await h.evaluate('AP({ ...identity, type: Ee.AUDIO, chunk: Buffer.from([1,2]) })');
  assert.equal(h.evaluate('A.geminiAudioChunks.length'),1);
  await h.evaluate('AP({ ...identity, type: Ee.TURN_COMPLETE })');
  assert.equal(h.sent.filter(e => e.type === 'npcAudioStreamEnded').length,1);
  await h.evaluate('by({ ...identity, type: It.PLAYBACK_ENDED, reason: "completed", hadAudio: true, playbackStarted: true })');
  assert.equal(h.evaluate('turn.status'),'completed');
  assert.equal(h.evaluate('A.outputOwnerByPedId.size'),0);
});

test('current stock action beyond old lists validates and dispatches only once at native timing', async () => {
  const h = await stockHarness(); const identity = h.create();
  h.evaluate('session.actorContext.integrations = { policingRedefined: { detected: true } }');
  const decision = { dialogue: 'Okay.', command:'DO PerformOneLegStandTest' };
  const validated = h.runtime.host.validateDecision(decision,{},identity);
  assert.equal(validated.actionCount,1);
  await h.runtime.host.routePinnedEvent({ ...identity,provider:'openai',type:'output_transcript',text:validated.internalTranscript });
  h.evaluate('Rb(turn,true); Rb(turn,true)');
  assert.equal(h.actions.length,1);
  assert.equal(h.actions[0].action,'performonelegstandtest');
  await h.evaluate('Qi(turn.id)'); h.evaluate('Rb(turn,true)');
  assert.equal(h.actions.length,1);
});

test('RequestBackup remains final-only and stale final callback cannot dispatch', async () => {
  const h = await stockHarness(); const identity=h.create();
  h.evaluate('session.actorContext.roleName="Police Officer"');
  const decision=h.runtime.host.validateDecision({ dialogue:'Backup requested.',command:'DO RequestBackup' },{},identity);
  await h.runtime.host.routePinnedEvent({ ...identity,provider:'openai',type:'output_transcript',text:decision.internalTranscript });
  assert.equal(h.actions.length,0);
  h.evaluate('Rb(turn,true); Rb(turn,true)');
  assert.equal(h.actions.length,1);
});

test('OpenAI failure then Gemini, and Gemini failure then OpenAI retain independent owner paths', async () => {
  const h = await stockHarness(); h.create(); h.evaluate('Zt(turn.id,ke.PLAYBACK_ERROR)');
  h.create('17',2,'gemini');
  assert.equal(h.evaluate('A.outputOwnerByPedId.size'),1);
  h.evaluate('Zt(turn.id,ke.GEMINI_ERROR)');
  const next=h.create('17',3,'openai');
  assert.equal(h.evaluate('A.outputOwnerByPedId.size'),0);
  assert.equal(h.runtime.host.isCurrent(next),true);
});

test('full OpenAI adapter against stock coordinator commits only native delivery', async () => {
  const h = await stockHarness(); const identity = h.create();
  const conn = await h.runtime.createTransport(() => { throw new Error('Gemini'); }).connect({ systemInstruction:'stock',diagnosticContext:identity });
  h.context.connection=conn;
  await conn.beginTurn(h.evaluate('bound'));
  h.runtime.services.decide = async () => ({ dialogue:'Hello.',command:'DO WaitHere' });
  h.runtime.services.speak = async ({onPcm}) => { await onPcm(new Uint8Array([1,2])); return {bytes:2}; };
  h.context.ack = message => {
    if (message.type === 'npcAudioTurnStart') queueMicrotask(() => h.context.by({ ...message,type:'npcAudioTurnAccepted' }));
    if (message.type === 'npcAudioStreamEnded') queueMicrotask(() => h.context.by({ ...message,type:'npcPlaybackEnded',reason:'completed',hadAudio:true,playbackStarted:true,wasInterrupted:false }));
  };
  h.evaluate('Qt = (_, message) => { sent.push(message); ack(message); return 1; }');
  await conn.sendText('Hello');
  assert.equal((await conn.whenSettled(identity)).status,'completed');
  assert.equal(h.actions.length,1);
  assert.equal(h.runtime.history.readForSession('17',1).length,2);
  assert.equal(h.evaluate('A.outputOwnerByPedId.size'),0);
});

test('stock mic finish drains queued PCM before ending input and ignores duplicate release', async () => {
  const h=await stockHarness(); h.create();
  let drain; const pending = new Promise(resolve => { drain=resolve; }); const order=[];
  h.context.pending=pending; h.context.order=order;
  h.evaluate(`A.mic=ND(); A.mic.activeTurnId=turn.id; A.mic.status="draining"; A.mic.sendChain=pending;
    mb=()=>{}; Te=()=>{}; gb=()=>{}; Py=()=>{};
    session.connection.endRealtimeInput=async()=>order.push('end');`);
  const first=h.evaluate('$y(turn,session)'); await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(order,[]);
  await h.evaluate('$y(turn,session)'); order.push('drained'); drain(); await first;
  assert.deepEqual(order,['drained','end']);
});

test('release before hydration flushes native pending prefix before exactly one input end', async()=>{
  const h=await stockHarness();h.create();const order=[];h.context.order=order;h.context.performance=performance;
  h.evaluate(`
    var Zr=16000, OK=false;
    A.sentToGeminiChunks=[]; A.activeActor={pedId:'17'};A.context={target:{pedId:'player'}};
    A.mic=ND();A.mic.activeTurnId=turn.id;A.mic.status='listening';A.mic.releasedBeforeContextReady=true;
    A.mic.pendingChunks=[Buffer.from([1,2]),Buffer.from([3,4])];
    hb=()=>{};oa=()=>{};pb=()=>{};s4=()=>'';Zc=()=>'';Te=()=>{};mb=()=>{};gb=()=>{};Py=()=>{};
    Zi=async()=>session;XP=()=>{};
    session.connection.startRealtimeInput=async()=>order.push('start');
    session.connection.sendRealtimeAudio=async bytes=>order.push([...bytes].join(','));
    session.connection.endRealtimeInput=async()=>order.push('end');
  `);
  await h.evaluate('wd({speaker:{pedId:"17"}})');
  assert.deepEqual(order,['start','1,2','3,4','end']);
  assert.equal(h.evaluate('A.mic.status'),'idle');
});

test('OpenAI pre-hydration overflow fails instead of silently dropping the prefix',async()=>{
  const h=await stockHarness();h.create();h.evaluate(`
    A.mic=ND();A.mic.activeTurnId=turn.id;A.mic.status='listening';gb=()=>{};
    A.mic.pendingChunks=[Buffer.alloc(4*1024*1024),Buffer.from([1,2])];a4();
  `);
  assert.equal(h.evaluate('turn.status'),'failed');
  assert.equal(h.evaluate('A.mic.pendingChunks.length'),0);
  assert.equal(h.evaluate('A.mic.status'),'idle');
});
