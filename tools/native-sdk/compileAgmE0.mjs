#!/usr/bin/env node
// Real GTA plugin build. Absolutely no GameStub/test SDK is permitted here.
// Uses precisely the repo's existing RPH 1.124.0 SHA-256 pin and net481 refs.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const candidate=path.join(repo,'lsa-essential-e1-candidate');
const dotnet=process.env.LSA_BUILD_DOTNET||'dotnet';
const run=(args)=>execFileSync(dotnet,args,{cwd:repo,encoding:'utf8',
  stdio:['ignore','pipe','pipe'],env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1'}});
const hash=(file)=>createHash('sha256').update(readFileSync(file)).digest('hex');
const {RPH_SDK_SHA256}=await import(pathToFileURL(path.join(candidate,'tools/verifyIdentityContract.mjs')));
run(['restore','tools/native-sdk/PinnedSdk.csproj']);
const listing=run(['nuget','locals','global-packages','--list']);
const root=listing.split(/\r?\n/).map(s=>s.match(/^global-packages:\s*(.+?)\s*$/)?.[1]).find(Boolean);
if(!root)throw Error('nuget_global_packages_unresolved');
const rph=path.join(root,'ragepluginhook/1.124.0/lib/net472/RagePluginHook.dll');
const framework=path.join(root,'microsoft.netframework.referenceassemblies.net481/1.0.3/build');
if(!existsSync(rph)||hash(rph)!==RPH_SDK_SHA256)throw Error('genuine_rph_sha256_mismatch_or_missing');
if(!existsSync(path.join(framework,'.NETFramework/v4.8.1')))throw Error('net481_reference_assemblies_missing');
const build=(project)=>{
  try{
    process.stdout.write(run(['build',project,'-c','Release','-nologo','-v:minimal',
      '-p:RphReferencePath='+rph,'-p:TargetFrameworkRootPath='+framework]));
  }catch(e){
    process.stderr.write((e.stdout||'')+'\n'+(e.stderr||''));
    process.exit(1);
  }
};
build('native/agm-e0/EssentialProbe.csproj');
build('native/agm-e0/AgmE0.csproj');
const output=path.join(repo,'native/agm-e0/artifacts');
mkdirSync(output,{recursive:true});
for(const base of ['LSA.AGM.E0','LSA.AGM.E0.EssentialProbe']){
  const file=path.join(repo,'native/agm-e0/bin/Release/net481',base+'.dll');
  if(!existsSync(file))throw Error('built_dll_missing:'+base);
  copyFileSync(file,path.join(output,base+'.dll'));
}
writeFileSync(path.join(output,'build-evidence.json'),JSON.stringify({
  utc:new Date().toISOString(),sdk:'RagePluginHook/1.124.0',rphSha256:hash(rph),
  framework:'net481',essentialBinary:hash(path.join(candidate,'upstream/LosSantosAlive.dll')),
  pluginSha256:hash(path.join(output,'LSA.AGM.E0.dll')),
  bridgeSha256:hash(path.join(output,'LSA.AGM.E0.EssentialProbe.dll')),
  gtaRuntimeVerified:false
},null,2)+'\n');
console.log('Genuine pinned RPH SDK build succeeded. GTA runtime NOT verified.');
