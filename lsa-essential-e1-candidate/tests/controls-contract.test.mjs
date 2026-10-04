import test from 'node:test';
import assert from 'node:assert/strict';
import net, { Socket } from 'node:net';
import { readFile, readdir } from 'node:fs/promises';
import { verifyControlsContract } from '../tools/verifyControlsContract.mjs';
import { controlsContractSupported, CONTROLS_METADATA_SHA256 } from '../src/control/nativeSupport.mjs';
import { IDENTITY_DLL_SHA256 } from '../src/identity/nativeSupport.mjs';
import { NativeOwnerClient, OWNER_OPERATIONS } from '../src/characters/nativeOwnerClient.mjs';

const metadataUrl = new URL('../docs/controls-native-metadata.json', import.meta.url);
const nativeDirectory = new URL('../../native/promoted-characters/', import.meta.url);

test('UX phase 1 Essential seams are an independent pinned contract that fails closed', async () => {
  const contract = await verifyControlsContract(), bytes = await readFile(metadataUrl);
  assert.deepEqual(contract, { available: true, version: 1, dllSha256: IDENTITY_DLL_SHA256, metadataSha256: CONTROLS_METADATA_SHA256, requiredGameTarget: 'net481', nativeProtocolChanged: false });
  assert.equal(controlsContractSupported(contract), true);
  for (const patch of [{ metadataSha256: '0'.repeat(64) }, { dllSha256: '0'.repeat(64) }, { nativeProtocolChanged: true }, { requiredGameTarget: 'net10.0' }, { available: false }, { version: 2 }]) assert.equal(controlsContractSupported({ ...contract, ...patch }), false);
  assert.equal(controlsContractSupported(undefined), false);
  assert.equal((await verifyControlsContract('0'.repeat(64), bytes)).available, false);
  assert.equal((await verifyControlsContract(undefined, Buffer.from(bytes + ' '))).available, false);
  // A metadata file with the right hash but a missing seam cannot exist; a
  // structurally different file is refused by its hash before parsing.
  const reduced = JSON.parse(String(bytes)); reduced.types = reduced.types.filter(type => type.name !== 'LosSantosAlive.Input.InputController');
  assert.equal((await verifyControlsContract(undefined, Buffer.from(JSON.stringify(reduced, null, 2)))).available, false);
});

test('the controls metadata pins exactly the four seams the bridge calls', async () => {
  const data = JSON.parse(await readFile(metadataUrl, 'utf8'));
  assert.equal(data.dllSha256, IDENTITY_DLL_SHA256);
  assert.deepEqual(data.types.map(type => [type.name, type.methods.map(method => `${method.name}(${method.parameters.join(',')}):${method.returns}`), type.fields.length]).sort(), [
    ['LosSantosAlive.Core.LsaControlsMenu', ['get_BlocksLsaInput():Boolean'], 0],
    ['LosSantosAlive.Input.InputController', ['SendTextPrompt(Rage.Ped,String):Void'], 0],
    ['LosSantosAlive.Input.TextInputService', ['get_IsOpen():Boolean'], 0],
    ['LosSantosAlive.NPC.NpcTargeting', ['IsValidHumanPed(Rage.Ped):Boolean'], 0],
  ]);
});

test('every Essential input/core member used by the native runtime is pinned', async () => {
  const pinned = new Set(JSON.parse(await readFile(metadataUrl, 'utf8')).types.flatMap(type => type.methods.map(method => `${type.name}.${method.name}`)));
  const files = (await readdir(nativeDirectory)).filter(name => name.endsWith('.cs'));
  const used = new Set();
  for (const name of files) {
    const source = await readFile(new URL(name, nativeDirectory), 'utf8');
    for (const match of source.matchAll(/LosSantosAlive\.(Input|Core)\.([A-Za-z]+)\.([A-Za-z]+)(\s*\()?/g)) used.add(`LosSantosAlive.${match[1]}.${match[2]}.${match[4] ? match[3] : 'get_' + match[3]}`);
    if (/NpcTargeting\.IsValidHumanPed\s*\(/.test(source)) used.add('LosSantosAlive.NPC.NpcTargeting.IsValidHumanPed');
  }
  assert.deepEqual([...used].sort(), [...pinned].sort());
});

test('the native owner client admits the read-only current op with the ordinary bounds', async t => {
  assert.equal(OWNER_OPERATIONS.has('current'), true);
  for (const operation of ['capture', 'register', 'inspect', 'spawn', 'follow', 'wait', 'dismiss', 'despawn', 'release', 'roster']) assert.equal(OWNER_OPERATIONS.has(operation), true);
  const ownerEpoch = '22222222-2222-4222-8222-222222222222', worldProfileId = '11111111-1111-4111-8111-111111111111'; let frame;
  const originalConnect = net.createConnection, socket = new Socket();
  net.createConnection = () => socket; t.after(() => { net.createConnection = originalConnect; socket.destroy(); });
  socket.write = bytes => { frame = JSON.parse(String(bytes).trim()); setImmediate(() => socket.emit('data', Buffer.from(JSON.stringify({ version: 1, requestId: frame.requestId, status: 'ok', result: { present: true, pedId: '12', encounterId: '7a3e9b1c-5d2f-4e8a-b6c4-1f0e9d8c7b6a', ownerAlias: null, owned: false, suspended: false, mode: null, human: true, safe: true }, reason: null }) + '\n'))); return true; };
  const client = new NativeOwnerClient({ pipeName: 'test', worldProfileId }), started = Date.now();
  const pending = client.request('current');
  process.nextTick(() => socket.emit('data', Buffer.from(JSON.stringify({ version: 1, type: 'hello', worldProfileId, ownerEpoch }) + '\n')));
  const view = await pending;
  assert.equal(frame.operation, 'current'); assert.deepEqual(frame.args, {}); assert.equal(frame.ownerEpoch, ownerEpoch);
  assert.ok(frame.expiresAtUtc > started && frame.expiresAtUtc <= started + 3000);
  assert.equal(view.present, true); assert.equal(view.owned, false);
});
