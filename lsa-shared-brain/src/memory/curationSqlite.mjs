// M7 durable queue and budget ledger inside the one P2 SQLite database.
// All writes are invoked from P2.withTimelineWrite and use synchronous SQLite.
import {randomUUID} from 'node:crypto';
import {isUuid} from '../util/identity.mjs';
import {validateCurationJob} from './queueContract.mjs';
import {validateLunaAppraisal} from './lunaCurator.mjs';
const fail=x=>{throw new Error(x)};
const scoped=(db,job,world,timeline)=>{
 const worldId=job?.worldProfileId??job?.world_profile_id;
 const timelineId=job?.timelineId??job?.timeline_id;
 const characterId=job?.characterId??job?.character_id;
 if(worldId!==world||timelineId!==timeline||!isUuid(characterId))
   fail('curation_scope_mismatch');
 if(!db.prepare('SELECT character_id FROM promoted_profiles WHERE character_id=?').get(characterId))
   fail('curation_character_not_promoted');
};
const tx=(db,fn)=>{db.exec('BEGIN IMMEDIATE');try{
 const v=fn();if(v&&typeof v.then==='function')fail('curation_async_transaction');
 db.exec('COMMIT');return v;
}catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}};
export const CURATION_EXTRA_DDL=`
CREATE TABLE IF NOT EXISTS memory_luna_appraisals (
 proposal_id TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL,timeline_id TEXT NOT NULL,
 character_id TEXT NOT NULL,original_proposal_json TEXT NOT NULL,
 appraisal_json TEXT NOT NULL,completed_at_utc TEXT NOT NULL);
`;
export function ensureCurationSchema(db){db.exec(CURATION_EXTRA_DDL);}
export function enqueueCuration(db,{job},world,timeline){
 validateCurationJob(job);scoped(db,job,world,timeline);
 return tx(db,()=>{
  const memory=db.prepare('SELECT proposal_json FROM memory_records WHERE memory_id=? AND world_profile_id=? AND timeline_id=? AND character_id=?')
    .get(job.proposal.proposalId,world,timeline,job.characterId);
  if(!memory||memory.proposal_json!==JSON.stringify(job.proposal))
    fail('curation_deterministic_record_not_committed');
  const old=db.prepare('SELECT job_json FROM memory_curation_jobs WHERE job_id=?').get(job.jobId);
  if(old){
   const previous=JSON.parse(old.job_json);
   if(JSON.stringify(previous.proposal)!==JSON.stringify(job.proposal))fail('curation_conflicting_replay');
   return {inserted:false,jobId:job.jobId};
  }
  db.prepare('INSERT INTO memory_curation_jobs(job_id,character_id,world_profile_id,timeline_id,job_json,state,next_attempt_at_utc,attempt) VALUES(?,?,?,?,?,?,?,?)')
    .run(job.jobId,job.characterId,world,timeline,JSON.stringify(job),'pending',job.nextAttemptAtUtc,0);
  return {inserted:true,jobId:job.jobId};
 });
}
export function claimCuration(db,{limit,nowUtc,leaseUntilUtc,ownerId},world,timeline){
 if(!isUuid(ownerId)||!Number.isSafeInteger(limit)||limit<1||limit>4||
    !Number.isFinite(Date.parse(nowUtc))||!Number.isFinite(Date.parse(leaseUntilUtc))||
    Date.parse(leaseUntilUtc)<=Date.parse(nowUtc))fail('curation_invalid_claim');
 return tx(db,()=>{
  const rows=db.prepare(`SELECT q.* FROM memory_curation_jobs q JOIN promoted_profiles p ON p.character_id=q.character_id
    WHERE q.world_profile_id=? AND q.timeline_id=? AND
    ((q.state='pending' AND q.next_attempt_at_utc<=?) OR
    (q.state='leased' AND q.lease_until_utc<=?))
    ORDER BY q.next_attempt_at_utc,q.job_id LIMIT ?`).all(world,timeline,nowUtc,nowUtc,limit);
  return rows.map(row=>{
   const token=randomUUID();
   const info=db.prepare(`UPDATE memory_curation_jobs SET state='leased',lease_token=?,lease_until_utc=?,lease_owner=?
     WHERE job_id=? AND state IN ('pending','leased')`).run(token,leaseUntilUtc,ownerId,row.job_id);
   if(info.changes!==1)fail('curation_claim_race');
   return {job:{...JSON.parse(row.job_json),state:'leased',attempt:row.attempt,lease:{leaseToken:token,leaseUntilUtc,ownerId}},leaseToken:token};
  });
 });
}
function leased(db,jobId,leaseToken,world,timeline){
 if(!isUuid(jobId)||!isUuid(leaseToken))fail('curation_invalid_lease');
 const row=db.prepare("SELECT * FROM memory_curation_jobs WHERE job_id=? AND world_profile_id=? AND timeline_id=? AND state='leased' AND lease_token=?")
   .get(jobId,world,timeline,leaseToken);
 if(!row)fail('curation_lease_not_current');
 scoped(db,row,world,timeline);
 return row;
}
export function completeCuration(db,{jobId,leaseToken,proposal},world,timeline){
 return tx(db,()=>{
  const row=leased(db,jobId,leaseToken,world,timeline),job=JSON.parse(row.job_json);
  const approved=validateLunaAppraisal(proposal,job.proposal);
  if(job.jobId!==jobId||approved.proposalId!==job.proposal.proposalId)fail('curation_proposal_mismatch');
  // A forgotten source cannot be re-curated after its command was committed.
  for(const id of approved.evidenceRecordIds){
   if(db.prepare('SELECT target_id FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND target_id=?')
     .get(world,row.character_id,timeline,id))fail('curation_source_forgotten');
  }
  const old=db.prepare('SELECT proposal_id FROM memory_luna_appraisals WHERE proposal_id=?').get(approved.proposalId);
  if(old)fail('curation_duplicate_appraisal');
  db.prepare('INSERT INTO memory_luna_appraisals(proposal_id,world_profile_id,timeline_id,character_id,original_proposal_json,appraisal_json,completed_at_utc) VALUES(?,?,?,?,?,?,?)')
    .run(approved.proposalId,world,timeline,row.character_id,JSON.stringify(job.proposal),JSON.stringify(approved),new Date().toISOString());
  const info=db.prepare("UPDATE memory_curation_jobs SET state='completed',lease_token=NULL,lease_until_utc=NULL,lease_owner=NULL WHERE job_id=? AND lease_token=? AND state='leased'")
    .run(jobId,leaseToken);
  if(info.changes!==1)fail('curation_complete_race');
  return {durableCommit:true,proposalId:approved.proposalId};
 });
}
export function retryCuration(db,{jobId,leaseToken,attempt,nextAttemptAtUtc,errorCode},world,timeline){
 if(!Number.isSafeInteger(attempt)||attempt<1||!Number.isFinite(Date.parse(nextAttemptAtUtc))||
    typeof errorCode!=='string'||errorCode.length>80)fail('curation_invalid_retry');
 return tx(db,()=>{
  leased(db,jobId,leaseToken,world,timeline);
  const dead=errorCode==='curation_dead_letter';
  const q=db.prepare("UPDATE memory_curation_jobs SET state=?,attempt=?,next_attempt_at_utc=?,lease_token=NULL,lease_until_utc=NULL,lease_owner=NULL WHERE job_id=? AND lease_token=? AND state='leased'")
    .run(dead?'dead_letter':'pending',attempt,nextAttemptAtUtc,jobId,leaseToken);
  if(q.changes!==1)fail('curation_retry_race');
  return {status:dead?'dead_letter':'pending'};
 });
}
export function releaseCuration(db,{jobId,leaseToken},world,timeline){
 return tx(db,()=>{
  leased(db,jobId,leaseToken,world,timeline);
  const q=db.prepare("UPDATE memory_curation_jobs SET state='pending',lease_token=NULL,lease_until_utc=NULL,lease_owner=NULL WHERE job_id=? AND lease_token=? AND state='leased'")
    .run(jobId,leaseToken);
  if(q.changes!==1)fail('curation_release_race');
  return {released:true};
 });
}
export function reserveCurationBudget(db,{batchKey,maxUsd,nowUtc},world,{dailyUsd,monthlyUsd}){
 if(typeof batchKey!=='string'||batchKey.length<1||batchKey.length>512||
    !Number.isFinite(maxUsd)||maxUsd<=0||!Number.isFinite(Date.parse(nowUtc))||
    !Number.isFinite(dailyUsd)||dailyUsd<=0||!Number.isFinite(monthlyUsd)||monthlyUsd<=0)
    fail('curation_invalid_budget');
 return tx(db,()=>{
  const existing=db.prepare('SELECT state,amount_usd FROM memory_budget_reservations WHERE batch_key=?').get(batchKey);
  if(existing)return existing.state!=='released'&&existing.amount_usd===maxUsd;
  const reserved=db.prepare("SELECT amount_usd,reserved_at_utc FROM memory_budget_reservations WHERE world_profile_id=? AND state IN ('reserved','settled')").all(world);
  const day=nowUtc.slice(0,10),month=nowUtc.slice(0,7);
  const daily=reserved.filter(r=>r.reserved_at_utc.slice(0,10)===day).reduce((n,r)=>n+r.amount_usd,0);
  const monthly=reserved.filter(r=>r.reserved_at_utc.slice(0,7)===month).reduce((n,r)=>n+r.amount_usd,0);
  if(daily+maxUsd>dailyUsd+1e-9||monthly+maxUsd>monthlyUsd+1e-9)return false;
  db.prepare("INSERT INTO memory_budget_reservations(batch_key,world_profile_id,amount_usd,reserved_at_utc,state) VALUES(?,?,?,?, 'reserved')")
    .run(batchKey,world,maxUsd,nowUtc);
  return true;
 });
}
export function finishCurationBudget(db,{batchKey,maxUsd},world,state){
 if(!['settled','released'].includes(state)||typeof batchKey!=='string'||!Number.isFinite(maxUsd))fail('curation_invalid_budget');
 return tx(db,()=>{
  const row=db.prepare('SELECT world_profile_id,state,amount_usd FROM memory_budget_reservations WHERE batch_key=?').get(batchKey);
  if(!row||row.world_profile_id!==world||row.amount_usd!==maxUsd)fail('curation_budget_missing');
  if(row.state===state)return true;
  if(row.state!=='reserved')fail('curation_budget_state_conflict');
  db.prepare('UPDATE memory_budget_reservations SET state=? WHERE batch_key=?').run(state,batchKey);
  return true;
 });
}
