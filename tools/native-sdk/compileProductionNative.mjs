#!/usr/bin/env node
// Compile the PRODUCTION native plugin (not a test stub) against the exact,
// SHA-256-pinned public SDK references. Native test projects compile against
// GameStub.cs; before this gate a CallByName<string> call passed CI and only
// failed on the user's machine (CS0453 against RagePluginHook 1.124.0).
// Usage: node tools/native-sdk/compileProductionNative.mjs
// Requires network access to the NuGet feed for the restore step only.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const candidate=path.join(repo,'lsa-essential-e1-candidate');
const pins=async()=>({
  rph:(await import(pathToFileURL(path.join(candidate,'tools/verifyIdentityContract.mjs')))).RPH_SDK_SHA256,
  damage:(await import(pathToFileURL(path.join(candidate,'src/perception/nativeSupport.mjs')))).DAMAGE_DLL_SHA256,
  rnui:(await import(pathToFileURL(path.join(candidate,'src/control/nativeSupport.mjs')))).RNUI_DLL_SHA256,
});
const dotnet=process.env.LSA_BUILD_DOTNET||'dotnet';
const run=(args,options={})=>execFileSync(dotnet,args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_NOLOGO:'1'},...options});
const sha256=file=>createHash('sha256').update(readFileSync(file)).digest('hex');

run(['restore',path.join(repo,'tools/native-sdk/PinnedSdk.csproj')]);
const listing=run(['nuget','locals','global-packages','--list']);
const root=listing.split(/\r?\n/).map(line=>line.match(/^global-packages:\s*(.+?)\s*$/)?.[1]).find(Boolean);
if(!root)throw new Error('nuget_global_packages_unresolved');
const references={
  rph:path.join(root,'ragepluginhook/1.124.0/lib/net472/RagePluginHook.dll'),
  rnui:path.join(root,'ragenativeui/1.9.3/lib/net472/RAGENativeUI.dll'),
  damage:path.join(root,'damagetrackerlib/2.0.0/lib/DamageTrackerLib.dll'),
};
const expected=await pins();
for(const [name,file] of Object.entries(references)) {
  if(!existsSync(file))throw new Error(`pinned_reference_missing:${name}`);
  const actual=sha256(file);
  if(actual!==expected[name])throw new Error(`pinned_reference_hash_mismatch:${name}:${actual}`);
}
const framework=path.join(root,'microsoft.netframework.referenceassemblies.net481/1.0.3/build');
if(!existsSync(path.join(framework,'.NETFramework/v4.8.1')))throw new Error('net481_reference_assemblies_missing');
const properties=[`-p:RphReferencePath=${references.rph}`,`-p:DamageReferencePath=${references.damage}`,
  `-p:RnuiReferencePath=${references.rnui}`,`-p:TargetFrameworkRootPath=${framework}`];
for(const project of ['native/promoted-characters/PromotedCharacters.csproj','native/promoted-characters/Loader.csproj']) {
  try {
    run(['build',path.join(repo,project),'--configuration','Release','-nologo','-v:q',...properties]);
  } catch(error) {
    const output=`${error.stdout??''}\n${error.stderr??''}`.split(/\r?\n/).filter(line=>/\berror\b/i.test(line));
    console.error(`Production native compile failed for ${project}:\n${[...new Set(output)].slice(0,40).join('\n')}`);
    process.exit(1);
  }
  console.log(`compiled ${project} against pinned RagePluginHook 1.124.0 / RAGENativeUI 1.9.3 / DamageTrackerLib 2.0.0`);
}
