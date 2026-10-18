import { assertOperationInput } from '../providerContract.mjs';
import { isDelivery } from '../../voice/emotion/deliveryContract.mjs';
import {
  ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY, ELEVEN_SPEECH_MAX_CHARS,
  sanitizeElevenSpeechDialogue, validateElevenSpeechDialogue,
  verifiedElevenTagForDelivery,
} from '../../voice/emotion/elevenTags.mjs';

// Eleven v4 Turbo is served via Text-to-Dialogue WebSocket, NOT the legacy
// Text-to-Speech stream-input protocol. Each synthesis has its own socket:
// turn cancellation can never reuse or leak audio from a previous NPC.
const ENDPOINT = 'wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input';
const PCM_BYTES_PER_SECOND = 48_000;
const MAX_MESSAGE_CHARS = 1_500_000;
const MAX_AUDIO_BYTES = 24_000_000;
const CHUNK_BYTES = 24_000; // 500 ms native forwarding, matching Qwen.
const VOICE_ID = /^[A-Za-z0-9]{20}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}={0,2}|[A-Za-z0-9+/]{3}={0,1})?$/;
// Some base64 encoders omit optional padding. Accept only canonical bytes,
// never arbitrary characters or silently truncated base64 groups.
// Defense in depth: a vendor tag is never accepted as an input parameter.
// The only acting-capable extension is EA0's injected trusted renderer.
const ALLOWED_TAG = Object.freeze(Object.fromEntries(
  Object.entries(ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY).map(([value, tag]) => [value, tag + ' '])
));
// A provider-result object is branded ONLY after the actual WebSocket text
// was sent, final PCM was forwarded, and synthesis finished without abort.
// This proves directive emission, not that a voice performed it effectively.
const appliedResults = new WeakMap();
export function wasElevenTagApplied(result, {delivery, identity} = {}) {
  try {
    const proof = appliedResults.get(result);
    return !!proof && proof.delivery === delivery && proof.identity === identity &&
      proof.modelId === 'eleven_v4_turbo' &&
      proof.tag === verifiedElevenTagForDelivery(delivery?.value, proof.modelId);
  } catch { return false; }
}
const DELIVERY_SOURCES = new Set(['verified_scene','luna_hint','dialogue_cue','ephemeral_mood','neutral']);
const DELIVERY_CONFIDENCES = new Set(['supported','soft']);
// Defense in depth before the trusted EA0 renderer's in-process brand check.
// Do not invoke getters from model-authored or otherwise untrusted objects.
function validDelivery(delivery) {
  try {
    if (!isDelivery(delivery) || Array.isArray(delivery) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(delivery)) ||
        Object.getOwnPropertySymbols(delivery).length) return false;
    const descriptors = Object.getOwnPropertyDescriptors(delivery);
    const keys = Object.keys(descriptors);
    if (keys.length !== 6 || keys.some(key =>
      !['version','value','source','confidence','intensity','evidenceRef'].includes(key) ||
      !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) return false;
    const d = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
    return d.version === 1 && Object.hasOwn(ALLOWED_TAG, d.value) &&
      DELIVERY_SOURCES.has(d.source) && DELIVERY_CONFIDENCES.has(d.confidence) &&
      ['subtle','normal','expressive'].includes(d.intensity) &&
      (d.evidenceRef === null ||
        (typeof d.evidenceRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(d.evidenceRef))) &&
      (d.source === 'verified_scene' ? d.confidence === 'supported' :
        d.confidence === 'soft' && d.evidenceRef === null) &&
      (d.source !== 'neutral' || d.value === 'neutral');
  } catch { return false; }
}
function speechTextForSocket(dialogue, delivery, mode, modelId, renderSpeech) {
  // Off and shadow must remain byte-identical to the existing socket payload.
  if (mode !== 'experimental') return {text: dialogue, tagged: false, tag: null};
  // Do not claim support on other/unknown models; still neutralize raw commands.
  const safeText = sanitizeElevenSpeechDialogue(dialogue);
  if (modelId !== 'eleven_v4_turbo' ||
      !validDelivery(delivery) || typeof renderSpeech !== 'function')
    return {text: safeText, tagged: false, tag: null};
  try {
    const rendered = renderSpeech({dialogue, delivery, enabled: true, modelId});
    const allowed = ALLOWED_TAG[delivery.value] + safeText;
    if (rendered === allowed && rendered.length <= ELEVEN_SPEECH_MAX_CHARS)
      return {text: rendered, tagged: true, tag: verifiedElevenTagForDelivery(delivery.value, modelId)};
  } catch { /* Fail closed to a sanitized, untagged TTS copy. */ }
  return {text: safeText, tagged: false};
}

