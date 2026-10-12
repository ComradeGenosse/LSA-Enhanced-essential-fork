// M6 deterministic permanent-memory lifecycle. No Luna/provider calls.
// All journals, checkpoints, memories, and optional M7 jobs belong to P2 SQLite.
import {isUuid,stableUuid,scopeOf,normalizedEvidence} from './evidence.mjs';
import {evaluateAutomaticMemoryBatch,selectAutomaticMemories} from './selection.mjs';
import {makeQueueJob} from './queueContract.mjs';
import {createM6CursorConsumer,requireM6CursorStore} from './m6CursorConsumer.mjs';

const PROTAGONISTS=Object.freeze(['unknown','franklin','michael','trevor']);
const fail=code=>{throw new Error(code);};
const safeClock=t=>typeof t==='string'&&Number.isFinite(Date.parse(t));
const sourceKey=row=>stableUuid('auto-memory-v1',row.characterId,row.worldProfileId,
  row.timelineId,[...row.envelope.sourceEvidenceIds].sort());
const isDeterministicMemory=row=>Array.isArray(row?.envelope?.sourceEvidenceIds)&&
  row.envelope.sourceEvidenceIds.length>0&&row.envelope.sourceEvidenceIds.length<=64&&
  row.envelope.sourceEvidenceIds.every(isUuid)&&row.recordId===sourceKey(row);
