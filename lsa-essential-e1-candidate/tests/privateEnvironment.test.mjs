import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPrivateEnvironment } from '../src/config/privateEnvironment.mjs';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';

async function fixture(t, content) {
  const directory = await mkdtemp(path.join(tmpdir(), 'e1-env-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envFilePath = path.join(directory, '.env');
  await writeFile(envFilePath, content);
  return envFilePath;
}

test('native bootstrap loads private credentials without importing old branch settings', async t => {
  const envFilePath = await fixture(t, 'OPENAI_API_KEY="offline-placeholder"\nAI_PROVIDER=gemini\nOPENAI_REASONING_MODEL=old-model\n');
  const env = await loadPrivateEnvironment({ env: {}, envFilePath });
  assert.equal(env.OPENAI_API_KEY, 'offline-placeholder');
  assert.equal(env.AI_PROVIDER, undefined);
  assert.equal(env.OPENAI_REASONING_MODEL, undefined);
  const runtime = await createRuntimeForBundle({ env: {}, envFilePath, configPath: path.join(path.dirname(envFilePath), 'missing.json') });
  assert.equal(runtime.config.provider, 'openai');
  assert.equal(runtime.config.reasoningKey, 'offline-placeholder');
});

test('process credentials take precedence and endpoint credentials remain supported', async t => {
  const envFilePath = await fixture(t, 'OPENAI_API_KEY=file-placeholder\nOPENAI_TTS_API_KEY=tts-placeholder\n');
  const env = await loadPrivateEnvironment({ env: { OPENAI_API_KEY: 'process-placeholder' }, envFilePath });
  assert.equal(env.OPENAI_API_KEY, 'process-placeholder');
  assert.equal(env.OPENAI_TTS_API_KEY, 'tts-placeholder');
});

test('missing private file preserves supplied environment', async () => {
  const env = await loadPrivateEnvironment({ env: { OPENAI_API_KEY: 'process-placeholder' }, envFilePath: new URL('./nonexistent-private-env', import.meta.url) });
  assert.equal(env.OPENAI_API_KEY, 'process-placeholder');
});

test('explicit bootstrap environment does not load local credentials', async () => {
  const runtime = await createRuntimeForBundle({ env: {}, configPath: new URL('./nonexistent-config.json', import.meta.url) });
  assert.equal(runtime.config.reasoningKey, '');
});
