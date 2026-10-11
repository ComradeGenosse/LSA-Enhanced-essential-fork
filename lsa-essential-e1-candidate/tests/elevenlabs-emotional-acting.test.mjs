import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeConfig } from '../src/config/e1Config.mjs';
import {
  DELIVERY_VALUES, DELIVERY_SOURCES, DELIVERY_CONFIDENCES, DELIVERY_INTENSITIES,
  EXPRESSIVE_DELIVERY_MODES, DEFAULT_EXPRESSIVE_DELIVERY_CONFIG,
  normalizeExpressiveDeliveryConfig, createDelivery, isDelivery, NEUTRAL_DELIVERY,
} from '../src/voice/emotion/deliveryContract.mjs';
import {
  ELEVEN_TAG_FOR_DELIVERY, ELEVEN_SPEECH_MAX_CHARS, renderElevenSpeech,
} from '../src/voice/emotion/elevenTags.mjs';

const elevenVoice = 'JBFqnCBsd6RMkjVDRZzb';
const eleven = {
  speechProvider: 'elevenlabs',
  elevenLabs: { voices: { nathan: elevenVoice } },
};
const currentConfig = input => normalizeConfig(input, {
  OPENAI_API_KEY: 'offline-example', ELEVENLABS_API_KEY: 'offline-example',
});

test('EA0 defaults off, independent of existing actingEnabled', () => {
  assert.deepEqual(normalizeExpressiveDeliveryConfig(), DEFAULT_EXPRESSIVE_DELIVERY_CONFIG);
  assert.deepEqual(currentConfig({}).expressiveDelivery, DEFAULT_EXPRESSIVE_DELIVERY_CONFIG);
  assert.deepEqual(currentConfig({ ...eleven, actingEnabled: true }).expressiveDelivery,
    DEFAULT_EXPRESSIVE_DELIVERY_CONFIG);
  assert.equal(Object.isFrozen(currentConfig(eleven).expressiveDelivery), true);
  assert.deepEqual([...EXPRESSIVE_DELIVERY_MODES], ['off', 'shadow', 'experimental']);
  assert.deepEqual([...DELIVERY_INTENSITIES], ['subtle', 'normal', 'expressive']);
});

test('EA0 config is closed, typed and within the per-turn budget', () => {
  for (const mode of EXPRESSIVE_DELIVERY_MODES) {
    for (const intensity of DELIVERY_INTENSITIES) {
      const normalized = currentConfig({
        ...eleven, expressiveDelivery: { mode, intensity, maxTaggedSegmentsPerTurn: 8 },
      }).expressiveDelivery;
      assert.deepEqual(normalized, { mode, intensity, maxTaggedSegmentsPerTurn: 8 });
      assert.equal(Object.isFrozen(normalized), true);
    }
  }
  assert.equal(currentConfig({
    ...eleven, expressiveDelivery: { mode: 'experimental', maxTaggedSegmentsPerTurn: 0 },
  }).expressiveDelivery.maxTaggedSegmentsPerTurn, 0);
  for (const invalid of [
    null, 12, 'experimental', [], {mode:null}, {mode:'EXPERIMENTAL'},
    {mode:'preview'}, {intensity:null}, {intensity:'extreme'},
    {maxTaggedSegmentsPerTurn:null}, {maxTaggedSegmentsPerTurn:-1},
    {maxTaggedSegmentsPerTurn:9}, {maxTaggedSegmentsPerTurn:1.25},
    {maxTaggedSegmentsPerTurn:'2'}, {maxTaggedSegmentsPerTurn:true},
    {mode:'experimental', vendorTag:'[laughs]'},
    Object.defineProperty({}, 'mode', {get() { throw new Error('unsafe_getter'); }, enumerable:true}),
  ]) {
    assert.throws(() => currentConfig({ ...eleven, expressiveDelivery: invalid }),
      TypeError);
  }
  assert.throws(() => normalizeExpressiveDeliveryConfig({
    [Symbol('hidden')]: 'experimental',
  }, {speechProvider:'elevenlabs'}), TypeError);
});

