#!/usr/bin/env node
// Standalone native policies, never native GTA-producer evidence.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const sha=x=>createHash('sha256').update(x).digest('hex');
const cmd=(bin,args)=>spawnSync(bin,args,{encoding:'utf8',shell:false,timeout:300000,maxBuffer:8*1024*1024});
const head=cmd('git',['rev-parse','HEAD']).stdout?.trim()||null;
const receipt={schemaVersion:1,kind:'w09-standalone-native-policy',headSha:head,platform:process.platform,
  physicalGta:false,registeredNativeProducer:false,checks:{}};
const entries=[
  ['EssentialABI','tools/essential-abi/EssentialAbi.csproj'],
  ['NativeOwner','native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj'],
  ['M9','native/intelligence/m9-tests/M9NativeTests.csproj'],
  ['PS6','native/intelligence/director-tests/DirectorTests.csproj']
];
for(const [name,proj] of entries){
  const p=process.platform==='win32'?
    cmd('dotnet',['run','--project',proj,'--configuration','Release']):null;
  const status=!p?'blocked':p.status===0?'pass':'fail';
  receipt.checks[name]={project:proj,status,exitCode:p?.status??null,error:p?.error?.message||null,
    stdoutSha256:sha(p?.stdout||''),stderrSha256:sha(p?.stderr||''),
    stdoutTail:(p?.stdout||'').slice(-8000),stderrTail:(p?.stderr||'').slice(-8000)};
  console.log('W09 NATIVE POLICY '+name+' '+status.toUpperCase());
  if(status==='fail'){
    console.error(name+' stdout:\n'+receipt.checks[name].stdoutTail);
    console.error(name+' stderr:\n'+receipt.checks[name].stderrTail);
  }
}
receipt.status=Object.values(receipt.checks).every(x=>x.status==='pass')?'pass':
  Object.values(receipt.checks).some(x=>x.status==='fail')?'fail':'blocked';
const out='artifacts/memory-k/w09-native-policy-receipt.json';
mkdirSync(path.dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');
if(receipt.status!=='pass')process.exitCode=1;
