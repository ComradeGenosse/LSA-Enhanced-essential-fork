import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=fileURLToPath(new URL('../../',import.meta.url)),baseline=option('--baseline',null);
const output=path.resolve(option('--output','work/g-validation/native'));await mkdir(output,{recursive:true});
const commands=[
  ['producer-policy',['run','--project','native/intelligence/producer-policy-tests/ProducerPolicyTests.csproj','--configuration','Release']],
  ['m3-witness-policy',['run','--project','native/intelligence/memory-m3-tests/MemoryM3Tests.csproj','--configuration','Release']],
];
if(process.platform==='win32')commands.push(
  ['intelligence-wire',['run','--project','native/intelligence/integration-tests/IntegrationTests.csproj','--configuration','Debug']],
  ['runtime',['run','--project','native/promoted-characters/runtime-tests/RuntimeTests.csproj','--configuration','Debug']],
  ['owner-sample',['run','--project','native/promoted-characters/owner-sample-tests/OwnerSampleTests.csproj','--configuration','Debug']],
  ...['source-only','stop','failed'].map(mode=>['host-'+mode,['run','--project','native/promoted-characters/ps-host-tests/PSHostTests.csproj','--configuration','Debug','--',mode]]));
const receipt={platform:process.platform,limits:process.platform==='win32'?[]:['net481 wire/host execution requires Windows'],runs:[]};
for(const [revision,cwd] of [...baseline?[['baseline',path.resolve(baseline)]]:[],['candidate',root]])for(const [name,argv] of commands){
  const r=spawnSync('dotnet',argv,{cwd,encoding:'utf8',timeout:300000,maxBuffer:32*1024*1024});
  const log=(r.stdout??'')+(r.stderr??'');await writeFile(path.join(output,revision+'-'+name+'.log'),log);
  receipt.runs.push({revision,name,command:['dotnet',...argv],exitCode:r.status,processError:r.error?.code??null,passed:r.status===0&&!r.error});
  await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt.runs.at(-1)));
}
process.exitCode=receipt.runs.every(r=>r.passed)?0:1;
