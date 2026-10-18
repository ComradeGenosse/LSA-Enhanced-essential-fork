// Fallback policy only. A native playback_ended(completed) receipt remains the
// sole authority for successfully delivered speech. No duration estimate
// can prove GTA drained its audio output.
export function playbackCompletionPolicy({
  pcmBytes, sampleRate = 24_000, channels = 1,
  nativeStartedAt = null, sealedAt,
  minimumMs = 10_000, graceMs = 12_000, maximumMs = 600_000,
}) {
  if (!Number.isSafeInteger(pcmBytes) || pcmBytes <= 0 ||
      !Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isSafeInteger(channels) || channels <= 0 ||
      !Number.isFinite(sealedAt) ||
      ![minimumMs, graceMs, maximumMs].every(v => Number.isFinite(v) && v > 0) ||
      minimumMs > maximumMs) throw new TypeError('Invalid playback completion policy input');
  const expectedDurationMs = pcmBytes / (sampleRate * channels * 2) * 1_000;
  const elapsedFromStartMs = Number.isFinite(nativeStartedAt)
    ? Math.max(0, sealedAt - nativeStartedAt) : null;
  const estimatedRemainingMs = elapsedFromStartMs === null
    ? expectedDurationMs : Math.max(0, expectedDurationMs - elapsedFromStartMs);
  // There is no verified native queue-depth/paused-clock probe for Essential
  // protocol v3. Reserve *the entire clip duration after EOS* plus slack,
  // rather than treating wall-clock elapsed while streaming as audible proof.
  // Long clips thus get longer watchdogs. This still fails UNKNOWN, not
  // completed, if the native callback is absent.
  const requiredMs = Math.ceil(expectedDurationMs + graceMs);
  const watchdogMs = Math.max(minimumMs, Math.min(maximumMs, requiredMs));
  return Object.freeze({
    expectedDurationMs,
    estimatedRemainingMs,
    elapsedFromStartMs,
    watchdogMs,
    durationCapped: requiredMs > maximumMs,
    bufferState: 'unavailable',
  });
}
