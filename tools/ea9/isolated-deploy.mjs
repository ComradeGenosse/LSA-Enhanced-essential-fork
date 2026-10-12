#!/usr/bin/env node
// Reversible overlay ONLY for manually marked, isolated GTA test installations.
// Never guesses GTA path; never reads production Steam/Program Files by default.
// commands: deploy|rollback|verify --target <isolated GTA> --backup-root <NEW folder>
//   --release-root <sealed stage> --expected-head <SHA> --ack-isolated
// Optional: --state-paths <JSON array of target-relative additional voice/config/DB files>
import { cp, mkdir, rm, readFile, writeFile, readdir, lstat, access, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const argv=process.argv.slice(2), mode=argv[0];
const arg=n=>{const i=argv.indexOf(n);return i<0?null:argv[i+1];};
const flag=n=>argv.includes(n);
const fail=s=>{throw Error('EA9_ISOLATED_DEPLOY_REJECTED: '+s);};
if(!['deploy','rollback','verify'].includes(mode)||!flag('--ack-isolated'))fail('explicit_command_and_ack_required');
const target=path.resolve(arg('--target')||fail('target_required'));
const backup=path.resolve(arg('--backup-root')||fail('backup_root_required'));
// verify and rollback operate exclusively on the immutable backup receipt.
// Neither should require a stage path; only deploy consumes a sealed stage.
const release=mode==='deploy'?path.resolve(arg('--release-root')||fail('release_root_required')):null;
const head=arg('--expected-head')||fail('expected_head_required');
if(!/^[0-9a-f]{40}$/i.test(head))fail('invalid_source_head');
const inside=(base,p)=>p===base||p.startsWith(base+path.sep);
if(target===backup||inside(target,backup)||inside(backup,target)||
   (release&&(inside(target,release)||inside(release,target))))fail('overlapping_paths');
if(/[\\/]Program Files(?: \(x86\))?[\\/]/i.test(target)||
   /[\\/]steamapps[\\/]common[\\/]/i.test(target))fail('active_game_location_forbidden');
const safe=(root,relative)=>{
  if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\\')||
     relative.split('/').some(p=>!p||p==='.'||p==='..'))fail('invalid_relative_path');
  const p=path.resolve(root,...relative.split('/'));
  if(!inside(root,p)||p===root)fail('path_escape');return p;
};
async function denyLinkedAncestors(relative){
  let current=target;
  for(const part of relative.split('/')){
    current=path.join(current,part);
    try{
      const stat=await lstat(current);
      if(stat.isSymbolicLink())fail('linked_target_path_forbidden:'+relative);
    }catch(error){if(error.code==='ENOENT')break;throw error;}
  }
}
const sha=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const exists=async p=>{try{await access(p);return true;}catch{return false;}};
async function scan(root){
  const list=[];
  async function visit(current){
    for(const ent of await readdir(current,{withFileTypes:true})){
      const p=path.join(current,ent.name),stat=await lstat(p);
      if(stat.isSymbolicLink())fail('symlink_present:'+p);
      if(stat.isDirectory())await visit(p);
      else if(stat.isFile())list.push(path.relative(root,p).split(path.sep).join('/'));
      else fail('unsupported_filesystem_entry:'+p);
    }
  }
  if(await exists(root)){
    const rootStat=await lstat(root);
    if(rootStat.isSymbolicLink())fail('linked_root_forbidden:'+root);
    if(!rootStat.isDirectory())fail('inventory_root_not_directory:'+root);
    await visit(root);
  }
  return list.sort();
}
async function inventory(root){
  const result=[];
  for(const f of await scan(root))result.push({path:f,sha256:await sha(safe(root,f))});
  return result;
}
// On Windows TEMP may contain legitimate 8.3 short-name ancestors (RUNNER~1)
// or casing aliases. Reject actual filesystem links/reparse points in EVERY
// existing ancestor, rather than equating a benign short path with a symlink.
// The canonical real path is still separately checked against active GTA dirs.
async function denyTargetLinks(full){
  const root=path.parse(full).root;
  let current=root;
  for(const segment of path.relative(root,full).split(path.sep)){
    if(!segment)continue;
    current=path.join(current,segment);
    const stat=await lstat(current);
    if(stat.isSymbolicLink())fail('target_alias_or_symlink_forbidden');
    if(!stat.isDirectory())fail('target_not_directory');
  }
}
await denyTargetLinks(target);
const canonicalTarget=await realpath(target);
if(process.platform!=='win32' && canonicalTarget!==target)
  fail('target_alias_or_symlink_forbidden');