function fault(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause?.status) error.status = cause.status;
  return error;
}
// ElevenLabs can report errors using nested error/detail objects or a
// top-level status. Map them to fixed diagnostic categories. Never persist
// vendor-provided text (which may echo dialogue, keys or account data).
export function classifyElevenLabsError(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return 'elevenlabs_remote_error';
  const error = frame.error && typeof frame.error === 'object' ? frame.error : {};
  const detail = frame.detail && typeof frame.detail === 'object' ? frame.detail : {};
  const nested = error.detail && typeof error.detail === 'object' ? error.detail : {};
  const tokens = [
    frame.code, frame.status, frame.type,
    error.code, error.status, error.type,
    detail.code, detail.status, detail.type,
    nested.code, nested.status, nested.type,
  ].filter(v => typeof v === 'string' && v.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(v))
    .join(' ').toLowerCase();
  // Unstructured error strings and messages are inspected ONLY for a fixed
  // set of literal indicators, NEVER logged, included in thrown errors, or
  // copied into telemetry.
  const descriptions = [
    typeof frame.error === 'string' ? frame.error : '',
    typeof frame.detail === 'string' ? frame.detail : '',
    error.message, detail.message, nested.message,
  ].filter(v => typeof v === 'string' && v.length <= 2048).join(' ').toLowerCase();
  const has = expression => expression.test(tokens) || expression.test(descriptions);
  if (has(/(credit|quota|balance|payment_required|insufficient_funds|subscription|billing)/))
    return 'elevenlabs_credits_unavailable';
  if (has(/(permission|unauthori|invalid_api_key|authenticat|forbidden|scope|api_key)/))
    return 'elevenlabs_auth_failed';
  if (has(/(rate.limit|too_many|concurren|capacity)/))
    return 'elevenlabs_rate_limited';
  if (has(/(model.not|model.unavailable|model.not.found|model_not_supported|alpha_access|model access|unsupported.model)/))
    return 'elevenlabs_model_unavailable';
  if (has(/(output.format|pcm_24000|sample.rate|format.not.supported|audio.format|tier.*format)/))
    return 'elevenlabs_output_format_unavailable';
  if (has(/(voice.not|voice.unavailable|voice.not.found|voice access|voice.not.supported)/))
    return 'elevenlabs_voice_unavailable';
  if (has(/(validation|invalid_request|unprocessable|bad_request|schema|invalid.input)/))
    return 'elevenlabs_request_rejected';
  return 'elevenlabs_remote_error';
}

