import test from 'node:test';
import assert from 'node:assert/strict';
import { stockHarness } from './stock-harness.mjs';
import { Telemetry } from '../src/observability/telemetry.mjs';

function nativeIdentity(turn, sessionNonce = 1) {
  return { pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce };
}

test('stock session refresh retains an omitted listener, clears explicit null, and rejects cross-actor world fallback', async () => {
  const h = await stockHarness();
  const { session } = await h.openAIControllerSession();
  const actor = { pedId: '17', roleName: 'Civilian' };
  h.context.actorForRefresh = actor;
  h.evaluate('ct=()=>{}');
  h.evaluate('A.context={speaker:{pedId:"18"},target:{pedId:"other-listener"},world:{streetName:"WORLD-B-PRIVATE"}}');

  await h.ensureWithStockController({ pedId: '17', actorContext: actor, world: { streetName: 'Route-A' }, mode: 'player' });
  assert.deepEqual(session.targetContext, { pedId: 'player' }, 'an omitted listener leaves the existing listener untouched');
  assert.equal(session.world.streetName, 'Route-A');

  await h.ensureWithStockController({ pedId: '17', actorContext: actor, targetContext: null, world: { streetName: 'Route-A2' }, mode: 'player' });
  assert.equal(session.targetContext, null, 'an explicit null clears the listener');
  assert.equal(session.world.streetName, 'Route-A2');

  await h.ensureWithStockController({ pedId: '17', actorContext: actor, targetContext: null, world: { streetName: 'Route-A3' }, mode: 'player' });
  assert.equal(session.targetContext, null, 'a second explicit null remains cleared');
  await h.ensureWithStockController({ pedId: '17', actorContext: actor, targetContext: { pedId: 'listener-a' }, world: { streetName: 'Route-A4' }, mode: 'player' });
  assert.equal(session.targetContext.pedId, 'listener-a');
  await h.ensureWithStockController({ pedId: '17', actorContext: actor, targetContext: { pedId: 'listener-b' }, world: { streetName: 'Route-A5' }, mode: 'player' });
  assert.equal(session.targetContext.pedId, 'listener-b', 'an explicit listener object replaces the previous listener');

  await h.ensureWithStockController({ pedId: '17', actorContext: actor, mode: 'player' });
  assert.equal(session.targetContext.pedId, 'listener-b', 'omitting the listener retains the last explicit object');
  assert.equal(session.world.streetName, 'unknown', 'a different speaker world is not borrowed when the actor has no world snapshot');
  assert.notEqual(session.world.streetName, 'WORLD-B-PRIVATE');

  const replacement = await h.openAIControllerSession({ nonce: 2, actorContext: actor, targetContext: { pedId: 'listener-new-session' } });
  assert.notEqual(replacement.connection, session.connection, 'a replacement session receives a new OpenAI connection');
  assert.equal(replacement.session.targetContext.pedId, 'listener-new-session');
});

