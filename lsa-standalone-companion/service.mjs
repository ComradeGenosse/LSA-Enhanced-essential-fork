import { runSessionSupervisor } from './src/native/sessionSupervisor.mjs';

// Independent Node entry point: no stock server.bundle.mjs or Essential patches.
const stopping = new AbortController();
process.once('SIGINT', () => stopping.abort());
process.once('SIGTERM', () => stopping.abort());

await runSessionSupervisor({
  signal: stopping.signal,
  onStatus(type, fields) {
    // Fixed event names only: do not print transcripts, config, keys or PCM.
    console.log(JSON.stringify({ component: 'lsa_standalone',
      event: type,
      reason: ['native_disconnected', 'native_unavailable'].includes(type)
        ? fields.reason : undefined,
      worldEpoch: type === 'native_connected' ? fields.worldEpoch : undefined
    }));
  }
});