function requireStore(store,{allowLegacyBoundedReplay,cloudQueueEnabled}){
  for(const key of ['listSuppressedMemoryIds','readCorrectionOverlays','saveDeterministicMemory',
    'readVerifiedEventEvidence']){
    if(typeof store?.[key]!=='function')throw new TypeError('m6_store_missing_'+key);
  }
  if(cloudQueueEnabled&&typeof store.enqueueCurationJob!=='function')
    throw new TypeError('m6_durable_curation_queue_required');
  if(!allowLegacyBoundedReplay)requireM6CursorStore(store);
  else for(const key of ['readDialogueLines','readJournalEvents','readPermanentMemoryRows']){
    if(typeof store?.[key]!=='function')throw new TypeError('m6_legacy_store_missing_'+key);
  }
}
function checkBoundary(store,scope){
  scopeOf(scope);
  if(store.worldProfileId!==scope.worldProfileId)fail('m6_world_mismatch');
  if(store.activeTimelineId!==scope.timelineId||store.timelineWritable!==true)
    fail('m6_timeline_not_writable');
  if(typeof store.get==='function'&&!store.get(scope.characterId))
    fail('m6_character_not_promoted');
}
async function suppression(store,scope){
  const blocked=new Set(await store.listSuppressedMemoryIds({...scope,protagonistKey:'unknown'}));
  for(const protagonistKey of PROTAGONISTS){
    const corrections=await store.readCorrectionOverlays({...scope,protagonistKey});
    if(!Array.isArray(corrections))fail('m6_correction_scan_unavailable');
    for(const correction of corrections)
      if(isUuid(correction.targetId))blocked.add(correction.targetId);
  }
  return blocked;
}
function reason(error){return error instanceof Error?error.message:'m6_source_rejected';}
async function qualifyCommitted(store,scope,raw,blocked){
  const accepted=[],rejected=[],ids=new Map();
  for(const item of raw){
    if(blocked.has(item?.recordId)){
      rejected.push({recordId:item.recordId,reason:'m6_suppressed_source'});
      continue;
    }
    if(item?.kind==='replay_rejection'){
      rejected.push({recordId:isUuid(item.recordId)?item.recordId:null,
        reason:item.replayRejection??'m6_unavailable_source'});
      continue;
    }
    try{
      const normalized=normalizedEvidence(item);
      if(normalized.worldProfileId!==scope.worldProfileId||
         normalized.timelineId!==scope.timelineId||
         normalized.characterId!==scope.characterId)fail('m6_source_scope_mismatch');
      if(normalized.kind==='journal_event'){
        // A "reported" or unsupported PS2 event is rejected by normalizedEvidence
        // before a sidecar is ever read. Missing native proof must never be
        // inferred, accepted, or silently cursor-acknowledged.
        const sidecar=await store.readVerifiedEventEvidence({...scope,recordId:item.recordId});
        if(!sidecar||sidecar.event?.recordId!==item.recordId||
           sidecar.event?.sourceHash!==item.sourceHash||!sidecar.sourceEvidence)
          fail('m6_verified_event_sidecar_missing');
      }
      const old=ids.get(normalized.recordId);
      if(old){
        if(JSON.stringify(old)!==JSON.stringify(normalized))
          fail('m6_conflicting_committed_record');
        continue;
      }
      ids.set(normalized.recordId,normalized);
      accepted.push(item);
    }catch(error){
      if(['m6_verified_event_sidecar_missing','m6_source_scope_mismatch',
        'm6_conflicting_committed_record'].includes(error?.message))throw error;
      rejected.push({recordId:isUuid(item?.recordId)?item.recordId:null,reason:reason(error)});
    }
  }
  return {accepted,rejected};
}
// An explicit compatibility path exists ONLY for pinned pre-B SQLite tests.
// It never advances a cursor, refuses a full latest-N window, and cannot
// certify durable full-archive replay. Do not enable in production bootstrap.
async function legacySnapshot(store,scope,maxRead,cutoffUtc){
  const args={...scope,limit:maxRead};
  const lines=await store.readDialogueLines(args);
  const events=await store.readJournalEvents(args);
  if(!Array.isArray(lines)||!Array.isArray(events)||lines.length>=maxRead||
     events.length>=maxRead)fail('m6_journal_replay_window_exhausted');
  const raw=[...lines],rejected=[];
  for(const event of events){
    try{
      const sidecar=await store.readVerifiedEventEvidence({...scope,recordId:event.recordId});
      if(!sidecar||sidecar.event?.recordId!==event.recordId||
         sidecar.event?.sourceHash!==event.sourceHash||!sidecar.sourceEvidence)
        fail('m6_verified_event_sidecar_missing');
      raw.push(sidecar.event);
    }catch(error){rejected.push({recordId:event.recordId,reason:reason(error)});}
  }
  const permanent=[];
  for(const protagonistKey of PROTAGONISTS){
    const part=await store.readPermanentMemoryRows({...scope,protagonistKey},{limit:1000});
    if(!Array.isArray(part)||part.length>=1000)fail('m6_permanent_replay_window_exhausted');
    permanent.push(...part);
  }
  const blocked=await suppression(store,scope);
  const {accepted,rejected:bad}=await qualifyCommitted(store,scope,raw,blocked);
  rejected.push(...bad);
  return {raw,eligible:accepted.filter(x=>Date.parse(
      x.kind==='journal_event'?x.receivedAtUtc:x.committedAtUtc)<=Date.parse(cutoffUtc)),
    rejected,blocked,permanent};
}
/**
 * Production: requires B's P2 readM6Checkpoint/readM6JournalPage/ackM6Checkpoint.
 * These are serialized, source-hashed and timeline-gated by P2. Page reads do
 * not commit. Save, optional queue enqueue, then cursor CAS ack; a crash
 * anywhere earlier replays exactly the same evidence and selection pressure.
 *
 * Only K wires onSceneClose/onIdle/recover AFTER trusted owner/source admission
 * and journal commits. None of these hooks may run on the native player fiber.
 */
