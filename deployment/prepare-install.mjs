import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadPrivateEnvironment } from '../lsa-essential-e1-candidate/src/config/privateEnvironment.mjs';
import { verifyNativeContract } from '../lsa-essential-e1-candidate/tools/verifyNativeContract.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const stock = path.join(root, 'stock-hotfix3');
const release = path.resolve(root, '../lsa-essential-e1-candidate/dist/plugins/LosSantosAliveServer');
const gta = 'C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V Enhanced';
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const expectedDll = '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653';
const expectedStock = '5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2';
if (await hash(path.join(stock, 'plugins/LosSantosAlive.dll')) !== expectedDll) throw Error('Stock DLL fingerprint mismatch');
if (await hash(path.join(stock, 'plugins/LosSantosAliveServer/server.bundle.mjs')) !== expectedStock) throw Error('Stock server fingerprint mismatch');
const nativeContract = await verifyNativeContract(expectedDll);
const id = new Date().toISOString().replace(/[:.]/g, '-');
const stage = path.join(root, `active-stage-${id}`);
const backup = path.join(root, 'backups', `old-custom-LSA-2.1-${id}`);
await mkdir(stage, { recursive: false });
for (const item of await readdir(stock)) await cp(path.join(stock, item), path.join(stage, item), { recursive: true, preserveTimestamps: true });
const server = path.join(stage, 'plugins/LosSantosAliveServer');
for (const item of await readdir(release)) await cp(path.join(release, item), path.join(server, item), { recursive: true, preserveTimestamps: true });
await cp(path.join(release, 'e1.config.example.json'), path.join(server, 'e1.config.json'));
const env = await loadPrivateEnvironment({ env: {}, envFilePath: path.join(gta, 'plugins/LosSantosAliveServer/.env') });
if (!env.OPENAI_API_KEY?.trim()) throw Error('Existing OPENAI_API_KEY is missing or empty');
const names = ['OPENAI_API_KEY', 'OPENAI_REASONING_API_KEY', 'OPENAI_TRANSCRIPTION_API_KEY', 'OPENAI_TTS_API_KEY'];
const lines = ['# E1.1 credentials only. Public settings are in e1.config.json.'];
for (const name of names) {
  if (env[name] === undefined) continue;
  if (!/^[^\r\n"\\]+$/.test(env[name])) throw Error('Credential format requires manual configuration');
  lines.push(`${name}=${JSON.stringify(env[name])}`);
}
await writeFile(path.join(server, '.env'), `${lines.join('\n')}\n`);
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
    else throw Error('Unexpected linked staging entry');
  }
  return result.sort();
}
const stockFiles = await files(stock);
await writeFile(path.join(stage, 'plugins/LosSantosAlive/.installer-manifest.json'), JSON.stringify({ version: 1, mode: 'essential', files: stockFiles.filter(f => !f.endsWith('LosSantosAlive.config')) }, null, 2) + '\n');
const allFiles = await files(stage);
const stagedFiles = [];
for (const relative of allFiles) stagedFiles.push({ relative, sha256: relative.endsWith('/.env') ? null : await hash(path.join(stage, relative)) });
const roots = ['plugins/LosSantosAliveServer', 'plugins/NPCGeminiFiles', 'plugins/LosSantosAlive', 'plugins/LosSantosAlive.dll', 'plugins/LSPDFR/LosSantosAlive.Interop.dll', 'plugins/LSPDFR/LosSantosAlive.PRBridge.dll', ...stockFiles.filter(f => !f.includes('/'))];
await writeFile(path.join(root, 'install-plan.json'), JSON.stringify({ gta, stage, backup, roots, stagedFiles, nativeContract, credentialPresent: true, priorBackupUntouched: 'plugins/LosSantosAliveServer.backup-E1.1-pretest-20261001' }, null, 2) + '\n');
console.log(JSON.stringify({ stage, backup, files: allFiles.length, stockDllVerified: true, metadataVerified: true, credentialPresent: true }));
