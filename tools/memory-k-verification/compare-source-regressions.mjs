import {spawnSync} from 'node:child_process';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus,release,tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const baseline=option('--baseline','bd51fc180efa6babc597f99f4987ef0538b61854');
const output=path.resolve(option('--output',path.join(tmpdir(),'memory-k-source-comparison')));
const rounds=Number(option('--rounds','3'));
if(!Number.isInteger(rounds)||rounds<1||rounds>10)throw new Error('invalid_rounds');
const git=(...argv)=>{
  const result=spawnSync('git',argv,{cwd:root,encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr||'git_failed');
  return result.stdout.trim();
};
await mkdir(output,{recursive:true});
const baselineRoot=path.join(output,'baseline');
git('worktree','add','--detach',baselineRoot,baseline);
try {
  const prefix='lsa-essential-e1-candidate/tests/';
  const discover=async directoryRoot=>{
    const files=['memory-capability-policy.test.mjs','perception-bootstrap.test.mjs','p2-lifecycle.test.mjs']
      .map(file=>prefix+file);
    async function nested(directory) {
      for(const entry of await readdir(path.join(directoryRoot,directory),{withFileTypes:true})) {
        const file=directory+'/'+entry.name;
        if(entry.isDirectory())await nested(file);
        else if(entry.name.endsWith('.test.mjs'))files.push(file);
      }
    }
    await nested(prefix+'memory');
    return files.sort();
  };
  // Compare unchanged original tests present in the BASELINE. New candidate
  // tests cannot run on the old revision; their dedicated workflows own them.
  const baselineFiles=await discover(baselineRoot);
  const candidateFiles=await discover(root);
  const candidateSet=new Set(candidateFiles);
  const baselineSet=new Set(baselineFiles);
  const removedOriginalTests=baselineFiles.filter(file=>!candidateSet.has(file));
  if(removedOriginalTests.length)
    throw new Error('comparison_original_test_removed:'+removedOriginalTests.join(','));
  const newCandidateTests=candidateFiles.filter(file=>!baselineSet.has(file));
  const files=baselineFiles;
  if(!files.length)throw new Error('comparison_no_original_tests');
  const fingerprints=[];
  for(const file of files) {
    const hash=async directory=>createHash('sha256').update(await readFile(path.join(directory,file))).digest('hex');
    const current=await hash(root),previous=await hash(baselineRoot);
    if(current!==previous)throw new Error('comparison_test_changed:'+file);
    fingerprints.push({file,sha256:current});
  }
  const head=git('rev-parse','HEAD'),dirty=git('status','--porcelain');
  const receipt={version:1,baseline:git('rev-parse',baseline),head,node:process.version,
    platform:process.platform,osRelease:release(),cpu:cpus()[0]?.model,cpuCount:cpus().length,
    concurrency:1,rounds,identicalTests:fingerprints,newCandidateTests,trackedChanges:dirty,runs:[]};
  for(let round=1;round<=rounds;round++) {
    // Alternate order to avoid consistently giving one revision a warm host.
    for(const revision of round%2?['baseline','candidate']:['candidate','baseline']) {
      const result=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...files],
        {cwd:revision==='baseline'?baselineRoot:root,env:{...process.env},encoding:'utf8',
          timeout:300000,maxBuffer:32*1024*1024});
      const log=(result.stdout??'')+(result.stderr??'');
      const logFile=`${revision}-${round}.log`;
      await writeFile(path.join(output,logFile),log);
      const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(key=>
        [key,Number(log.match(new RegExp(`^# ${key} (\\d+)$`,'m'))?.[1]??0)]));
      const failures=[...log.matchAll(/^not ok \d+ - (.+)$/gm)].map(match=>match[1]);
      const passed=result.status===0&&!result.error&&counts.tests>0&&counts.fail===0&&counts.cancelled===0;
      const row={round,revision,head:revision==='baseline'?receipt.baseline:head,
        exitCode:result.status,processError:result.error?.code??null,passed,failures,...counts,logFile};
      receipt.runs.push(row);console.log(JSON.stringify(row));
      await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    }
  }
  receipt.headAfter=git('rev-parse','HEAD');receipt.trackedChangesAfter=git('status','--porcelain');
  receipt.exactCleanHead=!dirty&&!receipt.trackedChangesAfter&&receipt.headAfter===head;
  const baselineFailures=new Set(receipt.runs.filter(row=>row.revision==='baseline').flatMap(row=>row.failures));
  receipt.candidateFailureEvidence=[...new Set(receipt.runs.filter(row=>row.revision==='candidate').flatMap(row=>row.failures))]
    .map(test=>({test,alsoObservedOnBaseline:baselineFailures.has(test)}));
  receipt.passed=receipt.runs.filter(row=>row.revision==='candidate').every(row=>row.passed)&&receipt.headAfter===head;
  receipt.interpretation='Every failure remains a failed test. Baseline overlap is comparative evidence, not release acceptance; no overlap means unresolved candidate failure.';
  await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  process.exitCode=receipt.passed?0:1;
} finally {
  // Only this exact newly-created checkout is removed; Git verifies its state.
  git('worktree','remove',baselineRoot);
}
