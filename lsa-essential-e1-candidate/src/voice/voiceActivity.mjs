// Live voice activity for the native UX4 microphone meter and status line.
//
// Where the signal comes from: Essential's server captures the microphone with one
// persistent FFmpeg process (16 kHz mono s16le on stdout) and forwards each chunk,
// while a mic turn is open, to OpenAIConnection.sendRealtimeAudio. This module
// measures exactly those chunks, so the level is the real microphone stream and
// never a second capture, a second device or an inference from button state.
// Only a peak magnitude (0..1) per chunk and a few phase codes are kept: no
// samples, no transcript, no names, and nothing is written to telemetry or disk.
// Every method is best effort and never throws, so the meter can never fail a
// conversation. The native loader reads snapshot() through the editor API's
// read-only voice_status action.
//
// Phases, in pipeline order:
//   recording     capture_started was accepted and chunks are arriving
//   transcribing  the player's audio was submitted (capture ended with audio)
//   thinking      STT finished (or no STT needed) and the model/TTS is working
//   speaking      native reported playback_started for this exact turn
//   done          the turn completed
//   error         the turn failed or was cancelled; `reason` is a bounded code
//   idle          nothing to show
const SAMPLE_PEAK = 32768;
const RING = 16;
const CODE = /^[a-z][a-z0-9_]{0,47}$/;
const THINKING_STAGES = new Set(['model_running', 'decision_validation', 'decision_validated', 'tts_running', 'native_authorization', 'playback_streaming', 'stream_end', 'playback_completion']);

export function peakOfPcm16(pcm) {
  if (!pcm || typeof pcm.length !== 'number' || pcm.length < 2) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2));
  let peak = 0;
  for (let offset = 0; offset < view.byteLength; offset += 2) {
    const magnitude = Math.abs(view.getInt16(offset, true));
    if (magnitude > peak) peak = magnitude;
  }
  return Math.min(1, peak / SAMPLE_PEAK);
}

export function reasonForAbort(reason) {
  const text = String(reason || '').toLowerCase();
  if (text.includes('supersed')) return 'superseded';
  if (text.includes('disconnect') || text.includes('session_closed')) return 'disconnected';
  return 'cancelled';
}

const keyOf = identity => identity ? [identity.pedId, identity.turnId, identity.generationId, identity.sessionNonce].join('\0') : null;
const boundedReason = reason => typeof reason === 'string' && CODE.test(reason) ? reason : 'failed';

export function createVoiceActivity({ clock = () => performance.now(), levelWindowMs = 120, lingerMs = 6000 } = {}) {
  let conversation = 0;
  let key = null;
  let phase = 'idle';
  let reason = null;
  let phaseAt = 0;
  let conversationAt = 0;
  let ring = [];

  const set = (next, why = null) => { phase = next; reason = why; phaseAt = clock(); };
  const current = identity => key !== null && keyOf(identity) === key;
  const live = () => phase === 'recording' || phase === 'transcribing' || phase === 'thinking' || phase === 'speaking';

  return {
    // A new microphone capture always takes over: an older conversation's later
    // events no longer match `key` and are ignored.
    captureStarted(identity) {
      try {
        const next = keyOf(identity);
        if (!next) return false;
        conversation += 1; key = next; ring = [];
        conversationAt = clock(); set('recording');
        return true;
      } catch { return false; }
    },
    level(identity, pcm) {
      try {
        if (phase !== 'recording' || !current(identity)) return false;
        ring.push({ at: clock(), peak: peakOfPcm16(pcm) });
        if (ring.length > RING) ring.shift();
        return true;
      } catch { return false; }
    },
    // submitted=false means the capture ended without usable audio.
    captureEnded(identity, { submitted, reason: why = 'no_audio' } = {}) {
      try {
        if (phase !== 'recording' || !current(identity)) return false;
        ring = [];
        if (submitted) set('transcribing'); else set('error', boundedReason(why));
        return true;
      } catch { return false; }
    },
    // Runner stage names (runSequentialTurn transition()).
    stage(identity, stage) {
      try {
        if (!live() || !current(identity)) return false;
        if (stage === 'transcribing' && phase === 'recording') { ring = []; set('transcribing'); return true; }
        if (stage === 'transcribing') return false;
        if (THINKING_STAGES.has(stage) && (phase === 'transcribing' || phase === 'thinking' || phase === 'recording')) {
          if (phase !== 'thinking') set('thinking');
          return true;
        }
        return false;
      } catch { return false; }
    },
    nativePlayback(identity, type) {
      try {
        if (type !== 'playback_started' || !live() || !current(identity) || phase === 'speaking') return false;
        set('speaking');
        return true;
      } catch { return false; }
    },
    // reason: 'completed' | 'superseded' | any bounded terminal code.
    terminal(identity, why) {
      try {
        if (!live() || !current(identity)) return false;
        ring = [];
        if (why === 'completed') set('done');
        else if (why === 'superseded') { set('idle'); key = null; }
        else set('error', boundedReason(why));
        return true;
      } catch { return false; }
    },
    snapshot() {
      try {
        const now = clock();
        if ((phase === 'done' || phase === 'error') && now - phaseAt > lingerMs) { phase = 'idle'; reason = null; }
        let level = 0;
        let levelAgeMs = null;
        if (phase === 'recording' && ring.length) {
          levelAgeMs = Math.max(0, Math.round(now - ring[ring.length - 1].at));
          for (const item of ring) if (now - item.at <= levelWindowMs && item.peak > level) level = item.peak;
        }
        return {
          v: 1, conv: conversation, phase, reason: phase === 'error' ? reason : null,
          phaseMs: Math.max(0, Math.round(now - phaseAt)), convMs: key === null ? 0 : Math.max(0, Math.round(now - conversationAt)),
          level: Math.round(level * 1000) / 1000, levelAgeMs,
        };
      } catch { return { v: 1, conv: 0, phase: 'idle', reason: null, phaseMs: 0, convMs: 0, level: 0, levelAgeMs: null }; }
    },
  };
}
