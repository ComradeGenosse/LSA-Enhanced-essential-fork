#!/usr/bin/env node
// Genuine production reference gate. Never substitute test stubs or repackage RPH.
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync,copyFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const candidate=path.join(repo,'lsa-essential-e1-candidate');
const {RPH_SDK_SHA256}=await import(pathToFileURL(path.join(candidate,'tools/verifyIdentityContract.mjs')));
const dotnet=process.env.LSA_BUILD_DOTNET||'dotnet';
const run=args=>execFileSync(dotnet,args,{cwd:repo,stdio:'inherit',env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1'}});
run(['restore','tools/native-sdk/PinnedSdk.csproj']);
const text=execFileSync(dotnet,['nuget','locals','global-packages','--list'],{encoding:'utf8'});
const root=text.match(/global-packages:\s*(.+)/)?.[1]?.trim();
if(!root)throw new Error('nuget_global_packages_unresolved');
const rph=path.join(root,'ragepluginhook/1.124.0/lib/net472/RagePluginHook.dll');
const framework=path.join(root,'microsoft.netframework.referenceassemblies.net481/1.0.3/build');
if(!existsSync(rph)||!existsSync(path.join(framework,'.NETFramework/v4.8.1')))throw new Error('official_sdk_or_reference_assemblies_missing');
const actual=createHash('sha256').update(readFileSync(rph)).digest('hex');
if(actual!==RPH_SDK_SHA256)throw new Error('genuine_rph_sdk_sha256_mismatch');
run(['build','native/physics-e0/LSA.WPS.Lab.csproj','-c','Release','-nologo',
  '-p:RphReferencePath='+rph,'-p:TargetFrameworkRootPath='+framework]);
const built=path.join(repo,'native/physics-e0/bin/Release/net481/LSA.WPS.Lab.dll');
if(!existsSync(built))throw new Error('production_lab_artifact_not_found');
const dir=path.join(repo,'dist/physics-e0');mkdirSync(dir,{recursive:true});
copyFileSync(built,path.join(dir,'LSA.WPS.Lab.dll'));
copyFileSync(path.join(repo,'native/physics-e0/LSA.WPS.Lab.example.json'),
  path.join(dir,'LSA.WPS.Lab.example.json'));
copyFileSync(path.join(repo,'native/physics-e0/LSA.WPS.Lab.samples.example.json'),
  path.join(dir,'LSA.WPS.Lab.samples.example.json'));
copyFileSync(path.join(repo,'tools/physics-e0/pack-pre-shot.ps1'),
  path.join(dir,'pack-pre-shot.ps1'));
run(['run','--project','tools/physics-e0/rph-import-audit/RphSignatureAudit.csproj',
  '--configuration','Release','--',rph,built,path.join(dir,'RPH-IMPORT-AUDIT.json')]);
writeFileSync(path.join(dir,'BUILD-RECEIPT.json'),JSON.stringify({
  productionArtifact:'LSA.WPS.Lab.dll',target:'net481',realSdk:'RagePluginHook 1.124.0',
  sdkSha256:actual,pluginSha256:createHash('sha256').update(readFileSync(built)).digest('hex'),
  runtime:'RPH 1.132 on GTA Enhanced 1158.16 requires in-game verification',
  deploymentPerformed:false,gtaTested:false},null,2)+'\n');
console.log('E0 genuine production plugin compiled, verified and packaged without SDK redistribution');
