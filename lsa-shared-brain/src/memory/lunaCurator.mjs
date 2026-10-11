// Agent E M7. Invoked only from an idle/off-turn scheduler. No daemon, local LLM or model dependencies.
import { isUuid, sameScope } from './evidence.mjs';
import { requireDurableQueueAdapter, retryDelayMs, validateCurationJob } from './queueContract.mjs';
const candidates=new Set(['episode','semantic','relationship','joke']);
const text=value=>typeof value==='string';
const equalIds=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&
  [...a].sort().every((x,i)=>x===[...b].sort()[i]);

export function validateLunaAppraisal(raw,original){
  if(!raw||typeof raw!=='object'||!sameScope(raw,original)||
     raw.proposalId!==original.proposalId||raw.batchId!==original.batchId||
     !equalIds(raw.evidenceRecordIds,original.evidenceRecordIds)||
     !candidates.has(raw.candidate)||!Number.isFinite(raw.notability)||raw.notability<0||raw.notability>1||
     raw.groundedSummary!==original.groundedSummary||!text(raw.inCharacterTake)||
     !raw.inCharacterTake.trim()||raw.inCharacterTake.length>1200)
    throw new Error('curation_ungrounded_appraisal');
  // Facts are immutable. Model output is only a subjective candidate label/take and salience signal.
  return Object.freeze({...original,provider:'luna',candidate:raw.candidate,
    notability:raw.notability,inCharacterTake:raw.inCharacterTake});
}

function jsonOutput(response){
  if(typeof response==='string')return JSON.parse(response);
  const message=response?.output?.filter(r=>r?.type==='message').flatMap(r=>r.content||[])
    .filter(part=>part.type==='output_text').map(part=>part.text).join('')||response?.output_text;
  if(typeof message!=='string')throw new Error('curation_missing_output');
  return JSON.parse(message);
}
export function createLunaCurationAdapter({requestJson,config}){
  if(typeof requestJson!=='function')throw new TypeError('curation_request_adapter_required');
  const model=config?.reasoningModel,baseUrl=config?.reasoningBaseUrl,key=config?.reasoningKey;
  if(typeof model!=='string'||!model.trim()||typeof baseUrl!=='string'||!baseUrl.trim())
    throw new Error('curation_missing_reasoning_config');
  // Caller may inject existing E1 openai/request.mjs requestJson; key only read on enabled calls.
  return Object.freeze({id:'existing-cloud-luna',async curateBatch(proposals,{signal}={}){
    if(!Array.isArray(proposals)||!proposals.length||proposals.length>4)throw new Error('curation_invalid_batch');
    if(signal?.aborted)throw signal.reason??new Error('curation_cancelled');
    const instructions='You appraise fictional GTA roleplay memories. Output only JSON: {"items":[{"proposalId":...,"characterId":...,"worldProfileId":...,"timelineId":...,"batchId":...,"evidenceRecordIds":[...],"candidate":"episode|semantic|relationship|joke","notability":0.0,"groundedSummary":"unchanged literal","inCharacterTake":"subjective opinion"}]}. Never alter groundedSummary, IDs, source facts or add observations. Interpretations are only opinions; no claims that a character witnessed something not in sources. Humor and inside jokes can be highly salient.';
    const response=await requestJson({url:baseUrl.replace(/\/+$/,'')+'/responses',key,signal,
      timeoutMs:Math.min(45_000,config.curatorTimeoutMs??20_000),operation:'curation',
      model,body:{model,instructions,input:JSON.stringify({items:proposals.map(p=>({
        proposalId:p.proposalId,characterId:p.characterId,worldProfileId:p.worldProfileId,
        timelineId:p.timelineId,batchId:p.batchId,evidenceRecordIds:p.evidenceRecordIds,
        candidate:p.candidate,notability:p.notability,groundedSummary:p.groundedSummary}))}),
      max_output_tokens:Math.min(1600,config.curatorMaxOutputTokens??1200)}});
    const parsed=jsonOutput(response);
    if(!Array.isArray(parsed?.items)||parsed.items.length!==proposals.length)throw new Error('curation_invalid_response');
    const byId=new Map();
    for(const proposal of parsed.items){
      if(!isUuid(proposal?.proposalId)||byId.has(proposal.proposalId))throw new Error('curation_duplicate_appraisal');
      byId.set(proposal.proposalId,proposal);
    }
    return proposals.map(p=>validateLunaAppraisal(byId.get(p.proposalId),p));
  }});
}

