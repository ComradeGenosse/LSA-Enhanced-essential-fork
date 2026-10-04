import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { directory } from './identity-fixtures.mjs';
import { fixture } from './p2-fixtures.mjs';
import { startCharacterEditor } from '../src/characters/editorServer.mjs';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';
import { verifyIdentityContract } from '../tools/verifyIdentityContract.mjs';
import { verifyCharactersContract } from '../tools/verifyCharactersContract.mjs';
import { CONTROL_ENDPOINT_FILE, controlEndpointDocument, defaultControlEndpointPath, publishControlEndpoint } from '../src/control/endpointFile.mjs';

const token = 'a'.repeat(64);
async function request(url, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })); });
    req.on('error', reject); req.end(body);
  });
}
async function freePort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address(); await new Promise(resolve => server.close(resolve)); return port;
}
const exitListeners = () => process.listeners('exit').length;

test('endpoint file lives per user under LOCALAPPDATA on Windows only', () => {
  assert.equal(defaultControlEndpointPath({ env: { LOCALAPPDATA: 'C:\\Users\\Chris\\AppData\\Local' }, platform: 'win32' }), `C:\\Users\\Chris\\AppData\\Local\\LSA Enhanced\\${CONTROL_ENDPOINT_FILE}`);
  for (const env of [{}, { LOCALAPPDATA: '' }, { LOCALAPPDATA: 'relative\\path' }, { LOCALAPPDATA: 7 }]) assert.equal(defaultControlEndpointPath({ env, platform: 'win32' }), null);
  assert.equal(defaultControlEndpointPath({ env: { LOCALAPPDATA: 'C:\\Users\\Chris\\AppData\\Local' }, platform: 'linux' }), null);
});

test('endpoint documents accept only loopback URLs, editor tokens and real process ids', () => {
  const document = controlEndpointDocument({ url: 'http://127.0.0.1:37921', token, pid: 4242, startedAtUtc: '2026-10-03T20:44:06.000Z' });
  assert.deepEqual(document, { version: 1, url: 'http://127.0.0.1:37921', token, pid: 4242, startedAtUtc: '2026-10-03T20:44:06.000Z' });
  for (const url of ['http://localhost:37921', 'http://0.0.0.0:37921', 'http://192.168.1.2:37921', 'https://127.0.0.1:37921', 'http://127.0.0.1:37921/', 'http://127.0.0.1:0', 'http://127.0.0.1:70000', 'http://127.0.0.1', null])
    assert.throws(() => controlEndpointDocument({ url, token }), /invalid_control_endpoint/);
  for (const bad of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), undefined]) assert.throws(() => controlEndpointDocument({ url: 'http://127.0.0.1:37921', token: bad }), /invalid_control_endpoint/);
  for (const pid of [0, -1, 1.5, '42']) assert.throws(() => controlEndpointDocument({ url: 'http://127.0.0.1:37921', token, pid }), /invalid_control_endpoint/);
  assert.throws(() => controlEndpointDocument({ url: 'http://127.0.0.1:37921', token, startedAtUtc: 'yesterday' }), /invalid_control_endpoint/);
});

test('endpoint file is written atomically and removed only by the server that owns it', async t => {
  const root = await directory(t), file = path.join(root, 'LSA Enhanced', CONTROL_ENDPOINT_FILE), listeners = exitListeners();
  await assert.rejects(publishControlEndpoint('relative/control-endpoint.v1.json', { url: 'http://127.0.0.1:37921', token }), /invalid_control_endpoint_path/);
  await assert.rejects(publishControlEndpoint(file, { url: 'http://0.0.0.0:37921', token }), /invalid_control_endpoint/);
  const first = await publishControlEndpoint(file, { url: 'http://127.0.0.1:37921', token });
  const written = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(written), ['version', 'url', 'token', 'pid', 'startedAtUtc']);
  assert.equal(written.version, 1); assert.equal(written.url, 'http://127.0.0.1:37921'); assert.equal(written.token, token); assert.equal(written.pid, process.pid);
  assert.deepEqual(await readdir(path.dirname(file)), [CONTROL_ENDPOINT_FILE]);
  assert.equal(exitListeners(), listeners + 1);
  // A newer companion overwrites the file; the older one's close leaves it alone.
  const second = await publishControlEndpoint(file, { url: 'http://127.0.0.1:37922', token: 'b'.repeat(64) });
  await first.close();
  assert.equal(JSON.parse(await readFile(file, 'utf8')).token, 'b'.repeat(64));
  await second.close(); await second.close();
  assert.deepEqual(await readdir(path.dirname(file)), []);
  assert.equal(exitListeners(), listeners);
});

