// WS-6a/6b: one P2-authorized read and M5 dispatch before PS4 builds the
// model frame. This module does not write prompts or open another database.
import {randomUUID} from 'node:crypto';
import {recallMemory,toPs4RecallContribution} from '../../../lsa-shared-brain/src/memory/recallEngine.mjs';
import {createP2IntegratedRecallAdapter} from '../../../lsa-shared-brain/src/memory/integrationPorts.mjs';
import {createM5SqliteServices} from '../../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {createM5RuntimeCoordinator,mayBeM5PlayerInput} from '../../../lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs';
import {createRecallEvidencePolicy} from '../../../lsa-shared-brain/src/memory/recallEvidencePolicy.mjs';
import {createP2M8ProductionReader} from './p2M8ProductionRead.mjs';
import {openH1ConversationSource} from './h1ConversationHistory.mjs';
export {assembleJournalConversation} from './h1ConversationHistory.mjs';

const noMemory=()=>Object.freeze({status:'unavailable',reason:'no_verified_memory_source',
  preparedRecall:null,conversationJournal:null,memoryAction:null,recallCurrent:()=>false});

export async function prepareLiveTurnMemory({store,turn,acceptedReceipt,input,source,isCurrent,
  nowUtc=new Date().toISOString()}={}){
  const empty=noMemory();
  try{
    // The combined path still requires M4. H1's own admission is independent.
    if(typeof store?.readIntegratedRecall!=='function')return empty;
    const h1Source=await openH1ConversationSource({
      store,turn,acceptedReceipt,input,source,isCurrent,nowUtc});
    if(h1Source.status!=='ready')return empty;
    const {scope,line,current,characterId}=h1Source;
    // Ordinary conversation never invokes a memory writer. Only an explicit
    // player command (or a possible reply to an existing durable clarification)
    // may enter M5, always subject to the coordinator's own source checks.
    let memoryAction=null;
    // The M5 module is the single authority for what may enter M5.
    const possibleCommand=mayBeM5PlayerInput(input);
    if(possibleCommand)try{
      const m5=createM5SqliteServices({store,filePath:store.filePath,
        authorize:()=>current()});
      const coordinator=createM5RuntimeCoordinator({
        commandStore:m5.bindCommands(),
        authority:{assertCurrent:()=>current()}
      });
      const result=await coordinator.acceptAcceptedPlayerLine({
        line,scope,sourceProof:acceptedReceipt});
      if(!current())return empty;
      if(result?.handled===true&&result.route==='command'){
        // Only the coordinator's verified durable statuses, not claimed text.
        memoryAction=Object.freeze((result.acknowledgements||[]).map(x=>({
          outcome:x.outcome,durableCommit:x.durableCommit===true})));
      }
    }catch{memoryAction=Object.freeze([{outcome:'failed',durableCommit:false}]);}
    if(!current())return empty;
    // M5 has completed any durable corrections; only now read H1 history.
    const preparedH1=await h1Source.prepare();
    if(preparedH1.status!=='ready')return Object.freeze({...empty,memoryAction});
    const {conversationJournal,stamp}=preparedH1;
    const query={version:1,kind:'recall_query',queryId:randomUUID(),
      characterId,worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
      turnIdentityHash:line.turnIdentityHash,
      question:input,intent:/\b(quote|exact words|word for word)\b/i.test(input)
        ?'exact_quote':'open_recall',maxBytes:4096};
    const sourceReader=createP2IntegratedRecallAdapter(store);
    let recallReadArgs=null;
    const {bundle}=await recallMemory({query,
      // A question must never retrieve itself as if it were an earlier memory.
      // The accepted current line belongs in CONVERSE.current only.
      readAdapter:{read:async args=>{
        recallReadArgs=args;
        const result=await sourceReader.read({...args,excludeRecordId:line.recordId});
        return {...result,rows:result.rows.filter(r=>r.recordId!==line.recordId)};
      }},
      protagonistKey:scope.protagonistKey,nowUtc});
    if(!current())return empty;
    let contribution=toPs4RecallContribution(bundle,{maxBytes:4096});
    const authority=turn.m2Capture.memoryIdentity?.()??null;
    const policy=authority?createRecallEvidencePolicy({store,isCurrent:current}):null;
    let labels=null,labelArgs=null;
    if(policy){
      labelArgs={scope,source:authority,
        terms:recallReadArgs?.terms??[],sourceKind:recallReadArgs?.sourceKind??null,
        expandDialogueContext:recallReadArgs?.expandDialogueContext===true,excludeRecordId:line.recordId,
        recordIds:contribution.items.map(x=>x.recordId),maxBytes:8192};
      labels=await policy.labelledEvidence(labelArgs);
      if(!current())return empty;
      contribution=Object.freeze({...contribution,items:Object.freeze(contribution.items.map(item=>{
        const label=labels.items?.find(x=>x.recordId===item.recordId);
        return label?Object.freeze({...item,category:label.category,sourceAvatar:label.sourceAvatar,
          sourceEvidenceIds:label.sourceEvidenceIds}):item;
      }))});
    }
    // Only a conservative explicit literal query has exhaustive semantics.
    // Unsupported semantic/event/implicit totals always abstain.
    const countQuestion=/\b(how many|first time|last time)\b/i.test(input);
    const literal=input.match(/^\s*(?:how many times did (I|you) say|when (?:was|is) the (first|last) time (I|you) said)\s+"([^"\r\n]{1,512})"\s*[?.]?\s*$/i);
    const predicate=literal?{speaker:(literal[1]??literal[3]).toLowerCase()==='i'?'player':'npc',containsText:literal[4]}:null;
    const countArgs={scope,source:authority,predicate,excludeRecordIds:[line.recordId]};
    const count=countQuestion&&policy&&predicate?await policy.countDialogue(countArgs):
      countQuestion?{status:'incomplete',reason:'unsupported_query',exactCount:null,first:null,last:null}:null;
    if(!current())return empty;
    let witness=null,witnessArgs=null;
    if(/\b(?:witness|see|saw|hear|heard)\b/i.test(input)&&policy){
      // Only persisted event identities may enter G5. A freeform question or
      // empty candidate page never supplies an event-specific negative proof.
      const item=contribution.items.find(x=>x.sourceKind==='journal_event');
      const proof=item?await store.readVerifiedEventEvidence({characterId,timelineId:scope.timelineId,recordId:item.recordId}):null;
      if(!current())return empty;
      if(proof?.event){
        const e=proof.event;
        witnessArgs={scope,source:authority,eventRecordId:e.recordId,observationId:e.observationId,
          fromUtc:e.receivedAtUtc,toUtc:new Date(Date.parse(e.receivedAtUtc)+1).toISOString()};
        witness=await policy.witness(witnessArgs);
      }else witness={status:'unknown',reason:'no_event_specific_proof',evidenceIds:[]};
    }
    if(!current())return empty;
    const answerEvidence=count||witness?Object.freeze({
      ...(count?{dialogueCount:{...count,predicate}}:{}),...(witness?{witness}:{}),
      completeness:'bounded_recall_page',negativeWitnessing:'unavailable'}):null;
    let m8Reader=null,preparedM8=null;
    if(authority&&typeof store.withP2SqliteRead==='function')try{
      m8Reader=createP2M8ProductionReader({store,originalCurrent:current,
        currentIdentity:()=>current()?turn.m2Capture.memoryIdentity():null});
      preparedM8=await m8Reader.prepare({scope,authority,nowUtc,maxBytes:2048});
    }catch{}
    if(!current())return empty;
    const preparedRecall=Object.freeze({status:'ready',stamp,contribution,answerEvidence});
    // PS4 immutableSnapshot clones the private stamp. Compare its exact
    // allowlisted values, not object identity, after every snapshot/prune.
    const recallCurrent=(_references,seen)=>!!seen&&
      Object.keys(stamp).length===Object.keys(seen).length&&
      Object.keys(stamp).every(k=>seen[k]===stamp[k])&&current();
    let verifiedFence=null,verifiedRequestFence=null,memoryValid=true,opinionValid=preparedM8?.status==='ready';
    // Awaited on EVERY model attempt and again at the request boundary. The
    // synchronous connection fence closes the gap from last read to fetch.
    async function verifyPrepared(){
      const fence=store.memoryReadFence;
      memoryValid=false;opinionValid=false;
      if(!current()||fence===null||fence===undefined||!policy)return false;
      try{
        const historyVerification=await preparedH1.verifyPrepared();
        if(historyVerification.status!=='ready')return false;
        // The bounded M4 query is re-read too, so a changed source chain or
        // corrected derivative cannot survive merely because its ID exists.
        const fresh=await recallMemory({query,readAdapter:{read:async args=>{
          const result=await sourceReader.read({...args,excludeRecordId:line.recordId});
          return {...result,rows:result.rows.filter(r=>r.recordId!==line.recordId)};
        }},protagonistKey:scope.protagonistKey,nowUtc});
        // M4's freshly verified projection checks derived source chains and
        // correction overlays. Claim IDs in event sidecars are not journal IDs;
        // a transcript overlay may legitimately reference its superseded line.
        const visible=await policy.verifyReferenceVisibility({scope,source:authority,recordIds:[line.recordId]});
        const freshLabels=labelArgs?await policy.labelledEvidence(labelArgs):labels;
        const freshCount=count&&predicate?await policy.countDialogue(countArgs):count;
        const freshWitness=witnessArgs?await policy.witness(witnessArgs):witness;
        const m8Ok=preparedM8?.status==='ready'&&await m8Reader.verifyPrepared(preparedM8);
        if(!current()||store.memoryReadFence!==fence)return false;
        memoryValid=visible&&preparedH1.sendCurrent()&&
          JSON.stringify(freshLabels)===JSON.stringify(labels)&&
          JSON.stringify(toPs4RecallContribution(fresh.bundle,{maxBytes:4096}))===
            JSON.stringify(toPs4RecallContribution(bundle,{maxBytes:4096}))&&
          JSON.stringify(freshCount)===JSON.stringify(count)&&JSON.stringify(freshWitness)===JSON.stringify(witness);
        opinionValid=m8Ok===true;
        verifiedFence=fence;
        verifiedRequestFence=store.memoryRequestFence??fence;
        return memoryValid;
      }catch{return false;}
    }
    const sendCurrent=()=>memoryValid&&current()&&verifiedFence!==null&&
      store.memoryReadFence===verifiedFence&&preparedH1.sendCurrent();
    const sendCurrentInFlight=()=>memoryValid&&current()&&verifiedFence!==null&&
      (store.memoryRequestFence??store.memoryReadFence)===verifiedRequestFence&&
      (preparedH1.sendCurrentInFlight?.()??preparedH1.sendCurrent());
    const invalidationReason=()=>!memoryValid?'verification_failed':!current()?'authority_revoked':
      verifiedFence===null?'not_verified':
      store.memoryRequestFenceFailure?.(verifiedRequestFence)??
      (sendCurrentInFlight()?null:preparedH1.invalidationReason?.()??'source_changed');
    const opinionCurrent=(_refs,seen,{requestSent=false}={})=>opinionValid&&
      (requestSent?sendCurrentInFlight():sendCurrent())&&!!seen&&
      Object.keys(preparedM8.stamp).every(k=>seen[k]===preparedM8.stamp[k]);
    return Object.freeze({status:'ready',preparedRecall,preparedM8,conversationJournal,
      memoryAction,recallCurrent,verifyPrepared,sendCurrent,sendCurrentInFlight,
      invalidationReason,opinionCurrent});
  }catch{return empty;}
}