test('typed turns freeze actor, listener, world, references, capture and revision before async work', async () => {
  const records = [];
  const telemetry = new Telemetry({ sink: { emit(record) { records.push(record); return true; } } });
  const h = await stockHarness('openai', { telemetry });
  const actor = {
    pedId: '17', roleName: 'Civilian', snapshotRevision: 'actor-r7',
    nearbyPersonReferences: { P001: '23' }, nearbyVehicleReferences: { V001: 'beef' },
  };
  const { connection, autoNativeAcks } = await h.openAIControllerSession({ actorContext: actor });
  autoNativeAcks();
  let observed;
  let beginDecision;
  let releaseDecision;
  const decisionStarted = new Promise(resolve => { beginDecision = resolve; });
  h.runtime.services.decide = async options => { observed = options; beginDecision(); await new Promise(resolve => { releaseDecision = resolve; }); return { dialogue: 'I heard you.', command: '' }; };
  h.runtime.services.speak = async ({ onPcm }) => { await onPcm(new Uint8Array([1, 2])); return { bytes: 2 }; };

  const listenerA = { pedId: 'listener-a', label: 'LISTENER-A-PRIVATE' };
  h.context.playerRequest = {
    pedId: '17', speaker: actor, target: listenerA,
    world: { gameTime: 'night', streetName: 'WORLD-A-PRIVATE', weather: 'clear' },
    text: 'Where are we?',
  };
  const pendingTurn = h.evaluate('ib(playerRequest)');
  h.evaluate('A.activeActor={pedId:"18"}; A.context={speaker:A.activeActor,target:{pedId:"other-listener"},world:{streetName:"WORLD-B-PRIVATE"}}');
  const turn = await pendingTurn;
  const identity = nativeIdentity(turn);
  await decisionStarted;
  connection.refreshContext({ actorContext: { pedId: '17', roleName: 'Civilian', revision: 'actor-r8' },
    targetContext: { pedId: 'listener-b', label: 'LISTENER-B-PRIVATE' },
    world: { gameTime: 'day', streetName: 'WORLD-B-PRIVATE' } });
  releaseDecision();
  assert.equal((await connection.whenSettled(identity)).status, 'completed');

  assert.equal(observed.context.actor.pedId, '17');
  assert.equal(observed.context.listener.label, 'LISTENER-A-PRIVATE');
  assert.equal(observed.context.world.streetName, 'WORLD-A-PRIVATE');
  assert.notEqual(observed.context.world.streetName, 'WORLD-B-PRIVATE');
  assert.equal(observed.context.listenerState, 'present');
  assert.deepEqual(observed.context.referenceMap, { persons: { P001: '23' }, vehicles: { V001: 'beef' } });
  assert.equal(observed.context.revision, 'actor-r7');
  assert.ok(Number.isFinite(Date.parse(observed.context.capturedAt)));
  assert.ok(Object.isFrozen(observed.context.actor));
  assert.ok(Object.isFrozen(observed.context.actor.nearbyPersonReferences));
  assert.ok(Object.isFrozen(observed.context.world));
  assert.ok(Object.isFrozen(observed.context.referenceMap.persons));
  h.runtime.services.decide = async options => { observed = options; return { dialogue: 'I heard the update.', command: '' }; };
  h.context.playerRequest = { pedId: '17', speaker: actor, target: null, text: 'Who is there?' };
  const clearedTurn = await h.evaluate('ib(playerRequest)');
  assert.equal((await connection.whenSettled(nativeIdentity(clearedTurn))).status, 'completed');
  assert.equal(observed.context.listener, null, 'explicit null clears the listener on the same connection');
  assert.equal(observed.context.listenerState, 'explicitly_cleared');
  assert.equal(observed.context.world.streetName, 'unknown');
  assert.ok(records.some(record => record.event === 'snapshot_created' && record.data.listenerState === 'explicitly_cleared' && record.data.worldStatus === 'unavailable'));
  h.context.playerRequest = { pedId: '17', speaker: actor, text: 'Who is there?' };
  const omittedTurn = await h.evaluate('ib(playerRequest)');
  assert.equal((await connection.whenSettled(nativeIdentity(omittedTurn))).status, 'completed');
  assert.equal(observed.context.listener, null, 'a retained clear is not replaced by the global/default listener');
  assert.equal(observed.context.listenerState, 'omitted');

  const actorB = { pedId: '18', roleName: 'Civilian', snapshotRevision: 'actor-b-r2' };
  const sessionB = await h.openAIControllerSession({ pedId: '18', actorContext: actorB, targetContext: { pedId: 'listener-b' } });
  sessionB.autoNativeAcks();
  h.runtime.services.decide = async options => { observed = options; return { dialogue: 'This is actor B.', command: '' }; };
  h.context.playerRequest = { pedId: '18', speaker: actorB, target: { pedId: 'listener-b' }, world: { gameTime: 'morning', streetName: 'WORLD-B-PRIVATE' }, text: 'Where are we?' };
  const turnB = await h.evaluate('ib(playerRequest)');
  assert.equal((await sessionB.connection.whenSettled(nativeIdentity(turnB))).status, 'completed');
  assert.equal(observed.context.actor.pedId, '18');
  assert.equal(observed.context.world.streetName, 'WORLD-B-PRIVATE');
  assert.equal(observed.context.listener.pedId, 'listener-b');
  const telemetryText = JSON.stringify(records);
  for (const privateValue of ['WORLD-A-PRIVATE', 'WORLD-B-PRIVATE', 'LISTENER-A-PRIVATE', 'LISTENER-B-PRIVATE', 'P001', 'beef']) assert.equal(telemetryText.includes(privateValue), false);
  connection.close();
  sessionB.connection.close();
});

