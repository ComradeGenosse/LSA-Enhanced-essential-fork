import { Phase2NativeClient } from '../src/native/phase2Wire.mjs';

const client = new Phase2NativeClient();
try {
  const binding = await client.connect();
  const health = await client.request('health.ping');
  const snapshot = await client.request('host.snapshot');
  console.log(JSON.stringify({
    status: health.status, hostRunId: binding.hostRunId,
    worldEpoch: binding.worldEpoch, trackedActors: snapshot.trackedActors,
    actorEffects: 'disabled'
  }));
} catch (error) {
  console.error('standalone_native_unavailable:' + error.message);
  process.exitCode = 1;
} finally {
  client.close();
}
