// Memory K H2: independently callable M4 factual-recall preparation.
//
// This is NOT a new memory engine. It composes the existing, unchanged pieces:
//   recallEngine (M4 query/ranking) -> P2 integrated SQLite read port ->
//   recallEvidencePolicy (G3/G4/G5 labels, counts, witness) -> PS4 `m4_recall`
//   contribution for the RECALLED lane.
// It adds no SQLite writer, authority mechanism, event bus, prompt writer,
// background worker or model request, and it never imports H1 conversation
// context, M5 commands, M6/M7 curation, M8 interpretation or PS3 salience.
//
// Authority is never accepted from the caller as data. It is proven by reading
// the accepted player line back out of the P2 journal (D03 durable receipt),
// by M2's openMemoryCurrent()/verifyMemoryCurrent() and by the D02 native
// source identity that M2 holds. See docs/plans/memory-k-h2-factual-recall-20261015.md.
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {recallMemory,toPs4RecallContribution} from '../../../lsa-shared-brain/src/memory/recallEngine.mjs';
import {createP2IntegratedRecallAdapter} from '../../../lsa-shared-brain/src/memory/integrationPorts.mjs';
import {createRecallEvidencePolicy} from '../../../lsa-shared-brain/src/memory/recallEvidencePolicy.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/;
const AVATARS=new Set(['franklin','michael','trevor','unknown']);
const PLAYER_SOURCES=new Set(['player_text','player_mic']);
export const H2_MAX_CONTRIBUTION_BYTES=4096;
export const H2_STATUSES=Object.freeze(['ready','abstained','unavailable','blocked','disabled']);

const matchesScope=(e,s)=>e.characterId===s.characterId&&
  e.worldProfileId===s.worldProfileId&&e.timelineId===s.timelineId;
const sameHost=(a,b)=>!!a&&!!b&&a.hostRunId===b.hostRunId&&a.worldEpoch===b.worldEpoch;
// The accepted line must be an authentic, durable, player-accepted M2 envelope.
const validAccepted=e=>e?.kind==='dialogue_line'&&UUID.test(e.recordId)&&
  typeof e.content==='string'&&e.content.length>0&&e.content.length<=12000&&
  Number.isFinite(Date.parse(e.committedAtUtc))&&e.speaker==='player'&&
  e.delivery==='accepted'&&['typed','stt'].includes(e.source);
const ms=n=>Math.round(n*1000)/1000;

function refuse(status,reason,timings=null){
  return Object.freeze({status,reason,preparedRecall:null,timings,
    recallCurrent:()=>false,verifyPrepared:async()=>false,sendCurrent:()=>false,
    revalidationMs:()=>null});
}

/**
 * Prepare bounded factual recall for ONE durably accepted player turn.
 *
 * @param store         the production P2 store (readDialogueLines,
 *                      readIntegratedRecall, listSuppressedMemoryIds,
 *                      withP2SqliteRead, verifiedHostContext, ...)
 * @param turn          the live turn; only turn.m2Capture and the character
 *                      projection are consulted, exactly like the combined path
 * @param acceptedReceipt  the D03 durable accepted-line receipt
 * @param input/source  the authentic accepted player text and its source
 * @param isCurrent     live turn-ownership predicate
 * @returns frozen {status, reason, preparedRecall, timings, recallCurrent,
 *   verifyPrepared, sendCurrent, revalidationMs}
 *   status: ready | abstained | unavailable | blocked  (disabled comes only from
 *   createFactualRecall). preparedRecall has the same shape as the combined path:
 *   {status:'ready',stamp,contribution,answerEvidence}; it is null unless the
 *   result is ready or abstained.
 */