test('microphone hydration binds its own actor and world before queued audio is released', async () => {
  const h = await stockHarness();
  const actor = { pedId: '17', roleName: 'Civilian', snapshotRevision: 'mic-r4', nearbyPersonReferences: { P001: '23' } };
  const listener = { pedId: 'listener-mic', label: 'MIC-LISTENER-PRIVATE' };
  const world = { gameTime: 'evening', streetName: 'MIC-WORLD-PRIVATE', weather: 'rain' };
  const { connection, autoNativeAcks } = await h.openAIControllerSession({ actorContext: actor, targetContext: listener });
  autoNativeAcks();
  let observed;
  h.runtime.services.transcribe = async () => 'Can you hear me?';
  h.runtime.services.decide = async options => { observed = options; return { dialogue: 'Yes.', command: '' }; };
  h.runtime.services.speak = async ({ onPcm }) => { await onPcm(new Uint8Array([1, 2])); return { bytes: 2 }; };
  const turn = h.evaluate(`(() => { const value=Xi({pedId:'17',speakerPedId:'17',listenerPedId:'listener-mic',source:Ht.PLAYER_MIC,input:{transcript:'',contextText:''},metadata:{}}); A.mic=ND(); A.mic.activeTurnId=value.id; A.mic.status='listening'; A.mic.pendingChunks=[]; A.mic.sendChain=Promise.resolve(); return value; })()`);
  h.context.micHydration = { speaker: actor, target: listener, world };
  h.evaluate('Te=()=>{}; hb=()=>{}; OK=false');
  await h.evaluate('wd(micHydration)');
  const identity = nativeIdentity(turn);
  h.evaluate('A.activeActor={pedId:"18"}; A.context={speaker:A.activeActor,target:{pedId:"listener-b"},world:{streetName:"MIC-WORLD-B-PRIVATE"}}');
  await connection.sendRealtimeAudio(new Uint8Array([1, 2]));
  await connection.endRealtimeInput();
  assert.equal((await connection.whenSettled(identity)).status, 'completed');
  assert.equal(observed.context.actor.pedId, '17');
  assert.equal(observed.context.listener.label, 'MIC-LISTENER-PRIVATE');
  assert.equal(observed.context.world.streetName, 'MIC-WORLD-PRIVATE');
  assert.equal(observed.context.revision, 'mic-r4');
  connection.close();
});

test('real stock text and microphone normalization preserve explicit listener clears', async () => {
  const h = await stockHarness();
  const initialListener = { pedId: 'listener-initial' };
  const { connection, session } = await h.openAIControllerSession({ targetContext: initialListener });
  h.useStockInputNormalizer();
  h.context.nullText = { speaker: { pedId: '17', roleName: 'Civilian' }, target: null, world: { streetName: 'Text world' }, text: 'Hello' };

  const textTurn = await h.evaluate('ib(nullText)');
  assert.equal(session.targetContext, null);
  assert.equal(textTurn.metadata.contextSnapshot.listener, null);
  assert.equal(textTurn.metadata.contextSnapshot.listenerState, 'explicitly_cleared');

  h.context.omittedText = { speaker: { pedId: '17', roleName: 'Civilian' }, text: 'Still no listener' };
  const omittedTurn = await h.evaluate('ib(omittedText)');
  assert.equal(session.targetContext, null);
  assert.equal(omittedTurn.metadata.contextSnapshot.listener, null);
  assert.equal(omittedTurn.metadata.contextSnapshot.listenerState, 'omitted');

  await h.evaluate('za("17",ke.PLAYER_BARGE_IN)');
  h.evaluate(`Te=()=>{}; hb=()=>{}; md=async()=>true; yd=async()=>true; n4=async()=>true;
    var micTurn=Xi({pedId:'17',speakerPedId:'17',listenerPedId:'listener-initial',source:Ht.PLAYER_MIC,input:{transcript:'',contextText:''},metadata:{}});
    A.mic=ND(); A.mic.activeTurnId=micTurn.id; A.mic.status='listening'; A.mic.pendingChunks=[]; A.mic.sendChain=Promise.resolve();`);
  h.context.nullMic = { speaker: { pedId: '17', roleName: 'Civilian' }, target: null, world: { streetName: 'Mic world' } };
  await h.evaluate('wd(nullMic)');
  assert.equal(session.targetContext, null);
  assert.equal(h.evaluate('micTurn.metadata.contextSnapshot.listener'), null);
  assert.equal(h.evaluate('micTurn.metadata.contextSnapshot.listenerState'), 'explicitly_cleared');
  connection.close();
});

