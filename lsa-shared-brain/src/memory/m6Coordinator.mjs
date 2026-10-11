// M6 scene-close / idle / restart coordinator. No daemon and no cloud calls.
// Every accepted candidate comes back from the committed P2 journal and is
// saved by the existing timeline-serialized SQLite API before optional queueing.
import {isUuid,stableUuid,scopeOf,normalizedEvidence} from './evidence.mjs';
import {evaluateAutomaticMemoryBatch,selectAutomaticMemories} from './selection.mjs';
import {makeQueueJob} from './queueContract.mjs';

const PROTAGONISTS=Object.freeze(['unknown','franklin','michael','trevor']);
const fail=code=>{throw new Error(code);};
const safeClock=t=>typeof t==='string'&&Number.isFinite(Date.parse(t));
const sourceKey=row=>stableUuid('auto-memory-v1',row.characterId,row.worldProfileId,
  row.timelineId,[...row.envelope.sourceEvidenceIds].sort());
const isDeterministicMemory=row=>
  Array.isArray(row?.envelope?.sourceEvidenceIds)&&
  row.envelope.sourceEvidenceIds.length>0&&row.envelope.sourceEvidenceIds.length<=64&&
  row.envelope.sourceEvidenceIds.every(isUuid)&&row.recordId===sourceKey(row);

function requireStore(store){
  for(const key of ['readDialogueLines','readJournalEvents','readVerifiedEventEvidence',
    'readPermanentMemoryRows','listSuppressedMemoryIds','readCorrectionOverlays','saveDeterministicMemory']){
    if(typeof store?.[key]!=='function')throw new TypeError('m6_store_missing_'+key);
  }
  return store;
}
function checkBoundary(store,scope){
  scopeOf(scope);
  if(store.worldProfileId!==scope.worldProfileId)fail('m6_world_mismatch');
  if(store.activeTimelineId!==scope.timelineId||store.timelineWritable!==true)
    fail('m6_timeline_not_writable');
  if(typeof store.get==='function'&&!store.get(scope.characterId))
    fail('m6_character_not_promoted');
}
async function readCommitted(store,scope,maxRead){
  const args={characterId:scope.characterId,timelineId:scope.timelineId,limit:maxRead};
  const lines=await store.readDialogueLines(args),events=await store.readJournalEvents(args);
  // The v4 journal API offers bounded latest-N reads, but no archive cursor.
  // Never report successful full replay if older unchecked evidence may exist.
  if(!Array.isArray(lines)||!Array.isArray(events)||lines.length>=maxRead||events.length>=maxRead)
    fail('m6_journal_replay_window_exhausted');
  const raw=[...lines],rejected=[];
  for(const event of events){
    try{
      const proof=await store.readVerifiedEventEvidence({...args,recordId:event.recordId});
      if(!proof||proof.event?.recordId!==event.recordId||
         proof.event.sourceHash!==event.sourceHash||!proof.sourceEvidence)
        throw new Error('m6_verified_event_sidecar_missing');
      raw.push(proof.event);
    }catch(error){
      rejected.push(Object.freeze({recordId:event.recordId,
        reason:error instanceof Error?error.message:'m6_event_evidence_unavailable'}));
    }
  }
  const permanent=[];
  for(const protagonistKey of PROTAGONISTS){
    const part=await store.readPermanentMemoryRows({...scope,protagonistKey},{limit:1000});
    if(!Array.isArray(part)||part.length>=1000)fail('m6_permanent_replay_window_exhausted');
    permanent.push(...part);
  }
  const suppress=new Set(await store.listSuppressedMemoryIds({...scope,protagonistKey:'unknown'}));
  for(const protagonistKey of PROTAGONISTS){
    const corrections=await store.readCorrectionOverlays({...scope,protagonistKey});
    if(!Array.isArray(corrections))fail('m6_correction_scan_unavailable');
    for(const c of corrections)if(isUuid(c.targetId))suppress.add(c.targetId);
  }
  return {raw,rejected,permanent,suppress};
}
function qualifiedSources({raw,rejected,suppress},cutoffUtc){
  const accepted=[];
  const ids=new Map();
  for(const item of raw){
    if(suppress.has(item?.recordId))continue;
    try{
      const record=normalizedEvidence(item);
      if(Date.parse(record.when)>Date.parse(cutoffUtc))continue;
      const previous=ids.get(record.recordId);
      if(previous){
        if(JSON.stringify(previous)!==JSON.stringify(record))fail('m6_conflicting_committed_record');
        continue;
      }
      ids.set(record.recordId,record);
      accepted.push(item);
    }catch(error){
      if(error?.message==='m6_conflicting_committed_record')throw error;
      rejected.push(Object.freeze({recordId:isUuid(item?.recordId)?item.recordId:null,
        reason:error instanceof Error?error.message:'m6_source_rejected'}));
    }
  }
  return accepted;
}
/**
 * createM6SelectionCoordinator({store,now,quietMs,maxRead,cloudQueueEnabled})
 *
 * Agent H calls onSceneClose({scope,atUtc}) AFTER the scene's last M2/M3
 * journal commit; onIdle({scope,atUtc}) at a safe non-dialogue checkpoint;
 * recover({scope,atUtc}) after P2 initialization, native epoch verification
 * and explicit timeline confirmation. Calls are safe to repeat. The scope
 * must be supplied by the trusted P2 promoted owner binder, NOT from a model.
 *
 * No raw event/utterance payload is accepted here. Enabling cloudQueueEnabled
 * only enqueues jobs and never starts Luna or reserves user spend.
 */
