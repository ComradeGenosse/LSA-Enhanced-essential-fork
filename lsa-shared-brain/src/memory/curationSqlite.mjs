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
  // Source permission is current and avatar-independent, not inferred from the
  // proposal's historical protagonist. Do not queue already-revoked evidence.
  if(!sourceAuthorized(db,job,world,timeline))fail('curation_source_no_longer_authorized');
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

/**
 * Model outputs can never authorize their own evidence. Resolve the immutable
 * deterministic record AND every source in the current scoped journal at each
 * claim and completion boundary. Tombstones and corrections revoke eligibility.
 * M5's backwards/forwards derived suppression is applied transitively.
 */
function suppressedIds(db,world,timeline,characterId){
 const args=[world,characterId,timeline];
 const ids=new Set(db.prepare('SELECT target_id FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=?').all(...args).map(r=>r.target_id));
 for(const r of db.prepare('SELECT target_id FROM memory_corrections WHERE world_profile_id=? AND character_id=? AND timeline_id=?').all(...args))ids.add(r.target_id);
 const rows=db.prepare('SELECT memory_id,evidence_ids_json FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=?').all(...args);
 let changed=true;
 while(changed){changed=false;for(const row of rows){
   const linked=JSON.parse(row.evidence_ids_json);
   if(ids.has(row.memory_id)){for(const id of linked)if(!ids.has(id)){ids.add(id);changed=true;}}
   else if(linked.some(id=>ids.has(id))){ids.add(row.memory_id);changed=true;}
 }}
 return ids;
}
function sourceAuthorized(db,job,world,timeline){
 try{
  validateCurationJob(job);scoped(db,job,world,timeline);
  const memory=db.prepare("SELECT * FROM memory_records WHERE memory_id=? AND world_profile_id=? AND timeline_id=? AND character_id=? AND origin='deterministic'")
    .get(job.proposal.proposalId,world,timeline,job.characterId);
  if(!memory||memory.proposal_json!==JSON.stringify(job.proposal)||
     !['unknown','franklin','michael','trevor','multi_avatar'].includes(memory.protagonist_key))return false;
  const ids=job.proposal.evidenceRecordIds;
  if(ids.length>64||new Set(ids).size!==ids.length)return false;
  const suppressed=suppressedIds(db,world,timeline,job.characterId);
  if(suppressed.has(job.proposal.proposalId))return false;
  for(const id of ids){
   if(suppressed.has(id))return false;
   const dialogue=db.prepare('SELECT speaker,source,delivery,receipt_id AS receipt,protagonist FROM dialogue_journal WHERE record_id=? AND world_profile_id=? AND character_id=? AND timeline_id=?')
     .get(id,world,job.characterId,timeline);
   if(dialogue){
     const accepted=dialogue.speaker==='player'&&['typed','stt'].includes(dialogue.source)&&dialogue.delivery==='accepted';
     const played=dialogue.speaker==='npc'&&dialogue.source==='npc_generated'&&dialogue.delivery==='completed'&&isUuid(dialogue.receipt);
     if((!accepted&&!played))return false;
     continue;
   }
   const event=db.prepare('SELECT e.receipt_status AS status,e.source_hash AS hash,s.source_evidence_json AS sidecarJson FROM event_journal e JOIN event_source_evidence s ON s.record_id=e.record_id WHERE e.record_id=? AND e.world_profile_id=? AND e.character_id=? AND e.timeline_id=?')
     .get(id,world,job.characterId,timeline);
   if(!event||event.status!=='witnessed'||JSON.parse(event.sidecarJson)?.sourceHash!==event.hash)return false;
  }
  return true;
 }catch{return false;}
}
export function claimCuration(db,{limit,nowUtc,leaseUntilUtc,ownerId,characterId=null},world,timeline){
 if(!isUuid(ownerId)||(characterId!==null&&!isUuid(characterId))||!Number.isSafeInteger(limit)||limit<1||limit>4||
    !Number.isFinite(Date.parse(nowUtc))||!Number.isFinite(Date.parse(leaseUntilUtc))||
    Date.parse(leaseUntilUtc)<=Date.parse(nowUtc))fail('curation_invalid_claim');
 return tx(db,()=>{
  const rows=db.prepare(`SELECT q.* FROM memory_curation_jobs q JOIN promoted_profiles p ON p.character_id=q.character_id
    WHERE q.world_profile_id=? AND q.timeline_id=? AND (? IS NULL OR q.character_id=?) AND
    ((q.state='pending' AND q.next_attempt_at_utc<=?) OR
    (q.state='leased' AND q.lease_until_utc<=?))
    ORDER BY q.next_attempt_at_utc,q.job_id LIMIT ?`).all(world,timeline,characterId,characterId,nowUtc,nowUtc,Math.min(128,limit*16));
  const claimed=[];let oneCharacter=null;
  for(const row of rows){
   if(claimed.length>=limit)break;
   const job=JSON.parse(row.job_json);
   if(!sourceAuthorized(db,job,world,timeline)){
     db.prepare("UPDATE memory_curation_jobs SET state='dead_letter',lease_token=NULL,lease_until_utc=NULL,lease_owner=NULL WHERE job_id=?")
       .run(row.job_id);
     continue;
   }
   // Never transmit another NPC's memories in the same provider request.
   if(oneCharacter!==null&&row.character_id!==oneCharacter)continue;
   oneCharacter=row.character_id;
   const token=randomUUID();
   const info=db.prepare(`UPDATE memory_curation_jobs SET state='leased',lease_token=?,lease_until_utc=?,lease_owner=?
     WHERE job_id=? AND state IN ('pending','leased')`).run(token,leaseUntilUtc,ownerId,row.job_id);
   if(info.changes!==1)fail('curation_claim_race');
   claimed.push({job:{...job,state:'leased',attempt:row.attempt,lease:{leaseToken:token,leaseUntilUtc,ownerId}},leaseToken:token});
  }
  return claimed;
 });
}
function leased(db,jobId,leaseToken,world,timeline,{checkExpiry=false,nowUtc=new Date().toISOString()}={}){
 if(!isUuid(jobId)||!isUuid(leaseToken))fail('curation_invalid_lease');
 const row=db.prepare("SELECT * FROM memory_curation_jobs WHERE job_id=? AND world_profile_id=? AND timeline_id=? AND state='leased' AND lease_token=?")
   .get(jobId,world,timeline,leaseToken);
 if(!row)fail('curation_lease_not_current');
 if(checkExpiry&&row.lease_until_utc<=nowUtc)fail('curation_lease_expired');
 scoped(db,row,world,timeline);
 return row;
}
export function completeCuration(db,{jobId,leaseToken,proposal,nowUtc=new Date().toISOString()},world,timeline){
 return tx(db,()=>{
  const row=leased(db,jobId,leaseToken,world,timeline,{checkExpiry:true,nowUtc}),job=JSON.parse(row.job_json);
  if(!sourceAuthorized(db,job,world,timeline))fail('curation_source_no_longer_authorized');
  const approved=validateLunaAppraisal(proposal,job.proposal);
  if(job.jobId!==jobId||approved.proposalId!==job.proposal.proposalId)fail('curation_proposal_mismatch');
  // A forgotten source cannot be re-curated after its command was committed.
  for(const id of approved.evidenceRecordIds){
   if(db.prepare('SELECT target_id FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND target_id=?')
     .get(world,row.character_id,timeline,id))fail('curation_source_forgotten');
  }
  const old=db.prepare('SELECT appraisal_json FROM memory_luna_appraisals WHERE proposal_id=?').get(approved.proposalId);
  if(old&&old.appraisal_json!==JSON.stringify(approved))fail('curation_duplicate_appraisal');
  if(!old){
  db.prepare('INSERT INTO memory_luna_appraisals(proposal_id,world_profile_id,timeline_id,character_id,original_proposal_json,appraisal_json,completed_at_utc) VALUES(?,?,?,?,?,?,?)')
    .run(approved.proposalId,world,timeline,row.character_id,JSON.stringify(job.proposal),JSON.stringify(approved),nowUtc);
  }
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
  const row=leased(db,jobId,leaseToken,world,timeline);
  if(attempt!==row.attempt+1)fail('curation_retry_attempt_conflict');
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
export function finishCurationBudget(db,{batchKey,maxUsd,actualUsd},world,state){
 if(!['settled','released'].includes(state)||typeof batchKey!=='string'||!Number.isFinite(maxUsd))fail('curation_invalid_budget');
 return tx(db,()=>{
  const row=db.prepare('SELECT world_profile_id,state,amount_usd FROM memory_budget_reservations WHERE batch_key=?').get(batchKey);
  if(!row||row.world_profile_id!==world||row.amount_usd!==maxUsd)fail('curation_budget_missing');
  if(row.state===state)return true;
  if(row.state!=='reserved')fail('curation_budget_state_conflict');
  // Only a trusted usage/pricing projection may supply actualUsd. Missing or
  // uncertain usage is always charged at the full reserved ceiling.
  const amount=state==='released'?row.amount_usd:
    Number.isFinite(actualUsd)&&actualUsd>=0&&actualUsd<=maxUsd?actualUsd:maxUsd;
  db.prepare('UPDATE memory_budget_reservations SET state=?,amount_usd=? WHERE batch_key=?').run(state,amount,batchKey);
  return true;
 });
}

/** Crash recovery: unresolved budget reservations remain conservatively spent,
 * because transport may have reached the provider before the process died. */
export function reconcileCurationBudgets(db,{beforeUtc,worldProfileId}){
 if(!Number.isFinite(Date.parse(beforeUtc))||!isUuid(worldProfileId))fail('curation_invalid_reconcile');
 return tx(db,()=>db.prepare("UPDATE memory_budget_reservations SET state='settled' WHERE world_profile_id=? AND state='reserved' AND reserved_at_utc<?")
  .run(worldProfileId,beforeUtc).changes);
}

/** Read-only M8/Agent-H seam. Opinions never replace verified factual records,
 * and derived state becomes invisible immediately after source suppression. */
export function readCurationAppraisals(db,{characterId,timelineId,protagonistKey='unknown',limit=100},world){
 const scope={characterId,worldProfileId:world,timelineId};
 scoped(db,scope,world,timelineId);
 if(!['unknown','franklin','michael','trevor'].includes(protagonistKey)||
    !Number.isSafeInteger(limit)||limit<1||limit>500)fail('curation_invalid_read');
 const suppressed=suppressedIds(db,world,timelineId,characterId);
 // The requested limit counts VISIBLE source-authorized appraisals, not the
 // first N raw rows. A burst of forgotten/corrected newer rows must not hide
 // older valid friendship and running-joke memories after avatar switching.
 const page=db.prepare(`SELECT a.*,m.protagonist_key AS protagonist FROM memory_luna_appraisals a
  JOIN memory_records m ON m.memory_id=a.proposal_id AND m.world_profile_id=a.world_profile_id
   AND m.timeline_id=a.timeline_id AND m.character_id=a.character_id
  WHERE a.world_profile_id=? AND a.timeline_id=? AND a.character_id=?
   ORDER BY a.completed_at_utc DESC,a.proposal_id DESC LIMIT ? OFFSET ?`);
 const out=[];
 let offset=0;
 while(out.length<limit){
  const rows=page.all(world,timelineId,characterId,Math.min(128,limit),offset);
  if(!rows.length)break;
  offset+=rows.length;
  for(const row of rows){
  if(suppressed.has(row.proposal_id))continue;
  const original=JSON.parse(row.original_proposal_json),appraisal=JSON.parse(row.appraisal_json);
  if(original.proposalId!==row.proposal_id||appraisal.proposalId!==row.proposal_id||
     appraisal.evidenceRecordIds.some(id=>suppressed.has(id)))continue;
  // A privacy purge may physically remove sources without retaining a
  // tombstone. Never surface an old appraisal unless every source STILL exists.
  const job={version:1,jobId:row.proposal_id,proposal:original,
    characterId,worldProfileId:world,timelineId,state:'completed',
    attempt:0,nextAttemptAtUtc:row.completed_at_utc};
  if(!sourceAuthorized(db,job,world,timelineId))continue;
  try{validateLunaAppraisal(appraisal,original);}
  catch{continue;}
  out.push(Object.freeze({proposalId:row.proposal_id,characterId,worldProfileId:world,
    timelineId,protagonistKey:row.protagonist,sourceEvidenceIds:Object.freeze([...original.evidenceRecordIds]),
    factualSummary:original.groundedSummary,opinion:appraisal.inCharacterTake,
    category:appraisal.candidate,notability:appraisal.notability,epistemicStatus:'character_opinion',
    verifiedWorldFact:false,completedAtUtc:row.completed_at_utc}));
   if(out.length===limit)break;
  }
  if(rows.length<Math.min(128,limit))break;
 }
 return Object.freeze(out);
}
