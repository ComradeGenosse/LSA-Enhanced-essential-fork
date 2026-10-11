#!/usr/bin/env node
// EA9 non-destructive packaging seal/verifier. NEVER reads/writes a game installation.
// Usage: node tools/ea9/verify-release.mjs seal|verify --release-root <isolated-stage>
//   --expected-head <40-hex-commit> --native-inputs <JSON map>
// JSON map: [{"staged":"plugins/LSA.PromotedCharacters.dll",
//             "compiled":"native/promoted-characters/bin/Release/net481/LSA.PromotedCharacters.dll"}, ...]
// Repeat for Bootstrap, Runtime, SessionIdentity. Compiled paths are repository-relative.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, lstat, access, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argv=process.argv.slice(2), mode=argv[0];
const arg=name=>{const i=argv.indexOf(name);return i<0?null:argv[i+1];};
const die=message=>{throw Error('EA9_RELEASE_REJECTED: '+message);};
if(!['seal','verify'].includes(mode))die('mode_must_be_seal_or_verify');
const release=path.resolve(arg('--release-root')||die('release_root_required'));
if(await realpath(release)!==release)die('release_root_alias_or_symlink_forbidden');
if(/[\\/]Program Files(?: \(x86\))?[\\/]/i.test(release)||
   /[\\/]steamapps[\\/]common[\\/]/i.test(release))die('active_game_release_root_forbidden');
const expected=arg('--expected-head')||die('expected_head_required');
const inputFile=arg('--native-inputs')||die('native_inputs_required');
if(!/^[0-9a-f]{40}$/i.test(expected))die('invalid_expected_head');
const actualHead=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
if(actualHead!==expected)die('head_mismatch:'+actualHead);
if(Number(process.versions.node.split('.')[0])<24)die('node24_required_for_sqlite_release');
const dirty=execFileSync('git',['status','--porcelain','--untracked-files=all','--',
  'lsa-essential-e1-candidate/src','lsa-shared-brain/src','native',
  'lsa-essential-e1-candidate/tools/buildCandidate.mjs','tools/native-sdk'],{cwd:repo,encoding:'utf8'}).trim();
if(dirty)die('source_checkout_dirty_or_untracked:'+dirty.slice(0,250));
const inside=(base,p)=>p===base||p.startsWith(base+path.sep);
if(inside(repo,release) && inside(path.join(repo,'lsa-essential-e1-candidate','src'),release))die('source_folder_not_stage');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const shaFile=async p=>sha(await readFile(p));
const exists=async p=>{try{await access(p);return true;}catch{return false;}};
const manifestPath=path.join(release,'ea9-release-manifest.json');
const pathFor=(root,relative)=>{
  if(typeof relative!=='string'||relative.includes('\\')||path.posix.isAbsolute(relative)||
     relative.split('/').some(x=>x===''||x==='.'||x==='..'))die('unsafe_relative_path:'+relative);
  const out=path.resolve(root,...relative.split('/'));
  if(!inside(root,out)||out===root)die('escaped_root:'+relative);
  return out;
};
async function inventory(root){
  const files=[];
  async function go(dir){
    for(const e of await readdir(dir,{withFileTypes:true})){
      const p=path.join(dir,e.name),s=await lstat(p);
      if(s.isSymbolicLink())die('linked_path:'+p);
      if(s.isDirectory())await go(p);
      else if(s.isFile())files.push(path.relative(root,p).split(path.sep).join('/'));
      else die('unsupported_path_type:'+p);
    }
  }
  const rootStat=await lstat(root);
  if(rootStat.isSymbolicLink()||!rootStat.isDirectory())die('inventory_root_not_plain_directory:'+root);
  await go(root);return files.sort();
}
async function directoryHash(root,skip=new Set()){
  const files=(await inventory(root)).filter(p=>!skip.has(p))
    .sort((a,b)=>a.localeCompare(b));
  const h=createHash('sha256');
  for(const f of files){h.update(f).update('\0');h.update(await readFile(pathFor(root,f))).update('\0');}
  return h.digest('hex');
}
const server=pathFor(release,'plugins/LosSantosAliveServer');
const e1=pathFor(server,'e1');
const legacy=JSON.parse(await readFile(pathFor(server,'build-manifest.json'),'utf8'));
const required=[
  'plugins/LosSantosAliveServer/server.bundle.mjs',
  'plugins/LosSantosAliveServer/e1/bootstrap.mjs',
  'plugins/LosSantosAliveServer/e1/voice/emotion/deliveryContract.mjs',
  'plugins/LosSantosAliveServer/e1/voice/emotion/sceneDelivery.mjs',
  'plugins/LosSantosAliveServer/e1/voice/emotion/moodRuntime.mjs',
  'plugins/LosSantosAliveServer/e1/voice/emotion/resolveSpeechDelivery.mjs',
  'plugins/LosSantosAliveServer/e1/voice/emotion/elevenTags.mjs',
  'plugins/LosSantosAliveServer/e1/providers/elevenlabs/speechProvider.mjs',
  'plugins/LosSantosAliveServer/e1/perception/protagonistProtocol.mjs',
  'plugins/LosSantosAliveServer/e1/perception/protagonistAuthority.mjs',
  'plugins/LosSantosAliveServer/e1/characters/memoryStorageAdapter.mjs',
  'plugins/LosSantosAliveServer/e1/characters/sqliteFoundation.mjs',
  'plugins/LosSantosAliveServer/e1/characters/timelineSourceBridge.mjs'
];
for(const f of required)if(!await exists(pathFor(release,f)))die('missing_required_module:'+f);
if(legacy?.nativeContract?.dllSha256 && legacy.nativeContract.dllSha256!==legacy.stockDllReferenceSha256)
  die('native_contract_and_build_manifest_disagree');
