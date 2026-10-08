import {intelligenceNativeSourceHash} from './verifyDialogueKnowledgePayload.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,copyFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyIdentityContract,RPH_SDK_SHA256,IDENTITY_DLL_SHA256 } from './verifyIdentityContract.mjs';
import { assertNoLinkedOutput,candidateRootPath } from './checkIsolation.mjs';
import { verifyCharactersContract } from './verifyCharactersContract.mjs';
import { verifyPerceptionContract } from './verifyPerceptionContract.mjs';
import { verifyControlsContract } from './verifyControlsContract.mjs';
import { DAMAGE_DLL_SHA256 } from '../src/perception/nativeSupport.mjs';
import { COMMANDS_CONTRACT_SHA256,RNUI_DLL_SHA256,RNUI_ASSEMBLY_VERSION } from '../src/control/nativeSupport.mjs';

const root = candidateRootPath();
export async function buildCharactersAddon({rphReferencePath,frameworkReferenceRoot,damageReferencePath,rnuiReferencePath,dotnetPath = 'dotnet',outputPath = path.join(root,'dist/promoted-characters')} = {}) {
  const target = await assertNoLinkedOutput(outputPath);
  const intelligenceSourceSha256=await intelligenceNativeSourceHash();
  if (!rphReferencePath || !frameworkReferenceRoot) throw new Error('Explicit compile-only RPH and .NET 4.8.1 references required.');
  const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
  if (await hash(path.join(root,'upstream/LosSantosAlive.dll')) !== IDENTITY_DLL_SHA256 || await hash(rphReferencePath) !== RPH_SDK_SHA256) throw new Error('P2 native assembly pin mismatch.');
  const nativeContract = await verifyIdentityContract(); if (!nativeContract.available) throw new Error('Optional P1 identity contract unavailable.');
  const characterContract = await verifyCharactersContract(); if (!characterContract.available) throw new Error('Optional P2 native contract unavailable.');
  const perceptionContract = await verifyPerceptionContract();
  // UX phase 1 command bridge seams (typed request entry and input gates).
  const controlsContract = await verifyControlsContract(); if (!controlsContract.available) throw new Error('Pinned UX controls contract unavailable.');
  if(!damageReferencePath || await hash(damageReferencePath)!==DAMAGE_DLL_SHA256 || !perceptionContract.available) throw new Error('Pinned compile-only DamageTracker reference and perception metadata required.');
  // UX phases 2-3: the embedded command contract and the compile-only RNUI
  // reference are hash-pinned; RAGENativeUI.dll itself is never packaged.
  const commandsPath = path.resolve(root,'../contracts/commands.v2.json');
  if (await hash(commandsPath) !== COMMANDS_CONTRACT_SHA256) throw new Error('UX command contract pin mismatch.');
  if (!rnuiReferencePath || await hash(rnuiReferencePath) !== RNUI_DLL_SHA256) throw new Error('Pinned compile-only RAGENativeUI 1.9.3 reference required.');
  const project = path.resolve(root,'../native/promoted-characters/Loader.csproj');
  const runtimeProject = path.resolve(root,'../native/promoted-characters/PromotedCharacters.csproj');
  const args = [`-p:RphReferencePath=${path.resolve(rphReferencePath)}`,`-p:TargetFrameworkRootPath=${path.resolve(frameworkReferenceRoot)}`,`-p:DamageReferencePath=${path.resolve(damageReferencePath)}`,`-p:RnuiReferencePath=${path.resolve(rnuiReferencePath)}`];
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
  await copyFile(path.resolve(root,'../native/enhanced/LSA.Enhanced.example.json'),path.join(target,'LSA.Enhanced.example.json'));
  const uxContract = {commandsSha256:COMMANDS_CONTRACT_SHA256,rnuiReferenceSha256:RNUI_DLL_SHA256,rnuiAssemblyVersion:RNUI_ASSEMBLY_VERSION,rnuiPackaged:false,inputDefaultEnabled:false,uiDefaultEnabled:false,talkTargetingDefaultEnabled:false};
  if(intelligenceSourceSha256!==await intelligenceNativeSourceHash())throw new Error('knowledge_native_source_changed_during_build');
  const manifest = {intelligenceSourceSha256,stage:'P2+PS0+PS1+PS2+ACT0+ACT1+ACT2+UX1+UX2+UX3+UX4+C02+C13+C14+C06',defaultEnabled:false,sharedIntelligenceContract:{primaryBehaviorOwnerVersion:1,hostContextVersion:1,actorCaptureVersion:1,observerIndexVersion:1,observerSituationVersion:1,physicalAcceptance:false},intelligenceDefaultMode:'off',playerSpeech:'disabled_unsupported_capture_receipt',nativeContract,characterContract,perceptionContract,controlsContract,uxContract,rphSdkSha256:RPH_SDK_SHA256,files,deploymentPerformed:false,gtaRuntimeTest:false,talkTargeting:'offline-complete-gta-pending'};
  await writeFile(path.join(target,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return {target,manifest,compilerOutput:stdout};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildCharactersAddon({rphReferencePath:process.env.LSA_IDENTITY_RPH_REFERENCE,frameworkReferenceRoot:process.env.LSA_IDENTITY_FRAMEWORK_ROOT,damageReferencePath:process.env.LSA_INTELLIGENCE_DAMAGE_REFERENCE,rnuiReferencePath:process.env.LSA_RNUI_REFERENCE,dotnetPath:process.env.LSA_BUILD_DOTNET || 'dotnet'});
  console.log(JSON.stringify({target:result.target,...result.manifest},null,2));
}
