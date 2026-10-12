// M4 PS4 contribution admission seam. Never renders a knowledge frame or a
// competing system message. Agent H owns the ONE C-04 TurnKnowledgeFrame.
import {performance} from 'node:perf_hooks';
import {recallMemory,validateRecallQuery,toPs4RecallContribution} from './recallEngine.mjs';

const keys=['characterId','worldProfileId','timelineId','protagonistKey','turnIdentityHash',
  'hostRunId','worldEpoch','incarnationId','encounterId','observerCaptureRef','turnId'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const identical=(a,b)=>!!a&&!!b&&keys.every(k=>a[k]===b[k]);
const verified=s=>s&&['characterId','worldProfileId','timelineId','hostRunId','incarnationId','encounterId'].every(k=>uuid.test(s[k]))&&
  ['franklin','michael','trevor','unknown'].includes(s.protagonistKey)&&
  typeof s.turnId==='string'&&s.turnId.length>0&&Number.isSafeInteger(s.worldEpoch)&&s.worldEpoch>=0&&
  typeof s.turnIdentityHash==='string'&&/^[0-9a-f]{64}$/.test(s.turnIdentityHash);
const safelyCurrent=read=>{try{return read()}catch{return null}};
const freezeIdentity=v=>Object.freeze(Object.fromEntries(keys.map(k=>[k,v?.[k]])));
/** Build M4 queries from a verified accepted player turn, never inferred intent. */
export function createAcceptedRecallQuery({acceptedTurn,snapshot,queryId,maxBytes=4096}={}){
 if(!verified(snapshot)||!acceptedTurn||acceptedTurn.accepted!==true||
   !['player_text','player_mic'].includes(acceptedTurn.source)||
   acceptedTurn.turnIdentityHash!==snapshot.turnIdentityHash||
   typeof acceptedTurn.text!=='string'||acceptedTurn.text.length<1||
   acceptedTurn.text.length>12000||!uuid.test(queryId))
   throw new TypeError('m4_unverified_accepted_turn');
 const question=acceptedTurn.text;
 const intent=/\b(quote|word for word|exact words|what (?:did|have) (?:i|you) say|what (?:i|you) said)\b/i.test(question)
   ?'exact_quote':/\b(remember|recall|earlier|before|last time|previous|ago)\b/i.test(question)
     ?'open_recall':'recent_fact';
 return validateRecallQuery({version:1,kind:'recall_query',
  characterId:snapshot.characterId,worldProfileId:snapshot.worldProfileId,
  timelineId:snapshot.timelineId,queryId,turnIdentityHash:snapshot.turnIdentityHash,
  intent,question,maxBytes});
}
const dropped=reason=>Object.freeze({status:'dropped',reason,contribution:null,stamp:null});
/**
 * Called by authenticated turn ownership before PS4 freezes its frame.
 * Caller must provide immutable P2-native identity and a live revalidation
 * function. A deadline only bounds admission; a slow read is never allowed
 * to populate the next turn's frame.
 */
export async function preparePs4Recall({query,readAdapter,snapshot,currentIdentity,
  protagonistKey,source='player_text',playerActive=false,nowUtc=new Date().toISOString(),
  deadlineMs=40,maxContributionBytes=4096,followup=null,directorAdmitted=false}={}){
  validateRecallQuery(query);
  if(!verified(snapshot)||typeof currentIdentity!=='function'||!identical(snapshot,{
    ...snapshot,characterId:query.characterId,worldProfileId:query.worldProfileId,
    timelineId:query.timelineId,turnIdentityHash:query.turnIdentityHash,protagonistKey
  }))return dropped('unverified_turn');
  if(query.intent==='spontaneous'&&(playerActive||source!=='special_event'||directorAdmitted!==true))
    return dropped('player_priority');
  if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>200||
    !Number.isSafeInteger(maxContributionBytes)||maxContributionBytes<512||maxContributionBytes>14336)
    throw new TypeError('m4_invalid_ps4_limits');
  if(!identical(snapshot,safelyCurrent(currentIdentity)))return dropped('stale_before_read');
  const stamp=freezeIdentity(snapshot),started=performance.now();
  let timer=null;
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),deadlineMs);});
  let answer;
  try{
    answer=await Promise.race([recallMemory({query,readAdapter,protagonistKey,nowUtc,followup}),timeout]);
  }catch{return dropped('recall_unavailable')}
  finally{if(timer!==null)clearTimeout(timer);}
  if(!answer)return dropped('deadline');
  if(performance.now()-started>deadlineMs)return dropped('deadline');
  if(!identical(snapshot,safelyCurrent(currentIdentity)))return dropped('stale_after_read');
  let contribution;
  try{contribution=toPs4RecallContribution(answer.bundle,{maxBytes:maxContributionBytes});}
  catch{return dropped('invalid_projection');}
  if(contribution.status!=='matched'||!contribution.items.length)return dropped('no_verified_evidence');
  return Object.freeze({status:'ready',reason:null,stamp,contribution,
    continuation:answer.continuation});
}
/** Run again just before the single PS4 model allocation is sent to Luna. */
export function verifyPs4RecallCurrent(prepared,{currentIdentity,playerActive=false,
  source='player_text',directorAdmitted=false,validateEvidence=null}={}){
  const live=typeof currentIdentity==='function'?safelyCurrent(currentIdentity):null;
  return !!prepared&&prepared.status==='ready'&&
    !!live&&identical(prepared.stamp,live)&&
    (prepared.originalAccepted!==true||(live.nativeVerified===true&&live.timelineWritable===true))&&
    !(source==='special_event'&&(playerActive||directorAdmitted!==true))&&
    // Revalidate tombstones, corrections and retained source visibility against
    // P2 at the very last provider-send/retry boundary. Unknown fails closed.
    typeof validateEvidence==='function'&&
    (()=>{try{return validateEvidence([...new Set([...prepared.contribution.items.map(item=>item.recordId),...(prepared.acceptedEvidenceRecordId?[prepared.acceptedEvidenceRecordId]:[])])],prepared.stamp)===true;}catch{return false;}})();
}