test('special turns carry M4 actor, listener, and world snapshots through Xn', async () => {
  const h = await stockHarness();
  const actor = { pedId: '17', roleName: 'Civilian', snapshotRevision: 11 };
  const listener = { pedId: 'player', label: 'SPECIAL-LISTENER-PRIVATE' };
  const { connection, autoNativeAcks } = await h.openAIControllerSession({ actorContext: actor, targetContext: listener });
  autoNativeAcks();
  let observed;
  h.runtime.services.decide = async options => { observed = options; return { dialogue: 'I heard that.', command: '' }; };
  h.runtime.services.speak = async ({ onPcm }) => { await onPcm(new Uint8Array([1, 2])); return { bytes: 2 }; };
  h.evaluate('A.context={speaker:{pedId:"18"},target:{pedId:"other"},world:{streetName:"SPECIAL-WORLD-B-PRIVATE"}}');
  const turn = await h.evaluate('kb({speakerPedId:"17",listenerPedId:"player",content:"An alarm is sounding.",reason:"scene_event"})');
  assert.equal((await connection.whenSettled(nativeIdentity(turn))).status, 'completed');
  assert.equal(observed.context.actor.pedId, '17');
  assert.equal(observed.context.listener.pedId, 'player');
  assert.equal(observed.context.listener.label, 'SPECIAL-LISTENER-PRIVATE');
  assert.deepEqual(observed.context.world, { location: 'stock' });
  assert.equal(observed.input, '');
  assert.deepEqual(h.runtime.history.readForSession('17', 1), [{ role: 'assistant', content: 'I heard that.' }]);
  connection.close();
});

test('real special hydration never borrows the listener world when speaker world is missing', async () => {
  const h = await stockHarness();
  const actor = { pedId: '17', roleName: 'Civilian' };
  const { connection } = await h.openAIControllerSession({ actorContext: actor });
  h.useStockSpecialHydration();
  h.context.hydrationResponses = {
    '17': { success: true, speaker: { pedId: '17', roleName: 'Civilian' } },
    '18': { success: true, speaker: { pedId: '18', roleName: 'Civilian' }, world: { streetName: 'LISTENER-WORLD-PRIVATE' } },
  };
  h.evaluate('var Nb=1000; Od=async pedId=>hydrationResponses[pedId]');
  const result = await h.evaluate('M4({speakerPedId:"17",listenerPedId:"18"})');
  assert.equal(result.world, null, 'listener hydration does not provide a missing speaker world');

  h.evaluate('vi=async()=>true');
  const turn = await h.evaluate('kb({speakerPedId:"17",listenerPedId:"18",content:"A scene event"})');
  assert.deepEqual(connection.turnSnapshot.world, {
    gameTime: 'unknown', weather: 'unknown', streetName: 'unknown', crossingStreetName: 'unknown', zoneCode: 'unknown',
  });
  assert.notEqual(connection.turnSnapshot.world.streetName, 'LISTENER-WORLD-PRIVATE');
  assert.equal(turn.metadata.contextSnapshot.actor.pedId, '17');
  connection.close();
});

