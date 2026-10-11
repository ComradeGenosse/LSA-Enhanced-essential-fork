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
  return Object.freeze({id:'existing-cloud-luna',
    estimateMaxCostUsd(proposals){
      const pricing=config.curatorPricing;
      if(!pricing||!Number.isFinite(pricing.inputUsdPerMillionTokens)||
         !Number.isFinite(pricing.outputUsdPerMillionTokens)||
         pricing.inputUsdPerMillionTokens<=0||pricing.outputUsdPerMillionTokens<=0)
        throw new Error('curation_verified_luna_pricing_required');
      if(!Array.isArray(proposals)||proposals.length<1||proposals.length>4)
        throw new Error('curation_invalid_batch');
      // Upper-bound input tokens by UTF-8 bytes, with conservative request
      // instructions/metadata overhead; output tokens are explicitly capped.
      const inputBytes=Buffer.byteLength(JSON.stringify(proposals),'utf8')+4096;
      const outputTokens=Math.min(1600,config.curatorMaxOutputTokens??1200);
      return (inputBytes*pricing.inputUsdPerMillionTokens+
        outputTokens*pricing.outputUsdPerMillionTokens)/1e6*1.2+0.000001;
    },
    async curateBatch(proposals,{signal}={}){
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
    const appraisals=proposals.map(p=>validateLunaAppraisal(byId.get(p.proposalId),p));
    // Usage is not a bill. Cost reconciliation is permitted only with a caller-
    // supplied price for the exact same Luna model and actual usage counters.
    const price=config.curatorPricing;
    const input=response?.usage?.input_tokens,output=response?.usage?.output_tokens;
    if(price&&Number.isSafeInteger(input)&&input>=0&&Number.isSafeInteger(output)&&output>=0&&
       Number.isFinite(price.inputUsdPerMillionTokens)&&price.inputUsdPerMillionTokens>=0&&
       Number.isFinite(price.outputUsdPerMillionTokens)&&price.outputUsdPerMillionTokens>=0){
      const amount=(input*price.inputUsdPerMillionTokens+output*price.outputUsdPerMillionTokens)/1e6;
      Object.defineProperty(appraisals,'actualUsd',{value:amount,enumerable:false});
    }
    return appraisals;
  }});
}


const checkBudget=ledger=>{
  if(!ledger||!['reserve','settle','release'].every(k=>typeof ledger[k]==='function'))
    throw new Error('curation_durable_budget_required');
};
const abortError=()=>Object.assign(new Error('curation_cancelled'),{code:'cancelled'});
function withCancellation(task,{signal,timeoutMs}){
 const internal=new AbortController();
 let timedOut=false;
 const onCancel=()=>internal.abort(signal?.reason??abortError());
 if(signal?.aborted)onCancel();
 else signal?.addEventListener('abort',onCancel,{once:true});
 const timer=setTimeout(()=>{timedOut=true;internal.abort(Object.assign(new Error('curation_timeout'),{code:'timeout'}));},timeoutMs);
 timer.unref?.();
 let remove=()=>{};
 const aborted=new Promise((_,reject)=>{
   const abort=()=>reject(internal.signal.reason??abortError());
   if(internal.signal.aborted)abort();
   else{internal.signal.addEventListener('abort',abort,{once:true});remove=()=>internal.signal.removeEventListener('abort',abort);}
 });
 return Promise.race([Promise.resolve().then(()=>task(internal.signal)),aborted])
   .finally(()=>{clearTimeout(timer);remove();signal?.removeEventListener('abort',onCancel);});
}
const authorized=async(fn,job)=>{
 if(fn&&await fn(job)!==true)throw Object.assign(new Error('curation_scope_revoked'),{code:'scope_revoked'});
};
const tryAll=async actions=>Promise.allSettled(actions.map(action=>Promise.resolve().then(action)));

/**
 * Explicit single idle-checkpoint unit of work. No dialogue path calls this
 * function. A persistent queue owns all lease/commit CAS; transport is allowed
 * only AFTER reservation and revalidation. On uncertain billing, retain the
 * full reservation and retry source-safe jobs later.
 */
