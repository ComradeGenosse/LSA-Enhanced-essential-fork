// WS-6 Agent A: P2-only, read-side M8 preparation for the single PS4 assembler.
// No SQLite connection, memory writer, model request, prompt, or callback is made here.
import {createHash} from 'node:crypto';
import {evaluateM8,preparePs4M8,verifyPs4M8Current} from '../../../lsa-shared-brain/src/memory/m8Interpretation.mjs';
import {normalizedEvidence,isUuid} from '../../../lsa-shared-brain/src/memory/evidence.mjs';
import {readVerifiedEventEvidence} from '../../../lsa-shared-brain/src/memory/journalSqlite.mjs';
import {readPermanentMemoryRows,listSuppressedMemoryIds} from '../../../lsa-shared-brain/src/memory/integratedSqlite.mjs';
import {supersededTargetIds} from '../../../lsa-shared-brain/src/memory/correctionSemantics.mjs';
import {readCurationAppraisals} from '../../../lsa-shared-brain/src/memory/curationSqlite.mjs';
import {readP2M8HistoricalSignals} from '../../../lsa-shared-brain/src/memory/m8SqliteHistory.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const uuid=x=>isUuid(x);
const same=(a,b)=>['characterId','worldProfileId','timelineId','protagonistKey'].every(k=>a?.[k]===b?.[k]);
const host=(a,b)=>!!a&&!!b&&a.hostRunId===b.hostRunId&&a.worldEpoch===b.worldEpoch;
const keys=s=>[s.worldProfileId,s.characterId,s.timelineId];
const stampKeys=['characterId','worldProfileId','timelineId','protagonistKey','hostRunId',
  'worldEpoch','incarnationId','encounterId','observerCaptureRef','turnIdentityHash','turnId'];
const currentStamp=(a,b)=>!!a&&!!b&&a.nativeVerified===true&&a.timelineWritable===true&&
  stampKeys.every(k=>a[k]===b[k]);
const validScope=s=>s&&['characterId','worldProfileId','timelineId'].every(k=>uuid(s[k]))&&
  ['franklin','michael','trevor'].includes(s.protagonistKey);
const proofError=()=>{throw Error('m8_p2_source_integrity_unavailable');};

// Read original persisted bytes, not a caller-asserted {sourceVerified:true}.
// In particular a failed/interrupted NPC utterance never becomes a source.
function committedDialogue(db,s,id){
 const d=db.prepare('SELECT * FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=?')
   .get(...keys(s),id);
 if(!d)return null;
 if(sha(d.envelope_json)!==d.envelope_sha256||sha(d.content)!==d.content_sha256)proofError();
 let e;try{e=JSON.parse(d.envelope_json);}catch{proofError();}
 if(e.version!==1||e.kind!=='dialogue_line'||e.recordId!==id||
    e.characterId!==s.characterId||e.worldProfileId!==s.worldProfileId||e.timelineId!==s.timelineId||
    e.content!==d.content||e.speaker!==d.speaker||e.source!==d.source||
    e.delivery!==d.delivery||e.turnIdentityHash!==d.turn_identity_hash||
    e.committedAtUtc!==d.committed_at_utc||e.deliveryReceiptId!==d.receipt_id||
    !uuid(d.session_id)||!uuid(d.host_run_id)||
    !Number.isSafeInteger(d.world_epoch)||d.world_epoch<0||
    !['franklin','michael','trevor','unknown'].includes(d.protagonist))proofError();
 const accepted=d.speaker==='player'&&d.delivery==='accepted'&&['typed','stt'].includes(d.source);
 const played=d.speaker==='npc'&&d.delivery==='completed'&&d.source==='npc_generated'&&
   uuid(d.receipt_id);
 if(!accepted&&!played)return null;
 const record={...e,attribution:{sessionId:d.session_id,protagonist:d.protagonist,
   hostRunId:d.host_run_id,worldEpoch:d.world_epoch}};
 try{normalizedEvidence(record);}catch{proofError();}
 return record;
}
function committedEvent(db,s,id){
 const e=db.prepare('SELECT receipt_status FROM event_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=?')
   .get(...keys(s),id);
 if(!e||e.receipt_status!=='witnessed')return null;
 // Requires the independently persisted native sidecar and its original hash.
 const receipt=readVerifiedEventEvidence(db,{characterId:s.characterId,timelineId:s.timelineId,recordId:id},s.worldProfileId);
 if(!receipt)proofError();
 try{normalizedEvidence(receipt.event);}catch{proofError();}
 const owner=db.prepare('SELECT owner_alias FROM promoted_profiles WHERE character_id=?').get(s.characterId)?.owner_alias;
 if(receipt.event.recordId!==id||!owner||receipt.event.ownerProof?.ownerAlias!==owner)proofError();
 return receipt.event;
}
function persistedSource(db,s,id){
 if(!uuid(id))return null;
 return committedDialogue(db,s,id)??committedEvent(db,s,id);
}