if(/[\\/]Program Files(?: \(x86\))?[\\/]/i.test(canonicalTarget)||
   /[\\/]steamapps[\\/]common[\\/]/i.test(canonicalTarget))fail('active_game_real_location_forbidden');
const markerPath=path.join(target,'.ea9-isolated-test-install.json');
const marker=JSON.parse(await readFile(markerPath,'utf8'));
if(marker?.ea9IsolatedTest!==true || marker?.notActiveInstall!==true ||
   marker?.explicitOperatorApproval!==true)fail('isolation_marker_invalid');
if(!await exists(path.join(target,'GTA5_Enhanced.exe')))fail('isolated_gta_executable_missing');
if(process.platform==='win32'){
  const {spawnSync}=await import('node:child_process');
  const jobs=spawnSync('tasklist',['/fo','csv','/nh'],{encoding:'utf8'});
  if(jobs.status!==0)fail('unable_to_verify_gta_is_stopped');
  if(/"(?:GTA5(?:_Enhanced)?|RAGEPluginHook)\.exe"/i.test(jobs.stdout))fail('game_or_rph_running');
}
const receiptPath=path.join(backup,'ea9-backup-receipt.json');
if(mode==='deploy'){
  if(await exists(backup))fail('backup_already_exists');
  const manifest=JSON.parse(await readFile(path.join(release,'ea9-release-manifest.json'),'utf8'));
  if(manifest?.schemaVersion!==1||manifest?.sourceHead!==head||
     !Array.isArray(manifest.files)||manifest.files.length===0||
     !Array.isArray(manifest.nativeOutputs)||manifest.nativeOutputs.length<4||
     !manifest.candidate?.builtBundleSha256)fail('unsealed_or_wrong_head');
  const mustHaveNative=[
    'plugins/LSA.PromotedCharacters.dll',
    'plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Bootstrap.dll',
    'plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Runtime.dll',
    'plugins/LSA.PromotedCharacters/LSA.SessionIdentity.dll'
  ];
  for(const required of mustHaveNative){
    const evidence=manifest.nativeOutputs.find(x=>x.staged===required);
    if(!evidence||!evidence.sha256||!manifest.files.some(x=>
       x.path===required&&x.sha256===evidence.sha256))fail('native_receipt_incomplete:'+required);
  }
  const staged=await inventory(release);
  const listed=manifest.files;
  if(JSON.stringify(staged.filter(x=>x.path!=='ea9-release-manifest.json'))!==JSON.stringify(listed))
    fail('release_stage_changed_or_manifest_incomplete');
  // The isolated install's ENTIRE plugins tree is copied before ANY mutation.
  // This includes JSON, SQLite WAL/SHM, user configs, voice assignments and DLLs.
  const extras=arg('--state-paths')?JSON.parse(await readFile(path.resolve(arg('--state-paths')),'utf8')):[];
  if(!Array.isArray(extras))fail('state_paths_not_array');
  const original=await exists(path.join(target,'plugins'));
  const additional=[];
  for(const relative of extras){
    if(relative==='plugins'||relative.startsWith('plugins/'))continue;
    const p=safe(target,relative);
    await denyLinkedAncestors(relative);
    additional.push({relative,wasPresent:await exists(p)});
  }
  await mkdir(backup,{recursive:false});
  try{
    const before=original?await inventory(path.join(target,'plugins')):[];
    if(original)await cp(path.join(target,'plugins'),path.join(backup,'plugins'),{recursive:true,force:false,errorOnExist:true});
    for(const x of additional)if(x.wasPresent){
      const source=safe(target,x.relative),dest=safe(backup,x.relative);
      await mkdir(path.dirname(dest),{recursive:true});
      await cp(source,dest,{recursive:true,force:false,errorOnExist:true});
    }
    const extraHashes=[];
    for(const x of additional)if(x.wasPresent){
      const source=safe(target,x.relative),stat=await lstat(source);
      if(stat.isSymbolicLink())fail('linked_extra_state');
      extraHashes.push({relative:x.relative,kind:stat.isDirectory()?'directory':'file',
        contents:stat.isDirectory()?await inventory(source):await sha(source)});
    }
    const receipt={version:1,sourceHead:head,target,backup,originalPluginsPresent:original,
      pluginsBefore:before,additional,extraHashes,staged:listed,
      createdAt:new Date().toISOString(),rollbackVerified:false};
    await writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
    if(original && JSON.stringify(await inventory(path.join(backup,'plugins')))!==JSON.stringify(before))
      fail('backup_hash_verification_failed');
    for(const item of listed){
      const dest=safe(target,item.path),src=safe(release,item.path);
      await denyLinkedAncestors(item.path);
      await mkdir(path.dirname(dest),{recursive:true});
      await cp(src,dest,{force:true});
      if(await sha(dest)!==item.sha256)fail('installed_file_mismatch:'+item.path);
    }
    console.log(JSON.stringify({status:'isolated_deployed',head,backup,target,files:listed.length,gtaLaunched:false,paidRequests:0}));
  }catch(error){
    console.error('Deploy interrupted; original snapshot is at '+backup+'; run rollback with the same target and backup root.');
    throw error;
  }
}else{
  const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
  if(receipt?.version!==1||receipt.target!==target||receipt.backup!==backup||
     receipt.sourceHead!==head||!Array.isArray(receipt.pluginsBefore)||
     !Array.isArray(receipt.additional))fail('backup_receipt_mismatch');
  if(receipt.originalPluginsPresent &&
    JSON.stringify(await inventory(path.join(backup,'plugins')))!==JSON.stringify(receipt.pluginsBefore))
    fail('backup_tampered');
  for(const x of receipt.additional)if(x.wasPresent&&!await exists(safe(backup,x.relative)))
    fail('additional_backup_missing:'+x.relative);
  for(const x of receipt.extraHashes||[]){
    const saved=safe(backup,x.relative);
    const current=x.kind==='directory'?await inventory(saved):await sha(saved);
    if(JSON.stringify(current)!==JSON.stringify(x.contents))fail('additional_state_backup_tampered:'+x.relative);
  }
  if(mode==='rollback'){
    await rm(path.join(target,'plugins'),{recursive:true,force:true});
    if(receipt.originalPluginsPresent)
      await cp(path.join(backup,'plugins'),path.join(target,'plugins'),{recursive:true});
    for(const x of receipt.additional){
      const dest=safe(target,x.relative);
      await denyLinkedAncestors(x.relative);
      await rm(dest,{recursive:true,force:true});
      if(x.wasPresent){
        await mkdir(path.dirname(dest),{recursive:true});
        await cp(safe(backup,x.relative),dest,{recursive:true});
      }
    }
  }
  const current=await inventory(path.join(target,'plugins'));
  let restored=JSON.stringify(current)===JSON.stringify(receipt.pluginsBefore);
  if(mode==='rollback'){
    for(const x of receipt.extraHashes||[]){
      const actual=safe(target,x.relative);
      const now=x.kind==='directory'?await inventory(actual):await sha(actual);
      if(JSON.stringify(now)!==JSON.stringify(x.contents))restored=false;
    }
  } else if(mode==='verify'){
    for(const item of receipt.staged||[])
      if(!await exists(safe(target,item.path))||await sha(safe(target,item.path))!==item.sha256)
        fail('deployed_package_hash_mismatch:'+item.path);
  }
  if(mode==='rollback'&&!restored)fail('rollback_hash_mismatch');
  console.log(JSON.stringify({status:mode==='rollback'?'rollback_hash_verified':'backup_hash_verified',
    restored:mode==='rollback'?restored:null,sourceHead:head,originalFiles:receipt.pluginsBefore.length}));
}
