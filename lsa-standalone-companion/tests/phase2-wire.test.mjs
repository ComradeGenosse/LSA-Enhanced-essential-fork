import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { encodeWireFrame, Phase2FrameDecoder, Phase2NativeClient } from '../src/native/phase2Wire.mjs';

const run = randomUUID(), transport = randomUUID();
const tags = { v: 1, hostRunId: run, worldEpoch: 1, transportId: transport };
const frame = (type, seq, more = {}) => ({ ...tags, type, seq, ...more });

async function fixture(t, behavior) {
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\lsa-s2-test-${randomUUID()}`
    : path.join(os.tmpdir(), `lsa-s2-${randomUUID()}.sock`);
  const sockets = new Set();
  const errors = [];
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    try { behavior(socket, errors); } catch (e) { errors.push(e); socket.destroy(); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, resolve);
  });
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    if (process.platform !== 'win32') { try { fs.unlinkSync(endpoint); } catch {} }
    assert.deepEqual(errors, []);
  });
  return endpoint;
}

function respond(socket, opts = {}) {
  const decoder = new Phase2FrameDecoder();
  let state = 0, seq = 1;
  socket.on('data', bytes => {
    try {
      for (const value of decoder.push(bytes)) {
        if (state === 0) {
          assert.equal(value.type, 'client.hello');
          assert.equal(value.seq, 1);
          socket.write(encodeWireFrame(frame('host.ready', 1)));
          state = 1;
          continue;
        }
        if (opts.onRequest) { opts.onRequest(socket, value, seq++); continue; }
        if (value.type === 'health.ping')
          socket.write(encodeWireFrame(frame('health.pong', ++seq, { requestId: value.requestId, status: 'ok' })));
        if (value.type === 'host.snapshot')
          socket.write(encodeWireFrame(frame('host.snapshot.result', ++seq,
            { requestId: value.requestId, status: 'ok', trackedActors: 0 })));
      }
    } catch (e) { opts.errors?.push(e); socket.destroy(); }
  });
  socket.write(encodeWireFrame(frame('host.hello', 0)));
}

test('strict framed health and game-fiber snapshot protocol', async t => {
  const endpoint = await fixture(t, (socket, errors) => respond(socket, { errors }));
  const client = new Phase2NativeClient({ pipePath: endpoint, timeoutMs: 1000 });
  const binding = await client.connect();
  assert.equal(binding.hostRunId, run);
  assert.equal((await client.request('health.ping')).status, 'ok');
  assert.equal((await client.request('host.snapshot')).trackedActors, 0);
  await assert.rejects(client.request('action.request'), /unsupported_request/);
  client.close();
});

test('decoder waits for complete length prefix and supports split/coalesced frames', () => {
  const decoder = new Phase2FrameDecoder();
  const a = encodeWireFrame(frame('host.hello', 0));
  const b = encodeWireFrame(frame('host.ready', 1));
  assert.deepEqual(decoder.push(a.subarray(0, 2)), []);
  assert.deepEqual(decoder.push(Buffer.concat([a.subarray(2, 5)])), []);
  assert.deepEqual(decoder.push(Buffer.concat([a.subarray(5), b])), [frame('host.hello', 0), frame('host.ready', 1)]);
});

test('decoder rejects invalid UTF-8 and oversized messages before allocating payload', () => {
  const invalid = Buffer.from([1, 0, 0, 0, 0xff]);
  assert.throws(() => new Phase2FrameDecoder().push(invalid));
  const tooLong = Buffer.alloc(4); tooLong.writeUInt32LE(8193);
  assert.throws(() => new Phase2FrameDecoder().push(tooLong), /invalid_frame_length/);
  assert.throws(() => encodeWireFrame({ text: 'x'.repeat(9000) }), /invalid_frame_length/);
});

test('handshake refuses wrong version even when host id is valid', async t => {
  const endpoint = await fixture(t, socket => socket.write(encodeWireFrame({ ...frame('host.hello', 0), v: 2 })));
  const client = new Phase2NativeClient({ pipePath: endpoint, timeoutMs: 800 });
  await assert.rejects(client.connect(), /invalid_native_hello/);
});

test('wrong world epoch invalidates the pending request and connection', async t => {
  const endpoint = await fixture(t, (socket, errors) => respond(socket, {
    errors,
    onRequest: (s, value) => s.write(encodeWireFrame(frame('health.pong', 2,
      { worldEpoch: 2, requestId: value.requestId, status: 'ok' })))
  }));
  const client = new Phase2NativeClient({ pipePath: endpoint, timeoutMs: 800 });
  await client.connect();
  await assert.rejects(client.request('health.ping'), /wire_identity_or_order_mismatch/);
  await assert.rejects(client.request('health.ping'), /native_not_ready/);
});

test('out of order replies cannot authorize the next request', async t => {
  const requests = [];
  const endpoint = await fixture(t, (socket, errors) => respond(socket, {
    errors,
    onRequest: (s, value) => {
      requests.push(value);
      if (requests.length === 2) {
        const later = requests[1], first = requests[0];
        s.write(encodeWireFrame(frame('health.pong', 3,
          { requestId: later.requestId, status: 'ok' })));
        s.write(encodeWireFrame(frame('health.pong', 2,
          { requestId: first.requestId, status: 'ok' })));
      }
    }
  }));
  const client = new Phase2NativeClient({ pipePath: endpoint, timeoutMs: 800 });
  await client.connect();
  const a = client.request('health.ping'), b = client.request('health.ping');
  const results = await Promise.allSettled([a, b]);
  assert.equal(results.filter(r => r.status === 'rejected').length, 2);
  client.close();
});

test('disconnect retires in-flight request; no auto-replay', async t => {
  const endpoint = await fixture(t, (socket, errors) => respond(socket, {
    errors, onRequest: socket => socket.destroy()
  }));
  const client = new Phase2NativeClient({ pipePath: endpoint, timeoutMs: 1000 });
  await client.connect();
  await assert.rejects(client.request('host.snapshot'), /native_disconnected/);
  await assert.rejects(client.request('host.snapshot'), /native_not_ready/);
});

test('duplicate handshake frame fails closed', async t => {
  const endpoint = await fixture(t, (socket, errors) => {
    socket.write(encodeWireFrame(frame('host.hello', 0)));
    socket.write(encodeWireFrame(frame('host.hello', 0)));
  });
  const client = new Phase2NativeClient({ pipePath: endpoint, timeoutMs: 800 });
  await assert.rejects(client.connect());
});
