import test from 'node:test';
import assert from 'node:assert/strict';
import { scalePcm16 } from '../src/voice/pcmVolume.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { stockHarness } from './stock-harness.mjs';

const fromSamples = (...samples) => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return bytes;
};
const toSamples = pcm => {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return Array.from({ length: pcm.byteLength / 2 },
    (_, index) => view.getInt16(index * 2, true));
};

test('unity is bit-exact, fractional gain attenuates, boost saturates instead of wrapping', () => {
  const samples = fromSamples(0, 1000, -1000, 32000, -32000, 32767, -32768);
  assert.equal(scalePcm16(samples, 1), samples);
  const attenuated = scalePcm16(samples, .5);
  assert.deepEqual(toSamples(attenuated), [0, 500, -500, 16000, -16000, 16384, -16384]);
  const boosted = scalePcm16(samples, 2);
  assert.deepEqual(toSamples(boosted), [0, 2000, -2000, 32767, -32768, 32767, -32768]);
  assert.deepEqual(toSamples(samples), [0, 1000, -1000, 32000, -32000, 32767, -32768],
    'gain must never modify provider-owned audio');
});
test('mute retains PCM byte count and format; nonzero input byte offsets are honored', () => {
  const raw = fromSamples(111, 1000, -1000, 222);
  const slice = raw.subarray(2, 6);
  assert.deepEqual(toSamples(scalePcm16(slice, .25)), [250, -250]);
  assert.deepEqual(toSamples(scalePcm16(slice, 0)), [0, 0]);
  assert.equal(scalePcm16(slice, 0).byteLength, slice.byteLength);
});
test('gain rejects invalid PCM and invalid volume without altering the input', () => {
  for (const bad of [-1, 2.01, Infinity, NaN, '0.5', null]) {
    assert.throws(() => scalePcm16(new Uint8Array(4), bad), /ttsVolume/);
  }
  assert.throws(() => scalePcm16(new Uint8Array(3), .5), /PCM16/);
  assert.throws(() => scalePcm16([0, 0], .5), /PCM/);
});
test('ttsVolume configuration is shared by OpenAI and ElevenLabs; absent config remains unity', () => {
  for (const speechProvider of ['openai', 'elevenlabs']) {
    const options = { speechProvider, ...(speechProvider === 'elevenlabs' ? {elevenLabs:{voices:{nathan:'JBFqnCBsd6RMkjVDRZzb'}}} : {}) };
    assert.equal(normalizeConfig(options, {}).ttsVolume, 1);
    assert.equal(normalizeConfig({...options, ttsVolume: 0}, {}).ttsVolume, 0);
    assert.equal(normalizeConfig({...options, ttsVolume: 0.8}, {}).ttsVolume, .8);
    assert.equal(normalizeConfig({...options, ttsVolume: 2}, {}).ttsVolume, 2);
    for (const volume of [-1, 2.01, '0.5', NaN, Infinity, {}, []]) {
      assert.throws(() => normalizeConfig({...options,ttsVolume:volume},{}), /ttsVolume/);
    }
  }
});
test('stock native playback gets volume-scaled PCM for both ElevenLabs and OpenAI without changing turn completion', {timeout:20000}, async()=>{
  for (const speechProvider of ['openai','elevenlabs']) {
    const speechConfig={speechProvider,ttsVolume:0.5,...(speechProvider === 'elevenlabs' ? {elevenLabs:{voices:{nathan:'JBFqnCBsd6RMkjVDRZzb'}}} : {})};
    const h = await stockHarness('openai',{config:speechConfig});
    const {connection,autoNativeAcks}=await h.openAIControllerSession();
    autoNativeAcks({completePlayback:true});
    h.runtime.services.decide=async()=>({dialogue:'Testing volume.',command:''});
    h.runtime.services.speak=async({onPcm})=>{
      const source=fromSamples(-30000,30000,1000,-1000);
      await onPcm(source);
      assert.deepEqual(toSamples(source),[-30000,30000,1000,-1000],
        'native gain must not mutate PCM returned by the provider');
      return {bytes:source.length};
    };
    try {
      const turn=await h.evaluate('ib({ pedId:"17", speaker:testActor, target:testTarget, world:testActor?.world, text:"How loud?" })');
      const identity={pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1};
      assert.equal((await connection.whenSettled(identity)).status,'completed');
      const audio=h.sent.filter(m=>m.type==='npcAudioChunk');
      assert.equal(audio.length,1);
      const bytes=Buffer.from(audio[0].audioBase64,'base64');
      assert.deepEqual(toSamples(bytes),[-15000,15000,500,-500]);
      assert.equal(bytes.length,8);
      assert.equal(h.sent.filter(m=>m.type==='npcAudioStreamEnded').length,1);
    } finally {
      connection.close();
    }
  }
});