test('Non-Eleven providers fail closed even when experimental was requested', () => {
  for (const provider of ['openai', 'faster-qwen3-tts']) {
    const config = currentConfig({
      speechProvider: provider,
      expressiveDelivery: { mode: 'experimental', intensity: 'expressive', maxTaggedSegmentsPerTurn: 3 },
    });
    assert.deepEqual(config.expressiveDelivery, {
      mode:'off', intensity:'expressive', maxTaggedSegmentsPerTurn:3,
    });
    assert.equal(config.speechProvider, provider);
    assert.equal(renderElevenSpeech({
      dialogue: 'Hello [laughs] there', enabled: config.expressiveDelivery.mode === 'experimental',
      delivery: createDelivery({value:'amused',source:'dialogue_cue'}),
    }), 'Hello [laughs] there');
  }
});

test('Intent enums and branded contracts are immutable and exact', () => {
  assert.deepEqual([...DELIVERY_VALUES], [
    'neutral', 'whisper', 'excited', 'fearful', 'angry',
    'amused', 'sad', 'sarcastic', 'concerned',
  ]);
  assert.deepEqual([...DELIVERY_SOURCES], ['neutral', 'verified_scene', 'luna_hint', 'dialogue_cue']);
  assert.deepEqual([...DELIVERY_CONFIDENCES], ['supported', 'soft']);
  assert.equal(isDelivery(NEUTRAL_DELIVERY), true);
  assert.deepEqual(NEUTRAL_DELIVERY, {
    version:1, value:'neutral', source:'neutral', confidence:'soft',
    intensity:'subtle', evidenceRef:null,
  });
  assert.equal(Object.isFrozen(NEUTRAL_DELIVERY), true);
  const scene = createDelivery({
    value:'excited', source:'verified_scene', confidence:'supported',
    intensity:'normal', evidenceRef:'verified:observation_123',
  });
  assert.equal(scene.evidenceRef, 'verified:observation_123');
  assert.equal(Object.isFrozen(scene), true);
  assert.equal(isDelivery(scene), true);
  assert.equal(isDelivery({...scene}), false);
  assert.equal(isDelivery(JSON.parse(JSON.stringify(scene))), false);
  assert.throws(() => { scene.value = 'angry'; }, TypeError);
});

test('Reject vendor commands, forged evidence, invalid sources and unsafe objects', () => {
  for (const input of [
    {value:'[laughs]'}, {value:'nonexistent'}, {value:'__proto__'},
    {value:7}, {source:'model'}, {source:'verified_scene', confidence:'soft'},
    {source:'luna_hint', confidence:'supported'}, {source:'neutral', value:'angry'},
    {source:'dialogue_cue',evidenceRef:'player-authored'},
    {source:'verified_scene', confidence:'supported', evidenceRef:'[sfx]'},
    {version:2}, {intensity:'screaming'}, {confidence:'strong'},
    {vendorTag:'[angry]'}, ['amused'], null,
    Object.defineProperty({}, 'value', {enumerable:true,get(){ return 'amused'; }}),
  ]) {
    assert.throws(() => createDelivery(input), TypeError);
  }
  assert.equal(isDelivery({value:'amused',source:'dialogue_cue'}), false);
});

test('Only the six approved expressions produce exactly one vendor tag', () => {
  assert.deepEqual(ELEVEN_TAG_FOR_DELIVERY, {
    whisper:'[whispers]', excited:'[excited]', angry:'[angry]',
    amused:'[laughs]', sad:'[sad]', sarcastic:'[sarcastic]',
  });
  for (const [value, tag] of Object.entries(ELEVEN_TAG_FOR_DELIVERY)) {
    const intent = createDelivery({ value, source:'dialogue_cue', intensity:'expressive' });
    assert.equal(renderElevenSpeech({
      dialogue:'Leave the room.', delivery:intent, enabled:true,
    }), tag + ' Leave the room.');
  }
  for (const value of ['neutral', 'fearful', 'concerned']) {
    const intent = value === 'neutral' ? NEUTRAL_DELIVERY :
      createDelivery({value,source:'verified_scene',confidence:'supported'});
    assert.equal(renderElevenSpeech({dialogue:'Stay safe.', delivery:intent, enabled:true}),
      'Stay safe.');
  }
});