const checkBudget=ledger=>{
  if(!ledger||!['reserve','settle','release'].every(k=>typeof ledger[k]==='function'))
    throw new Error('curation_durable_budget_required');
};
// A single call processes a bounded claim batch. Scheduler controls idle timing;
// no retries on the turn path; leases + spend ledger are persisted by Agent A.
export async function processIdleCuration({enabled=false,queue,provider,ledger,ownerId,nowUtc=new Date().toISOString(),
  maxBatch=4,estimatedMaxCostUsd=.02,leaseMs=90000,maxAttempts=8,signal}={}){
  if(!enabled)return {status:'disabled',processed:0};
  if(signal?.aborted)return {status:'cancelled',processed:0};
  requireDurableQueueAdapter(queue);checkBudget(ledger);
  if(typeof provider?.curateBatch!=='function'||!isUuid(ownerId)||
    !Number.isInteger(maxBatch)||maxBatch<1||maxBatch>4||
    !Number.isFinite(estimatedMaxCostUsd)||estimatedMaxCostUsd<=0||!Number.isInteger(leaseMs)||leaseMs<5000)
    throw new Error('curation_invalid_runtime');
  const leaseUntilUtc=new Date(Date.parse(nowUtc)+leaseMs).toISOString();
  // claimDue must CAS durable leases; expired leases become eligible for recovery after restart.
  const claimed=await queue.claimDue({limit:maxBatch,nowUtc,leaseUntilUtc,ownerId});
  if(!Array.isArray(claimed)||claimed.length>maxBatch)throw new Error('curation_bad_claim');
  if(!claimed.length)return {status:'empty',processed:0};
  try{
    const tokens=new Set();
    for(const item of claimed){
      validateCurationJob(item.job);
      if(item.job.state!=='leased'||!isUuid(item.leaseToken)||tokens.has(item.leaseToken)||
        !sameScope(item.job,item.job.proposal))throw new Error('curation_bad_lease');
      tokens.add(item.leaseToken);
    }
    // Capacity must be reserved durably BEFORE billable transport.
    const batchKey=claimed.map(x=>x.job.jobId).sort().join(':');
    const reserved=await ledger.reserve({batchKey,maxUsd:estimatedMaxCostUsd,nowUtc});
    if(!reserved){
      await Promise.all(claimed.map(x=>queue.releaseLeased({jobId:x.job.jobId,leaseToken:x.leaseToken})));
      return {status:'budget_blocked',processed:0};
    }
    try{
      if(signal?.aborted)throw signal.reason??new Error('curation_cancelled');
      const appraisals=await provider.curateBatch(claimed.map(x=>x.job.proposal),{signal});
      if(!Array.isArray(appraisals)||appraisals.length!==claimed.length)throw new Error('curation_partial_batch');
      // Validate full batch BEFORE committing any item.
      const validated=appraisals.map((raw,i)=>validateLunaAppraisal(raw,claimed[i].job.proposal));
      if(signal?.aborted)throw signal.reason??new Error('curation_cancelled');
      let completed=0;
      for(let i=0;i<claimed.length;i++){
        const item=claimed[i];
        // Under TimelineGuard: adapter's completeLeased MUST durably store the proposal
        // and consume lease in one transaction, or reject with no acknowledgement.
        await queue.completeLeased({jobId:item.job.jobId,leaseToken:item.leaseToken,proposal:validated[i]});
        completed++;
      }
      await ledger.settle({batchKey,maxUsd:estimatedMaxCostUsd});
      return {status:'completed',processed:completed};
    }catch(error){
      // No provider payload, player text, or secrets leak into diagnostics.
      const cancelled=signal?.aborted===true;
      await Promise.allSettled(claimed.map(async x=>{
        if(cancelled){await queue.releaseLeased({jobId:x.job.jobId,leaseToken:x.leaseToken});return;}
        const attempt=x.job.attempt+1;
        await queue.retryLeased({jobId:x.job.jobId,leaseToken:x.leaseToken,attempt,
          nextAttemptAtUtc:new Date(Date.parse(nowUtc)+retryDelayMs(attempt,{retryAfterMs:error.retryAfterMs??0})).toISOString(),
          errorCode:attempt>=maxAttempts?'curation_dead_letter':'curation_retry'});
      }));
      // A provider request may be billable even after failure. Conservatively settle reserved ceiling
      // unless the injected ledger can reconcile exact provider usage.
      await ledger.settle({batchKey,maxUsd:estimatedMaxCostUsd});
      return {status:cancelled?'cancelled':'retry_scheduled',processed:0};
    }
  }catch(error){
    await Promise.allSettled(claimed.map(x=>queue.releaseLeased({jobId:x.job?.jobId,leaseToken:x.leaseToken})));
    throw error;
  }
}
