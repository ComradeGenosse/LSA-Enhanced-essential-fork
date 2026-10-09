import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { ActivityClient } from '../src/activities/activityClient.mjs';
import { ACTIVITY_CAPABILITIES_SHA256 } from '../src/activities/capabilityRegistry.mjs';
import { CAPABILITY_IDS, DIAGNOSTIC_KEYS, LIMITS } from '../src/activities/contracts.mjs';
import { createTelemetryRecord } from '../src/observability/eventContract.mjs';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';
import { verifyPerceptionContract } from '../tools/verifyPerceptionContract.mjs';

function hello() {
  return { version: 1, type: 'hello', nativeRun: '11111111-1111-4111-8111-111111111111', adapterEpoch: '22222222-2222-4222-8222-222222222222', contractSha256: ACTIVITY_CAPABILITIES_SHA256, capabilities: Object.fromEntries(CAPABILITY_IDS.map(id => [id, false])), limits: { ...LIMITS } };
}
function diagnostics(sequence, patch = {}) {
  return { version: 1, type: 'diagnostics', sequence, ...Object.fromEntries(DIAGNOSTIC_KEYS.map(key => [key, 0])), ...patch };
}
function socket() {
  const value = new EventEmitter(); value.writes = []; value.write = frame => value.writes.push(frame); value.destroy = () => value.emit('close'); return value;
}

test('C05 negotiated shadow handshake echoes support and shares heartbeat sequence',async()=>{
 const host={hostContextVersion:1,hostRunId:'44444444-4444-4444-8444-444444444444',worldEpoch:1},pipe=socket();
 const observed=[];const client=new ActivityClient({mode:'shadow',pipeName:'LSA.Activities.v1'},{connect:()=>pipe,onFrame:frame=>observed.push(frame)});
 client.start();pipe.emit('data',Buffer.from(JSON.stringify({...hello(),...host,dialogueActionVersion:1})+'\n'));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(client.runtime.ready,true);assert.equal(JSON.parse(pipe.writes[0]).dialogueActionVersion,1);
 const result=client.sendDialogueAnnotation({publicationId:hello().nativeRun,tuple:{pedId:'17',turnId:'turn',generationId:1,sessionNonce:1},binding:{captureRef:host.hostRunId,encounterId:hello().nativeRun,incarnationId:hello().adapterEpoch,hostContext:host},canonicalAction:'waithere',publishedAtMs:100});
 assert.equal(result.sequence,2);assert.equal(JSON.parse(pipe.writes[2]).type,'dialogue.action.pending');
 assert.equal(client.send({type:'step.begin'}),false);
 const receipt={...result,type:'dialogue.action.receipt',sequence:1,succeeded:true,atGameTick:20,nativeRun:hello().nativeRun,adapterEpoch:hello().adapterEpoch};
 pipe.emit('data',Buffer.from(JSON.stringify(receipt)+'\n'));await new Promise(resolve=>setImmediate(resolve));assert.equal(observed.at(-1).type,'dialogue.action.receipt');assert.equal(client.runtime.ready,true);
 pipe.emit('data',Buffer.from(JSON.stringify({...receipt,sequence:2,adapterEpoch:host.hostRunId})+'\n'));await new Promise(resolve=>setImmediate(resolve));assert.equal(client.runtime.ready,false);assert.equal(observed.filter(frame=>frame.type==='dialogue.action.receipt').length,1);
 client.stop();assert.equal(client.runtime.dialogueActionVersion,null);assert.equal(client.runtime.ready,false);
 for(const advertised of [{...hello(),dialogueActionVersion:1},{...hello(),...host,dialogueActionVersion:2}]){
  const bad=socket(),peer=new ActivityClient({mode:'shadow',pipeName:'LSA.Activities.v1'},{connect:()=>bad});peer.start();bad.emit('data',Buffer.from(JSON.stringify(advertised)+'\n'));await new Promise(resolve=>setImmediate(resolve));assert.equal(peer.runtime.ready,false);peer.stop();
 }
});
test('shadow client correlates hello, lease and diagnostics and drops on a sequence gap', async () => {
  const events = []; const pipe = socket();
  const client = new ActivityClient({ mode: 'shadow', pipeName: 'LSA.Activities.v1' }, { connect: () => pipe, onEvent: (event, data) => events.push([event, data]) });
  client.runtime.nativeRun = '33333333-3333-4333-8333-333333333333';
  client.runtime.counters = { accepted: 9 };
  client.start(); pipe.emit('data', Buffer.from(JSON.stringify(hello()) + '\n')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.runtime.ready, true);
  assert.equal(client.runtime.nativeRun, hello().nativeRun);
  assert.deepEqual(client.runtime.counters, {});
  assert.equal(JSON.parse(pipe.writes[0]).type, 'hello');
  assert.deepEqual(JSON.parse(pipe.writes[1]), { version: 1, type: 'lease', sequence: 1, leaseTtlMs: 5000 });
  assert.equal(pipe.writes.some(frame => JSON.parse(frame).type === 'step.begin'), false);
  pipe.emit('data', Buffer.from(JSON.stringify(diagnostics(1, { accepted: 1, superseded: 1 })) + '\n')); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.map(item => item[0]), ['activity_receipt', 'activity_receipt']);
  assert.deepEqual(events.map(item => item[1].receiptState), ['HANDLER_ACCEPTED', 'SUPERSEDED']);
  const run = client.clientRun; pipe.emit('data', Buffer.from(JSON.stringify(diagnostics(3)) + '\n')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.runtime.ready, false); assert.notEqual(client.clientRun, run);
  client.stop();
  const off = new ActivityClient({ mode: 'off', pipeName: 'LSA.Activities.v1' }, { connect: () => { throw new Error('off'); } });
  off.start(); assert.equal(off.socket, null);
});