function safeTime(clock) {
  const value = clock();
  if (!Number.isFinite(value)) throw new TypeError('ElevenLabs needs a monotonic clock.');
  return value;
}
export function decodePcmAudio(encoded, maxBytes, {allowOddLength=false}={}) {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(maxBytes * 4 / 3) + 4 ||
      encoded.length % 4 === 1 || !BASE64.test(encoded))
    throw fault('elevenlabs_invalid_audio');
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const pcm = Buffer.from(padded, 'base64');
  if (!pcm.length || (!allowOddLength && pcm.length % 2) || pcm.length > maxBytes ||
      pcm.toString('base64') !== padded)
    throw fault('elevenlabs_invalid_audio');
  return pcm;
}
export function createElevenLabsSpeechProvider({
  config, WebSocketImpl = globalThis.WebSocket, clock = () => performance.now(),
  renderSpeech = null,
} = {}) {
  return Object.freeze({
    id: 'elevenlabs.speech',
    capabilities: Object.freeze({
      cancellation: true, immutableInput: true, awaitedPcmCallback: true,
      outputFormat: 'pcm_s16le_mono_24000', voices: config.speechVoices,
      instructions: false, speed: false,
    }),
    async synthesize(input) {
      assertOperationInput(input, 'speech');
      if (typeof WebSocketImpl !== 'function') throw fault('elevenlabs_websocket_unavailable');
      const { dialogue, identity, speechProfile, signal, onPcm, telemetry } = input;
      if (typeof onPcm !== 'function')
        throw new TypeError('ElevenLabs dialogue and PCM callback are required and bounded.');
      validateElevenSpeechDialogue(dialogue);
      if (speechProfile?.provider && speechProfile.provider !== 'elevenlabs')
        throw new TypeError('ElevenLabs provider mismatch.');
      const alias = speechProfile?.voice ?? config.ttsVoice;
      const voiceId = config.elevenLabs.voices[alias];
      if (!config.speechVoices.includes(alias) || !VOICE_ID.test(voiceId || ''))
        throw fault('elevenlabs_voice_unconfigured');
      const key = config.elevenLabs.apiKey;
      if (typeof key !== 'string' || !key.trim()) throw fault('elevenlabs_missing_key');
      if (signal?.aborted) throw fault('cancelled');
      const actingMode = config.expressiveDelivery?.mode ?? 'off';
      const speechPayload = speechTextForSocket(
        dialogue, input.delivery, actingMode, config.elevenLabs.modelId, renderSpeech);
      const maxBytes = Math.min(config.streamingMaxPcmBytes ?? MAX_AUDIO_BYTES, MAX_AUDIO_BYTES);
      const timeoutMs = Math.min(input.timeoutMs ?? config.providerWorkDeadlineMs ?? 45_000, 120_000);
      const started = safeTime(clock);
      const url = new URL(ENDPOINT);
      url.searchParams.set('model_id', config.elevenLabs.modelId);
      url.searchParams.set('output_format', 'pcm_24000');
      const socket = new WebSocketImpl(url.toString());
      // Browser-style WebSocket works in Node 22; never place credentials in URL.
      let completed = false, failed = null, closed = false, generatedBytes = 0;
      let chunks = 0, firstAudioAt = null, forwardedBytes = 0, forwardedChunks = 0;
      let queueBytes = 0, drained = false, wake = null;
      let failureStage = 'none', emptyMarkers = 0;
      // WS frames can split a PCM16 sample; only whole samples reach native.
      let pendingPcmByte = null;
      let resolveFinished, rejectFinished;
      const finished = new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
      finished.catch(() => {}); // suppress unhandled rejection during streaming.
      const queue = [];
      const signalWake = () => { const fn = wake; wake = null; fn?.(); };
      const close = () => {
        if (closed) return;
        closed = true;
        try { socket.close(1000); } catch {}
      };
      const fail = (error, stage = 'provider_stream') => {
        if (failed || (completed && drained)) return;
        failed = error;
        failureStage = stage;
        signalWake();
        rejectFinished(error);
        close();
      };
      const abort = () => fail(fault('cancelled'), 'interruption');
      const timeout = setTimeout(() => fail(fault('timeout'), 'provider_timeout');
      signal?.addEventListener('abort', abort, { once:true });
      const record = (name, data) => telemetry?.event(name, {
        provider:'elevenlabs', modelId:config.elevenLabs.modelId, ...data,
      });
      record('elevenlabs_stream_stage', {stage:'format_selected',sampleRate:24000,channels:1});
      const enqueue = pcm => {
        if (generatedBytes + pcm.length > maxBytes || queueBytes + pcm.length > maxBytes)
          return fail(fault('elevenlabs_pcm_limit'), 'pcm_limit');
        generatedBytes += pcm.length;
        queueBytes += pcm.length;
        queue.push(pcm);
        chunks++;
        if (firstAudioAt === null) {
          firstAudioAt = safeTime(clock);
          telemetry?.event('provider_first_byte', {
            operation:'tts', durationMs:firstAudioAt-started, rawBytes:pcm.length,
          });
          telemetry?.event('pcm_first_ready', {
            pcmBytes:pcm.length, sampleRate:24000, channels:1, durationMs:firstAudioAt-started,
          });
        }
        signalWake();
      };
      const pump = async () => {
        while (!completed || queue.length) {
          if (failed) throw failed;
          if (!queue.length) {
            await new Promise(resolve => { wake = resolve; });
            continue;
          }
          const pcm = queue.shift();
          queueBytes -= pcm.length;
          for (let at=0; at<pcm.length; at+=CHUNK_BYTES) {
            if (failed) throw failed;
            const part = pcm.subarray(at, Math.min(at+CHUNK_BYTES, pcm.length));
            if (signal?.aborted) throw fault('cancelled');
            try { await onPcm(new Uint8Array(part)); }
            catch (error) {
              // Native ownership/cancellation failures are not provider audio corruption.
              fail(error, 'native_pcm');
              throw error;
            }
            // A final WebSocket frame does NOT authorize forwarding audio after
            // a native turn has been interrupted during the asynchronous callback.
            if (failed || signal?.aborted) throw failed || fault('cancelled');
            forwardedBytes += part.byteLength;
            forwardedChunks++;
            if (forwardedChunks === 1) record('elevenlabs_stream_stage', {
              stage:'pcm_forwarded',pcmBytes:part.byteLength,
            });
          }
        }
        drained = true;
      };
      const eventData = event => typeof event?.data === 'string' ? event.data : null;
      const onOpen = () => {
        if (failed || signal?.aborted) return abort();
        record('elevenlabs_stream_stage', {stage:'socket_open'});
        try {
          // Dedicated per-turn connection. Key is only sent inside authenticated
          // TLS socket, never as a URL or telemetry field.
          socket.send(JSON.stringify({voices:[voiceId],xi_api_key:key}));
          socket.send(JSON.stringify({inputs:[{text:speechPayload.text,voice_id:voiceId,new_turn:false}]}));
          socket.send(JSON.stringify({close_socket:true}));
        } catch { fail(fault('elevenlabs_send_failed'), 'request_send'); }
      };
      const onMessage = event => {
        if (failed || completed) return;
        let stage = 'message_decode';
        try {
          const raw=eventData(event);
          if (raw === null || raw.length > MAX_MESSAGE_CHARS)
            throw fault('elevenlabs_invalid_message');
          const message = JSON.parse(raw);
          if (!message || typeof message !== 'object' || Array.isArray(message))
            throw fault('elevenlabs_invalid_message');
          if (message.error || message.detail?.status === 'error' || message.type === 'error') {
            stage = 'provider_rejected';
            throw fault(classifyElevenLabsError(message));
          }
          if (message.audio !== undefined && message.audio !== null) {
            // Empty audio data conveys no PCM. It may accompany control frames:
            // do not fail an otherwise healthy stream on a zero-byte marker.
            // A complete stream with zero total PCM still fails below.
            if (message.audio === '') {
              if (emptyMarkers++ === 0) record('elevenlabs_stream_stage', {stage:'empty_audio_marker'});
            } else {
              stage = 'audio_decode';
              const pcm = decodePcmAudio(message.audio,
                Math.min(maxBytes - generatedBytes - (pendingPcmByte === null ? 0 : 1), MAX_AUDIO_BYTES),
                {allowOddLength:true});
              let aligned = pendingPcmByte === null ? pcm :
                Buffer.concat([Buffer.from([pendingPcmByte]), pcm]);
              pendingPcmByte = null;
              if (aligned.length % 2) {
                pendingPcmByte = aligned[aligned.length - 1];
                aligned = aligned.subarray(0, aligned.length - 1);
              }
              if (aligned.length) enqueue(aligned);
            }
          }
          if (message.is_final === true) {
            stage = 'pcm_alignment';
            if (pendingPcmByte !== null) throw fault('elevenlabs_invalid_audio');
            if (failed) return;
            completed = true;
            record('elevenlabs_stream_stage', {stage:'provider_final',generatedChunks:chunks});
            signalWake();
            resolveFinished();
          }
        } catch (error) {
          fail(error?.code?.startsWith?.('elevenlabs_') ? error : fault('elevenlabs_invalid_message'), stage);
        }
      };
      const onError = () => fail(fault('elevenlabs_connection_error'), 'socket_error');
      const onClose = (event) => {
        if (!completed && !failed) {
          // The numeric WebSocket close code is protocol metadata, not
          // vendor-supplied text. Keep it bounded and never log the reason.
          const code = event?.code;
          const closeCategory = Number.isInteger(code) && code >= 1000 && code <= 4999
            ? (code === 1008 ? 'elevenlabs_policy_closed' :
              code === 1013 ? 'elevenlabs_rate_limited' : 'elevenlabs_connection_closed')
            : 'elevenlabs_connection_closed';
          fail(fault(closeCategory), 'socket_closed');
        }
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('error', onError);
      socket.addEventListener('close', onClose);
      try {
        const [_, __] = await Promise.all([pump(), finished]);
        if (failed) throw failed;
        if (signal?.aborted) throw fault('cancelled');
        if (!drained || !forwardedBytes || forwardedBytes !== generatedBytes) {
          failureStage = !forwardedBytes ? 'empty_stream' : 'pcm_accounting';
          throw fault('elevenlabs_invalid_audio');
        }
        if (actingMode !== 'off') telemetry?.event('acting_tts_delivery', {
          mode: actingMode, tagged: speechPayload.tagged,
          selected: validDelivery(input.delivery) ? input.delivery.value : 'neutral',
        });
        if (actingMode === 'experimental' && input.actingBenchmark === true &&
            Number.isFinite(input.actingBaselineFirstPcmMs) && input.actingBaselineFirstPcmMs >= 0 &&
            input.actingBaselineFirstPcmMs <= 120_000) {
          telemetry?.event('acting_tts_first_pcm_delta', {
            durationMs: firstAudioAt - started - input.actingBaselineFirstPcmMs,
            tagged: speechPayload.tagged,
          });
        }
        record('elevenlabs_tts_timing_summary', {
          outcome:'finished', firstPcmMs:firstAudioAt-started,
          wallMs:safeTime(clock)-started, audioDurationMs:forwardedBytes*1000/PCM_BYTES_PER_SECOND,
          generatedChunks:chunks, forwardedChunks, pcmBytes:forwardedBytes,
        });
        telemetry?.event('pcm_delivery_summary', {
          pcmBytes:forwardedBytes, chunks:forwardedChunks,
          audioDurationMs:forwardedBytes*1000/PCM_BYTES_PER_SECOND,
          sampleRate:24000, channels:1,
        });
        if (signal?.aborted) throw fault('cancelled');
        const result = Object.freeze({
          bytes:forwardedBytes, chunks:forwardedChunks, sampleRate:24000, channels:1,
          // Diagnostic only. The authoritative check is wasElevenTagApplied
          // (unforgeable WeakMap membership + same delivery and native identity).
          tagApplied:speechPayload.tagged, appliedTag:speechPayload.tag,
        });
        if (speechPayload.tagged && speechPayload.tag !== null) {
          appliedResults.set(result, {
            delivery:input.delivery, identity, modelId:config.elevenLabs.modelId,
            tag:speechPayload.tag,
          });
        }
        return result;
      } catch(error) {
        fail(error);
        record('elevenlabs_tts_timing_summary', {
          outcome:'failed', code:failed?.code || error?.code || 'elevenlabs_audio_delivery_failed',
          stage:failureStage, generatedChunks:chunks, forwardedChunks, pcmBytes:forwardedBytes,
          wallMs:safeTime(clock)-started,
        });
        throw failed || error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        close();
        record('elevenlabs_stream_stage', {
          stage:'socket_cleanup', outcome:failed ? 'failed' : drained ? 'finished' : 'interrupted',
          forwardedBytes,forwardedChunks,
        });
      }
    },
  });
}
