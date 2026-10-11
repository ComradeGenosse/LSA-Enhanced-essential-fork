// M6/M7 offline contract + fixture suite; NO network or billable model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectAutomaticMemories } from '../../lsa-shared-brain/src/memory/selection.mjs';
import { consolidateCandidates } from '../../lsa-shared-brain/src/memory/consolidation.mjs';
import { stableUuid, factDigest, normalizedEvidence } from '../../lsa-shared-brain/src/memory/evidence.mjs';
import { makeQueueJob, retryDelayMs, requireDurableQueueAdapter } from '../../lsa-shared-brain/src/memory/queueContract.mjs';
import { createLunaCurationAdapter, validateLunaAppraisal, processIdleCuration } from '../../lsa-shared-brain/src/memory/lunaCurator.mjs';
import { createEssentialLunaCurator } from '../src/memory/lunaCurationBridge.mjs';
const id=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const scope={characterId:id(1),worldProfileId:id(2),timelineId:id(3)};
const proof={ownerAlias:'promoted.'+id(1),incarnationId:id(11),encounterId:id(12),
  hostRunId:id(13),worldEpoch:1,observerCaptureRef:id(14)};
const clock=n=>new Date(Date.UTC(2026,9,11,16,0,n)).toISOString();
function event(n,type='crash',{subject='franklin',characterId=scope.characterId,timelineId=scope.timelineId,time=n,epoch=1,receiptStatus='witnessed'}={}){
  return {version:1,...scope,characterId,timelineId,kind:'journal_event',recordId:id(100+n),
    observationId:id(200+n),revision:1,eventType:type,receivedAtUtc:clock(time),
    sourceHash:'a'.repeat(64),ownerProof:{...proof,worldEpoch:epoch},receiptStatus,
    claims:[{kind:type,modality:'visual',certainty:'direct',durableSubject:subject,sourceEvidenceId:id(300+n)}]};
}
function line(n,content,{characterId=scope.characterId,delivery='accepted',speaker='player',
  source='typed',time=n,deliveryReceiptId=null}={}){
  return {version:1,...scope,characterId,kind:'dialogue_line',recordId:id(400+n),speaker,source,
    content,delivery,committedAtUtc:clock(time),turnIdentityHash:'b'.repeat(64),
    utteranceId:id(500+n),transcription:null,deliveryReceiptId};
}
const choose=(e,opt)=>selectAutomaticMemories(e,opt);
const listed=()=>choose([event(1),event(2)]);
const validAppraisal=p=>({proposalId:p.proposalId,characterId:p.characterId,worldProfileId:p.worldProfileId,
  timelineId:p.timelineId,batchId:p.batchId,evidenceRecordIds:p.evidenceRecordIds,
  candidate:'joke',notability:.94,groundedSummary:p.groundedSummary,inCharacterTake:'I think that was absurd.'});