test('Spoofed serialized intents can never authorize tags', () => {
  const dialogue='Can I come too?';
  const branded = createDelivery({value:'amused',source:'dialogue_cue'});
  const forged = {...branded};
  assert.equal(renderElevenSpeech({dialogue,delivery:forged,enabled:true}),dialogue);
  assert.equal(renderElevenSpeech({dialogue,delivery:{value:'amused'},enabled:true}),dialogue);
  assert.equal(renderElevenSpeech({dialogue,delivery:'[laughs]',enabled:true}),dialogue);
  assert.equal(renderElevenSpeech({dialogue,delivery:branded,enabled:false}),dialogue);
  assert.equal(renderElevenSpeech({dialogue,delivery:branded}),dialogue);
  assert.throws(() => renderElevenSpeech({dialogue,enabled:'experimental'}),TypeError);
});

test('Canonical dialogue, streaming segments, commands and memory plaintext stay identical', () => {
  const segment = Object.freeze({text:'You said [laughs] out loud!',sequence:1});
  const decision = Object.freeze({dialogue:segment.text,command:'Wait'});
  const transcript = JSON.stringify({role:'assistant',content:decision.dialogue});
  const before = JSON.stringify({segment,decision,transcript});
  const ttsText = renderElevenSpeech({
    dialogue:segment.text, delivery:createDelivery({value:'amused',source:'dialogue_cue'}),
    enabled:true,
  });
  assert.equal(ttsText,'[laughs] You said “laughs” out loud!');
  assert.equal(JSON.stringify({segment,decision,transcript}),before);
  assert.equal(JSON.parse(transcript).content, segment.text);
});

test('Bracket quotations keep their words but not any untrusted [tag] syntax', () => {
  const raw='She said "[angry]" and read [explosion] [whispers] [laughs].';
  const tagged = renderElevenSpeech({
    dialogue:raw,
    delivery:createDelivery({value:'sarcastic',source:'dialogue_cue'}),
    enabled:true,
  });
  assert.equal(tagged,'[sarcastic] She said "“angry”" and read “explosion” “whispers” “laughs”.');
  assert.equal((tagged.match(/\[[^\]]+\]/g)||[]).length,1);
  assert.ok(tagged.includes('“angry”'));
  assert.ok(tagged.includes('“explosion”'));
  assert.equal(renderElevenSpeech({dialogue:raw,enabled:true}),
    'She said "“angry”" and read “explosion” “whispers” “laughs”.');
  // Shadow/off always preserve the provider's legacy payload, exactly.
  assert.equal(renderElevenSpeech({dialogue:raw,enabled:false,
    delivery:createDelivery({value:'angry',source:'dialogue_cue'})}),raw);
});

test('TTS payload never exceeds the provider limit; no truncation or mutation', () => {
  const intent=createDelivery({value:'amused',source:'dialogue_cue'});
  const prefix=ELEVEN_TAG_FOR_DELIVERY.amused+' ';
  const fits='a'.repeat(ELEVEN_SPEECH_MAX_CHARS-prefix.length);
  const tagged=renderElevenSpeech({dialogue:fits,delivery:intent,enabled:true});
  assert.equal(tagged.length,ELEVEN_SPEECH_MAX_CHARS);
  assert.equal(tagged, prefix+fits);
  const full='x'.repeat(ELEVEN_SPEECH_MAX_CHARS);
  assert.equal(renderElevenSpeech({dialogue:full,delivery:intent,enabled:true}),full);
  assert.equal(renderElevenSpeech({dialogue:full,delivery:intent,enabled:false}),full);
  assert.throws(()=>renderElevenSpeech({dialogue:full+'x',delivery:intent,enabled:true}),RangeError);
  assert.throws(()=>renderElevenSpeech({dialogue:' ',enabled:true}),TypeError);
});
