import { runSessionSupervisor } from './src/native/sessionSupervisor.mjs';
import { runTypedTurnSession } from './src/conversation/typedRuntime.mjs';
import { createResponsesProvider } from './src/conversation/responsesProvider.mjs';
import { createStreamingResponsesProvider } from './src/conversation/streamingResponses.mjs';
import { createConfiguredSpeechRouter } from './src/audio/speechSetup.mjs';
import { resolveActivation } from './src/activation/capabilities.mjs';
import { createActivationReporter } from './src/activation/diagnostics.mjs';

// Independent Node entry point: no stock server.bundle.mjs, no Essential.
// Explicitly opt-in to provider calls. It is safe to run health-only without
// credentials, and no actor can be controlled until the native GTA gate opens.
const stopping = new AbortController();
process.once('SIGINT', () => stopping.abort());
process.once('SIGTERM', () => stopping.abort());

const activation = resolveActivation(process.env);
if (!activation.valid) {
  for (const reason of activation.errors) console.error(JSON.stringify({
    component: 'lsa_standalone', event: 'activation_blocked', reason
  }));
  process.exit(2); // no native connection or effects on invalid configuration
}
const requested = name => activation.capabilities[name].requested;
const reporter = createActivationReporter(activation, record => {
  console.log(JSON.stringify(record));
});
const emitCapability = reporter.emit;
reporter.initialize();
let provider = null, tts = null, earlySpeech = false;
if (requested('typed_conversation')) {
  try { provider = createResponsesProvider(); }
  catch {
    emitCapability('typed_conversation', false, 'blocked', ['provider_initialization_failed']);
    process.exit(2);
  }
}
if (requested('tts')) {
  try { tts = await createConfiguredSpeechRouter(); }
  catch {
    emitCapability('tts', false, 'blocked', ['speech_provider_initialization_failed']);
    process.exit(2);
  }
  emitCapability('tts', true, 'router_constructed_no_PCM_evidence');
}
if (requested('early_speech')) {
  try {
    provider.streamSpeechSegments =
      createStreamingResponsesProvider().streamSpeechSegments;
    earlySpeech = typeof provider.streamSpeechSegments === 'function';
    if (!earlySpeech) throw Error('streaming_adapter_unavailable');
  } catch {
    emitCapability('early_speech', false, 'blocked', ['streaming_adapter_unavailable']);
    process.exit(2);
  }
  emitCapability('early_speech', true, 'stream_adapter_loaded_no_segment_evidence');
}
// The device-side waveOut effect still requires native opt-in, lease and
// owner-fiber progress. Node configuration alone never means audible output.
const confirmPlayback = requested('physical_audio');
await runSessionSupervisor({
  signal: stopping.signal,
  onConnected: provider ? (client, _session, signal) => {
    return runTypedTurnSession({
      client, provider, tts, confirmPlayback,
      earlySpeech, signal, pollMs: 250,
      onStatus: (event, metadata = {}) => {
        // Detached work from an old native pipe cannot claim new-session status.
        if (signal.aborted) return;
        if (event === 'typed_reply_staged') emitCapability('typed_conversation', true, 'native_reply_staged_not_played');
        if (event === 'pcm_sealed_not_played') emitCapability('tts', true, 'pcm_sealed_not_played');
        if (event === 'speech_segments_sealed_not_played') emitCapability('early_speech', true, 'segments_sealed_not_played');
        if (event === 'physical_playback_completed_no_history') emitCapability('physical_audio', true, 'native_driver_receipt_not_GTA_audibility');
        console.log(JSON.stringify({
        component: 'lsa_standalone', event, reason: metadata.reason,
        completedSegments: event === 'physical_segment_progress'
          ? metadata.completedSegments : undefined,
        expectedSegments: event === 'physical_segment_progress'
          ? metadata.expectedSegments : undefined
      }));
      }
    });
  } : null,
  onStatus(type, fields) {
    reporter.transportStatus(type);
    // No player dialogue, profile details, keys, model output or PCM in logs.
    console.log(JSON.stringify({ component: 'lsa_standalone',
      event: type,
      reason: ['native_disconnected', 'native_unavailable'].includes(type)
        ? fields.reason : undefined,
      worldEpoch: type === 'native_connected' ? fields.worldEpoch : undefined
    }));
  }
});
