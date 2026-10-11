// Agent E interface only, NOT a database implementation. Agent A owns all SQLite migrations.
// Durable adapter MUST atomically persist claims, acknowledgements and retry state under withTimelineWrite.
import { isUuid, scopeOf, sameScope } from './evidence.mjs';
export const CURATION_QUEUE_VERSION=1;
export const CURATION_QUEUE_STATES=Object.freeze(['pending','leased','completed','dead_letter']);
export function validateCurationJob(job){
  const scope=scopeOf(job);
  if(job.version!==1||!isUuid(job.jobId)||!isUuid(job.proposal?.proposalId)||
    !sameScope(scope,job.proposal)||job.proposal.provider!=='deterministic'||
    !['pending','leased','completed','dead_letter'].includes(job.state)||
    !Number.isSafeInteger(job.attempt)||job.attempt<0||
    !Number.isFinite(Date.parse(job.nextAttemptAtUtc))||
    !Array.isArray(job.proposal.evidenceRecordIds)||!job.proposal.evidenceRecordIds.length)
    throw new Error('curation_invalid_job');
  return job;
}
export function makeQueueJob(proposal,nowUtc){
  const scope=scopeOf(proposal);
  if(proposal.source==='player'||proposal.explicit===true)throw new Error('curation_explicit_bypass');
  if(proposal.kind!=='curation_proposal'||proposal.provider!=='deterministic'||!isUuid(proposal.proposalId)||
     !Array.isArray(proposal.evidenceRecordIds)||proposal.evidenceRecordIds.length>64||
     !proposal.evidenceRecordIds.length||!proposal.evidenceRecordIds.every(isUuid))throw new Error('curation_invalid_proposal');
  const job={...scope,version:1,jobId:proposal.proposalId,proposal,state:'pending',
    attempt:0,nextAttemptAtUtc:nowUtc,lease:null};
  return validateCurationJob(job);
}
export function retryDelayMs(attempt,{baseMs=1000,maxMs=300000,retryAfterMs=0}={}){
  if(!Number.isSafeInteger(attempt)||attempt<1)throw new Error('curation_invalid_attempt');
  // Deterministic (no jitter) for repeatable scheduling/recovery; provider Retry-After respected.
  return Math.max(Math.max(0,retryAfterMs),Math.min(maxMs,baseMs*2**Math.min(20,attempt-1)));
}
export function requireDurableQueueAdapter(store){
  for(const fn of ['enqueueIfAbsent','claimDue','completeLeased','retryLeased','releaseLeased']){
    if(typeof store?.[fn]!=='function')throw new TypeError('curation_queue_missing_'+fn);
  }
  // Contract: all methods return only after synchronous transactional durable commits.
  // claimDue({limit,nowUtc,leaseUntilUtc,ownerId}) -> array {job,leaseToken};
  // completeLeased({jobId,leaseToken,proposal,commit}) -> CAS ack AFTER proposal append
  // retryLeased({jobId,leaseToken,attempt,nextAttemptAtUtc,errorCode}) -> CAS retry
  // releaseLeased({jobId,leaseToken}) -> CAS immediate replay; recovery expires old leases.
  return store;
}
