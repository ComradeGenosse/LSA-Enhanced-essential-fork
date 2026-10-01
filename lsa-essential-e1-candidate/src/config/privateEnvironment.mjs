import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const defaultEnvFilePath = fileURLToPath(new URL('../../.env', import.meta.url));
const credentialNames = ['OPENAI_API_KEY', 'OPENAI_REASONING_API_KEY', 'OPENAI_TRANSCRIPTION_API_KEY', 'OPENAI_TTS_API_KEY'];

// The native launcher starts Node without dotenv or --env-file. Import only
// credentials; old-branch settings must not configure the Essential companion.
export async function loadPrivateEnvironment({ env = process.env, envFilePath = defaultEnvFilePath } = {}) {
  let parsed;
  try {
    parsed = parseEnv(await readFile(envFilePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...env };
    throw new Error('Unable to load E1 private credential file.');
  }
  const merged = { ...env };
  for (const name of credentialNames) {
    if (merged[name] === undefined && parsed[name] !== undefined) merged[name] = parsed[name];
  }
  return merged;
}