export async function processIdleCuration({enabled=false,mode,queue,provider,ledger,ownerId,nowUtc=new Date().toISOString(),
  maxBatch=4,characterId=null,estimatedMaxCostUsd=.02,leaseMs=90000,maxProviderMs=45000,
  maxAttempts=8,signal,isAuthorized}={}){
 const effectiveMode=mode??(enabled?'experimental':'off');
 if(!['off','shadow','experimental'].includes(effectiveMode))throw new Error('curation_invalid_mode');
 if(effectiveMode==='off')return {status:'disabled',processed:0};
 if(effectiveMode==='shadow')return {status:'shadow',processed:0};
 if(signal?.aborted)return {status:'cancelled',processed:0};
 requireDurableQueueAdapter(queue);checkBudget(ledger);
 if(typeof provider?.curateBatch!=='function'||!isUuid(ownerId)||
   !Number.isInteger(maxBatch)||maxBatch<1||maxBatch>4||(characterId!==null&&!isUuid(characterId))||
   !Number.isFinite(estimatedMaxCostUsd)||estimatedMaxCostUsd<=0||
   !Number.isInteger(leaseMs)||leaseMs<5000||leaseMs>300000||
   !Number.isInteger(maxProviderMs)||maxProviderMs<1000||maxProviderMs>=leaseMs-1000||
   !Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>32||
   !Number.isFinite(Date.parse(nowUtc))||
   (isAuthorized!==undefined&&typeof isAuthorized!=='function'))
   throw new Error('curation_invalid_runtime');
 const leaseUntilUtc=new Date(Date.parse(nowUtc)+leaseMs).toISOString();
 const claimed=await queue.claimDue({limit:maxBatch,nowUtc,leaseUntilUtc,ownerId,characterId});
 if(!Array.isArray(claimed)||claimed.length>maxBatch)throw new Error('curation_bad_claim');
 if(!claimed.length)return {status:'empty',processed:0};
 let batchKey=null,reserved=false,transportStarted=false;
 const completed=new Set(),tokens=new Set();
 try{
   for(const {job,leaseToken} of claimed){
     validateCurationJob(job);
     if(job.state!=='leased'||!isUuid(leaseToken)||tokens.has(leaseToken)||
       !sameScope(job,job.proposal)||job.lease?.leaseToken&&job.lease.leaseToken!==leaseToken)
       throw new Error('curation_bad_lease');
     // Per-character provider isolation, including multi-NPC contention.
     if((characterId!==null&&job.characterId!==characterId)||
        job.characterId!==claimed[0].job.characterId||
        job.worldProfileId!==claimed[0].job.worldProfileId||
        job.timelineId!==claimed[0].job.timelineId)
       throw new Error('curation_cross_scope_batch');
     tokens.add(leaseToken);
     await authorized(isAuthorized,job);
   }
   if(signal?.aborted)throw abortError();
   // Cloud request must be bounded using known model pricing; never make
   // a billable request with an estimated ceiling below the worst case.
   if(typeof provider.estimateMaxCostUsd==='function'){
     const cost=provider.estimateMaxCostUsd(claimed.map(x=>x.job.proposal));
     if(!Number.isFinite(cost)||cost>estimatedMaxCostUsd)
       throw Object.assign(new Error('curation_estimate_exceeds_budget'),
         {code:'estimate_exceeds_budget'});
   }
   batchKey=claimed.map(x=>x.job.jobId+':'+x.leaseToken).sort().join(':');
   reserved=await ledger.reserve({batchKey,maxUsd:estimatedMaxCostUsd,nowUtc});
   if(!reserved){
     await tryAll(claimed.map(x=>()=>queue.releaseLeased({jobId:x.job.jobId,leaseToken:x.leaseToken})));
     return {status:'budget_blocked',processed:0};
   }
   // The authority may change while awaiting a durable reservation.
   for(const {job} of claimed)await authorized(isAuthorized,job);
   if(signal?.aborted)throw abortError();
   transportStarted=true;
   const response=await withCancellation(sig=>provider.curateBatch(
      claimed.map(x=>x.job.proposal),{signal:sig}),{signal,timeoutMs:maxProviderMs});
   const appraisals=Array.isArray(response)?response:response?.appraisals;
   if(!Array.isArray(appraisals)||appraisals.length!==claimed.length)throw new Error('curation_partial_batch');
   const validated=appraisals.map((raw,i)=>validateLunaAppraisal(raw,claimed[i].job.proposal));
   if(signal?.aborted)throw abortError();
   for(let i=0;i<claimed.length;i++){
     await authorized(isAuthorized,claimed[i].job);
     if(signal?.aborted)throw abortError();
     const item=claimed[i];
     // SQLite rechecks source evidence and lease expiration inside the one
     // P2 transaction; this async recheck alone is not authorization.
     await queue.completeLeased({jobId:item.job.jobId,leaseToken:item.leaseToken,
        proposal:validated[i]});
     completed.add(item.job.jobId);
   }
   const actualUsd=Array.isArray(response)?response.actualUsd:response?.actualUsd;
   try{
     await ledger.settle({batchKey,maxUsd:estimatedMaxCostUsd,
       ...(Number.isFinite(actualUsd)&&actualUsd>=0&&actualUsd<=estimatedMaxCostUsd?{actualUsd}:{})});
     return {status:'completed',processed:completed.size};
   }catch{return {status:'settlement_pending',processed:completed.size};}
 }catch(error){
   const noBudget=error?.code==='estimate_exceeds_budget'||error?.message==='curation_verified_luna_pricing_required';
   const cancelled=signal?.aborted===true||error?.code==='scope_revoked';
   const retryAfterMs=Number.isFinite(error?.retryAfterMs)&&error.retryAfterMs>=0?error.retryAfterMs:0;
   const permanent=error?.status>=400&&error?.status<500&&![408,409,425,429].includes(error.status)||
       error?.code==='curation_ungrounded_appraisal'||error?.code==='curation_cross_scope_batch';
   const retry=claimed.filter(x=>!completed.has(x.job.jobId));
   await tryAll(retry.map(x=>async()=>{
     if((cancelled||noBudget)&&!transportStarted){
       await queue.releaseLeased({jobId:x.job.jobId,leaseToken:x.leaseToken});
     }else{
       const attempt=x.job.attempt+1;
       await queue.retryLeased({jobId:x.job.jobId,leaseToken:x.leaseToken,attempt,
         nextAttemptAtUtc:new Date(Date.parse(nowUtc)+retryDelayMs(attempt,{retryAfterMs})).toISOString(),
         errorCode:attempt>=maxAttempts||permanent?'curation_dead_letter':'curation_retry'});
     }
   }));
   if(reserved){
     // Any transport-start uncertainty is billed at ceiling, even cancelled
     // or timed-out requests; crash recovery likewise retains reservation.
     try{
       if(transportStarted)await ledger.settle({batchKey,maxUsd:estimatedMaxCostUsd});
       else await ledger.release({batchKey,maxUsd:estimatedMaxCostUsd});
     }catch{return {status:'settlement_pending',processed:completed.size};}
   }
   return {status:noBudget?'budget_estimate_exceeded':cancelled?'cancelled':completed.size?'partially_completed':'retry_scheduled',
     processed:completed.size};
 }
}
