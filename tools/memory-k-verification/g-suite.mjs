// G receipts: unchanged original entrypoints on the exact #138 base and G,
// with G additions separate. Preserve every red result; do not relabel gates.
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {release,cpus} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverTests,loadInventory,verifyInventory} from './discovery.mjs';
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=fileURLToPath(new URL('../../',import.meta.url));
const baseline=option('--baseline',null),output=path.resolve(option('--output','work/g-validation'));
const e1='lsa-essential-e1-candidate/tests/',shared='lsa-shared-brain/tests/';
const originals=[
  ...['m3-completion','m3-closure-agent-d','m3-ws5b-production','m3-ws5b-stress',
    'memory-agent-b-events','memory-agent-b-ps2-tap','perception-contract','perception-witness-rules',
    'perception-speech','perception-client','perception-bootstrap','intelligence-frame-rejection-telemetry',
    'memory-k-source-consumers','memory-k-native-source-only','memory-k-w02-source-time',
    'm1-sqlite-foundation','m1-shared-memory-parity','m1-source-write-gate','m1-world-epoch-bridge',
    'p2-authority','p2-contract','p2-lifecycle','p2-profiles',
    'memory/nativeMemoryAuthority','memory/nativeCurrentOwnerAuthenticatedIntake',
    'memory/nativeCurrentOwnerPlayerAuthority','memory/nativeC01Authority',
    'memory/d01OpenAIAcceptance','memory/d03OriginalDialogueJoin'].map(f=>e1+f+'.test.mjs'),
  ...['m3-intake-outcomes','m3-observer-coverage-tracker','m3-observer-coverage-sqlite',
    'memory-k-production-w04-sqlite','memory-k-ws4b-review'].map(f=>shared+f+'.test.mjs'),
];
const additions=['memory-g-independent-events','memory-g-bootstrap'].map(f=>e1+f+'.test.mjs');
await mkdir(output,{recursive:true});
const git=(cwd,argv)=>{const r=spawnSync('git',argv,{cwd,encoding:'utf8'});if(r.status!==0)throw Error('git_evidence_unavailable');return r.stdout.trim();};
const receipt={version:1,head:git(root,['rev-parse','HEAD']),changes:git(root,['status','--porcelain']),
  baseline:baseline?git(path.resolve(baseline),['rev-parse','HEAD']):null,
  node:process.version,platform:process.platform,osRelease:release(),cpu:cpus()[0]?.model,concurrency:1,runs:[]};
const fingerprint=async(cwd,files)=>Promise.all(files.map(async file=>({file,
  sha256:createHash('sha256').update(await readFile(path.join(cwd,file))).digest('hex')})));
receipt.originalTests=await fingerprint(root,originals);
receipt.inventory=[];
for(const [revision,cwd] of [...baseline?[['baseline',path.resolve(baseline)]]:[],['candidate',root]]){
  const actual=await discoverTests(cwd),inventory=await loadInventory(cwd);
  let error=null;try{verifyInventory(actual,inventory.files);}catch(e){error=e.message;}
  receipt.inventory.push({revision,discovered:actual.length,registered:inventory.files.length,error,passed:error===null});
}
if(baseline){
  const old=await fingerprint(path.resolve(baseline),originals);
  if(JSON.stringify(old)!==JSON.stringify(receipt.originalTests))throw Error('original_entrypoint_changed');
}
async function run(label,cwd,files){
  const started=new Date().toISOString();
  const r=spawnSync(process.execPath,['--import',new URL('./offline.mjs',import.meta.url).href,
    '--test','--test-concurrency=1','--test-reporter=tap',...files],
    {cwd,encoding:'utf8',timeout:900000,maxBuffer:64*1024*1024});
  const log=(r.stdout??'')+(r.stderr??'');await writeFile(path.join(output,label+'.log'),log);
  const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(key=>
    [key,Number(log.match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1]??0)]));
  const result={label,started,ended:new Date().toISOString(),exitCode:r.status,processError:r.error?.code??null,
    counts,failures:[...log.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1]),
    passed:r.status===0&&!r.error&&counts.tests>0&&counts.fail===0&&counts.cancelled===0&&counts.skipped===0};
  receipt.runs.push(result);await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(result));
}
if(baseline)await run('baseline-original',path.resolve(baseline),originals);
await run('candidate-original',root,originals);
await run('g',root,additions);
// E2 owns its original WS6/10k/privacy inventory and receipt format. Invoke it
// unchanged on both snapshots, including its original red K07 result if any.
for(const [label,cwd] of [...baseline?[['baseline',path.resolve(baseline)]]:[],['candidate',root]]){
  const r=spawnSync(process.execPath,[path.join(root,'tools/memory-k-verification/e2-suite.mjs'),
    '--root',cwd,'--output',path.join(output,label+'-e2')],
    {cwd,encoding:'utf8',timeout:1800000,maxBuffer:64*1024*1024});
  await writeFile(path.join(output,label+'-e2-runner.log'),(r.stdout??'')+(r.stderr??''));
  receipt.runs.push({label:label+'-e2',exitCode:r.status,processError:r.error?.code??null,passed:r.status===0&&!r.error});
  console.log(JSON.stringify(receipt.runs.at(-1)));
}
receipt.headAfter=git(root,['rev-parse','HEAD']);receipt.changesAfter=git(root,['status','--porcelain']);
receipt.passed=receipt.runs.every(r=>r.passed)&&receipt.inventory.every(r=>r.passed)&&
  receipt.headAfter===receipt.head&&receipt.changesAfter===receipt.changes;
await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
process.exitCode=receipt.passed?0:1;
