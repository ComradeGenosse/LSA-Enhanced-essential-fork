import { stageNativeSpeechSegments } from './segmentPipeline.mjs';
import { stageNativePcmStream } from '../audio/nativePcm.mjs';
import { NativePlayerContext, PendingDialogue, handleNextTypedTurn } from './typedTurn.js.mjs';

// One model request at a time, from exactly one native connection. This is
// intentionally more restrictive than the eventual multi-NPC arbiter.
export async function runTypedTurnSession({
  client, provider, tts = null, earlySpeech = false,
  confirmPlayback = false, signal, pollMs = 250, onStatus = () => {}
} = {}) {
  if (!client || !provider || !Number.isInteger(pollMs) ||
      pollMs < 50 || pollMs > 5000 || typeof onStatus !== 'function')
    throw new Error('invalid_typed_runtime');
  const staged = new PendingDialogue();
  const playerContext = new NativePlayerContext();
  const retired = new AbortController();
  const stop = () => retired.abort();
  signal?.addEventListener('abort', stop, { once: true });
  client.closed?.then(stop, stop);
  if (signal?.aborted) stop();

  const pause = () => new Promise(resolve => {
    if (retired.signal.aborted) { resolve(); return; }
    const finish = () => {
      clearTimeout(timer);
      retired.signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, pollMs);
    retired.signal.addEventListener('abort', finish, { once: true });
  });

  try {
    while (!retired.signal.aborted) {
      try {
        const result = await handleNextTypedTurn(client, provider, {
          signal: retired.signal, pending: staged, playerContext,
          onStage: () => onStatus('typed_reply_staged'),
          onStreamingSegments: earlySpeech && tts
            ? ({ client: native, offer, claims, modelSegments, signal: turnSignal }) =>
                stageNativeSpeechSegments({
                  client: native, offer, claims, modelSegments,
                  tts, signal: turnSignal, confirmPlayback,
                  onPlaybackProgress: progress =>
                    onStatus('physical_segment_progress', {
                      completedSegments: progress.completedSegments,
                      expectedSegments: progress.expectedSegments
                    })
                }).then(receipt => {
                  if (receipt.physicalReceipt)
                    onStatus('physical_playback_completed_no_history');
                  return receipt;
                })
            : null,
          onReplyStaged: tts ? ({ client: native, claims, offer, replyText, signal: turnSignal }) =>
            stageNativePcmStream(native, claims,
              tts.streamPcm({ text: replyText, identity: offer, signal: turnSignal }),
              { signal: turnSignal, confirmPlayback,
                onPlaybackProgress: progress =>
                  onStatus('physical_segment_progress', {
                    completedSegments: progress.completedSegments,
                    expectedSegments: progress.expectedSegments
                  }) }).then(receipt => {
                if (receipt.physicalReceipt)
                  onStatus('physical_playback_completed_no_history');
                return receipt;
              }) : null
        });
        if (result.state === 'speech_segments_sealed_not_played')
          onStatus('speech_segments_sealed_not_played');
        if (result.state === 'pcm_sealed_not_played')
          onStatus('pcm_sealed_not_played');
        if (result.state !== 'none' && result.state !== 'staged_not_played' &&
            result.state !== 'pcm_sealed_not_played' &&
            result.state !== 'speech_segments_sealed_not_played')
          throw new Error('unknown_typed_outcome');
      } catch (error) {
        if (retired.signal.aborted) break;
        const permitted = new Set([
          'native_typed_text_missing', 'invalid_player_text',
          'provider_transport_failure', 'provider_http_failure',
          'provider_invalid_json', 'provider_incomplete', 'provider_invalid_answer',
          'typed_turn_cancelled', 'native_request_timeout',
          'native_disconnected', 'unknown_typed_outcome',
          'speech_http_failure', 'speech_transport_failure',
          'speech_stream_failure', 'speech_stream_unavailable',
          'speech_too_long', 'speech_invalid_pcm_length',
          'pcm_stream_capacity', 'pcm_no_native_output_credit',
          'pcm_transfer_cancelled',
          'playback_cancelled', 'playback_deadline',
          'playback_device_stalled', 'playback_device_failed',
          'invalid_native_physical_progress', 'playback_ack_rejected',
          'speech_text_capacity', 'speech_segment_capacity',
          'provider_stream_invalid', 'provider_stream_failure',
          'provider_stream_unavailable', 'provider_unsupported_output'
        ]);
        const code = permitted.has(error?.message) ? error.message : 'typed_turn_rejected';
        onStatus('typed_turn_failed', { reason: code });
      }
      await pause();
    }
  } finally {
    stop();
    staged.retireAll(); // never carry unplayed conversation into a new transport
    playerContext.retireAll();
    signal?.removeEventListener('abort', stop);
  }
}
