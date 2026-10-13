// Shared standalone activation contract used by the launcher and Node runtime.
// Native RPH remains the authority for actual actor and physical side effects.
// Adding a future feature means registering its prerequisites and native/env
// binding here; it does NOT grant that feature any GTA capability.
export const CAPABILITIES = Object.freeze({
  native_host_ipc: { requires: [], evidence: 'native_pipe_handshake' },
  native_diagnostics: { requires: ['native_host_ipc'], evidence: 'rph_status' },
  actor_probing: { requires: ['native_diagnostics'], evidence: 'rph_probe_status' },
  typed_conversation: { requires: ['actor_probing'], evidence: 'native_typed_offer' },
  tts: { requires: ['typed_conversation'], evidence: 'pcm_stream_sealed' },
  physical_audio: { requires: ['tts'], evidence: 'native_playback_receipt_and_audibility' },
  lip_sync: { requires: ['physical_audio'], evidence: 'actual_gta_facial_observation' },
  early_speech: { requires: ['tts'], evidence: 'streamed_segments_sealed' }
});
const BASE = ['native_host_ipc', 'native_diagnostics'];
export const PRESETS = Object.freeze({
  host: [...BASE],
  probe: [...BASE, 'actor_probing'],
  typed: [...BASE, 'actor_probing', 'typed_conversation'],
  tts: [...BASE, 'actor_probing', 'typed_conversation', 'tts'],
  audio: [...BASE, 'actor_probing', 'typed_conversation', 'tts', 'physical_audio'],
  lipsync: [...BASE, 'actor_probing', 'typed_conversation', 'tts', 'physical_audio', 'lip_sync'],
  streaming: [...BASE, 'actor_probing', 'typed_conversation', 'tts', 'early_speech']
});
const enabled = value => value === 'enabled';
const flag = (env, key) => {
  const value = env[key] ?? 'off';
  if (value !== 'off' && value !== 'enabled') throw Error('invalid_setting:' + key);
  return enabled(value);
};
const mode = (env, key, allowed, defaultValue) => {
  const value = env[key] ?? defaultValue;
  if (!allowed.includes(value)) throw Error('invalid_setting:' + key);
  return value;
};
const checks = {
  native_host_ipc: () => [],
  native_diagnostics: () => [],
  actor_probing: () => [],
  typed_conversation: env => [
    ...(!/^[a-zA-Z0-9._:-]{2,100}$/.test(env.LSA_STANDALONE_MODEL ?? '')
      ? ['LSA_STANDALONE_MODEL required for typed conversation'] : []),
    ...(!env.OPENAI_API_KEY ? ['OPENAI_API_KEY required for typed conversation'] : [])
  ],
  tts: env => {
    const provider = mode(env, 'LSA_STANDALONE_TTS_PROVIDER',
      ['openai', 'faster-qwen3-tts'], 'openai');
    const missing = [];
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(env.LSA_STANDALONE_TTS_VOICE ?? ''))
      missing.push('LSA_STANDALONE_TTS_VOICE required');
    if (provider === 'openai' && !env.LSA_STANDALONE_TTS_MODEL)
      missing.push('LSA_STANDALONE_TTS_MODEL required for OpenAI TTS');
    if (provider === 'faster-qwen3-tts' &&
        !/^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?(\/|$)/.test(
          env.LSA_STANDALONE_QWEN_URL ?? ''))
      missing.push('local LSA_STANDALONE_QWEN_URL required for Qwen TTS');
    return missing;
  },
  physical_audio: env => env.LSA_STANDALONE_PLAYBACK_CONFIRM === 'enabled'
    ? [] : ['LSA_STANDALONE_PLAYBACK_CONFIRM required for physical audio'],
  lip_sync: () => [],
  early_speech: () => []
};
const settingKeys = Object.freeze([
  'LSA_STANDALONE_ACTOR_MODE', 'LSA_STANDALONE_TYPED_MODE',
  'LSA_STANDALONE_TTS_MODE', 'LSA_STANDALONE_AUDIO_OUTPUT',
  'LSA_STANDALONE_PLAYBACK_CONFIRM', 'LSA_STANDALONE_LIPSYNC',
  'LSA_STANDALONE_EARLY_SPEECH'
]);