test('stock dispatch rejects changed or unavailable person and vehicle aliases and lost action capability', async t => {
  const dispatch = async ({ actor, command, currentActor = actor }) => {
    const records = [];
    const telemetry = new Telemetry({ sink: { emit(record) { records.push(record); return true; } } });
    const h = await stockHarness('openai', { telemetry });
    const identity = h.create();
    h.context.reasoningActor = actor;
    h.context.currentActor = currentActor;
    h.evaluate('session.actorContext=reasoningActor; A.activeActor=currentActor');
    const referenceMap = {
      persons: Object.fromEntries(Object.entries(actor.nearbyPersonReferences || {}).map(([key, value]) => [key, String(value).toLowerCase()])),
      vehicles: Object.fromEntries(Object.entries(actor.nearbyVehicleReferences || {}).map(([key, value]) => [key, String(value).toLowerCase()])),
    };
    let validated;
    try {
      validated = h.runtime.host.validateDecision({ dialogue: 'Proceed.', command }, {
        actor, referenceMap, listener: null, world: { streetName: 'unknown' }, capturedAt: new Date().toISOString(), revision: actor.snapshotRevision || null,
      }, identity);
    } catch (validationError) {
      return { dispatched: false, actions: h.actions, records, validationError };
    }
    h.context.finalText = validated.internalTranscript;
    h.evaluate('turn.output.finalTranscript=finalText');
    if (currentActor !== actor) {
      h.context.dispatchActor = currentActor;
      h.evaluate('session.actorContext=dispatchActor; A.activeActor=dispatchActor');
    }
    const result = h.evaluate('Rb(turn,true)');
    return { dispatched: result, actions: h.actions, records };
  };

  await t.test('unchanged person mapping dispatches', async () => {
    const result = await dispatch({ actor: { pedId: '17', roleName: 'Civilian', nearbyPersonReferences: { P001: '23' } }, command: 'DO Follow P001' });
    assert.equal(result.dispatched, true);
    assert.equal(result.actions.length, 1);
  });
  await t.test('changed person mapping is rejected before native publication', async () => {
    const actor = { pedId: '17', roleName: 'Civilian', nearbyPersonReferences: { P001: '23' } };
    const result = await dispatch({ actor, currentActor: { ...actor, nearbyPersonReferences: { P001: '24' } }, command: 'DO Follow P001' });
    assert.equal(result.dispatched, false);
    assert.equal(result.actions.length, 0);
    assert.ok(result.records.some(record => record.event === 'target_changed' && record.data.reason === 'target_changed'));
    assert.ok(result.records.some(record => record.event === 'reference_map_revision_changed'));
    const safeLog = JSON.stringify(result.records.map(record => record.data));
    for (const privateValue of ['P001', '23', '24']) assert.equal(safeLog.includes(privateValue), false);
  });
  await t.test('removed person mapping is rejected as unavailable', async () => {
    const actor = { pedId: '17', roleName: 'Civilian', nearbyPersonReferences: { P001: '23' } };
    const result = await dispatch({ actor, currentActor: { ...actor, nearbyPersonReferences: {} }, command: 'DO Follow P001' });
    assert.equal(result.dispatched, false);
    assert.equal(result.actions.length, 0);
  });
  await t.test('changed vehicle mapping is rejected before native publication', async () => {
    const actor = { pedId: '17', roleName: 'Civilian', nearbyVehicleReferences: { V001: 'beef' } };
    const result = await dispatch({ actor, currentActor: { ...actor, nearbyVehicleReferences: { V001: 'cafe' } }, command: 'DO EnterDriverSeat V001' });
    assert.equal(result.dispatched, false);
    assert.equal(result.actions.length, 0);
  });
  await t.test('unchanged vehicle mapping dispatches', async () => {
    const actor = { pedId: '17', roleName: 'Civilian', nearbyVehicleReferences: { V001: 'beef' } };
    const result = await dispatch({ actor, command: 'DO EnterDriverSeat V001' });
    assert.equal(result.dispatched, true);
    assert.equal(result.actions.length, 1);
  });
  await t.test('reordered aliases with the same underlying person remain valid', async () => {
    const actor = { pedId: '17', roleName: 'Civilian', nearbyPersonReferences: { P001: '23', P002: '24' } };
    const currentActor = { ...actor, nearbyPersonReferences: { P002: '24', P001: '23' } };
    const result = await dispatch({ actor, currentActor, command: 'DO Follow P001' });
    assert.equal(result.dispatched, true);
    assert.equal(result.actions.length, 1);
  });
  await t.test('reference absent from the reasoning-time map is rejected', async () => {
    const actor = { pedId: '17', roleName: 'Civilian', nearbyPersonReferences: { P001: '23' } };
    const h = await stockHarness();
    const identity = h.create();
    h.context.reasoningActor = actor; h.context.currentActor = actor;
    h.evaluate('session.actorContext=reasoningActor; A.activeActor=currentActor');
    assert.throws(() => h.runtime.host.validateDecision({ dialogue: 'Proceed.', command: 'DO Follow P002' }, {
      actor, referenceMap: { persons: { P001: '23' }, vehicles: {} }, world: { streetName: 'unknown' },
    }, identity), error => error.code === 'target_missing');
  });
  await t.test('new generation uses its own reference map and stale generation cannot dispatch', async () => {
    const h = await stockHarness();
    const oldIdentity = h.create('17', 1);
    const firstActor = { pedId: '17', roleName: 'Civilian', nearbyPersonReferences: { P001: '23' } };
    h.context.currentActor = firstActor; h.context.oldContext = { actor: firstActor, referenceMap: { persons: { P001: '23' }, vehicles: {} } };
    h.evaluate('session.actorContext=currentActor; A.activeActor=currentActor');
    const oldDecision = h.runtime.host.validateDecision({ dialogue: 'Proceed.', command: 'DO Follow P001' }, h.context.oldContext, oldIdentity);
    h.context.oldTranscript = oldDecision.internalTranscript;
    h.context.oldTurnId = oldIdentity.turnId;
    h.evaluate('turn.output.finalTranscript=oldTranscript; Qi(turn.id)');
    const newIdentity = h.create('17', 2);
    const secondActor = { pedId: '17', roleName: 'Civilian', nearbyPersonReferences: { P001: '24' } };
    h.context.currentActor = secondActor; h.context.newContext = { actor: secondActor, referenceMap: { persons: { P001: '24' }, vehicles: {} } };
    h.evaluate('session.actorContext=currentActor; A.activeActor=currentActor');
    const newDecision = h.runtime.host.validateDecision({ dialogue: 'Proceed.', command: 'DO Follow P001' }, h.context.newContext, newIdentity);
    assert.deepEqual(newDecision.referenceBindings, { persons: { P001: '24' }, vehicles: {} });
    h.context.newTranscript = newDecision.internalTranscript;
    assert.equal(h.evaluate('Rb(le.getTurn(oldTurnId),true)'), false);
    h.evaluate('turn.output.finalTranscript=newTranscript');
    assert.equal(h.evaluate('Rb(turn,true)'), true);
    assert.equal(h.actions.length, 1);
  });
  await t.test('removed action capability is rechecked at dispatch', async () => {
    const actor = { pedId: '17', roleName: 'Police Officer' };
    const currentActor = { pedId: '17', roleName: 'Civilian' };
    const result = await dispatch({ actor, currentActor, command: 'DO RequestBackup' });
    assert.equal(result.dispatched, false);
    assert.equal(result.actions.length, 0);
  });
});