export function createM6SelectionCoordinator({store,now=()=>new Date().toISOString(),
  quietMs=90_000,maxRead=1000,cloudQueueEnabled=false,
  softTargetPerHour=6,minScore=.56}={}){
  requireStore(store);
  if(typeof now!=='function'||!Number.isSafeInteger(quietMs)||quietMs<0||
    !Number.isSafeInteger(maxRead)||maxRead<1||maxRead>1000||
    typeof cloudQueueEnabled!=='boolean'||!Number.isSafeInteger(softTargetPerHour)||
    softTargetPerHour<1||!Number.isFinite(minScore)||minScore<0||minScore>1)
    throw new TypeError('m6_invalid_coordinator_options');
  if(cloudQueueEnabled&&typeof store.enqueueCurationJob!=='function')
    throw new TypeError('m6_durable_curation_queue_required');

  async function checkpoint({scope,atUtc=now(),phase='idle',activeHourCount=null}={}){
    if(!['scene_close','idle','recovery'].includes(phase)||!safeClock(atUtc)||
      activeHourCount!==null&&(!Number.isSafeInteger(activeHourCount)||activeHourCount<0))
      fail('m6_invalid_checkpoint');
    checkBoundary(store,scope);
    const cutoffUtc=new Date(Date.parse(atUtc)-(phase==='scene_close'?0:quietMs)).toISOString();
    const snapshot=await readCommitted(store,scope,maxRead);
    const eligible=qualifiedSources(snapshot,cutoffUtc);
    const existing=snapshot.permanent.filter(row=>isDeterministicMemory(row)&&
      !snapshot.suppress.has(row.recordId)&&
      !row.envelope.sourceEvidenceIds.some(id=>snapshot.suppress.has(id)));
    const consumed=new Set(existing.flatMap(row=>row.envelope.sourceEvidenceIds));
    const byId=new Map(eligible.map(row=>[row.recordId,row]));
    // Explicit memories are never counted as automatic and never change this
    // pressure. Co-present activity can be supplied by Agent H; otherwise
    // a rolling wall-hour is a safe heuristic, not a hard quota.
    const existingInHour=activeHourCount??existing.filter(row=>
      safeClock(row.atUtc)&&Date.parse(row.atUtc)>Date.parse(atUtc)-3_600_000&&
      Date.parse(row.atUtc)<=Date.parse(atUtc)).length;
    const toSelect=eligible.filter(row=>!consumed.has(row.recordId));
    const evaluated=evaluateAutomaticMemoryBatch(toSelect,
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
      // Retry queue insertion even for already-durable deterministic records.
      // If a crash occurred between save and enqueue, recovery reconstructs
      // the original proposal from its immutable evidence links.
      const queueProposals=[...evaluated.proposals];
      for(const row of existing){
        if(!row.envelope.sourceEvidenceIds.every(id=>byId.has(id))){
          fail('m6_queue_replay_evidence_unavailable');
        }
        const candidates=selectAutomaticMemories(
          row.envelope.sourceEvidenceIds.map(id=>byId.get(id)),{minScore:0});
        const original=candidates.find(p=>p.proposalId===row.recordId);
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
    return Object.freeze({status:snapshot.rejected.length?'partial_evidence':'complete',
      phase,cutoffUtc,readCount:snapshot.raw.length,
      qualifiedCount:eligible.length,candidateCount:evaluated.proposals.length,
      saved:Object.freeze(saved),queued,
      rejected:Object.freeze(snapshot.rejected)});
  }

  return Object.freeze({
    onSceneClose:args=>checkpoint({...args,phase:'scene_close'}),
    onIdle:args=>checkpoint({...args,phase:'idle'}),
    recover:args=>checkpoint({...args,phase:'recovery'}),
  });
}