test('a companion process that exits removes its own endpoint file but not a newer one', async t => {
  const root = await directory(t), file = path.join(root, 'LSA Enhanced', CONTROL_ENDPOINT_FILE);
  const module = new URL('../src/control/endpointFile.mjs', import.meta.url).href;
  const child = overwrite => `const m = await import(${JSON.stringify(module)});
    await m.publishControlEndpoint(${JSON.stringify(file)}, { url: 'http://127.0.0.1:37921', token: '${token}' });
    ${overwrite ? `(await import('node:fs')).writeFileSync(${JSON.stringify(file)}, JSON.stringify({ version: 1, url: 'http://127.0.0.1:37922', token: '${'c'.repeat(64)}', pid: 1, startedAtUtc: new Date().toISOString() }));` : ''}
    process.exit(0);`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', child(false)]);
  await assert.rejects(readFile(file, 'utf8'), { code: 'ENOENT' });
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', child(true)]);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).token, 'c'.repeat(64));
});

test('character editor publishes the same token it embeds and removes the endpoint on close', async t => {
  const f = await fixture(t), file = path.join(f.root, 'LSA Enhanced', CONTROL_ENDPOINT_FILE);
  const editor = await startCharacterEditor(f.service, { port: 0, endpointPath: file });
  let closed = false; t.after(() => closed || editor.close());
  assert.equal(editor.endpointPublished, true);
  const endpoint = JSON.parse(await readFile(file, 'utf8')), page = await request(editor.url);
  assert.equal(endpoint.url, editor.url);
  assert.equal(endpoint.token, page.body.match(/const auth="([a-f0-9]{64})"/)[1]);
  const listed = await request(editor.url + '/api', { method: 'POST', headers: { origin: editor.url, 'content-type': 'application/json', 'x-lsa-editor': endpoint.token }, body: '{"action":"list"}' });
  assert.equal(listed.status, 200); assert.deepEqual(JSON.parse(listed.body), []);
  await editor.close(); closed = true;
  await assert.rejects(readFile(file, 'utf8'), { code: 'ENOENT' });
});

test('character editor keeps the page handshake when the endpoint file cannot be written', async t => {
  const f = await fixture(t), blocker = path.join(f.root, 'not-a-directory');
  await writeFile(blocker, 'x');
  const editor = await startCharacterEditor(f.service, { port: 0, endpointPath: path.join(blocker, CONTROL_ENDPOINT_FILE) }); t.after(() => editor.close());
  assert.equal(editor.endpointPublished, false);
  assert.equal((await request(editor.url)).status, 200);
  const plain = await startCharacterEditor(f.service, { port: 0 }); t.after(() => plain.close());
  assert.equal(plain.endpointPublished, false);
});

test('bootstrap writes the endpoint file beside a started editor, and null disables it', async t => {
  const f = await fixture(t), configPath = path.join(f.root, 'e1.config.json');
  const endpointPath = path.join(f.root, 'LSA Enhanced', CONTROL_ENDPOINT_FILE);
  const options = { configPath, env: {}, enableTelemetry: false, identityContract: await verifyIdentityContract(), characterContract: await verifyCharactersContract(), identityEvidence: f.evidence, nativeOwner: f.native, profileStore: f.store };
  const config = port => JSON.stringify({ persistentIdentity: { enabled: true, mode: 'voices', worldProfileId: f.config.persistentIdentity.worldProfileId, storePath: f.config.persistentIdentity.storePath }, promotedCharacters: { ...f.config.promotedCharacters, editorPort: port } });
  await writeFile(configPath, config(await freePort()));
  const runtime = await createRuntimeForBundle({ ...options, controlEndpointPath: endpointPath });
  t.after(() => runtime.identityService.close());
  assert.equal(runtime.characterEditor.endpointPublished, true);
  assert.equal(JSON.parse(await readFile(endpointPath, 'utf8')).url, runtime.characterEditor.url);
  await runtime.characterEditor.close();
  await assert.rejects(readFile(endpointPath, 'utf8'), { code: 'ENOENT' });
  await writeFile(configPath, config(await freePort()));
  const disabled = await createRuntimeForBundle({ ...options, controlEndpointPath: null });
  t.after(() => disabled.identityService.close()); t.after(() => disabled.characterEditor.close());
  assert.equal(disabled.characterEditor.endpointPublished, false);
  await assert.rejects(readFile(endpointPath, 'utf8'), { code: 'ENOENT' });
});
