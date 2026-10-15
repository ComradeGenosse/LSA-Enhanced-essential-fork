// Original recording entrypoints are hashed and run unchanged, separately
// from F additions. E2's independent runner remains a prerequisite gate.
import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {release,cpus} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const originals=[
 'lsa-essential-e1-candidate/tests/memory/originalBackendAcceptedInput.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/originalBackendSourceTransitions.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/openaiRuntimeAcceptedInput.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/nativeCurrentOwnerPlayerAuthority.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/nativeCurrentOwnerAuthenticatedIntake.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/d03OriginalDialogueJoin.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/d01OpenAIAcceptance.test.mjs',
 'lsa-essential-e1-candidate/tests/memory/ws5aNpcDialogueCapture.test.mjs',
 'lsa-essential-e1-candidate/tests/original-backend-accepted-input.test.mjs',
 'lsa-shared-brain/tests/memory-k05-k06-forgetting.test.mjs',
];
const additions=['lsa-essential-e1-candidate/tests/memory-f-independent-dialogue.test.mjs'];
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const root=path.resolve(option('--root',fileURLToPath(new URL('../../',import.meta.url))));
const output=path.resolve(option('--output','work/f-validation'));
await mkdir(output,{recursive:true});
const git=argv=>{const r=spawnSync('git',argv,{cwd:root,encoding:'utf8'});return r.status===0?r.stdout.trim():null;};
const receipt={version:1,head:option('--head',git(['rev-parse','HEAD'])),changes:git(['status','--porcelain']),
 node:process.version,platform:process.platform,osRelease:release(),cpu:cpus()[0]?.model,concurrency:1,runs:[]};
const groups=args.includes('--original-only')?[['original',originals]]:
 args.includes('--new-only')?[['f',additions]]:[['original',originals],['f',additions]];
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
 receipt.runs.push(result);await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({...result,tests:files}));
}
process.exitCode=receipt.runs.every(r=>r.passed)?0:1;
