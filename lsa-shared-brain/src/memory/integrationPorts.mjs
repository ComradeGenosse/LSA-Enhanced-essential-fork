// PS5 integration ports; neither side owns game-native authority.
// Callers MUST supply a verified PS2/P2 owner binder and authenticated observer receipts.
import {WitnessedEventRecorder} from '../events/witnessedEventRecorder.mjs';
import {recallMemory} from './recallEngine.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const textToken=t=>typeof t==='string'&&/^[\p{L}\p{N}]{2,48}$/u.test(t);

/** Commit B's event + immutable evidence sidecar through A's one P2 SQLite writer. */
export function createM3JournalPorts(store){
  if(!store||typeof store.withTimelineWrite!=='function'||typeof store.appendJournalEvent!=='function')
    throw new TypeError('m3_shared_store_required');
  return Object.freeze({
    withTimelineWrite:(timelineId,commit)=>store.withTimelineWrite(timelineId,commit),
    journalPort:Object.freeze({
      append:({event,sourceEvidence},foundation)=>{
        const host=store.verifiedHostContext;
        if(!host || host.hostRunId!==event?.ownerProof?.hostRunId ||
           host.worldEpoch!==event.ownerProof.worldEpoch)
          throw new Error('m3_native_epoch_unconfirmed');
        if(!sourceEvidence||sourceEvidence.sourceHash!==event.sourceHash)
          throw new Error('m3_evidence_sidecar_required');
        // Foundation's append includes one synchronous SQLite transaction.
        const receipt=foundation.appendJournalEvent(event,{hostContext:host,sourceEvidence});
        if(!receipt||typeof receipt.inserted!=='boolean'||!uuid.test(receipt.recordId))
          throw new Error('m3_commit_unconfirmed');
        return Object.freeze({...(receipt.inserted?{inserted:true}:{duplicate:true}),
          ...(receipt.recordId!==event.recordId?{recordId:receipt.recordId}:{})});
      },
      recordCoverage:(record,foundation)=>{
        const host=store.verifiedHostContext;
        if(!host || host.hostRunId!==record?.ownerProof?.hostRunId ||
           host.worldEpoch!==record.ownerProof.worldEpoch ||
           record.worldProfileId!==store.worldProfileId ||
           record.timelineId!==store.activeTimelineId ||
           store.timelineWritable!==true ||
           store.get(record.characterId)?.promotion?.ownerAlias!==record.ownerProof.ownerAlias)
          throw new Error('m3_coverage_owner_or_epoch_unconfirmed');
        const receipt=foundation.appendM3Coverage(record);
        if(!receipt || !(receipt.inserted===true || receipt.duplicate===true))
          throw new Error('m3_coverage_commit_unconfirmed');
        return Object.freeze(receipt);
      },
      // Authenticated observer-coverage ledger. Re-checked INSIDE the writer
      // fence: an op for another host run, world epoch, timeline or a profile
      // that no longer owns the alias is reported stale instead of written.
      recordObserverCoverage:(ops,foundation)=>{
        const host=store.verifiedHostContext;
        if(!host||store.timelineWritable!==true)throw new Error('m3_coverage_owner_or_epoch_unconfirmed');
        const apply=[],indexes=[],staleIndexes=[];
        ops.forEach((op,index)=>{
          const r=op?.record;
          const current=op?.seal?op.seal.worldProfileId===store.worldProfileId:
            !!r&&r.hostRunId===host.hostRunId&&r.worldEpoch===host.worldEpoch&&
            r.worldProfileId===store.worldProfileId&&r.timelineId===store.activeTimelineId&&
            store.get(r.characterId)?.promotion?.ownerAlias===r.ownerProof?.ownerAlias;
          if(current){apply.push(op);indexes.push(index);}else staleIndexes.push(index);
        });
        if(apply.length===0)return Object.freeze({applied:0,staleIndexes});
        const receipt=foundation.appendObserverCoverage(apply);
        return Object.freeze({applied:apply.length,staleIndexes,receipt});
      },
    }),
  });
}
export function createM3WitnessRecorder({store,authorize,authorizeCoverage=null,now}={}){
  if(typeof authorize!=='function')throw new TypeError('m3_owner_binder_required');
  return new WitnessedEventRecorder({...createM3JournalPorts(store),authorize,authorizeCoverage,now});
}

