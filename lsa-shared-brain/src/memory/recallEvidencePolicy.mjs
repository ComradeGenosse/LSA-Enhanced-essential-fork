// WS-6a Agent B: source-fenced, READ-ONLY answer evidence policy.
// No prompt assembly, memory writes, inferred absence, or model authority.
import {createHash} from 'node:crypto';
import {suppressedMemoryIds} from './suppressionSqlite.mjs';
import {supersededTargetIds} from './correctionSemantics.mjs';
import {readVerifiedEventEvidence} from './journalSqlite.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/;
const AVATARS=new Set(['franklin','michael','trevor','unknown']);
const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
const bytes=x=>Buffer.byteLength(JSON.stringify(x),'utf8');
const utc=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&
  Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
const same=(a,b,keys)=>a&&b&&keys.every(k=>a[k]===b[k]);
const ownerKeys=['hostRunId','worldEpoch','ownerAlias','incarnationId','encounterId','observerCaptureRef'];
const limitedText=x=>typeof x==='string'&&x.length>0&&x.length<=12000&&x===x.toWellFormed();
const incomplete=(reason,best=null)=>Object.freeze({status:'incomplete',reason,exactCount:null,
  first:null,last:null,best,querySemantics:'literal_substring'});
const unavailable=(reason)=>Object.freeze({status:'unavailable',reason,evidenceIds:[]});
const negative=(status,reason)=>Object.freeze({status,reason,evidenceIds:[]});
// Ledger windows must cover every instant in the requested range, not merely
// exist, overlap, or carry an unverified `complete` flag.
function continuousClosedCoverage(windows,fromUtc,toUtc,source){
 if(!Array.isArray(windows)||windows.length===0)return false;
 const from=Date.parse(fromUtc),to=Date.parse(toUtc);
 let cursor=from;
 const ordered=[...windows].sort((a,b)=>Date.parse(a.startUtc)-Date.parse(b.startUtc));
 for(const w of ordered){
  if(!utc(w.startUtc)||!utc(w.endUtc)||w.startUtc>=w.endUtc)return false;
  const start=Date.parse(w.startUtc),end=Date.parse(w.endUtc);
  if(end<=from||start>=to)continue;
  if(w.status!=='closed'||w.hostRunId!==source.hostRunId||
     w.worldEpoch!==source.worldEpoch||start>cursor)return false;
  cursor=Math.max(cursor,end);
 }
 return cursor>=to;
}
function assertScope(scope){
  if(!scope||!['characterId','worldProfileId','timelineId'].every(k=>UUID.test(scope[k]))||
    !AVATARS.has(scope.protagonistKey))throw new TypeError('ws6_invalid_scope');
}
function assertRange(fromUtc,toUtc){
  if(!utc(fromUtc)||!utc(toUtc)||fromUtc>=toUtc)throw new TypeError('ws6_invalid_range');
}
function validSource(source){
  return source&&UUID.test(source.hostRunId)&&Number.isSafeInteger(source.worldEpoch)&&
    source.worldEpoch>=1&&typeof source.ownerAlias==='string'&&source.ownerAlias.length>0&&
    UUID.test(source.incarnationId)&&UUID.test(source.encounterId)&&
    UUID.test(source.observerCaptureRef);
}
function isQualifiedLine(row,scope,revoked){
  if(!row||revoked.has(row.recordId)||!UUID.test(row.recordId)||
     !HASH.test(row.rawHash)||!HASH.test(row.contentHash)||
     sha(row.raw)!==row.rawHash||sha(row.content)!==row.contentHash)return null;
  let e;
  try{e=JSON.parse(row.raw);}catch{return null;}
  if(e.version!==1||e.kind!=='dialogue_line'||e.recordId!==row.recordId||
    ['characterId','worldProfileId','timelineId'].some(k=>e[k]!==scope[k])||
    e.content!==row.content||e.speaker!==row.speaker||e.source!==row.source||
    e.delivery!==row.delivery||e.committedAtUtc!==row.atUtc||
    (e.attribution?.protagonist&&e.attribution.protagonist!==row.avatar)||!HASH.test(e.turnIdentityHash)||
    !UUID.test(row.sessionId)||!UUID.test(row.hostRunId)||
    !Number.isSafeInteger(row.worldEpoch)||row.worldEpoch<1||
    !['franklin','michael','trevor','unknown'].includes(row.avatar))return null;
  if(e.speaker==='player'&&e.delivery==='accepted'&&['typed','stt'].includes(e.source))
    return e;
  if(e.speaker==='npc'&&e.delivery==='completed'&&e.source==='npc_generated'&&UUID.test(e.deliveryReceiptId)&&e.deliveryReceiptId===row.receiptId)
    return e;
  return null;
}
function labelRow(row,scope){
  if(!row||row.evidenceState!=='verified'||row.forgotten===true||
    row.superseded===true||row.suppressed===true||!UUID.test(row.recordId)||
    !['characterId','worldProfileId','timelineId'].every(k=>row[k]===scope[k]&&row.envelope?.[k]===scope[k])||
    row.recordId!==row.envelope.recordId||
    row.envelope.version!==1||row.envelope.kind!==row.sourceKind||
    !utc(row.atUtc))return null;
  const e=row.envelope;
  let category,content,sourceEvidenceIds=[];
  if(row.sourceKind==='dialogue_line'){
    if(!limitedText(e.content)||!HASH.test(e.turnIdentityHash)||row.atUtc!==e.committedAtUtc||
       !AVATARS.has(row.protagonistKey??e.attribution?.protagonist)||
       e.attribution?.protagonist&&row.protagonistKey&&e.attribution.protagonist!==row.protagonistKey)return null;
    if(e.speaker==='player'&&e.delivery==='accepted'&&['typed','stt'].includes(e.source) ||
      e.speaker==='npc'&&e.delivery==='completed'&&e.source==='npc_generated'&&UUID.test(e.deliveryReceiptId)){
      category='exact_quote';content=e.content;
    }else return null;
  }else if(row.sourceKind==='journal_event'){
    if(!UUID.test(e.observationId)||!HASH.test(e.sourceHash)||e.receiptStatus!=='witnessed'||
       !Array.isArray(e.claims)||e.claims.length<1||e.claims.length>32||
       !e.claims.every(c=>UUID.test(c?.sourceEvidenceId)&&
         ['self','visual','auditory','report'].includes(c.modality)&&
         ['direct','reported','inferred','unknown'].includes(c.certainty)&&
         typeof c.kind==='string'&&typeof c.durableSubject==='string'))return null;
    sourceEvidenceIds=e.claims.map(c=>c.sourceEvidenceId);
    category=e.claims.every(c=>c.certainty==='direct'&&['self','visual','auditory'].includes(c.modality))
      ?'directly_observed_fact':'reported_claim';
    content=String(e.eventType)+': '+e.claims.map(c=>c.kind+' '+c.durableSubject+' ('+c.modality+'/'+c.certainty+')').join('; ');
  }else if(row.sourceKind==='permanent_memory'||row.sourceKind==='canon'){
    if(!limitedText(e.content)||!['observed_fact','reported_claim','opinion'].includes(e.mode)||
       !Array.isArray(e.sourceEvidenceIds)||e.sourceEvidenceIds.length<1||
       !e.sourceEvidenceIds.every(x=>UUID.test(x)))return null;
    sourceEvidenceIds=e.sourceEvidenceIds;
    // A derived observation is labelled archival, NOT first-hand fresh witness.
    category=e.mode==='opinion'?'character_opinion':
      e.mode==='reported_claim'?'reported_claim':'archived_memory';
    content=e.content;
  }else return null;
  if(!limitedText(content)||[...content].length>3072)return null; // never truncate a quote
  return Object.freeze({recordId:row.recordId,sourceKind:row.sourceKind,
    category,content,atUtc:row.atUtc,
    sourceAvatar:row.sourceKind==='journal_event'?'unknown':row.protagonistKey??e.attribution?.protagonist??'unknown',
    sourceEvidenceIds});
}
/**
 * Trusted inputs:
 *  - store: original P2SqliteProfileStore, including its serialized withP2SqliteRead.
 *  - isCurrent: D03's original accepted-source / live D02 lease verification.
 *  - verifyNativeNegative: independent authenticated native verifier; MUST
 *    certify this exact observation, requested interval, and historical owner.
 *    Never implement this by reading nativeVerified/certified booleans from DB.
 * If no such verifier exists, all negative conclusions remain unknown.
 */
