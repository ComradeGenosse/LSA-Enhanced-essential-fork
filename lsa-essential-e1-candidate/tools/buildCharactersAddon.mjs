import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,copyFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyIdentityContract,RPH_SDK_SHA256,IDENTITY_DLL_SHA256 } from './verifyIdentityContract.mjs';
import { assertNoLinkedOutput,candidateRootPath } from './checkIsolation.mjs';
import { verifyCharactersContract } from './verifyCharactersContract.mjs';

const root = candidateRootPath();
export async function buildCharactersAddon({rphReferencePath,frameworkReferenceRoot,dotnetPath = 'dotnet',outputPath = path.join(root,'dist/promoted-characters')} = {}) {
  const target = await assertNoLinkedOutput(outputPath);
  if (!rphReferencePath || !frameworkReferenceRoot) throw new Error('Explicit compile-only RPH and .NET 4.8.1 references required.');
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  if (await hash(path.join(root,'upstream/LosSantosAlive.dll')) !== IDENTITY_DLL_SHA256 || await hash(rphReferencePath) !== RPH_SDK_SHA256) throw new Error('P2 native assembly pin mismatch.');
  const nativeContract = await verifyIdentityContract(); if (!nativeContract.available) throw new Error('Optional P1 identity contract unavailable.');
  const characterContract = await verifyCharactersContract(); if (!characterContract.available) throw new Error('Optional P2 native contract unavailable.');
  const project = path.resolve(root,'../native/promoted-characters/Loader.csproj');
  const runtimeProject = path.resolve(root,'../native/promoted-characters/PromotedCharacters.csproj');
  const args = [`-p:RphReferencePath=${path.resolve(rphReferencePath)}`,`-p:TargetFrameworkRootPath=${path.resolve(frameworkReferenceRoot)}`];
  const run = promisify(execFile);
  await run(dotnetPath,['restore',runtimeProject,'--ignore-failed-sources',...args],{windowsHide:true});
  await run(dotnetPath,['build',runtimeProject,'--configuration','Release','--no-restore',...args],{windowsHide:true});
  await run(dotnetPath,['restore',project,'--ignore-failed-sources',...args],{windowsHide:true});
  const {stdout} = await run(dotnetPath,['build',project,'--configuration','Release','--no-restore',...args],{windowsHide:true});
  await mkdir(target,{recursive:true}); const addonDirectory = path.join(path.dirname(project),'bin/Release/net481');
  const files = [];
  for (const name of ['LSA.PromotedCharacters.dll','LSA.PromotedCharacters.Bootstrap.dll','LSA.PromotedCharacters.Runtime.dll','LSA.SessionIdentity.dll']) {
    const source = path.join(addonDirectory,name); await copyFile(source,path.join(target,name));files.push({name,relativePath:name === 'LSA.PromotedCharacters.dll' ? `plugins/${name}` : `plugins/LSA.PromotedCharacters/${name}`,sha256:await hash(source)});
  }
  await copyFile(path.resolve(root,'../native/promoted-characters/LSA.PromotedCharacters.example.json'),path.join(target,'LSA.PromotedCharacters.example.json'));
  const manifest = {stage:'P2',defaultEnabled:false,nativeContract,characterContract,rphSdkSha256:RPH_SDK_SHA256,files,deploymentPerformed:false,gtaRuntimeTest:false};
  await writeFile(path.join(target,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return {target,manifest,compilerOutput:stdout};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildCharactersAddon({rphReferencePath:process.env.LSA_IDENTITY_RPH_REFERENCE,frameworkReferenceRoot:process.env.LSA_IDENTITY_FRAMEWORK_ROOT,dotnetPath:process.env.LSA_BUILD_DOTNET || 'dotnet'});
  console.log(JSON.stringify({target:result.target,...result.manifest},null,2));
}