/**
 * Production M4 adapter using A's committed journal APIs, no speculative m4_* tables.
 * Coverage is always conservative: no certified continuous event coverage currently exists.
 * Historical dialogue receives literal FTS5 phrase lookups beyond recent rows.
 */
export class SharedJournalRecallAdapter{
  constructor(store){
    if(!store||['readDialogueLines','readJournalEvents','searchDialogue','readVerifiedEventEvidence']
      .some(k=>typeof store[k]!=='function'))
      throw new TypeError('recall_shared_journal_required');
    this.store=store;
  }
  async read({scope,terms=[],fromUtc=null,toUtc=null,sourceKind=null,speaker=null,limit=384,
     expandDialogueContext=false,excludeRecordId=null}={}){
    if(!scope||!uuid.test(scope.characterId)||!uuid.test(scope.worldProfileId)||
       !uuid.test(scope.timelineId)||!['franklin','michael','trevor','unknown'].includes(scope.protagonistKey)||
       !Number.isSafeInteger(limit)||limit<1||limit>384)
      throw new TypeError('recall_invalid_scope');
    if(this.store.worldProfileId!==scope.worldProfileId)throw new Error('recall_world_mismatch');
    // Production P2 has a single source-qualified SQLite projection. Prefer
    // it over rebuilding recall from multiple independently paged journal
    // reads, which can otherwise admit an invalid derived source chain.
    // Retain journal fallback for older stores/tests without this capability.
    if(typeof this.store.readIntegratedRecall==='function')
      return this.store.readIntegratedRecall({scope,terms,fromUtc,toUtc,sourceKind,speaker,limit,
         expandDialogueContext,excludeRecordId});
    const wanted=sourceKind===null?['dialogue_line','journal_event','permanent_memory']:[sourceKind];
    const unique=new Map();
    const suppressed=new Set(typeof this.store.listSuppressedMemoryIds==='function'
      ?await this.store.listSuppressedMemoryIds(scope):[]);
    const corrections=typeof this.store.readCorrectionOverlays==='function'
      ?await this.store.readCorrectionOverlays(scope):[];
    const corrected=new Set(corrections.filter(row=>row.supersedesTarget!==false).map(row=>row.targetId));
    const include=(envelope,sourceKind,protagonistKey,atUtc)=>{
      if(suppressed.has(envelope?.recordId)||corrected.has(envelope?.recordId))return;
      if(!envelope||envelope.characterId!==scope.characterId||
         envelope.worldProfileId!==scope.worldProfileId||envelope.timelineId!==scope.timelineId||
         typeof atUtc!=='string'||
         (fromUtc&&atUtc<fromUtc)||(toUtc&&atUtc>=toUtc)||
         (speaker&&sourceKind==='dialogue_line'&&envelope.speaker!==speaker))return;
      unique.set(envelope.recordId,{characterId:scope.characterId,worldProfileId:scope.worldProfileId,
        timelineId:scope.timelineId,protagonistKey,sourceKind,recordId:envelope.recordId,
        atUtc,evidenceState:'verified',envelope});
    };
    if(wanted.includes('dialogue_line')){
      const q={characterId:scope.characterId,timelineId:scope.timelineId,limit};
      const recent=await this.store.readDialogueLines(q);
      for(const e of recent){
        if((e.speaker==='player'&&e.delivery==='accepted')||
           (e.speaker==='npc'&&e.delivery==='completed'&&uuid.test(e.deliveryReceiptId)))
          include(e,'dialogue_line',e.attribution?.protagonist,e.committedAtUtc);
      }
      const tokens=[...new Set(terms.filter(textToken))].slice(0,8);
      for(const token of tokens){
        const found=await this.store.searchDialogue({...q,query:token,limit:64});
        for(const e of found){
          if((e.speaker==='player'&&e.delivery==='accepted')||
             (e.speaker==='npc'&&e.delivery==='completed'&&uuid.test(e.deliveryReceiptId)))
            include(e,'dialogue_line',e.attribution?.protagonist,e.committedAtUtc);
        }
      }
    }
    if(wanted.includes('journal_event')){
      const events=await this.store.readJournalEvents({
        characterId:scope.characterId,timelineId:scope.timelineId,limit:Math.min(limit,1000)});
      for(const e of events){
        // M3 has no trusted controlling-protagonist field yet. Do not silently
        // assign a native event to Franklin/Michael/Trevor by proximity.
        // Historical events require proof, not an assumed controlling avatar.
        const evidence=await this.store.readVerifiedEventEvidence({
          characterId:scope.characterId,timelineId:scope.timelineId,recordId:e.recordId});
        if(!evidence||evidence.event.sourceHash!==e.sourceHash)continue;
        include(e,'journal_event','unknown',e.receivedAtUtc);
      }
    }
    if(wanted.includes('permanent_memory')&&typeof this.store.readPermanentMemoryRows==='function'){
      const memories=await this.store.readPermanentMemoryRows(scope,{limit:Math.min(limit,200)});
      for(const row of memories){
        if(suppressed.has(row.recordId)||row.envelope?.sourceEvidenceIds?.some(id=>suppressed.has(id))||
           (fromUtc&&row.atUtc<fromUtc)||(toUtc&&row.atUtc>=toUtc))continue;
        unique.set(row.recordId,row);
      }
    }
    if((wanted.includes('permanent_memory'))&&Array.isArray(corrections)){
      for(const row of corrections){
        if(suppressed.has(row.recordId)||suppressed.has(row.targetId)||
           (fromUtc&&row.atUtc<fromUtc)||(toUtc&&row.atUtc>=toUtc))continue;
        unique.set(row.recordId,row);
      }
    }
    const rows=[...unique.values()].sort((a,b)=>b.atUtc.localeCompare(a.atUtc)||a.recordId.localeCompare(b.recordId));
    return {rows:rows.slice(0,limit),coverageComplete:false};
  }
}
export function createP2IntegratedRecallAdapter(store){
  if(!store||typeof store.readIntegratedRecall!=='function')
    throw new TypeError('m4_integrated_p2_reader_required');
  return Object.freeze({read:args=>store.readIntegratedRecall(args)});
}
export async function recallFromSharedJournal({store,query,protagonistKey,nowUtc,followup}){
  return recallMemory({query,readAdapter:new SharedJournalRecallAdapter(store),protagonistKey,nowUtc,followup});
}

