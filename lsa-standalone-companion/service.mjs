import { runSessionSupervisor } from './src/native/sessionSupervisor.mjs';
import { runTypedTurnSession } from './src/conversation/typedRuntime.mjs';
import { createResponsesProvider } from './src/conversation/responsesProvider.mjs';

// Independent Node entry point: no stock server.bundle.mjs, no Essential.
// Explicitly opt-in to provider calls. It is safe to run health-only without
// credentials, and no actor can be controlled until the native GTA gate opens.
const stopping = new AbortController();
process.once('SIGINT', () => stopping.abort());
process.once('SIGTERM', () => stopping.abort());

const typedMode = process.env.LSA_STANDALONE_TYPED_MODE === 'enabled';
let provider = null;
if (typedMode) {
  try { provider = createResponsesProvider(); }
  catch { console.log(JSON.stringify({ component: 'lsa_standalone',
    event: 'typed_provider_not_configured' })); }
}
if (!typedMode) console.log(JSON.stringify({
  component: 'lsa_standalone', event: 'typed_mode_off'
}));

await runSessionSupervisor({
  signal: stopping.signal,
  onConnected: provider ? (client, _session, signal) =>
    runTypedTurnSession({
      client, provider, signal, pollMs: 250,
      onStatus: (event, metadata = {}) => console.log(JSON.stringify({
        component: 'lsa_standalone', event, reason: metadata.reason
      }))
    }) : null,
  onStatus(type, fields) {
    // No player dialogue, profile details, keys, model output or PCM in logs.
    console.log(JSON.stringify({ component: 'lsa_standalone',
      event: type,
      reason: ['native_disconnected', 'native_unavailable'].includes(type)
        ? fields.reason : undefined,
      worldEpoch: type === 'native_connected' ? fields.worldEpoch : undefined
    }));
  }
});