/** Synchronous, read-only operation. Must run INSIDE store.withP2SqliteRead.
 * The history scan is exhaustive; prompt projection is deliberately bounded.
 * Cross-avatar scope does not filter history by protagonist.
 */
export function readAuthorizedM8Snapshot(db,scope){
 if(!validScope(scope))throw Error('m8_invalid_p2_scope');
 const s=scope,revoked=new Set(listSuppressedMemoryIds(db,s,s.worldProfileId));
 const corrected=new Set(supersededTargetIds(db,keys(s)));
 for(const id of corrected)revoked.add(id);
 const history=readP2M8HistoricalSignals(db,s);
 const permanent=readPermanentMemoryRows(db,s,s.worldProfileId,{limit:32});
 const appraisals=readCurationAppraisals(db,{characterId:s.characterId,
   timelineId:s.timelineId,protagonistKey:s.protagonistKey,limit:32},s.worldProfileId);
 const result=new Map();
 const add=id=>{
  if(result.size>=128||revoked.has(id)||result.has(id))return;
  const record=persistedSource(db,s,id);
  if(record)result.set(id,{record,committed:true,sourceVerified:true,
    ...(record.kind==='journal_event'?{sidecarVerified:true}:{})});
 };
 // Source-linked deterministic memories/appraisals get first access to the
 // bounded evidence budget. A missing source disqualifies its memory entirely.
 for(const row of permanent)
   for(const id of row.envelope.sourceEvidenceIds) add(id);
 for(const row of appraisals)
   for(const id of row.sourceEvidenceIds) add(id);
 const recentLines=db.prepare('SELECT record_id FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? ORDER BY committed_at_utc DESC,record_id DESC LIMIT 128').all(...keys(s));
 const recentEvents=db.prepare("SELECT record_id FROM event_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND receipt_status='witnessed' ORDER BY received_at_utc DESC,record_id DESC LIMIT 128").all(...keys(s));
 for(const row of [...recentLines,...recentEvents])add(row.record_id);
 const memories=permanent.filter(row=>!revoked.has(row.recordId)&&
   row.envelope.sourceEvidenceIds.every(id=>result.has(id)))
   .map(row=>({committed:true,sourceVerified:true,characterId:s.characterId,
     worldProfileId:s.worldProfileId,timelineId:s.timelineId,memoryId:row.recordId,
     evidenceRecordIds:[...row.envelope.sourceEvidenceIds]}));
 const memoryIds=new Set(memories.map(row=>row.memoryId));
 const trustedAppraisals=appraisals.filter(row=>memoryIds.has(row.proposalId)&&
   row.sourceEvidenceIds.every(id=>result.has(id))&&
   !revoked.has(row.proposalId)&&row.sourceEvidenceIds.every(id=>!revoked.has(id)));
 const sources=[...result.values()].sort((a,b)=>a.record.recordId.localeCompare(b.record.recordId));
 const suppressedIds=[...revoked].sort(),correctedIds=[...corrected].sort();
 const snapshot={sources,memories,appraisals:trustedAppraisals,
   suppressedIds,correctedIds,relationshipHistory:history};
 // The seal binds ALL source bytes and durable historical rollups, not only
 // the few IDs the PS4 budget could display. Never expose this as source proof.
 return Object.freeze({...snapshot,seal:sha(JSON.stringify(snapshot))});
}

/** Factory for Agent C. originalCurrent must be the ORIGINAL D03/D02 authority
 * guard, never user-supplied or LLM-derived. No caller-supplied receipt booleans.
 * Prep and send/retry rechecks are separate asynchronous serialized P2 reads.
 */