export async function prepareFactualRecall({store,turn,acceptedReceipt,input,source,isCurrent,
  nowUtc=new Date().toISOString(),queryId=randomUUID(),
  maxContributionBytes=H2_MAX_CONTRIBUTION_BYTES}={}){
  const t0=performance.now();
  const timings={readbackMs:0,retrievalMs:0,evidenceMs:0,contributionMs:0,totalMs:0};
  const done=(r)=>{timings.totalMs=ms(performance.now()-t0);return r;};
  let currentNow=null;
  try{
    if(!PLAYER_SOURCES.has(source)||typeof input!=='string'||typeof isCurrent!=='function'||
       !store||typeof store.readDialogueLines!=='function'||
       typeof store.readIntegratedRecall!=='function'||
       typeof store.listSuppressedMemoryIds!=='function'||
       typeof store.withP2SqliteRead!=='function'||
       !['stored','duplicate'].includes(acceptedReceipt?.status)||
       acceptedReceipt?.durable!==true||!UUID.test(acceptedReceipt.recordId)||
       !AVATARS.has(acceptedReceipt.protagonistKey)||!UUID.test(queryId)||
       !Number.isSafeInteger(maxContributionBytes)||maxContributionBytes<512||
       maxContributionBytes>14336)
      return done(refuse('blocked','no_verified_memory_source',timings));
    const profile=turn?.characterProjection?.profile;
    const characterId=profile?.characterId;
    const scope={characterId,worldProfileId:store.worldProfileId,
      timelineId:store.activeTimelineId,protagonistKey:acceptedReceipt.protagonistKey};
    const host=store.verifiedHostContext;
    const alias=profile?.promotion?.ownerAlias;
    const current=()=>isCurrent()===true&&
      turn.characterProjection?.persistent===true&&
      turn.characterInputs?.profile?.characterId===characterId&&
      UUID.test(characterId)&&UUID.test(scope.worldProfileId)&&
      UUID.test(scope.timelineId)&&store.activeTimelineId===scope.timelineId&&
      store.timelineWritable===true&&sameHost(store.verifiedHostContext,host)&&
      store.get(characterId)?.promotion?.ownerAlias===alias&&
      turn.m2Capture?.verifyMemoryCurrent?.()===true;
    currentNow=current;
    // M2 accepted-line verification is mandatory. It is never bypassed.
    if(!alias||typeof turn.m2Capture?.openMemoryCurrent!=='function'||
       await turn.m2Capture.openMemoryCurrent()!==true||!current())
      return done(refuse('blocked','memory_source_not_current',timings));
    const authority=turn.m2Capture.memoryIdentity?.()??null;
    if(!authority)return done(refuse('blocked','no_source_identity',timings));
    const rows=await store.readDialogueLines({characterId,timelineId:scope.timelineId,limit:200});
    if(!current())return done(refuse('blocked','memory_source_revoked',timings));
    const line=rows.find(row=>row.recordId===acceptedReceipt.recordId);
    const expectedSource=source==='player_mic'?'stt':'typed';
    // Readback from the journal, never a line synthesized from client input.
    if(!line||!validAccepted(line)||line.source!==expectedSource||line.content!==input||
       !matchesScope(line,scope)||line.attribution?.protagonist!==scope.protagonistKey||
       !sameHost(line.attribution,host)||!UUID.test(line.attribution.sessionId)||
       !HASH.test(line.turnIdentityHash))
      return done(refuse('blocked','accepted_line_unverified',timings));

    timings.readbackMs=ms(performance.now()-t0);
    const hidden=async()=>{
      const ids=await store.listSuppressedMemoryIds(scope);
      if(!current())throw Error('memory_source_revoked');
      const corrections=await store.readCorrectionOverlays?.(scope)??[];
      if(!current())throw Error('memory_source_revoked');
      return new Set([...ids,...corrections.filter(x=>x.supersedesTarget!==false).map(x=>x.targetId)]);
    };
    const query={version:1,kind:'recall_query',queryId,characterId,
      worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
      turnIdentityHash:line.turnIdentityHash,question:input,
      intent:/\b(quote|exact words|word for word)\b/i.test(input)?'exact_quote':'open_recall',
      maxBytes:4096};
    const sourceReader=createP2IntegratedRecallAdapter(store);
    // One read path for first preparation and revalidation. The current accepted
    // line is excluded so a question never retrieves itself as history.
    const runRecall=async()=>{
      let readArgs=null,failed=false;
      const {bundle}=await recallMemory({query,readAdapter:{read:async args=>{
        readArgs=args;
        try{
          const result=await sourceReader.read(args);
          return {...result,rows:result.rows.filter(r=>r.recordId!==line.recordId)};
        }catch(error){failed=true;throw error;}
      }},protagonistKey:scope.protagonistKey,nowUtc});
      return {bundle,readArgs,failed};
    };
    const tRead=performance.now();
    const first=await runRecall();
    timings.retrievalMs=ms(performance.now()-tRead);
    if(!current())return done(refuse('blocked','memory_source_revoked',timings));
    if(first.failed)return done(refuse('unavailable','source_read_failed',timings));
    const tContribution=performance.now();
    const baseContribution=toPs4RecallContribution(first.bundle,{maxBytes:maxContributionBytes});
    const baseSeal=JSON.stringify(baseContribution);
    timings.contributionMs=ms(performance.now()-tContribution);

    // Evidence/provenance: G3 labels, G3 counts, G4/G5 witness, all fenced.
    const tEvidence=performance.now();
    const policy=createRecallEvidencePolicy({store,isCurrent:current});
    const labelArgs={scope,source:authority,terms:first.readArgs?.terms??[],
      sourceKind:first.readArgs?.sourceKind??null,
      recordIds:baseContribution.items.map(x=>x.recordId),maxBytes:8192};
    const labels=await policy.labelledEvidence(labelArgs);
    if(!current())return done(refuse('blocked','memory_source_revoked',timings));
    // Evidence integrity is mandatory: a revoked/unreadable source blocks, and an
    // item the evidence policy cannot label (no authenticated provenance) is
    // dropped rather than passed to the model unlabelled.
    if(baseContribution.items.length&&labels.status==='unavailable')
      return done(refuse('blocked','evidence_unverified',timings));
    const labelledItems=baseContribution.items.flatMap(item=>{
      const label=labels.items?.find(x=>x.recordId===item.recordId);
      // The quote the model sees must equal the evidence-labelled bytes exactly.
      return label&&label.content===item.content&&label.sourceKind===item.sourceKind?[Object.freeze({...item,category:label.category,
        sourceAvatar:label.sourceAvatar,sourceEvidenceIds:label.sourceEvidenceIds})]:[];
    });
    const labelled=Object.freeze({...baseContribution,
      coverage:Object.freeze({...baseContribution.coverage,returnedCount:labelledItems.length}),
      items:Object.freeze(labelledItems)});
    // Exact counts exist only for the conservative literal query shape; every
    // other first/last/how-many question abstains rather than counting a page.
    const countQuestion=/\b(how many|first time|last time)\b/i.test(input);
    const literal=input.match(/^\s*(?:how many times did (I|you) say|when (?:was|is) the (first|last) time (I|you) said)\s+"([^"\r\n]{1,512})"\s*[?.]?\s*$/i);
    const predicate=literal?{speaker:(literal[1]??literal[3]).toLowerCase()==='i'?'player':'npc',
      containsText:literal[4]}:null;
    const countArgs={scope,source:authority,predicate,excludeRecordIds:[line.recordId]};
    const count=countQuestion&&predicate?await policy.countDialogue(countArgs):
      countQuestion?{status:'incomplete',reason:'unsupported_query',exactCount:null,first:null,last:null}:null;
    if(!current())return done(refuse('blocked','memory_source_revoked',timings));
    // Witnessing comes only from persisted, source-verified M3 events (M3
    // recording may be off). No event proof => unknown, never inferred.
    let witness=null,witnessArgs=null;
    if(/\b(?:witness|see|saw|hear|heard)\b/i.test(input)){
      const item=labelled.items.find(x=>x.sourceKind==='journal_event');
      const proof=item&&typeof store.readVerifiedEventEvidence==='function'
        ?await store.readVerifiedEventEvidence({characterId,timelineId:scope.timelineId,recordId:item.recordId}):null;
      if(!current())return done(refuse('blocked','memory_source_revoked',timings));
      if(proof?.event){
        const e=proof.event;
        witnessArgs={scope,source:authority,eventRecordId:e.recordId,observationId:e.observationId,
          fromUtc:e.receivedAtUtc,toUtc:new Date(Date.parse(e.receivedAtUtc)+1).toISOString()};
        witness=await policy.witness(witnessArgs);
      }else witness={status:'unknown',reason:'no_event_specific_proof',evidenceIds:[]};
    }
    if(!current())return done(refuse('blocked','memory_source_revoked',timings));
    const suppressedAtPrepare=await hidden();
    timings.evidenceMs=ms(performance.now()-tEvidence);
    if(labelled.items.some(x=>suppressedAtPrepare.has(x.recordId)))
      return done(refuse('blocked','recalled_record_suppressed',timings));

    // A bounded M4 candidate page cannot establish an unsupported count.
    // With matching recall items, suppress the partial evidence rather than implying a total.
    const unsupportedCount=countQuestion&&count?.status!=='complete';
    const admittedContribution=unsupportedCount?Object.freeze({...labelled,
      coverage:Object.freeze({...labelled.coverage,returnedCount:0}),
      items:Object.freeze([])}):labelled;
    const answerEvidence=count||witness?Object.freeze({
      ...(count?{dialogueCount:{...count,predicate}}:{}),...(witness?{witness}:{}),
      completeness:'bounded_recall_page',negativeWitnessing:'unavailable'}):null;
    const stamp=Object.freeze({...scope,hostRunId:host.hostRunId,
      worldEpoch:host.worldEpoch,recordId:line.recordId});
    const preparedRecall=Object.freeze({status:'ready',stamp,contribution:admittedContribution,answerEvidence});
    const recallCurrent=(_references,seen)=>!!seen&&
      Object.keys(stamp).length===Object.keys(seen).length&&
      Object.keys(stamp).every(k=>seen[k]===stamp[k])&&current();

    // ---- final-send / retry revalidation ---------------------------------
    // Awaited before EVERY model attempt. Any failure latches: a prepared object
    // that once failed can never become valid again (no stale cached recall);
    // the caller must prepare afresh from the current authority.
    let verifiedFence=null,valid=true,lastVerifyMs=null;
    const fenceAtPrepare=store.memoryReadFence;
    if(fenceAtPrepare===null||fenceAtPrepare===undefined)
      return done(refuse('blocked','no_read_fence',timings));
    async function verifyPrepared(){
      const begin=performance.now();
      const fence=store.memoryReadFence;
      if(!valid||fence===null||fence===undefined||!current())return fail();
      try{
        const freshHidden=await hidden();
        const freshRows=await store.readDialogueLines({characterId,timelineId:scope.timelineId,limit:200});
        if(!current())return fail();
        // The accepted line itself must be byte-identical (not forgotten/corrected).
        if(JSON.stringify(freshRows.find(r=>r.recordId===line.recordId))!==JSON.stringify(line))return fail();
        if(labelled.items.some(x=>freshHidden.has(x.recordId)))return fail();
        const fresh=await runRecall();
        if(fresh.failed)return fail();
        const visible=await policy.verifyReferenceVisibility({scope,source:authority,
          recordIds:[line.recordId]});
        const itemsVisible=labelled.items.length===0||await policy.verifyReferenceVisibility({
          scope,source:authority,recordIds:[...new Set(labelled.items.map(x=>x.recordId))]});
        const freshLabels=await policy.labelledEvidence(labelArgs);
        const freshCount=count&&predicate?await policy.countDialogue(countArgs):count;
        const freshWitness=witnessArgs?await policy.witness(witnessArgs):witness;
        if(!current()||store.memoryReadFence!==fence)return fail();
        const same=visible&&itemsVisible&&
          JSON.stringify(toPs4RecallContribution(fresh.bundle,{maxBytes:maxContributionBytes}))===baseSeal&&
          JSON.stringify(freshLabels)===JSON.stringify(labels)&&
          JSON.stringify(freshCount)===JSON.stringify(count)&&
          JSON.stringify(freshWitness)===JSON.stringify(witness);
        if(!same)return fail();
        verifiedFence=fence;lastVerifyMs=ms(performance.now()-begin);
        return true;
      }catch{return fail();}
      function fail(){valid=false;verifiedFence=null;lastVerifyMs=ms(performance.now()-begin);return false;}
    }
    const sendCurrent=()=>valid&&current()&&verifiedFence!==null&&store.memoryReadFence===verifiedFence;

    const itemCount=admittedContribution.items.length;
    const exactCount=count?.status==='complete';
    const knownWitness=['witnessed','did_not_witness'].includes(witness?.status);
    let status='ready',reason=null;
    if(unsupportedCount||(!itemCount&&!exactCount&&!knownWitness)){
      status='abstained';
      reason=first.bundle.status==='not_recorded'?'not_recorded':
        count?(count.reason??'count_unsupported'):'unsupported_or_insufficient_evidence';
    }
    return done(Object.freeze({status,reason,preparedRecall,timings,
      recallCurrent,verifyPrepared,sendCurrent,revalidationMs:()=>lastVerifyMs}));
  }catch{
    // Authority gone => blocked. A fault with authority intact (for example one
    // unreadable retained row failing the P2 read) is unavailable, never fabricated.
    let still=false;try{still=currentNow?.()===true;}catch{}
    return done(still?refuse('unavailable','prepare_fault',timings):
      refuse('blocked','memory_source_revoked',timings));
  }
}

/**
 * Activation seam for the integrator. `mode` defaults to 'off': a disabled H2
 * returns immediately and performs no store read, retrieval, context
 * contribution or background activity. 'on' never relaxes M2/D03/P2 authority.
 */
export function createFactualRecall({mode='off',...fixed}={}){
  if(!['off','on'].includes(mode))throw new TypeError('h2_invalid_mode');
  return Object.freeze({
    mode,
    prepare:async args=>mode==='on'?prepareFactualRecall({...fixed,...args}):refuse('disabled','h2_off')
  });
}

