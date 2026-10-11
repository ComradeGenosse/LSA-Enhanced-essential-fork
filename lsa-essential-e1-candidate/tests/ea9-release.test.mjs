import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const deploy=path.join(repo,'tools/ea9/isolated-deploy.mjs');
const verifier=path.join(repo,'tools/ea9/verify-release.mjs');
const head='a'.repeat(40);
const hash=v=>createHash('sha256').update(v).digest('hex');
const run=(script,args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
const mkdirp=async f=>mkdir(path.dirname(f),{recursive:true});
const put=async(f,s)=>{await mkdirp(f);await writeFile(f,s);};
async function fixture(){
  const temp=await mkdtemp(path.join(tmpdir(),'ea9-isolation-'));
  const target=path.join(temp,'isolated-game'),release=path.join(temp,'sealed-stage');
  const backup=path.join(temp,'original-snapshot');
  await mkdir(target);await mkdir(release);
  await put(path.join(target,'GTA5_Enhanced.exe'),'test fixture only');
  await put(path.join(target,'.ea9-isolated-test-install.json'),JSON.stringify({
    ea9IsolatedTest:true,notActiveInstall:true,explicitOperatorApproval:true}));
  const original={
    'plugins/LosSantosAliveServer/e1.config.json':'{"expressiveDelivery":{"mode":"off"}}',
    'plugins/LosSantosAliveServer/profiles.json':'{"profiles":["legacy"]}',
    'plugins/LosSantosAliveServer/profiles.sqlite':'SQLite original bytes',
    'plugins/LosSantosAliveServer/profiles.sqlite-wal':'WAL original bytes',
    'plugins/LosSantosAliveServer/profiles.sqlite-shm':'SHM original bytes',
    'plugins/LosSantosAliveServer/voice-assignments.json':'{"voice":"old"}',
    'plugins/LSA.PromotedCharacters.dll':'old original loader',
    'plugins/unrelated-mod/keep.txt':'unrelated asset'};
  for(const [f,v] of Object.entries(original))await put(path.join(target,f),v);
  await put(path.join(target,'data/voice-assignments.json'),'outside-plugins original');
  const staged={
    'plugins/LosSantosAliveServer/server.bundle.mjs':'// patched offline server',
    'plugins/LosSantosAliveServer/voice-assignments.json':'{"voice":"new"}',
    'plugins/LSA.PromotedCharacters.dll':'new loader',
    'plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Bootstrap.dll':'new bootstrap',
    'plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Runtime.dll':'new runtime',
    'plugins/LSA.PromotedCharacters/LSA.SessionIdentity.dll':'new identity'};
  for(const [f,v] of Object.entries(staged))await put(path.join(release,f),v);
  const files=Object.entries(staged).map(([p,v])=>({path:p,sha256:hash(v)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const nativeOutputs=files.filter(x=>x.path.endsWith('.dll')).map(x=>x.path);
  await put(path.join(release,'ea9-release-manifest.json'),JSON.stringify({
    schemaVersion:1,sourceHead:head,files,nativeOutputs:nativeOutputs.map(staged=>({staged}))}));
  const statePaths=path.join(temp,'extras.json');
  await writeFile(statePaths,JSON.stringify(['data/voice-assignments.json']));
  const common=['--target',target,'--backup-root',backup,'--expected-head',head,'--ack-isolated'];
  return {temp,target,release,backup,original,common,statePaths};
}
test('EA9 isolated deploy preserves SQLite WAL, JSON, voice and unrelated files; verified rollback is byte exact',async()=>{
  const f=await fixture();
  try{
    const a=run(deploy,['deploy',...f.common,'--release-root',f.release,'--state-paths',f.statePaths]);
    assert.equal(a.status,0,a.stderr);
    assert.equal(await readFile(path.join(f.target,'plugins/LosSantosAliveServer/voice-assignments.json'),'utf8'),'{"voice":"new"}');
    const v=run(deploy,['verify',...f.common]);
    assert.equal(v.status,0,v.stderr);
    const b=run(deploy,['rollback',...f.common]);
    assert.equal(b.status,0,b.stderr);
    assert.match(b.stdout,/rollback_hash_verified/);
    for(const [relative,original] of Object.entries(f.original))
      assert.equal(await readFile(path.join(f.target,relative),'utf8'),original,relative);
    assert.equal(await readFile(path.join(f.target,'data/voice-assignments.json'),'utf8'),'outside-plugins original');
    await assert.rejects(readFile(path.join(f.target,'plugins/LosSantosAliveServer/server.bundle.mjs')));
  }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('EA9 refuses a modified stage and does not touch isolated target',async()=>{
  const f=await fixture();
  try{
    await writeFile(path.join(f.release,'plugins/LSA.PromotedCharacters.dll'),'mismatched content');
    const result=run(deploy,['deploy',...f.common,'--release-root',f.release]);
    assert.notEqual(result.status,0);
    assert.equal(await readFile(path.join(f.target,'plugins/LSA.PromotedCharacters.dll'),'utf8'),'old original loader');
  }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('EA9 refuses incomplete native and missing EA5/EA6 package rather than approving it',async()=>{
  const f=await fixture();
  try{
    const h=spawnSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'});
    assert.equal(h.status,0,h.stderr);
    const actual=h.stdout.trim();
    const nativeFile=path.join(f.temp,'native-inputs.json');
    await writeFile(nativeFile,'[]');
    const output=run(verifier,['verify','--release-root',f.release,
      '--expected-head',actual,'--native-inputs',nativeFile]);
    assert.notEqual(output.status,0);
    assert.match(output.stderr,/ENOENT|EA9_RELEASE_REJECTED/);
  }finally{await rm(f.temp,{recursive:true,force:true});}
});
test('EA9 refuses unmarked installations and forbids active Steam/Program Files paths',async()=>{
  const f=await fixture();
  try{
    await writeFile(path.join(f.target,'.ea9-isolated-test-install.json'),'{}');
    const a=run(deploy,['deploy',...f.common,'--release-root',f.release]);
    assert.notEqual(a.status,0);
    assert.match(a.stderr,/isolation_marker_invalid/);
  }finally{await rm(f.temp,{recursive:true,force:true});}
});