if(!legacy?.builtBundleSha256||!legacy?.e1SourceTreeSha256||
   !legacy?.upstreamBundleSha256||!legacy?.stockDllReferenceSha256||
   !Number.isInteger(legacy.astPatchCount))die('candidate_manifest_incomplete');
const bundle='plugins/LosSantosAliveServer/server.bundle.mjs';
if(await shaFile(pathFor(release,bundle))!==legacy.builtBundleSha256)die('patched_bundle_hash_mismatch');
const e1Hash=await directoryHash(e1);
if(e1Hash!==legacy.e1SourceTreeSha256)die('candidate_e1_tree_hash_mismatch');
const originalTree=await directoryHash(path.join(repo,'lsa-essential-e1-candidate/src'));
if(e1Hash!==originalTree)die('candidate_source_does_not_match_checkout');
const stockDll='plugins/LosSantosAlive.dll';
if(!await exists(pathFor(release,stockDll)) ||
   await shaFile(pathFor(release,stockDll))!==legacy.stockDllReferenceSha256)
  die('stock_native_dll_pin_mismatch');
if(legacy.releasePayloadSha256){
  const sourcePayloadHash=await directoryHash(server,new Set(['build-manifest.json']));
  if(sourcePayloadHash!==legacy.releasePayloadSha256)die('candidate_payload_hash_mismatch');
}
// All relative module imports must resolve INSIDE the sealed release, including
// external M1 shared brain imports. No dynamic import rewrite or hidden host path.
for(const f of (await inventory(release)).filter(x=>x.endsWith('.mjs'))){
  const source=await readFile(pathFor(release,f),'utf8');
  const imports=[...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)['"](\.{1,2}\/[^'"]+)['"]/g)];
  for(const [,relative] of imports){
    const target=path.resolve(path.dirname(pathFor(release,f)),relative);
    if(!inside(release,target))die('module_import_escapes_release:'+f+':'+relative);
    if(!await exists(target))die('missing_relative_module:'+f+':'+relative);
  }
}
const nativeInputs=JSON.parse(await readFile(path.resolve(inputFile),'utf8'));
if(!Array.isArray(nativeInputs)||nativeInputs.length<4)die('native_output_receipts_missing');
const expectedNative=[
 'plugins/LSA.PromotedCharacters.dll',
 'plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Bootstrap.dll',
 'plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Runtime.dll',
 'plugins/LSA.PromotedCharacters/LSA.SessionIdentity.dll'
];
const collected=new Map();
for(const item of nativeInputs){
  const staged=pathFor(release,item.staged),compiled=pathFor(repo,item.compiled);
  if(collected.has(item.staged))die('duplicate_native_output:'+item.staged);
  if(!item.staged.endsWith('.dll')||!item.compiled.endsWith('.dll'))die('native_input_not_dll');
  if(!await exists(staged)||!await exists(compiled))die('native_output_missing:'+item.staged);
  const digest=await shaFile(staged);
  if(digest!==await shaFile(compiled))die('stale_native_output:'+item.staged);
  collected.set(item.staged,{staged:item.staged,compiled:item.compiled,sha256:digest});
}
for(const f of expectedNative)if(!collected.has(f))die('missing_native_compilation:'+f);
const names=(await inventory(release)).filter(n=>n!=='ea9-release-manifest.json');
if(names.some(n=>/(?:^|\/)\.env(?:\.|$)|(?:^|\/)node_modules\/|(?:^|\/)\.git\//i.test(n)))
  die('private_or_dependency_cache_in_release');
const entries=[];
for(const f of names)entries.push({path:f,sha256:await shaFile(pathFor(release,f))});
if(mode==='seal'){
  // F's release manifest must always name the exact checked-out commit.
  const manifest={schemaVersion:1,sourceHead:actualHead,createdAt:new Date().toISOString(),
    candidate:{upstreamBundleSha256:legacy.upstreamBundleSha256,
      stockDllReferenceSha256:legacy.stockDllReferenceSha256,
      builtBundleSha256:legacy.builtBundleSha256,e1SourceTreeSha256:legacy.e1SourceTreeSha256,
      releasePayloadSha256:legacy.releasePayloadSha256,astPatchCount:legacy.astPatchCount},
    nativeOutputs:[...collected.values()],files:entries,networkCalls:0,gtaInstalled:false};
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:'sealed',sourceHead:actualHead,fileCount:entries.length,release}));
} else {
  if(!await exists(manifestPath))die('missing_ea9_release_manifest');
  const m=JSON.parse(await readFile(manifestPath,'utf8'));
  if(m.schemaVersion!==1||m.sourceHead!==actualHead||!Array.isArray(m.files)||
     !Array.isArray(m.nativeOutputs))die('release_manifest_invalid');
  if(JSON.stringify(m.files)!==JSON.stringify(entries)||
     JSON.stringify(m.nativeOutputs)!==JSON.stringify([...collected.values()])||
     JSON.stringify(m.candidate)!==JSON.stringify({
       upstreamBundleSha256:legacy.upstreamBundleSha256,
       stockDllReferenceSha256:legacy.stockDllReferenceSha256,
       builtBundleSha256:legacy.builtBundleSha256,e1SourceTreeSha256:legacy.e1SourceTreeSha256,
       releasePayloadSha256:legacy.releasePayloadSha256,astPatchCount:legacy.astPatchCount}))
     die('release_inventory_or_compilation_mismatch');
  console.log(JSON.stringify({status:'verified',sourceHead:actualHead,fileCount:entries.length,release}));
}
