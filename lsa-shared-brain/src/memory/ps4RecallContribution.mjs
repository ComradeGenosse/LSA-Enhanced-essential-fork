// M4 PS4 contribution admission seam. Never renders a knowledge frame or a
// competing system message. Agent H owns the ONE C-04 TurnKnowledgeFrame.
import {performance} from 'node:perf_hooks';
import {recallMemory,validateRecallQuery,toPs4RecallContribution} from './recallEngine.mjs';

const keys=['characterId','worldProfileId','timelineId','protagonistKey','turnIdentityHash',
  'hostRunId','worldEpoch','incarnationId','encounterId','turnId'];
const identical=(a,b)=>!!a&&!!b&&keys.every(k=>a[k]===b[k]);
const freezeIdentity=v=>Object.freeze(Object.fromEntries(keys.map(k=>[k,v?.[k]])));
const dropped=reason=>Object.freeze({status:'dropped',reason,contribution:null,stamp:null});
/**
 * Called by authenticated turn ownership before PS4 freezes its frame.
 * Caller must provide immutable P2-native identity and a live revalidation
 * function. A deadline only bounds admission; a slow read is never allowed
 * to populate the next turn's frame.
 */
export async function preparePs4Recall({query,readAdapter,snapshot,currentIdentity,
  protagonistKey,source='player_text',playerActive=false,nowUtc=new Date().toISOString(),
  deadlineMs=40,maxContributionBytes=4096,followup=null}={}){
  validateRecallQuery(query);
  if(!snapshot||typeof currentIdentity!=='function'||!identical(snapshot,{
    ...snapshot,characterId:query.characterId,worldProfileId:query.worldProfileId,
    timelineId:query.timelineId,turnIdentityHash:query.turnIdentityHash,protagonistKey
  }))return dropped('unverified_turn');
  if(query.intent==='spontaneous'&&(playerActive||['player_text','player_mic'].includes(source)))
    return dropped('player_priority');
  if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>200||
    !Number.isSafeInteger(maxContributionBytes)||maxContributionBytes<512||maxContributionBytes>14336)
    throw new TypeError('m4_invalid_ps4_limits');
  if(!identical(snapshot,currentIdentity()))return dropped('stale_before_read');
  const stamp=freezeIdentity(snapshot),started=performance.now();
  let timer=null;
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),deadlineMs);timer.unref?.();});
  let answer;
  try{
    answer=await Promise.race([recallMemory({query,readAdapter,protagonistKey,nowUtc,followup}),timeout]);
  }catch{return dropped('recall_unavailable')}
  finally{if(timer!==null)clearTimeout(timer);}
  if(!answer)return dropped('deadline');
  if(performance.now()-started>deadlineMs)return dropped('deadline');
  if(!identical(snapshot,currentIdentity()))return dropped('stale_after_read');
  return Object.freeze({status:'ready',reason:null,
    stamp,contribution:toPs4RecallContribution(answer.bundle,{maxBytes:maxContributionBytes}),
    continuation:answer.continuation});
}
/** Run again just before the single PS4 model allocation is sent to Luna. */
export function verifyPs4RecallCurrent(prepared,{currentIdentity,playerActive=false,
  source='player_text'}={}){
  return !!prepared&&prepared.status==='ready'&&
    typeof currentIdentity==='function'&&identical(prepared.stamp,currentIdentity())&&
    !(playerActive&&source==='special_event');
}
