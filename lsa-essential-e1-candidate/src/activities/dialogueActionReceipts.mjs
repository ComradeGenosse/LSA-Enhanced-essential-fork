import {randomUUID} from 'node:crypto';
import {immutableSnapshot} from '../context/turnSnapshot.mjs';
import {isUuid} from '../identity/identityContract.mjs';
import {readHostContext,sameHostContext} from '../context/hostContext.mjs';

const tupleKeys=['pedId','turnId','generationId','sessionNonce'];
const validTuple=t=>typeof t?.pedId==='string' && t.pedId.length>0 && t.pedId.length<=128 && typeof t.turnId==='string' && t.turnId.length>0 && t.turnId.length<=128 && Number.isSafeInteger(t.generationId) && t.generationId>=0 && Number.isSafeInteger(t.sessionNonce) && t.sessionNonce>0;
const validBinding=b=>isUuid(b?.encounterId) && isUuid(b?.incarnationId) && readHostContext(b.hostContext);
const sameBinding=(a,b)=>validBinding(a) && validBinding(b) && a.encounterId===b.encounterId && a.incarnationId===b.incarnationId && sameHostContext(a.hostContext,b.hostContext);
const tick=value=>Number.isSafeInteger(value) && value>=0 && value<=0xffffffff;
// Passive C-05 adapter only. An annotated native callback must carry the exact
// publication id AND tuple/body/host scope. Never infer the latest matching turn.
// No lease, dispatcher, timer, history commit or physical-completion authority.
export class DialogueActionReceipts {
 #pending=new Map();#receipts=[];
 #finish(row,state,reason,atGameTick=null){
  this.#pending.delete(row.publicationId);
  const receipt=immutableSnapshot({...row,state,reason,atGameTick,evidence:state==='HANDLER_ACCEPTED'?'handler_only':'none'});
  this.#receipts.push(receipt);if(this.#receipts.length>128)this.#receipts.shift();return receipt;
 }
 expire(now){
  if(!Number.isSafeInteger(now) || now<0)return;
  for(const row of this.#pending.values())if(now<row.publishedAtMs || now-row.publishedAtMs>5000)this.#finish(row,'UNKNOWN',now<row.publishedAtMs?'clock_regression':'callback_timeout');
 }
 publish({tuple,binding,canonicalAction,publishedAtMs,allowedActions}={}){
  if(!validTuple(tuple) || !validBinding(binding) || !Number.isSafeInteger(publishedAtMs) || publishedAtMs<0 || typeof canonicalAction!=='string' || !/^[a-z][a-z0-9_]{0,63}$/.test(canonicalAction) || !Array.isArray(allowedActions) || !allowedActions.includes(canonicalAction))return null;
  this.expire(publishedAtMs);
  const row=immutableSnapshot({publicationId:randomUUID(),tuple:Object.fromEntries(tupleKeys.map(key=>[key,tuple[key]])),binding:{encounterId:binding.encounterId,incarnationId:binding.incarnationId,hostContext:readHostContext(binding.hostContext)},canonicalAction,publishedAtMs});
  const overlaps=[...this.#pending.values()].filter(other=>sameBinding(other.binding,row.binding) && other.canonicalAction===canonicalAction);
  const quarantined=this.#receipts.some(other=>other.reason==='ambiguous_publication' && sameBinding(other.binding,row.binding) && other.canonicalAction===canonicalAction && publishedAtMs-other.publishedAtMs<=5000);
  if(overlaps.length || quarantined){for(const other of overlaps)this.#finish(other,'UNKNOWN','ambiguous_publication');return this.#finish(row,'UNKNOWN','ambiguous_publication');}
  if(this.#pending.size>=32)return this.#finish(row,'UNKNOWN','pending_capacity');
  this.#pending.set(row.publicationId,row);return row;
 }
 callback({publicationId,tuple,binding,canonicalAction,succeeded,atGameTick,receivedAtMs,overflowed=false}={}){
  if(!Number.isSafeInteger(receivedAtMs) || receivedAtMs<0)return null;
  this.expire(receivedAtMs);const row=this.#pending.get(publicationId);if(!row)return null;
  if(overflowed===true)return this.#finish(row,'UNKNOWN','callback_overflow');
  if(!validTuple(tuple) || !tupleKeys.every(key=>tuple[key]===row.tuple[key]) || !sameBinding(binding,row.binding) || canonicalAction!==row.canonicalAction || typeof succeeded!=='boolean' || !tick(atGameTick))return this.#finish(row,'UNKNOWN','callback_mismatch');
  return this.#finish(row,succeeded?'HANDLER_ACCEPTED':'FAILED',succeeded?'handler_accepted':'handler_failed',atGameTick);
 }
 retire(binding){for(const row of this.#pending.values())if(sameBinding(row.binding,binding))this.#finish(row,'UNKNOWN','participant_retired');this.#receipts=this.#receipts.filter(row=>!sameBinding(row.binding,binding));}
 reset(){this.#pending.clear();this.#receipts=[];}
 read(binding){return immutableSnapshot(this.#receipts.filter(row=>sameBinding(row.binding,binding)).slice(-16));}
 get pendingCount(){return this.#pending.size;}
}
