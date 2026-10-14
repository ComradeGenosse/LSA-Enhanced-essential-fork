import {readFile, mkdir, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {discoverTests, fingerprintTests, verifyInventory,loadInventory} from './discovery.mjs';
import {selectProfile} from './profiles.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index+1];
};
const profileName = option('--profile','all');
const output = path.resolve(option('--output',path.join(root,'work/memory-k-verification',profileName)));
const files = await discoverTests(root);
const inventory = await loadInventory(root);
verifyInventory(files, inventory.files);
const {profile, files:selected} = selectProfile(profileName,files);
const git = (...argv) => {
  const result = spawnSync('git',argv,{cwd:root,encoding:'utf8'});
  if (result.status !== 0) throw new Error(`Git evidence unavailable: ${argv.join(' ')}`);
  return result.stdout.trim();
};
const head = git('rev-parse','HEAD');
const dirty = git('status','--porcelain');
await mkdir(output,{recursive:true});
const receipt = {version:1,profile:profileName,tier:profile.tier,limits:profile.limits??null,
  coverage:profile.coverage??[],head,trackedChanges:dirty,node:process.version,platform:process.platform,
  startedAt:new Date().toISOString(),discovered:files.length,selected:selected.length,
  files:await fingerprintTests(root,selected),results:[],
  separateGates:{nativeBuild:'not_run',packaging:'not_run',physicalGTA:'not_run',soak:'not_run'}};
for (const file of selected) {
  const scenario = /\/memory-k-original-(S\d\d)\.test\.mjs$/.exec(file)?.[1];
  const scratch = scenario ? await mkdtemp(path.join(tmpdir(),'memory-k-original-')) : null;
  const result = spawnSync(process.execPath,['--import',new URL('./offline.mjs',import.meta.url).href,
    '--test','--test-reporter=tap',file],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024,
    env:scenario ? {...process.env,MEMORY_K_W09_DB_PATH:path.join(scratch,'evidence.sqlite'),
      MEMORY_K_EXPECTED_HEAD_SHA:head,MEMORY_K_EXPECTED_SCENARIO:scenario} : process.env});
  if (scratch) await rm(scratch,{recursive:true,force:true});
  const log = `${result.stdout??''}${result.stderr??''}`;
  await writeFile(path.join(output,file.replaceAll('/','__')+'.log'),log);
  const counts = Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key =>
    [key,Number(log.match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1]??0)]));
  const passed = result.status === 0 && !result.error && counts.tests > 0 &&
    counts.fail === 0 && counts.cancelled === 0;
  receipt.results.push({file,exitCode:result.status,passed,...counts,
    processError:result.error?.code??null});
  console.log(`${passed?'PASS':'FAIL'} ${file} tests=${counts.tests} fail=${counts.fail} skipped=${counts.skipped}`);
  // Preserve evidence if a later test process or verification is interrupted.
  await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
}
receipt.finishedAt = new Date().toISOString();
receipt.headAfter = git('rev-parse','HEAD');
receipt.trackedChangesAfter = git('status','--porcelain');
receipt.exactCleanHead = !dirty && !receipt.trackedChangesAfter && receipt.headAfter === head;
receipt.passed = receipt.results.every(result => result.passed) && receipt.headAfter === head;
receipt.totals = Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key =>
  [key,receipt.results.reduce((sum,result)=>sum+result[key],0)]));
await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({head,exactCleanHead:receipt.exactCleanHead,profile:profileName,...receipt.totals}));
process.exitCode = receipt.passed ? 0 : 1;