test('M6 deterministic stable ID, evidence links and bounded contract shape',async()=>{
  const [a]=listed(),[b]=listed();
  assert.deepEqual(a,b);assert.equal(a.provider,'deterministic');assert.equal(a.kind,'curation_proposal');
  assert.equal(a.evidenceRecordIds.length,2);assert.equal(a.candidate,'episode');
  assert.match(a.groundedSummary,/Observed crash/);
  assert.ok(!a.groundedSummary.includes('NPC witnessed player confession'));
  const contract=JSON.parse(await readFile(new URL('../../contracts/memory.v1.json',import.meta.url),'utf8')).$defs.curationProposal;
  assert.deepEqual(Object.keys(a).sort(),contract.required.sort());
  assert.ok(a.groundedSummary.length<=contract.properties.groundedSummary.maxLength);
});
test('M6 does not turn dialogue or hearsay into witnessed world fact',()=>{
  const r=line(4,'I did a 10000 foot jump, trust me!');
  assert.match(factDigest(normalizedEvidence(r)),/^Player said:/);
  assert.equal(choose([r]).length,0);
  const told=event(3,'prank');told.claims[0].modality='report';told.claims[0].certainty='reported';
  assert.match(choose([told])[0].groundedSummary,/Reported prank/);
  assert.equal(choose([event(4,'crash',{receiptStatus:'reported'})]).length,0);
  assert.equal(choose([line(8,'made up NPC answer',{speaker:'npc',source:'npc_generated',delivery:'accepted'})]).length,0);
  assert.equal(choose([line(9,'completed speech no receipt',{speaker:'npc',source:'npc_generated',delivery:'completed'})]).length,0);
});
test('M6 favors humor, surreal accidents, relationships; does not hard cap remarkable sessions',()=>{
  const fun=[event(1,'inside_joke'),event(2,'rollover'),event(3,'rescued_friend')];
  assert.ok(choose(fun).length>=1);
  assert.ok(choose([event(7,'bizarre_crash')],{existingInHour:100}).length===1);
  assert.equal(choose([event(8,'walking')],{existingInHour:0}).length,0);
  assert.equal(choose([line(15,'That was hilarious!')]).length,1);
});
test('scope, epochs and time-window prevent cross-NPC and divergent-timeline scene links',()=>{
  const records=[event(1,'crash'),event(2,'crash',{characterId:id(9)}),
    event(3,'crash',{timelineId:id(10)}),event(4,'crash',{epoch:2}),
    event(5,'crash',{time:200})];
  assert.equal(choose(records).length,5);
  const ids=new Set(choose(records).map(p=>p.proposalId));assert.equal(ids.size,5);
});
test('invalid or unknown evidence cannot be promoted, no evidence disappears from journal',()=>{
  const r=event(1);r.claims[0].certainty='unknown';
  assert.equal(choose([r]).length,0);
  const good=event(2),result=choose([good,event(3,'crash',{receiptStatus:'reported'})]);
  assert.equal(result.length,1);assert.deepEqual(result[0].evidenceRecordIds,[good.recordId]);
  assert.throws(()=>choose(Array.from({length:10001},()=>good)),/batch_limit/);
});
test('consolidation links only exact automatic duplicates, leaves explicit user saves and other identities untouched',()=>{
  const [a]=choose([event(1)]),[b]=choose([event(2)]);
  assert.equal(consolidateCandidates([a],b).action,'link_duplicate');
  assert.deepEqual(consolidateCandidates([a],b).evidenceRecordIds,[id(101),id(102)]);
  assert.equal(consolidateCandidates([{...a,source:'player'}],b).action,'insert');
  assert.equal(consolidateCandidates([a],{...b,characterId:id(55)}).action,'insert');
  assert.equal(consolidateCandidates([a],{...b,groundedSummary:'Observed unrelated event.'}).action,'insert');
});
test('job keys are deterministic, explicit memories bypass, retry has bounded exponential backoff',()=>{
  const [proposal]=listed(),job=makeQueueJob(proposal,clock(20));
  assert.equal(job.jobId,proposal.proposalId);assert.equal(job.state,'pending');
  assert.throws(()=>makeQueueJob({...proposal,source:'player'},clock(20)),/explicit_bypass/);
  assert.equal(retryDelayMs(1),1000);assert.equal(retryDelayMs(3),4000);
  assert.equal(retryDelayMs(100),300000);assert.equal(retryDelayMs(1,{retryAfterMs:42000}),42000);
  assert.throws(()=>requireDurableQueueAdapter({}),/missing_enqueueIfAbsent/);
});
test('Luna adapter reuses existing response transport and refuses forged source facts',async()=>{
  const p=listed()[0],calls=[];
  const mock=async input=>{calls.push(input);return {output:[{type:'message',content:[
    {type:'output_text',text:JSON.stringify({items:[validAppraisal(p)]})}]}]};};
  const config={provider:'openai',reasoningModel:'gpt-6-luna',reasoningBaseUrl:'https://api.openai.com/v1',
    reasoningKey:'fake-test-key'};
  const adapter=createLunaCurationAdapter({config,requestJson:mock});
  const [result]=await adapter.curateBatch([p]);
  assert.equal(result.provider,'luna');assert.equal(result.groundedSummary,p.groundedSummary);
  assert.equal(calls.length,1);assert.equal(calls[0].operation,'curation');
  assert.equal(calls[0].body.model,'gpt-6-luna');
  assert.throws(()=>validateLunaAppraisal({...validAppraisal(p),groundedSummary:'Invented crash victim'},p),/ungrounded/);
  assert.throws(()=>validateLunaAppraisal({...validAppraisal(p),evidenceRecordIds:[id(999)]},p),/ungrounded/);
  assert.throws(()=>validateLunaAppraisal({...validAppraisal(p),characterId:id(999)},p),/ungrounded/);
  assert.throws(()=>validateLunaAppraisal({...validAppraisal(p),inCharacterTake:''},p),/ungrounded/);
  assert.throws(()=>createEssentialLunaCurator({provider:'local'}),/requires_existing/);
});
function queueFixture(proposal){
  const log=[],job={...makeQueueJob(proposal,clock(10)),state:'leased'};
  return {log,async claimDue(){log.push('claim');return [{job,leaseToken:id(88)}];},
    async completeLeased({proposal}){log.push('commit:'+proposal.provider);},
    async retryLeased(){log.push('retry');},async releaseLeased(){log.push('release');},
    async enqueueIfAbsent(){log.push('enqueue');}};
}
function ledgerFixture(allowed=true){
  const log=[];return {log,async reserve(){log.push('reserve');return allowed;},
    async settle(){log.push('settle');},async release(){log.push('release');}};
}
test('M7 worker is off by default; no cloud request, even if a queue exists',async()=>{
  const p=listed()[0],q=queueFixture(p),ledger=ledgerFixture();
  const result=await processIdleCuration({queue:q,ledger,provider:{curateBatch(){throw Error('billable')}},ownerId:id(66)});
  assert.equal(result.status,'disabled');assert.deepEqual(q.log,[]);assert.deepEqual(ledger.log,[]);
});
test('M7 batch validates evidence before durable acknowledgement, ledger reserves first',async()=>{
  const p=listed()[0],q=queueFixture(p),ledger=ledgerFixture();
  const result=await processIdleCuration({enabled:true,queue:q,ledger,ownerId:id(66),nowUtc:clock(10),
    provider:{async curateBatch(){q.log.push('provider');return [{...p,provider:'luna',...validAppraisal(p)}]}}});
  assert.equal(result.status,'completed');assert.deepEqual(q.log,['claim','provider','commit:luna']);
  assert.deepEqual(ledger.log,['reserve','settle']);
});
test('M7 outage schedules retry without acknowledging or removing selected evidence',async()=>{
  const p=listed()[0],q=queueFixture(p),ledger=ledgerFixture();
  const result=await processIdleCuration({enabled:true,queue:q,ledger,ownerId:id(66),nowUtc:clock(10),
    provider:{async curateBatch(){throw Error('offline');}}});
  assert.equal(result.status,'retry_scheduled');assert.deepEqual(q.log,['claim','retry']);
  assert.deepEqual(p.evidenceRecordIds,[id(101),id(102)]);
});
test('M7 budget blocked releases lease; cancellation never calls provider',async()=>{
  const p=listed()[0],q=queueFixture(p),ledger=ledgerFixture(false);
  const result=await processIdleCuration({enabled:true,queue:q,ledger,ownerId:id(66),nowUtc:clock(10),
    provider:{async curateBatch(){throw Error('should not call');}}});
  assert.equal(result.status,'budget_blocked');assert.deepEqual(q.log,['claim','release']);
  const cancel=new AbortController();cancel.abort();
  const q2=queueFixture(p);
  assert.equal((await processIdleCuration({enabled:true,queue:q2,ledger,ownerId:id(66),signal:cancel.signal})).status,'cancelled');
  assert.deepEqual(q2.log,[]);
});