test('ACT2 lease heartbeats and execution frames share one client sequence', async () => {
  const pipe = socket();
  const client = new ActivityClient({ mode: 'on', pipeName: 'LSA.Activities.v1' }, { connect: () => pipe });
  client.start();
  pipe.emit('data', Buffer.from(JSON.stringify(hello()) + '\n'));
  await new Promise(resolve => setImmediate(resolve));
  const lease = JSON.parse(pipe.writes[1]);
  assert.equal(lease.type, 'lease');
  assert.equal(lease.sequence, 1);
  const sent = client.send({ type: 'step.query', requestId: '44444444-4444-4444-8444-444444444444', executionIds: [] });
  assert.equal(sent.sequence, 2);
  assert.equal(JSON.parse(pipe.writes.at(-1)).sequence, 2);
  client.stop();
});

test('ACT shadow sources do not dispatch NPC actions or task natives', async () => {
  const root = new URL('../../native/', import.meta.url);
  const files = ['activities/ActivityChannel.cs','activities/StepMachine.cs','activities/SupersessionMonitor.cs','activities/CapabilityTable.cs','promoted-characters/ActivityCommands.cs'];
  const source = (await Promise.all(files.map(file => readFile(new URL(file, root), 'utf8')))).join('\n');
  for (const forbidden of ['QueueNpcAction','NpcActions.','TASK_','CLEAR_PED','CancelAll','SetControlledBrain','ReleaseExclusiveControl','fetch(','openai']) assert.equal(source.includes(forbidden), false, forbidden);
  assert.match(source, /PHYSICALLY_COMPLETED/);
  assert.doesNotMatch(source, /State = "PHYSICALLY_COMPLETED"/);
});
test('activity telemetry cannot record physical completion', () => {
  const record = createTelemetryRecord({ sequence: 1, runId: '11111111-1111-4111-8111-111111111111', originMs: 0, event: 'activity_receipt', source: 'system', data: { receiptState: 'PHYSICALLY_COMPLETED', capability: 'hold_position' }, now: 1, utc: '2026-10-04T00:00:00.000Z' });
  assert.equal(record.data.receiptState, undefined);
  assert.equal(record.data.capability, 'hold_position');
});
test('bootstrap starts shadow observation or explicit ACT2 execution and stays off otherwise', async () => {
  const temp = await mkdtemp(path.resolve('.build-check-activities-')); const contract = await verifyPerceptionContract(); let connects = 0;
  const forbidden = () => { throw new Error('side effect'); };
  try {
    for (const mode of ['off', 'on', 'shadow']) {
      const configPath = path.join(temp, mode + '.json');
      await writeFile(configPath, JSON.stringify({ activities: { mode }, intelligence: { mode: 'off' }, promotedCharacters: { enabled: false }, persistentIdentity: { enabled: false } }));
      const pipe = socket();
      const runtime = await createRuntimeForBundle({ configPath, env: {}, enableTelemetry: false, startCharacterEditor: false, perceptionContract: contract, fetchImpl: forbidden, profileStore: { initialize: forbidden, memory: forbidden }, nativeOwner: { request: forbidden }, activityOptions: { connect: () => { connects++; return pipe; } } });
      if (mode === 'off') assert.equal(runtime.activities, undefined);
      else { assert.ok(runtime.activities); runtime.activities.stop(); }
    }
    assert.equal(connects, 2);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
