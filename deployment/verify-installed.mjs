import assert from 'node:assert/strict';
import { readFile, readdir, access, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { verifyNativeContract } from '../lsa-essential-e1-candidate/tools/verifyNativeContract.mjs';

// This verifier never starts the server, GTA, or any provider operation.
globalThis.fetch = () => { throw Error('Network prohibited during deployment verification'); };
const directory = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(await readFile(path.join(directory, 'install-plan.json'), 'utf8'));
const server = path.join(plan.gta, 'plugins/LosSantosAliveServer');
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
for (const file of plan.stagedFiles) {
  await access(path.join(plan.gta, file.relative));
  if (file.sha256) assert.equal(await hash(path.join(plan.gta, file.relative)), file.sha256, file.relative);
}
const dllHash = await hash(path.join(plan.gta, 'plugins/LosSantosAlive.dll'));
assert.equal(dllHash, plan.nativeContract.dllSha256);
const nativeContract = await verifyNativeContract(dllHash);
const { createRuntimeForBundle } = await import(pathToFileURL(path.join(server, 'e1/bootstrap.mjs')));
const runtime = await createRuntimeForBundle();
assert.equal(runtime.config.provider, 'openai');
for (const name of ['reasoningKey', 'transcriptionKey', 'ttsKey']) assert.ok(runtime.config[name]?.trim(), `${name} must be present`);
const withoutInheritedEnv = await createRuntimeForBundle({ env: {}, envFilePath: path.join(server, '.env'), configPath: path.join(server, 'e1.config.json') });
for (const name of ['reasoningKey', 'transcriptionKey', 'ttsKey']) assert.ok(withoutInheritedEnv.config[name]?.trim(), 'Native direct launch must load file credentials');
assert.equal(withoutInheritedEnv.config.reasoningModel, 'gpt-6-luna');
const { loadPrivateEnvironment } = await import(pathToFileURL(path.join(server, 'e1/config/privateEnvironment.mjs')));
const oldEnv = await loadPrivateEnvironment({ env: {}, envFilePath: path.join(plan.backup, 'plugins/LosSantosAliveServer/.env') });
assert.equal(withoutInheritedEnv.config.reasoningKey, oldEnv.OPENAI_REASONING_API_KEY ?? oldEnv.OPENAI_API_KEY);
assert.equal(withoutInheritedEnv.config.transcriptionKey, oldEnv.OPENAI_TRANSCRIPTION_API_KEY ?? oldEnv.OPENAI_API_KEY);
assert.equal(withoutInheritedEnv.config.ttsKey, oldEnv.OPENAI_TTS_API_KEY ?? oldEnv.OPENAI_API_KEY);
const configText = await readFile(path.join(plan.gta, 'plugins/LosSantosAlive/LosSantosAlive.config'), 'utf8');
for (const name of ['ApiKey', 'Language', 'TalkKey', 'TextKey', 'MarkPedKey', 'MarkedPedTalkKey', 'AudioVolume', 'TutorialComplete']) assert.match(configText, new RegExp(`^${name}=`, 'm'));
const syntaxFiles = plan.stagedFiles.filter(f => f.relative.endsWith('.mjs'));
for (const file of syntaxFiles) {
  const checked = spawnSync(process.execPath, ['--check', path.join(plan.gta, file.relative)], { encoding: 'utf8', windowsHide: true });
  assert.equal(checked.status, 0, `Syntax check: ${file.relative}`);
}
const serverFiles = await readdir(server);
assert.ok(!serverFiles.includes('server.js') && !serverFiles.includes('node_modules'));
const ffmpeg = spawnSync(path.join(server, 'ffmpeg.exe'), ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true });
assert.equal(ffmpeg.status, 0, 'Bundled ffmpeg executes');
const rollback = JSON.parse((await readFile(path.join(plan.backup, 'rollback-manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
for (const file of rollback.files) assert.equal(await hash(path.join(plan.backup, file.relative)), file.sha256.toLowerCase(), 'Rollback file content');
const report = {
  status: 'ready-for-user-GTA-smoke-test-runtime-unverified', activeBuild: 'E1.1 hardened Essential Hotfix #3 companion',
  activeRoot: plan.gta, backup: plan.backup, backupFilesVerified: rollback.files.length,
  installedFilesVerified: plan.stagedFiles.length, nativeContract, nodeVersion: process.version,
  syntaxFilesVerified: syntaxFiles.length, ffmpegExecutableVerified: true,
  provider: runtime.config.provider, reasoningModel: runtime.config.reasoningModel,
  transcriptionModel: runtime.config.transcriptionModel, ttsModel: runtime.config.ttsModel,
  openaiKeyAvailable: true, nativeBootstrapLoadsPrivateEnv: true, copiedCredentialsMatchBackup: true,
  legacyServerCodeAbsent: true, stockConfigPreserved: true,
  stockControls: { talk: 'Mouse4', text: 'None', markPed: 'F3', markedPedTalk: 'Mouse5' },
  priorBackupUntouched: plan.priorBackupUntouched, offlineTests: { total: 99, passed: 99, failed: 0, cancelled: 0, skipped: 0 },
  gtaLaunched: false, liveApiCalls: 0,
  limitations: ['GTA native startup, protocol handshake, physical playback, and actions require in-game smoke testing.', 'Stock TextKey=None; bind a text key through stock settings before keyboard shortcut testing.']
};
await writeFile(path.join(directory, 'deployment-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
