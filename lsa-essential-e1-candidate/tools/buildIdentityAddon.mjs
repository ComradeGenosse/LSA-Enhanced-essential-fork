import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyIdentityContract, RPH_SDK_SHA256, IDENTITY_DLL_SHA256 } from './verifyIdentityContract.mjs';
import { assertNoLinkedOutput, candidateRootPath } from './checkIsolation.mjs';

const root = candidateRootPath();
export async function buildIdentityAddon({ rphReferencePath, frameworkReferenceRoot, outputPath = path.join(root, 'dist/session-identity') } = {}) {
  const target = await assertNoLinkedOutput(outputPath);
  if (!rphReferencePath || !frameworkReferenceRoot) throw new Error('Explicit compile-only RPH and .NET 4.8.1 reference paths required.');
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  if (await hash(path.join(root,'upstream/LosSantosAlive.dll')) !== IDENTITY_DLL_SHA256 || await hash(rphReferencePath) !== RPH_SDK_SHA256) throw new Error('Identity addon assembly pin mismatch.');
  const nativeContract = await verifyIdentityContract();
  if (!nativeContract.available) throw new Error('Optional identity contract unavailable; ordinary E1 remains buildable.');
  const project = path.resolve(root, '../native/session-identity/SessionIdentity.csproj');
  const { stdout } = await promisify(execFile)('dotnet', ['build',project,'--configuration','Release','--no-restore',
    `-p:RphReferencePath=${path.resolve(rphReferencePath)}`, `-p:TargetFrameworkRootPath=${path.resolve(frameworkReferenceRoot)}`], { windowsHide: true });
  const addon = path.join(path.dirname(project), 'bin/Release/net481/LSA.SessionIdentity.dll');
  await mkdir(target, { recursive: true });
  await copyFile(addon, path.join(target,'LSA.SessionIdentity.dll'));
  const manifest = { stage:'P1', defaultEnabled:false, nativeContract, rphSdkSha256:RPH_SDK_SHA256,
    addonSha256:await hash(addon), deploymentPerformed:false, gtaRuntimeTest:false };
  await writeFile(path.join(target,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return { target, manifest, compilerOutput:stdout };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildIdentityAddon({ rphReferencePath:process.env.LSA_IDENTITY_RPH_REFERENCE, frameworkReferenceRoot:process.env.LSA_IDENTITY_FRAMEWORK_ROOT });
  console.log(JSON.stringify({ target:result.target,...result.manifest },null,2));
}