// This is the ONLY preset->native+Node setting mapper. It always emits every
// feature switch so inherited settings cannot accidentally enable effects.
export function presetEnvironment(stage = 'host', { enable = [], disable = [] } = {}) {
  if (!Object.hasOwn(PRESETS, stage)) throw Error('unknown_stage:' + stage);
  const selected = new Set(PRESETS[stage]);
  for (const [action, names] of [['enable', enable], ['disable', disable]]) {
    if (!Array.isArray(names)) throw Error('invalid_capability_overrides');
    for (const name of names) {
      if (!Object.hasOwn(CAPABILITIES, name)) throw Error('unknown_capability:' + name);
      if (BASE.includes(name) && action === 'disable')
        throw Error('required_diagnostic_capability:' + name);
      if (action === 'enable') selected.add(name);
      else selected.delete(name);
    }
  }
  for (const name of selected) {
    for (const requirement of CAPABILITIES[name].requires)
      if (!selected.has(requirement))
        throw Error('missing_prerequisite:' + name + ' requires ' + requirement);
  }
  const has = name => selected.has(name);
  return {
    LSA_STANDALONE_ACTOR_MODE: has('typed_conversation') ? 'experimental' :
      has('actor_probing') ? 'diagnostic' : 'off',
    LSA_STANDALONE_TYPED_MODE: has('typed_conversation') ? 'enabled' : 'off',
    LSA_STANDALONE_TTS_MODE: has('tts') ? 'enabled' : 'off',
    LSA_STANDALONE_AUDIO_OUTPUT: has('physical_audio') ? 'waveout_experimental' : 'off',
    LSA_STANDALONE_PLAYBACK_CONFIRM: has('physical_audio') ? 'enabled' : 'off',
    LSA_STANDALONE_LIPSYNC: has('lip_sync') ? 'facial_experimental' : 'off',
    LSA_STANDALONE_EARLY_SPEECH: has('early_speech') ? 'enabled' : 'off'
  };
}

export function resolveActivation(env = {}) {
  const actorMode = mode(env, 'LSA_STANDALONE_ACTOR_MODE',
    ['off', 'diagnostic', 'experimental'], 'off');
  const audio = mode(env, 'LSA_STANDALONE_AUDIO_OUTPUT',
    ['off', 'waveout_experimental'], 'off');
  const face = mode(env, 'LSA_STANDALONE_LIPSYNC',
    ['off', 'facial_experimental'], 'off');
  const requested = {
    native_host_ipc: true,
    native_diagnostics: true,
    actor_probing: actorMode !== 'off',
    typed_conversation: flag(env, 'LSA_STANDALONE_TYPED_MODE'),
    tts: flag(env, 'LSA_STANDALONE_TTS_MODE'),
    physical_audio: audio === 'waveout_experimental',
    lip_sync: face === 'facial_experimental',
    early_speech: flag(env, 'LSA_STANDALONE_EARLY_SPEECH')
  };
  const confirm = flag(env, 'LSA_STANDALONE_PLAYBACK_CONFIRM');
  const errors = [];
  if (actorMode === 'experimental' && !requested.typed_conversation)
    errors.push('actor_mode experimental requires typed_conversation');
  if (requested.typed_conversation && actorMode !== 'experimental')
    errors.push('typed_conversation requires actor_mode experimental; in-game Probe and Arm still required');
  if (confirm !== requested.physical_audio)
    errors.push('playback confirmation must match physical_audio selection');
  const capabilities = {};
  for (const [name, definition] of Object.entries(CAPABILITIES)) {
    const blockedBy = [];
    if (requested[name]) {
      for (const prerequisite of definition.requires)
        if (!requested[prerequisite]) blockedBy.push('requires ' + prerequisite);
      blockedBy.push(...checks[name](env));
      for (const reason of blockedBy) errors.push(name + ': ' + reason);
    }
    capabilities[name] = {
      requested: requested[name],
      implementationAvailable: true, // compiled paths exist; never means the device works
      configurationReady: requested[name] && !blockedBy.length,
      activated: false, // only runtime evidence can change this
      operational: 'not_observed',
      gtaValidated: false, // offline automation cannot set this
      evidenceRequired: definition.evidence,
      blockedBy
    };
  }
  return { valid: errors.length === 0, errors, capabilities,
    nativeActorMode: actorMode, physicalEffectsOptIn: requested.physical_audio,
    settings: Object.fromEntries(settingKeys.map(key => [key, env[key] ?? (
      key === 'LSA_STANDALONE_ACTOR_MODE' ? 'off' : 'off'
    )])) };
}