/**
 * Real M7 ports. Never schedule or enable Luna here: the host must explicitly
 * authorize cloud curation, set budget caps, and call worker only while idle.
 */
export function createDurableCurationAdapters(store,{dailyUsd,monthlyUsd}={}){
 const methods=['enqueueCurationJob','claimCurationDue','verifyCurationLease','completeCurationLease','retryCurationLease',
   'releaseCurationLease','reserveCurationBudget','finishCurationBudget'];
 if(!store||methods.some(k=>typeof store[k]!=='function')||
    !Number.isFinite(dailyUsd)||dailyUsd<=0||!Number.isFinite(monthlyUsd)||monthlyUsd<=0)
   throw new TypeError('curation_persistent_store_and_budget_required');
 const queue=Object.freeze({
   enqueueIfAbsent:args=>store.enqueueCurationJob(args),
   claimDue:args=>store.claimCurationDue(args),
   verifyLeased:args=>store.verifyCurationLease(args),
   completeLeased:args=>store.completeCurationLease(args),
   retryLeased:args=>store.retryCurationLease(args),
   releaseLeased:args=>store.releaseCurationLease(args)
 });
 const budget=Object.freeze({dailyUsd,monthlyUsd});
 const ledger=Object.freeze({
   reserve:args=>store.reserveCurationBudget(args,budget),
   settle:args=>store.finishCurationBudget(args,'settled'),
   release:args=>store.finishCurationBudget(args,'released')
 });
 return Object.freeze({queue,ledger});
}