/**
 * W05 production entry: only a T1 original C-01 accepted + T3 durably
 * committed player line may create a query. The port is K-owned and MUST
 * retrieve both receipts from authenticated native and serialized P2 ledgers.
 * This function deliberately has no plain transcript/accepted-boolean path.
 *
 * readVerifiedAccepted({stamp}) -> {
 *  originalAccepted:true,nativeVerified:true,p2Committed:true,
 *  accepted:true,source:'player_text'|'player_mic',text,
 *  recordId, ...full stamp
 * }
 *
 * The return is an ADAPTER CONTRACT, not something received over the network.
 * No P2 source or independently verified original C-01 => no recall.
 */
export async function prepareOriginalPs4Recall({snapshot,queryId,
 readVerifiedAccepted,readAdapter,currentIdentity,deadlineMs=200,
 maxContributionBytes=4096,nowUtc=new Date().toISOString(),followup=null,
 playerActive=false}={}){
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>200)
  throw new TypeError('m4_invalid_ps4_limits');
 const strictStamp=()=>verified(snapshot)&&uuid.test(snapshot.observerCaptureRef)&&
   uuid.test(snapshot.turnId)&&snapshot.protagonistKey!=='unknown';
 if(!strictStamp()||typeof readVerifiedAccepted!=='function'||
    typeof currentIdentity!=='function'||!readAdapter?.read)
  return dropped('original_turn_unavailable');
 const stamp=freezeIdentity(snapshot),start=performance.now();
 const current=()=>{
  const v=safelyCurrent(currentIdentity);
  return v?.nativeVerified===true&&v.timelineWritable===true&&identical(stamp,v);
 };
 if(!current())return dropped('stale_before_accepted');
 let timer;
 const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),deadlineMs);});
 let accepted;
 try{accepted=await Promise.race([Promise.resolve().then(()=>readVerifiedAccepted({stamp})),timeout]);}
 catch{return dropped('accepted_read_unavailable');}
 finally{clearTimeout(timer);}
 if(performance.now()-start>=deadlineMs)return dropped('deadline');
 if(!current())return dropped('stale_after_accepted');
 if(!accepted||accepted.originalAccepted!==true||accepted.nativeVerified!==true||
    accepted.p2Committed!==true||accepted.accepted!==true||
    !['player_text','player_mic'].includes(accepted.source)||
    !uuid.test(accepted.recordId)||!identical(stamp,accepted)||
    typeof accepted.text!=='string'||!accepted.text.length||
    Buffer.from(accepted.text,'utf8').toString('utf8')!==accepted.text)
  return dropped('original_turn_unverified');
 let query;
 try{query=createAcceptedRecallQuery({acceptedTurn:accepted,
   snapshot,queryId,maxBytes:maxContributionBytes});}
 catch{return dropped('invalid_original_query');}
 const remaining=Math.floor(deadlineMs-(performance.now()-start));
 if(remaining<1)return dropped('deadline');
 // A just-committed question cannot become its own recalled earlier answer.
 // A thin view over the original P2 adapter excludes precisely that verified
 // accepted source record, without changing or copying the SQLite writer.
 const previousOnly={read:async options=>{
  const result=await readAdapter.read(options);
  if(!result||!Array.isArray(result.rows))return result;
  const rows=result.rows.filter(row=>row?.recordId!==accepted.recordId);
  return {...result,rows,coverageComplete:false};
 }};
 const prepared=await preparePs4Recall({query,readAdapter:previousOnly,snapshot,currentIdentity,
   protagonistKey:snapshot.protagonistKey,source:accepted.source,playerActive,
   deadlineMs:remaining,maxContributionBytes,nowUtc,followup});
 if(prepared.status!=='ready')return prepared;
 if(performance.now()-start>deadlineMs)return dropped('deadline');
 if(!current())return dropped('stale_after_recall');
 // Include the question's source record in the last-second P2 validity check:
 // corrections to the triggering utterance also invalidate the old query.
 return Object.freeze({...prepared,acceptedEvidenceRecordId:accepted.recordId,
   originalAccepted:true});
}
