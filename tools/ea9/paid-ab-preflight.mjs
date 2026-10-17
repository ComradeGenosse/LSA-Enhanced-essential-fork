#!/usr/bin/env node
// NO NETWORK, NO SYNTHESIS. A mandatory local consent/budget gate for a later
// separately supervised paid A/B; never automatically invokes ElevenLabs.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const argv=process.argv.slice(2);
const item=n=>{const i=argv.indexOf(n);return i<0?null:argv[i+1];};
const deny=s=>{throw Error('EA9_BILLING_NOT_AUTHORIZED:'+s);};
if(process.env.LSA_EA9_BILLING_APPROVED!=='1')deny('explicit_flag_missing');
const file=item('--local-approval')||deny('written_approval_file_missing');
const data=JSON.parse(await readFile(path.resolve(file),'utf8'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
if(data?.approved!==true || typeof data.approver!=='string' || !data.approver.trim() ||
   data.sourceHead!==head || data.modelId!=='eleven_v4_turbo' ||
   typeof data.voiceId!=='string'|| !data.voiceId.trim() ||
   !Number.isFinite(data.maxBudgetUsd)||data.maxBudgetUsd<=0 ||
   !Number.isInteger(data.maxSamples)||data.maxSamples<2||data.maxSamples>20 ||
   data.maxSamples%2!==0 || typeof data.approvedAt!=='string'||
   !/^\d{4}-\d{2}-\d{2}/.test(data.approvedAt))deny('source_voice_sample_or_budget_incomplete');
console.log(JSON.stringify({status:'local_approval_verified_plan_only',sourceHead:head,
  modelId:data.modelId,maxSamples:data.maxSamples,maxBudgetUsd:data.maxBudgetUsd,
  billedSamples:0,paidCallsPerformed:0,willSynthesize:false,
  warning:'This check does not contact the vendor. Operator must enforce the account budget before separate synthesis.'}));