test('real stock dispatcher cannot retarget an alias using a map newer than the session cache', async () => {
  const h = await stockHarness();
  const actor = { pedId: '17', roleName: 'Civilian', nearbyVehicleReferences: { V001: 'beef' } };
  const identity = h.create();
  h.context.reasoningActor = actor;
  h.evaluate('session.actorContext=reasoningActor; A.activeActor=reasoningActor');
  const checked = h.runtime.host.validateDecision({ dialogue: 'Proceed.', command: 'DO EnterDriverSeat V001' }, {
    actor, referenceMap: { persons: {}, vehicles: { V001: 'beef' } }, world: { streetName: 'unknown' },
  }, identity);
  h.context.commandTranscript = checked.internalTranscript;
  h.evaluate('turn.output.finalTranscript=commandTranscript; A.activeActor={pedId:"17",roleName:"Civilian",nearbyVehicleReferences:{V001:"cafe"}}');
  h.useStockActionDispatcher();

  assert.equal(h.evaluate('Rb(turn,true)'), false);
  assert.deepEqual(h.actions, [], 'the stock action encoder never receives the newly mapped vehicle');
});

test('real stock dispatcher still accepts a stable reasoning-time vehicle target', async () => {
  const h = await stockHarness();
  const actor = { pedId: '17', roleName: 'Civilian', nearbyVehicleReferences: { V001: 'beef' } };
  const identity = h.create();
  h.context.reasoningActor = actor;
  h.evaluate('session.actorContext=reasoningActor; A.activeActor=reasoningActor');
  const checked = h.runtime.host.validateDecision({ dialogue: 'Proceed.', command: 'DO EnterDriverSeat V001' }, {
    actor, referenceMap: { persons: {}, vehicles: { V001: 'beef' } }, world: { streetName: 'unknown' },
  }, identity);
  h.context.commandTranscript = checked.internalTranscript;
  h.evaluate('turn.output.finalTranscript=commandTranscript');
  h.useStockActionDispatcher();

  assert.equal(h.evaluate('Rb(turn,true)'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.actions)), [{ action: 'enterdriverseatoftargetvehicle', parameter: 'beef' }]);
});
