// Post-TTS gain for the common native PCM handoff. Both OpenAI and Qwen
// produce signed mono PCM16 LE at 24 kHz. Never alter byte count or timing.
export function scalePcm16(pcm, gain = 1) {
  if (!(pcm instanceof Uint8Array)) throw new TypeError('TTS PCM must be bytes.');
  if (pcm.byteLength % 2) throw new TypeError('TTS PCM must contain complete PCM16 samples.');
  if (typeof gain !== 'number' || !Number.isFinite(gain) || gain < 0 || gain > 2) {
    throw new RangeError('ttsVolume must be between 0 and 2.');
  }
  if (gain === 1) return pcm;
  const output = new Uint8Array(pcm.byteLength);
  const input = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const dest = new DataView(output.buffer);
  for (let offset = 0; offset < pcm.byteLength; offset += 2) {
    const sample = input.getInt16(offset, true);
    const scaled = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
    dest.setInt16(offset, scaled, true);
  }
  return output;
}