// personalityFor maps the editor-approved P2 canon to the evaluator's structured
// inputs. It defaults to identity so the legacy WS-6 path is unchanged.
export function createP2M8ProductionReader({store,currentIdentity,originalCurrent,personalityFor=x=>x}={}){
 if(typeof store?.withP2SqliteRead!=='function'||typeof store?.get!=='function'||
    typeof currentIdentity!=='function'||typeof originalCurrent!=='function'||
    typeof personalityFor!=='function')
   throw new TypeError('m8_original_p2_ports_required');
 const issued=new WeakMap();
 const authorized=(scope,authority)=>{
  try{
   const i=currentIdentity(),p=store.get(scope.characterId);
   return validScope(scope)&&same(scope,authority)&&
     currentStamp(authority,i)&&originalCurrent()===true&&
     store.available===true&&store.timelineWritable===true&&
     store.timelineSourceStatus==='verified'&&store.activeTimelineId===scope.timelineId&&
     store.worldProfileId===scope.worldProfileId&&
     typeof p?.promotion?.ownerAlias==='string'&&
     /^promoted\.[0-9a-f-]{36}$/.test(p.promotion.ownerAlias)&&
     host(store.verifiedHostContext,authority);
  }catch{return false;}
 };
 async function snapshot(scope,authority){
  if(!authorized(scope,authority))return null;
  const data=await store.withP2SqliteRead(scope,db=>{
   if(!authorized(scope,authority))throw Error('m8_p2_stale_read');
   const rows=readAuthorizedM8Snapshot(db,scope);
   if(!authorized(scope,authority))throw Error('m8_p2_stale_read');
   return rows;
  });
  return authorized(scope,authority)?data:null;
 }
 return Object.freeze({
  async prepare({scope,authority,nowUtc=new Date().toISOString(),maxBytes=4096,
    deadlineMs=200}={}){
   if(!authorized(scope,authority))return Object.freeze({status:'dropped',reason:'unverified_original_owner',projection:null,stamp:null});
   let seal=null;
   const adapter={project:async args=>{
    const rows=await snapshot(args.scope,args.authority);
    if(!rows)return null;
    seal=rows.seal;
    // Only persistent P2 editor-approved personality is honored. Model-provided
    // personality and relationship guesses are never admitted as canon.
    const canon=personalityFor(store.get(scope.characterId)?.personality??{});
    return evaluateM8({...rows,scope,personality:canon,nowUtc:args.nowUtc,maxBytes:args.maxBytes});
   }};
   const prepared=await preparePs4M8({scope,authority,readAdapter:adapter,
     currentIdentity:()=>authorized(scope,authority)?currentIdentity():null,
     nowUtc,maxBytes,deadlineMs});
   if(prepared.status==='ready'&&seal&&authorized(scope,authority))
     issued.set(prepared.projection,Object.freeze({seal,scope:{...scope},stamp:prepared.stamp,authority:{...authority}}));
   else if(prepared.status==='ready')
     return Object.freeze({status:'dropped',reason:'stale_after_read',projection:null,stamp:null});
   return prepared;
  },
  // Call immediately before EVERY send/retry. A new forget/correction,
  // deletion, host renewal or intervening accepted source invalidates the
  // whole optional M8 frame. Failure must remove, never reuse, the projection.
  async verifyPrepared(prepared){
   const token=prepared?.projection&&issued.get(prepared.projection);
   if(prepared?.status!=='ready'||!token||!authorized(token.scope,token.authority))return false;
   try{
    const fresh=await store.withP2SqliteRead(token.scope,db=>{
     if(!authorized(token.scope,token.authority))throw Error('m8_p2_stale_verify');
     const now=readAuthorizedM8Snapshot(db,token.scope);
     const ids=[...(prepared.projection.interpretations??[]),
       ...(prepared.projection.jokes??[]),prepared.projection.relationship]
       .flatMap(x=>x?.sourceEvidenceIds??[]);
     const evidenceOk=ids.length>0&&ids.every(id=>!now.suppressedIds.includes(id)&&
       !!persistedSource(db,token.scope,id));
     return {seal:now.seal,evidenceOk};
    });
    return fresh.seal===token.seal&&fresh.evidenceOk===true&&
      authorized(token.scope,token.authority)&&
      verifyPs4M8Current(prepared,{currentIdentity:()=>authorized(token.scope,token.authority)?
        currentIdentity():null,validateEvidence:()=>fresh.evidenceOk});
   }catch{return false;}
  }
 });
}
