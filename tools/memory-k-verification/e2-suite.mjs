// Identical, unchanged original suites on baseline/candidate; E2 additions are
// a separate result. Any failure remains red, including inherited failures.
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {release,cpus} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const originals=[
 'lsa-shared-brain/tests/memory-m5-completion.test.mjs', // imports original closure/cross-avatar tests
 'lsa-shared-brain/tests/memory-k07-k12-adversarial.test.mjs',
 'lsa-shared-brain/tests/memory-k-ws4b-durability.test.mjs',
 'lsa-shared-brain/tests/memory-k-integrated-replay.test.mjs',
 'lsa-shared-brain/tests/memory-ws6-g3-g5-evidence.test.mjs',
 'lsa-shared-brain/tests/memory-integrated-storage.test.mjs',
 'lsa-shared-brain/tests/memory-m6-completion.test.mjs',
 'lsa-shared-brain/tests/memory-m6-cursor-lifecycle.test.mjs',
 'lsa-shared-brain/tests/memory-m6-p2-production.test.mjs',
 'lsa-shared-brain/tests/memory-m6-sqlite.test.mjs',
 'lsa-shared-brain/tests/memory-m7-completion.test.mjs',
 'lsa-shared-brain/tests/memory-m8-closure.test.mjs',
 'lsa-essential-e1-candidate/tests/memory-runtime-composition.test.mjs',
 'lsa-essential-e1-candidate/tests/memory-capability-policy.test.mjs',
 'lsa-essential-e1-candidate/tests/memory-storage-only-activation.test.mjs',
 'lsa-essential-e1-candidate/tests/memory-storage-only-contract.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/ws6LiveTurnMemory.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/ws6ProductionPipeline.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/ws6OriginalRunner.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/ws6M8ProductionRead.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/ws6Original10kWriteRegression.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/ws6Latency.test.mjs',
];
export const additions=[
 'lsa-shared-brain/tests/memory-e2-privacy-recovery.test.mjs',
 'lsa-essential-e1-candidate/tests/memory-e2-independent-privacy.test.mjs',
 'lsa-essential-e1-candidate/tests/memory-e2-ws6-privacy-recovery.test.mjs',
];
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=path.resolve(option('--root',fileURLToPath(new URL('../../',import.meta.url))));
const output=path.resolve(option('--output','work/e2-validation'));
await mkdir(output,{recursive:true});
const git=argv=>{const r=spawnSync('git',argv,{cwd:root,encoding:'utf8'});return r.status===0?r.stdout.trim():null;};
const receipt={version:1,head:git(['rev-parse','HEAD']),changes:git(['status','--porcelain']),
 node:process.version,platform:process.platform,osRelease:release(),cpu:cpus()[0]?.model,concurrency:1,runs:[]};
const groups=args.includes('--original-only')?[['original',originals]]:
 args.includes('--new-only')?[['e2',additions]]:[['original',originals],['e2',additions]];
for(const [group,files] of groups){
 const tests=await Promise.all(files.map(async file=>({file,
  sha256:createHash('sha256').update(await readFile(path.join(root,file))).digest('hex')})));
 const started=new Date().toISOString();
 const r=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...files],
  {cwd:root,encoding:'utf8',timeout:900000,maxBuffer:64*1024*1024});
 const log=(r.stdout??'')+(r.stderr??'');
 const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(key=>
  [key,Number(log.match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1]??0)]));
 const result={group,started,ended:new Date().toISOString(),tests,counts,exitCode:r.status,
  processError:r.error?.code??null,failures:[...log.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1]),
  passed:r.status===0&&!r.error&&counts.tests>0&&counts.fail===0&&counts.cancelled===0&&counts.skipped===0};
 await writeFile(path.join(output,group+'.log'),log);
 receipt.runs.push(result);
 await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({...result,tests:files}));
}
process.exitCode=receipt.runs.every(r=>r.passed)?0:1;
