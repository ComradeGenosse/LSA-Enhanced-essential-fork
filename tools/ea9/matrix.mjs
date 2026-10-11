#!/usr/bin/env node
// Offline-only EA0-EA9 acceptance: every row retains its own exact HEAD provenance.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const essential=path.join(root,'lsa-essential-e1-candidate');
const args=process.argv.slice(2);
const flag=name=>args.includes(name);
const val=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const run=flag('--run'), requireCombined=flag('--require-combined');
const expected=val('--expected-head');
const reportPath=path.resolve(val('--report') || path.join(root,'ea9-matrix-report.json'));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(expected && head!==expected)throw Error('HEAD_MISMATCH: expected '+expected+' found '+head);
const suites=[
  ['EA0 contract',['elevenlabs-emotional-acting.test.mjs']],
  ['EA1 scene source',['scene-delivery.test.mjs','ea-integration-owner-projection.test.mjs']],
  ['EA2 delivery and receipts',['ea2-speech-delivery.test.mjs','ea2-turn-lifecycle.test.mjs','elevenlabs-provider.test.mjs']],
  ['EA3 strict streaming',['ea3-delivery-hints.test.mjs','streaming-decision.test.mjs','decisions-and-requests.test.mjs']],
  ['EA4 lifetime',['ea4-runtime-integration.test.mjs','emotional-mood-continuity.test.mjs']],
  ['EA5 native protagonist',['ea5-native-protagonist-authority.test.mjs']],
  ['EA6 M1 SQLite',['ea6-storage-timeline.test.mjs']],
  ['EA7 continuity',['ea7-emotional-continuity-completion.test.mjs']],
  ['EA8 vendor tag safety',['ea8-elevenlabs-provider-safety.test.mjs']],
  ['EA9 release and rollback',['ea9-release.test.mjs']],
  ['Legacy P2 JSON',['p2-authority.test.mjs','p2-contract.test.mjs']],
  ['Director/controller/native bridge',['director-wire.test.mjs','director-transport.test.mjs','native-lifecycle.test.mjs']]
];
const result={schemaVersion:1,head,expectedHead:expected,branch:process.env.GITHUB_HEAD_REF||process.env.GITHUB_REF_NAME||null,
  githubRunId:process.env.GITHUB_RUN_ID||null,platform:process.platform,node:process.version,
  startedAt:new Date().toISOString(),paidRequests:0,gtaLaunched:false,combinedRequired:requireCombined,rows:[]};
let failed=false,missing=false;
for(const [name,files] of suites){
  const absent=files.filter(f=>!existsSync(path.join(essential,'tests',f)));
  let status='not-run',reason=run?'not-executed':'probe-only';
  if(absent.length){status='blocked';reason='missing tests from separate EA PR(s): '+absent.join(', ');missing=true;}
  else if(run){
    const p=spawnSync(process.execPath,['--test',...files.map(f=>'tests/'+f)],{cwd:essential,encoding:'utf8',
      env:{...process.env,LSA_CI_FAILURE_DETAILS:'1',ELEVENLABS_API_KEY:'',LSA_EA9_BILLING_APPROVED:'0'},maxBuffer:8*1024*1024});
    status=p.status===0?'passed':'failed';
    reason=p.error?.message|| (p.status===null?'terminated': 'exit '+p.status);
    if(status==='failed')failed=true;
    if(p.stdout)process.stdout.write(p.stdout);
    if(p.stderr)process.stderr.write(p.stderr);
  }
  result.rows.push({name,files,status,reason,head});
  console.log('[EA9] '+status+' '+name+': '+reason);
}
result.finishedAt=new Date().toISOString();
result.summary=Object.fromEntries(['passed','failed','blocked','not-run'].map(s=>[s,result.rows.filter(r=>r.status===s).length]));
mkdirSync(path.dirname(reportPath),{recursive:true});
writeFileSync(reportPath,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head,report:reportPath,summary:result.summary,combinedRequired:requireCombined}));
if(failed || (requireCombined && missing))process.exitCode=1;
