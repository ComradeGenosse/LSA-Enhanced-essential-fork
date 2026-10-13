import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, PRESETS, presetEnvironment, resolveActivation
} from '../src/activation/capabilities.mjs';

const configured = settings => ({
  ...settings,
  OPENAI_API_KEY: 'fixture-never-log-secret',
  LSA_STANDALONE_MODEL: 'gpt-test',
  LSA_STANDALONE_TTS_MODEL: 'gpt-4o-mini-tts',
  LSA_STANDALONE_TTS_VOICE: 'alloy',
  LSA_STANDALONE_TTS_PROVIDER: 'openai'
});

test('default host has only native host/IPC and diagnostics, no credentials or actor effects', () => {
  const report = resolveActivation(presetEnvironment());
  assert.equal(report.valid, true);
  assert.deepEqual(Object.entries(report.capabilities)
    .filter(([, value]) => value.requested).map(([name]) => name),
    ['native_host_ipc', 'native_diagnostics']);
  assert.equal(report.nativeActorMode, 'off');
  for (const value of Object.values(report.capabilities)) {
    assert.equal(value.activated, false);
    assert.equal(value.gtaValidated, false);
    assert.equal(value.operational, 'not_observed');
  }
});

test('stages isolate features and preserve explicit physical-effect opt-in', () => {
  const stages = {
    host: [],
    probe: ['actor_probing'],
    typed: ['actor_probing','typed_conversation'],
    tts: ['actor_probing','typed_conversation','tts'],
    audio: ['actor_probing','typed_conversation','tts','physical_audio'],
    lipsync: ['actor_probing','typed_conversation','tts','physical_audio','lip_sync'],
    streaming: ['actor_probing','typed_conversation','tts','early_speech']
  };
  assert.deepEqual(Object.keys(PRESETS), Object.keys(stages));
  for (const [stage, expected] of Object.entries(stages)) {
    const env = presetEnvironment(stage);
    const report = resolveActivation(configured(env));
    assert.equal(report.valid, true, stage + ': ' + report.errors);
    assert.deepEqual(Object.entries(report.capabilities)
      .filter(([key, value]) => value.requested &&
        !['native_host_ipc', 'native_diagnostics'].includes(key))
      .map(([name]) => name), expected, stage);
    assert.equal(report.capabilities.physical_audio.requested,
      ['audio', 'lipsync'].includes(stage), stage);
    assert.equal(report.capabilities.lip_sync.requested, stage === 'lipsync');
    assert.equal(report.capabilities.early_speech.requested, stage === 'streaming');
    assert.equal(env.LSA_STANDALONE_ACTOR_MODE,
      stage === 'host' ? 'off' : stage === 'probe' ? 'diagnostic' : 'experimental');
  }
});

test('advanced overrides cannot bypass dependencies or disable mandatory host diagnostics', () => {
  assert.throws(() => presetEnvironment('typed',
    { enable: ['physical_audio'] }), /physical_audio requires tts/);
  assert.throws(() => presetEnvironment('audio',
    { disable: ['tts'] }), /physical_audio requires tts/);
  assert.throws(() => presetEnvironment('lipsync',
    { disable: ['physical_audio'] }), /lip_sync requires physical_audio/);
  assert.throws(() => presetEnvironment('host',
    { disable: ['native_diagnostics'] }), /required_diagnostic_capability/);
  assert.throws(() => presetEnvironment('host',
    { enable: ['actions'] }), /unknown_capability/);
  assert.throws(() => presetEnvironment('unsafe_mode'), /unknown_stage/);
  const custom = presetEnvironment('audio', { enable: ['early_speech'],
    disable: ['physical_audio'] });
  assert.equal(resolveActivation(configured(custom)).valid, true);
  assert.equal(custom.LSA_STANDALONE_EARLY_SPEECH, 'enabled');
  assert.equal(custom.LSA_STANDALONE_AUDIO_OUTPUT, 'off');
});

test('reject tampered independent flags and provider prerequisites fail closed', () => {
  const typed = presetEnvironment('typed');
  assert.match(resolveActivation(typed).errors.join(' '), /OPENAI_API_KEY required/);
  assert.match(resolveActivation(typed).errors.join(' '), /LSA_STANDALONE_MODEL required/);
  const badActor = resolveActivation(configured({
    ...typed, LSA_STANDALONE_ACTOR_MODE: 'diagnostic'
  }));
  assert.equal(badActor.valid, false);
  assert.match(badActor.errors.join(' '), /actor_mode experimental/);
  assert.equal(resolveActivation(configured({
    ...typed, LSA_STANDALONE_EARLY_SPEECH: 'enabled'
  })).valid, false);
  const wrongConfirmation = resolveActivation(configured({
    ...presetEnvironment('tts'),
    LSA_STANDALONE_PLAYBACK_CONFIRM: 'enabled'
  }));
  assert.equal(wrongConfirmation.valid, false);
  assert.throws(() => resolveActivation(configured({
    ...typed, LSA_STANDALONE_TTS_MODE: 'banana'
  })), /invalid_setting:LSA_STANDALONE_TTS_MODE/);
  const missingTts = resolveActivation(configured({
    ...presetEnvironment('tts'), LSA_STANDALONE_TTS_MODEL: ''
  }));
  assert.match(missingTts.errors.join(' '), /TTS_MODEL required/);
});

test('streaming requires TTS not waveOut or lip sync; direct host launch clears stale env', () => {
  assert.deepEqual(CAPABILITIES.early_speech.requires, ['tts']);
  const env = { ...configured(presetEnvironment('lipsync')),
    ...presetEnvironment('host') };
  assert.equal(resolveActivation(env).valid, true);
  assert.equal(env.LSA_STANDALONE_AUDIO_OUTPUT, 'off');
  assert.equal(env.LSA_STANDALONE_LIPSYNC, 'off');
  assert.equal(env.LSA_STANDALONE_TTS_MODE, 'off');
});

test('packaged preflight CLI emits no secrets or false GTA validation', () => {
  const exe = fileURLToPath(new URL('../tools/activation-config.mjs', import.meta.url));
  const run = (args, env) => spawnSync(process.execPath, [exe, ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } });
  const host = run(['host'], { OPENAI_API_KEY: '', LSA_STANDALONE_AUDIO_OUTPUT: 'waveout_experimental' });
  assert.equal(host.status, 0, host.stderr);
  const decoded = JSON.parse(host.stdout);
  assert.equal(decoded.settings.LSA_STANDALONE_AUDIO_OUTPUT, 'off');
  assert.match(decoded.note, /no_runtime_or_GTA_acceptance/);
  const typed = run(['typed'], configured({}));
  assert.equal(typed.status, 0, typed.stderr);
  assert.equal(typed.stdout.includes('fixture-never-log-secret'), false);
  assert.ok(Object.values(JSON.parse(typed.stdout).capabilities)
    .every(value => value.gtaValidated === false && value.activated === false));
  const bad = run(['host', '--enable=physical_audio'], configured({}));
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /requires tts/);
  assert.equal(bad.stdout, '');
});
