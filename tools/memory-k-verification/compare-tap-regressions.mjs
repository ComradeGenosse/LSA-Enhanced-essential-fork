// Compare the same inherited TAP suite on a pinned baseline and PR candidate.
// Pre-existing source-blocked tests remain visible; new failures or changed
// reasons fail CI. Preserve the complete logs and a JSON comparison artifact.
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function parseTap(log,label){
  const summary={};
  for(const key of ['tests','pass','fail','cancelled','skipped','todo']){
    const matches=[...log.matchAll(new RegExp(`^# ${key} (\\d+)\\s*// Compare the same inherited TAP suite on a pinned baseline and PR candidate.
// Pre-existing source-blocked tests remain visible; new failures or changed
// reasons fail CI. Preserve the complete logs and a JSON comparison artifact.
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function parseTap(log,label){
  const summary={};
  for(const key of ['tests','pass','fail','cancelled','skipped','todo']){
    const matches=[...log.matchAll(,'gm'))];
    if(!matches.length)throw new Error(`${label}: incomplete TAP output (missing ${key})`);
    summary[key]=Number(matches.at(-1)[1]);
  }
  if(summary.tests!==summary.pass+summary.fail+summary.cancelled+summary.skipped+summary.todo)
    throw new Error(`${label}: inconsistent TAP summary`);
  const matches=[...log.matchAll(/^([ \t]*)not ok\s+\d+\s+-\s+(.+?)\s*$/gm)];
  const failures=matches.map((m,i)=>{
    const following=log.slice(m.index+m[0].length,matches[i+1]?.index??log.length);
    const error=following.match(/^[ \t]*error:\s*(.+?)\s*$/m)?.[1]?.trim()??'';
    return `${m[1].length}:${m[2].trim()} | ${error}`;
  });
  if(summary.fail>0&&failures.length===0)
    throw new Error(`${label}: failures without individual TAP records`);
  return {summary,failures};
}

export function compareTapLogs(baseLog,candidateLog){
  const baseline=parseTap(baseLog,'baseline'),candidate=parseTap(candidateLog,'candidate');
  const counts=new Map();
  for(const fp of baseline.failures)counts.set(fp,(counts.get(fp)??0)+1);
  const newFailures=[];
  for(const fp of candidate.failures){
    const remaining=counts.get(fp)??0;
    if(remaining)counts.set(fp,remaining-1);
    else newFailures.push(fp);
  }
  const report={baseline:baseline.summary,candidate:candidate.summary,
    inheritedFailures:baseline.failures.length,newFailures};
  return {pass:baseline.summary.tests===candidate.summary.tests&&
    candidate.summary.cancelled<=baseline.summary.cancelled&&newFailures.length===0,report};
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const directory=process.argv[2];
  if(!directory)throw new Error('Usage: compare-tap-regressions.mjs <log-directory>');
  const {pass,report}=compareTapLogs(
    readFileSync(path.join(directory,'baseline.log'),'utf8'),
    readFileSync(path.join(directory,'candidate.log'),'utf8'));
  writeFileSync(path.join(directory,'delta.json'),JSON.stringify({pass,...report},null,2)+'\n');
  console.log('Inherited TAP regression comparison:',JSON.stringify({pass,...report},null,2));
  if(!pass)process.exitCode=1;
}