export function createM6SelectionCoordinator({store,now=()=>new Date().toISOString(),
  quietMs=90_000,pageSize=250,maxRows=8192,maxPages=64,maxRead=1000,
  allowLegacyBoundedReplay=false,cloudQueueEnabled=false,
  softTargetPerHour=6,minScore=.56}={}){
  requireStore(store,{allowLegacyBoundedReplay,cloudQueueEnabled});
  if(typeof now!=='function'||!Number.isSafeInteger(quietMs)||quietMs<0||
    !Number.isSafeInteger(maxRead)||maxRead<1||maxRead>1000||
    typeof cloudQueueEnabled!=='boolean'||!Number.isSafeInteger(softTargetPerHour)||
    softTargetPerHour<1||!Number.isFinite(minScore)||minScore<0||minScore>1)
    throw new TypeError('m6_invalid_coordinator_options');
  const consumer=allowLegacyBoundedReplay?null:createM6CursorConsumer({
    store,pageSize,maxRows,maxPages});
  const inflight=new Map();
  async function checkpoint({scope,atUtc=now(),phase='idle',activeHourCount=null}={}){
    if(!['scene_close','idle','recovery'].includes(phase)||!safeClock(atUtc)||
       activeHourCount!==null&&(!Number.isSafeInteger(activeHourCount)||activeHourCount<0))
      fail('m6_invalid_checkpoint');
    checkBoundary(store,scope);
    const cutoffUtc=new Date(Date.parse(atUtc)-(phase==='scene_close'?0:quietMs)).toISOString();
    if(consumer){
      const scan=await consumer.readBatch({scope,cutoffUtc});
      checkBoundary(store,scope);
      const blocked=await suppression(store,scope);
      const qualified=await qualifyCommitted(store,scope,scan.rows,blocked);
      const rejected=[...qualified.rejected];
      // Checkpointed count is fixed until CAS ack. Never derive this from
      // records saved in this unacknowledged batch: crash replay must yield
      // identical proposal IDs even if some writes already committed.
      const hourBucket=cutoffUtc.slice(0,13); // UTC hour is the fallback; K may use co-present active-hour IDs in P2.
      const existingInHour=scan.checkpoint.hourBucket===hourBucket?
        scan.checkpoint.activeHourCount:0;
      const evaluated=evaluateAutomaticMemoryBatch(qualified.accepted,{
        existingInHour,softTargetPerHour,minScore});
      rejected.push(...evaluated.rejected);
      const saved=[],savedIds=[];
      let queued=0;
      for(const proposal of evaluated.proposals){
        checkBoundary(store,scope);
        // Privacy can change while selecting; reread before each write.
        const latest=await suppression(store,scope);
        if(proposal.evidenceRecordIds.some(id=>latest.has(id))){
          rejected.push({recordId:proposal.proposalId,reason:'m6_source_changed_before_save'});
          continue;
        }
        const receipt=await store.saveDeterministicMemory(proposal);
        if(!receipt||receipt.recordId!==proposal.proposalId||typeof receipt.inserted!=='boolean')
          fail('m6_durable_save_unconfirmed');
        saved.push(Object.freeze({proposalId:proposal.proposalId,inserted:receipt.inserted,
          evidenceRecordIds:proposal.evidenceRecordIds}));
        savedIds.push(proposal.proposalId);
        if(cloudQueueEnabled){
          checkBoundary(store,scope);
          const beforeQueue=await suppression(store,scope);
          if(proposal.evidenceRecordIds.some(id=>beforeQueue.has(id)))
            fail('m6_source_changed_before_queue');
          const job=makeQueueJob(proposal,atUtc);
          const ack=await store.enqueueCurationJob({job});
          if(!ack||ack.jobId!==job.jobId||typeof ack.inserted!=='boolean')
            fail('m6_durable_enqueue_unconfirmed');
          if(ack.inserted)queued++;
        }
      }
      checkBoundary(store,scope);
      const finalBlocked=await suppression(store,scope);
      if(saved.some(r=>r.evidenceRecordIds.some(id=>finalBlocked.has(id))))
        fail('m6_source_changed_before_cursor_ack');
      let acknowledged=false;
      if(scan.toCursor!==scan.fromCursor){
        const ack=await store.ackM6Checkpoint({scope,expectedCursor:scan.fromCursor,
          nextCursor:scan.toCursor,sourceHashes:scan.sourceHashes,
          savedProposalIds:savedIds,rejected,cutoffUtc,hourBucket,
          lastSourceUtc:scan.lastSourceUtc??null,cloudQueueEnabled});
        if(ack?.committed!==true||ack.cursor!==scan.toCursor)
          fail('m6_durable_cursor_ack_unconfirmed');
        acknowledged=true;
      }
      return Object.freeze({status:rejected.length?'partial_evidence':'complete',
        phase,cutoffUtc,readCount:scan.rows.length,
        qualifiedCount:qualified.accepted.length,candidateCount:evaluated.proposals.length,
        saved:Object.freeze(saved),queued,rejected:Object.freeze(rejected),
        fromCursor:scan.fromCursor,toCursor:scan.toCursor,acknowledged,
        archiveComplete:scan.atEnd,blockedByQuiet:scan.blockedByQuiet});
    }
    const snapshot=await legacySnapshot(store,scope,maxRead,cutoffUtc);
    const existing=snapshot.permanent.filter(row=>isDeterministicMemory(row)&&
      !snapshot.blocked.has(row.recordId)&&
      !row.envelope.sourceEvidenceIds.some(id=>snapshot.blocked.has(id)));
    const consumed=new Set(existing.flatMap(row=>row.envelope.sourceEvidenceIds));
    const byId=new Map(snapshot.eligible.map(row=>[row.recordId,row]));
    const existingInHour=activeHourCount??existing.filter(row=>safeClock(row.atUtc)&&
      Date.parse(row.atUtc)>Date.parse(atUtc)-3600000&&Date.parse(row.atUtc)<=Date.parse(atUtc)).length;
    const evaluated=evaluateAutomaticMemoryBatch(
      snapshot.eligible.filter(row=>!consumed.has(row.recordId)),
      {existingInHour,softTargetPerHour,minScore});
    snapshot.rejected.push(...evaluated.rejected);
    const saved=[];
    for(const proposal of evaluated.proposals){
      checkBoundary(store,scope);
      const receipt=await store.saveDeterministicMemory(proposal);
      if(!receipt||receipt.recordId!==proposal.proposalId||typeof receipt.inserted!=='boolean')
        fail('m6_durable_save_unconfirmed');
      saved.push(Object.freeze({proposalId:proposal.proposalId,inserted:receipt.inserted,
        evidenceRecordIds:proposal.evidenceRecordIds}));
    }
    let queued=0;
    if(cloudQueueEnabled){
      const queueProposals=[...evaluated.proposals];
      for(const row of existing){
        if(!row.envelope.sourceEvidenceIds.every(id=>byId.has(id)))
          fail('m6_queue_replay_evidence_unavailable');
        const proposals=selectAutomaticMemories(row.envelope.sourceEvidenceIds.map(id=>byId.get(id)),
          {minScore:0});
        const original=proposals.find(p=>p.proposalId===row.recordId);
        if(!original)fail('m6_queue_proposal_reconstruction_failed');
        queueProposals.push(original);
      }
      for(const proposal of queueProposals){
        checkBoundary(store,scope);
        const job=makeQueueJob(proposal,atUtc);
        const ack=await store.enqueueCurationJob({job});
        if(!ack||ack.jobId!==job.jobId||typeof ack.inserted!=='boolean')
          fail('m6_durable_enqueue_unconfirmed');
        if(ack.inserted)queued++;
      }
    }
    return Object.freeze({status:snapshot.rejected.length?'partial_evidence':'legacy_bounded',
      phase,cutoffUtc,readCount:snapshot.raw.length,qualifiedCount:snapshot.eligible.length,
      candidateCount:evaluated.proposals.length,saved:Object.freeze(saved),queued,
      rejected:Object.freeze(snapshot.rejected),archiveComplete:false,acknowledged:false});
  }
  function schedule(args,phase){
    // Serialize checkpoint triggers for the same promoted source scope in this
    // runtime. B's P2 cursor CAS remains the cross-runtime authority.
    const scope=scopeOf(args?.scope),key=Object.values(scope).join(':');
    const previous=inflight.get(key)??Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>checkpoint({...args,phase}));
    inflight.set(key,next);
    void next.finally(()=>{if(inflight.get(key)===next)inflight.delete(key);}).catch(()=>{});
    return next;
  }
  return Object.freeze({
    onSceneClose:args=>schedule(args,'scene_close'),
    onIdle:args=>schedule(args,'idle'),
    recover:args=>schedule(args,'recovery'),
  });
}
