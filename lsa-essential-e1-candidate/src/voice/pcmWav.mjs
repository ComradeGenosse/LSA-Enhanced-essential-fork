// Provider-neutral 24 kHz mono PCM16-to-WAV conversion for local audio previews.
const MAX_PCM_BYTES=12_000_000;
export function pcmToWav(chunks) {
  if (!Array.isArray(chunks) || chunks.some(chunk=>!Buffer.isBuffer(chunk))) {
    throw new TypeError('Expected a list of PCM buffers.');
  }
  const pcm=Buffer.concat(chunks);
  if (!pcm.length || pcm.length>MAX_PCM_BYTES || pcm.length%2!==0) {
    throw new Error('WAV preview rejected empty, oversized, or misaligned PCM.');
  }
  const header=Buffer.alloc(44);
  header.write('RIFF',0);
  header.writeUInt32LE(36+pcm.length,4);
  header.write('WAVE',8);
  header.write('fmt ',12);
  header.writeUInt32LE(16,16);
  header.writeUInt16LE(1,20);
  header.writeUInt16LE(1,22);
  header.writeUInt32LE(24000,24);
  header.writeUInt32LE(48000,28);
  header.writeUInt16LE(2,32);
  header.writeUInt16LE(16,34);
  header.write('data',36);
  header.writeUInt32LE(pcm.length,40);
  return Buffer.concat([header,pcm]);
}