export function createRecallEvidencePolicy({store,isCurrent,verifyNativeNegative=null}={}){
  if(!store||typeof isCurrent!=='function')throw new TypeError('ws6_source_required');
  const authorized=(scope,source)=>{
    try{
      const host=store.verifiedHostContext;
      return isCurrent()===true&&store.timelineWritable===true&&
        store.worldProfileId===scope.worldProfileId&&store.activeTimelineId===scope.timelineId&&
        validSource(source)&&same(host,source,['hostRunId','worldEpoch'])&&
        store.get?.(scope.characterId)?.promotion?.ownerAlias===source.ownerAlias;
    }catch{return false;} // closed P2, invalidated native lease, or D03 verifier fault
  };
  const readWithFence=async(scope,source,work)=>{
    if(!authorized(scope,source))return {ok:false};
    try{
      const data=await work();
      return authorized(scope,source)?{ok:true,data}:{ok:false};
    }catch{return {ok:false};}
  };
  async function witness({scope,source,fromUtc,toUtc,observationId,eventRecordId=null}={}){
    assertScope(scope);assertRange(fromUtc,toUtc);
    if(!UUID.test(observationId)||eventRecordId!==null&&!UUID.test(eventRecordId))
      throw new TypeError('ws6_invalid_observation');
    if(!authorized(scope,source))return unavailable('source_revoked');
    if(eventRecordId&&typeof store.readVerifiedEventEvidence==='function'){
      const eventRead=await readWithFence(scope,source,()=>store.readVerifiedEventEvidence({
        characterId:scope.characterId,timelineId:scope.timelineId,recordId:eventRecordId}));
      if(!eventRead.ok)return unavailable('source_revoked_or_read_failed');
      const {event,sourceEvidence}=eventRead.data??{};
      if(event?.recordId===eventRecordId&&event?.observationId===observationId&&
         event?.characterId===scope.characterId&&event.worldProfileId===scope.worldProfileId&&
         event.timelineId===scope.timelineId&&event.receiptStatus==='witnessed'&&
         event.receivedAtUtc>=fromUtc&&event.receivedAtUtc<toUtc&&
         event.sourceHash===sourceEvidence?.sourceHash&&
         sourceEvidence?.observation?.observationId===observationId&&
         same(event.ownerProof,sourceEvidence?.ownerProof,ownerKeys)){
        return Object.freeze({status:'witnessed',reason:'authenticated_event_sidecar',
          evidenceIds:[eventRecordId],sourceAvatar:'unknown'});
      }
      // Missing, wrong-scope or non-witness event can never prove absence.
    }
    if(typeof store.readM3Coverage!=='function'||typeof store.readObserverCoverage!=='function')
      return unavailable('coverage_reader_unavailable');
    const [recordRead,ledgerRead]=await Promise.all([
      readWithFence(scope,source,()=>store.readM3Coverage({...scope,observationId})),
      readWithFence(scope,source,()=>store.readObserverCoverage({...scope,fromUtc,toUtc}))
    ]);
    if(!recordRead.ok||!ledgerRead.ok)return unavailable('source_revoked_or_read_failed');
    const receipt=recordRead.data,ledger=ledgerRead.data,r=receipt?.record,c=r?.nativeCoverage;
    if(!receipt?.evidencePresent||receipt.status!=='did_not_witness'||receipt.certified!==true||
       r?.observationId!==observationId||r.characterId!==scope.characterId||
       r.worldProfileId!==scope.worldProfileId||r.timelineId!==scope.timelineId||
       !c||c.certified!==true||c.nativeVerified!==true||c.status!=='did_not_witness'||
       c.observationId!==observationId||!UUID.test(c.sourceReceiptId)||
       !same(c,r.ownerProof,['ownerAlias','incarnationId','encounterId','observerCaptureRef','hostRunId','worldEpoch'])||
       !same(c,source,ownerKeys)||
       c.adapterEpoch!==r.adapterEpoch)return negative('unknown','no_independent_negative_proof');
    // Windows only describe sampling. They NEVER turn missing rows into a negative.
    // Even an otherwise continuous ledger requires the native *event-specific* proof.
    if(ledger?.complete!==true||ledger.characterId!==scope.characterId||
       ledger.worldProfileId!==scope.worldProfileId||ledger.timelineId!==scope.timelineId||
       ledger.requested?.fromUtc!==fromUtc||ledger.requested?.toUtc!==toUtc||
       !Array.isArray(ledger.gaps)||ledger.gaps.length>0||
       !continuousClosedCoverage(ledger.windows,fromUtc,toUtc,c))
      return negative('unknown','partial_or_changed_observer_coverage');
    if(typeof verifyNativeNegative!=='function')
      return negative('unknown','native_negative_verifier_unavailable');
    let certified=false;
    try{
      certified=await verifyNativeNegative({scope,source,observationId,fromUtc,toUtc,
        nativeCoverage:c,ownerProof:r.ownerProof,coverage:ledger})===true;
    }catch{}
    if(!authorized(scope,source))return unavailable('source_revoked');
    if(!certified)return negative('unknown','native_interval_negative_not_verified');
    return Object.freeze({status:'did_not_witness',reason:'independent_native_interval_certificate',
      evidenceIds:[c.sourceReceiptId],channel:c.channel,basis:c.basis});
  }
  /**
   * Exact count is intentionally limited to a deterministic literal predicate
   * on authenticated M2 dialogue. Semantic similarity and all-source/event
   * counts have NO exhaustive query today. Do not call a 384-row M4 page exact.
   */
  async function countDialogue({scope,source,predicate={},excludeRecordIds=[],maxScan=20000,maxBytes=4096}={}){
    assertScope(scope);
    if(!Array.isArray(excludeRecordIds)||excludeRecordIds.length>1||
       !excludeRecordIds.every(x=>UUID.test(x)))throw new TypeError('ws6_invalid_exclusion');
    if(!Number.isSafeInteger(maxScan)||maxScan<1||maxScan>20000||
       !Number.isSafeInteger(maxBytes)||maxBytes<512||maxBytes>8192)
      throw new TypeError('ws6_invalid_scan_or_output_budget');
    if(!predicate||typeof predicate!=='object'||Array.isArray(predicate)||
       Object.keys(predicate).some(key=>!['speaker','containsText','fromUtc','toUtc'].includes(key)))
      return incomplete('unsupported_predicate');
    const {speaker=null,containsText='',fromUtc=null,toUtc=null}=predicate;
    if(speaker!==null&&!['player','npc'].includes(speaker)||
       typeof containsText!=='string'||containsText.length>512||
       fromUtc!==null&&!utc(fromUtc)||toUtc!==null&&!utc(toUtc)||
       fromUtc&&toUtc&&fromUtc>=toUtc)return incomplete('unsupported_predicate');
    if(!authorized(scope,source))return incomplete('source_revoked');
    if(typeof store.withP2SqliteRead!=='function')
      return incomplete('exhaustive_p2_read_unavailable');
    const outcome=await readWithFence(scope,source,()=>store.withP2SqliteRead(scope,db=>{
      const keys=[scope.worldProfileId,scope.characterId,scope.timelineId];
      const revoked=new Set([...suppressedMemoryIds(db,scope),...supersededTargetIds(db,keys)]);
      let where='world_profile_id=? AND character_id=? AND timeline_id=?',args=[...keys];
      if(speaker){where+=' AND speaker=?';args.push(speaker);}
      if(fromUtc){where+=' AND committed_at_utc>=?';args.push(fromUtc);}
      if(toUtc){where+=' AND committed_at_utc<?';args.push(toUtc);}
      // Scan *all* relevant rows including rejected ones. Never infer that a
      // limit-selected prefix is complete. Existing SQL/P2 connection only.
      const sql='SELECT record_id AS recordId,content,content_sha256 AS contentHash,'+
        'envelope_json AS raw,envelope_sha256 AS rawHash,speaker,source,delivery,'+
        'protagonist AS avatar,session_id AS sessionId,host_run_id AS hostRunId,world_epoch AS worldEpoch,'+
        'receipt_id AS receiptId,committed_at_utc AS atUtc FROM dialogue_journal WHERE '+where+
        ' ORDER BY committed_at_utc ASC,record_id ASC';
      let scanned=0,matched=0,first=null,last=null,best=null;
      const needle=containsText.toLocaleLowerCase('en-US');
      for(const row of db.prepare(sql).iterate(...args)){
        if(++scanned>maxScan)return incomplete('scan_limit',best);
        // Corrupt source rows cannot be silently omitted from an exact total.
        if(!HASH.test(row.contentHash)||!HASH.test(row.rawHash)||
          sha(row.content)!==row.contentHash||sha(row.raw)!==row.rawHash)
          return incomplete('source_integrity_failure',best);
        if(revoked.has(row.recordId)||excludeRecordIds.includes(row.recordId))continue;
        const evidence=isQualifiedLine(row,scope,revoked);
        if(!evidence){
          // Invalid status is non-evidence, but a malformed accepted/delivered
          // envelope requires abstention, not a misleading exact number.
          if(row.delivery==='accepted'||row.delivery==='completed')
            return incomplete('source_integrity_failure',best);
          continue;
        }
        if(needle&&!row.content.toLocaleLowerCase('en-US').includes(needle))continue;
        const ref={recordId:row.recordId,sourceAvatar:row.avatar,
          atUtc:row.atUtc,sourceKind:'dialogue_line'};
        ++matched;
        if(!first)first=ref;
        last=ref;
        // Byte-exact quote or explicit omission. Never silently shorten speech.
        best={...ref,category:'exact_quote',
          ...(row.content.length<=3072?{content:row.content}:{quoteOmitted:true})};
      }
      const summary={status:'complete',reason:'exhaustive_authenticated_p2_dialogue',
        exactCount:matched,first,last,best,scanned,
        querySemantics:'literal_substring',scope:{characterId:scope.characterId,
          worldProfileId:scope.worldProfileId,timelineId:scope.timelineId}};
      if(bytes(summary)>maxBytes&&best)summary.best={...last,quoteOmitted:true};
      if(bytes(summary)>maxBytes)return incomplete('output_budget');
      return Object.freeze(summary);
    }));
    return outcome.ok?outcome.data:incomplete('source_revoked_or_read_failed');
  }
  /** Labels only P2-authenticated integrated projection rows, within PS4 budget. */
  async function labelledEvidence({scope,source,sourceKind=null,terms=[],recordIds=null,maxBytes=4096}={}){
    assertScope(scope);
    if(recordIds!==null&&(!Array.isArray(recordIds)||recordIds.length>32||!recordIds.every(x=>UUID.test(x))))
      throw new TypeError('ws6_invalid_label_ids');
    if(!Number.isSafeInteger(maxBytes)||maxBytes<256||maxBytes>8192)
      throw new TypeError('ws6_invalid_label_budget');
    if(!authorized(scope,source))return unavailable('source_revoked');
    if(typeof store.readIntegratedRecall!=='function')return unavailable('p2_recall_unavailable');
    const read=await readWithFence(scope,source,()=>store.readIntegratedRecall({
      scope,sourceKind,terms,limit:384}));
    if(!read.ok||!Array.isArray(read.data?.rows)||read.data.rows.length>384)
      return unavailable('source_revoked_or_read_failed');
    const out=[],refs=[];let dropped=0;
    for(const row of read.data.rows){
      if(recordIds!==null&&!recordIds.includes(row.recordId))continue;
      const item=labelRow(row,scope);
      if(!item){dropped++;continue;}
      if(out.some(x=>x.recordId===item.recordId)){dropped++;continue;}
      if(bytes({items:[...out,item],references:[...refs,item.recordId],dropped})>maxBytes){
        dropped++;continue;
      }
      out.push(item);refs.push(item.recordId);
      if(out.length>=12)break;
    }
    if(!authorized(scope,source))return unavailable('source_revoked');
    return Object.freeze({status:out.length?'matched':'unknown',items:out,references:refs,dropped,
      completeness:'bounded_candidate_page',exactCount:null,sourceKind});
  }
  /**
   * Lightweight pre-send/retry revocation gate for projected source IDs.
   * This verifies VISIBILITY, not the freshness of an exact count: an exact
   * count must be re-executed before a later model send/retry.
   */
  async function verifyReferenceVisibility({scope,source,recordIds}={}){
    assertScope(scope);
    if(!Array.isArray(recordIds)||recordIds.length>32||
      !recordIds.every(x=>UUID.test(x))||new Set(recordIds).size!==recordIds.length)
      return false;
    if(!authorized(scope,source)||typeof store.withP2SqliteRead!=='function')return false;
    const read=await readWithFence(scope,source,()=>store.withP2SqliteRead(scope,db=>{
      const keys=[scope.worldProfileId,scope.characterId,scope.timelineId];
      const revoked=new Set([...suppressedMemoryIds(db,scope),...supersededTargetIds(db,keys)]);
      const dialogue=db.prepare('SELECT content,content_sha256 AS hash,envelope_json AS raw,envelope_sha256 AS rawHash FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=?');
      const event=db.prepare('SELECT receipt_status AS status FROM event_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=?');
      const memory=db.prepare('SELECT content,content_sha256 AS hash FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND memory_id=?');
      for(const id of recordIds){
        if(revoked.has(id))return false;
        const line=dialogue.get(...keys,id);
        if(line){
          if(sha(line.content)!==line.hash||sha(line.raw)!==line.rawHash)return false;
          continue;
        }
        const eventRow=event.get(...keys,id);
        if(eventRow){
          if(eventRow.status!=='witnessed')return false;
          const proof=readVerifiedEventEvidence(db,{characterId:scope.characterId,
            timelineId:scope.timelineId,recordId:id},scope.worldProfileId);
          if(!proof?.event||proof.event.recordId!==id||
             proof.event.characterId!==scope.characterId||
             proof.event.worldProfileId!==scope.worldProfileId||
             proof.event.timelineId!==scope.timelineId||
             proof.event.receiptStatus!=='witnessed')return false;
          continue;
        }
        const derived=memory.get(...keys,id);
        if(!derived||sha(derived.content)!==derived.hash)return false;
      }
      return true;
    }));
    return read.ok&&read.data===true;
  }
  return Object.freeze({witness,countDialogue,labelledEvidence,verifyReferenceVisibility});
}
