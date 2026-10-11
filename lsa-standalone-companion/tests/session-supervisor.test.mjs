import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { Phase2FrameDecoder, encodeWireFrame } from '../src/native/phase2Wire.mjs';
import { runSessionSupervisor } from '../src/native/sessionSupervisor.mjs';

test('independent supervisor obtains fresh transport ID after connection retirement', async t => {
  const address = process.platform === 'win32'
    ? `\\\\.\\pipe\\lsa-supervisor-${randomUUID()}` : `/tmp/lsa-supervisor-${randomUUID()}.sock`;
  const servers = new Set();
  let connections = 0;
  const host = randomUUID();
  const server = net.createServer(socket => {
    servers.add(socket);
    socket.on('close', () => servers.delete(socket));
    const transport = randomUUID();
    let stage = 0;
    const decoder = new Phase2FrameDecoder();
    socket.write(encodeWireFrame({
      v: 1, type: 'host.hello', hostRunId: host,
      worldEpoch: 1, transportId: transport, seq: 0
    }));
    socket.on('data', bytes => {
      for (const request of decoder.push(bytes)) {
        if (stage !== 0) return;
        assert.equal(request.type, 'client.hello');
        socket.write(encodeWireFrame({
          v: 1, type: 'host.ready', hostRunId: host,
          worldEpoch: 1, transportId: transport, seq: 1
        }));
        stage = 1;
        setTimeout(() => socket.destroy(), 40);
      }
    });
    connections++;
  });
  await new Promise(resolve => server.listen(address, resolve));
  t.after(async () => {
    for (const socket of servers) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  const abort = new AbortController();
  const sessions = [];
  const running = runSessionSupervisor({
    pipePath: address, timeoutMs: 1000, retryMs: 50, signal: abort.signal,
    onStatus(kind, fields) {
      if (kind === 'native_connected') {
        sessions.push(fields.transportId);
        if (sessions.length === 2) abort.abort();
      }
    }
  });
  await running;
  assert.ok(connections >= 2);
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0], sessions[1]);
});
