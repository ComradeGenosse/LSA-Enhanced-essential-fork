// Memory K L: independently callable M8 interpretation preparation.
//
// Not a new engine. It composes the unchanged pieces: the authenticated
// accepted-player-line opener (shared with H1), createP2M8ProductionReader
// (P2 SQLite history + PS4 projection) and the existing evaluateM8() inside it.
// It never imports or invokes M4 recall, H1 history assembly, M5 commands,
// M6/M7 curation or a model request, opens no database and writes nothing.
//
// Authority is proven, never asserted: the accepted line is read back from the
// P2 journal, turn.m2Capture proves the current D02/native owner, and every
// P2 read is re-checked against the live identity stamp (host run, world epoch,
// timeline, owner alias, observer/turn). Preparation is fail-closed: any failure
// yields a refusal with NO projection, so PS4 falls back to its base frame.
import {openH1ConversationSource} from './h1ConversationHistory.mjs';
import {createP2M8ProductionReader} from './p2M8ProductionRead.mjs';

export const M8_MAX_PROJECTION_BYTES=2048;

function refuse(status,reason){
  return Object.freeze({status,reason,preparedM8:null,stamp:null,
    opinionCurrent:()=>false,verifyPrepared:async()=>false,sendCurrent:()=>false});
}

/**
 * Prepare M8 interpretation for ONE durably accepted player turn.
 * Same input contract as prepareFactualRecall/prepareH1ConversationHistory.
 * @returns frozen {status:'ready'|'unavailable'|'blocked', reason, preparedM8,
 *   stamp, opinionCurrent, verifyPrepared, sendCurrent}
 *   'ready' means the P2 reader produced a source-linked projection; it is only
 *   sendable after `await verifyPrepared()` resolves true for the same request.
 */
export async function prepareIndependentM8({store,turn,acceptedReceipt,input,source,isCurrent,
  nowUtc=new Date().toISOString(),maxBytes=M8_MAX_PROJECTION_BYTES}={}){
  try{
    if(typeof store?.withP2SqliteRead!=='function'||typeof store?.get!=='function')
      return refuse('unavailable','p2_sqlite_unavailable');
    const opened=await openH1ConversationSource({store,turn,acceptedReceipt,input,source,isCurrent,nowUtc});
    if(opened.status!=='ready')return refuse('blocked','source_authority_missing');
    const {scope,current}=opened;
    const authority=turn.m2Capture.memoryIdentity?.()??null;
    if(!authority||!current())return refuse('blocked','no_source_identity');
    const reader=createP2M8ProductionReader({store,originalCurrent:current,
      currentIdentity:()=>current()?turn.m2Capture.memoryIdentity():null});
    const prepared=await reader.prepare({scope,authority,nowUtc,maxBytes});
    if(!current())return refuse('blocked','memory_source_revoked');
    if(prepared.status!=='ready')return refuse('unavailable',prepared.reason??'m8_not_ready');
    // A frame with no source-linked interpretation has nothing to admit.
    const p=prepared.projection;
    if(!((p.interpretations?.length??0)||(p.jokes?.length??0)||p.relationship?.sourceEvidenceIds?.length))
      return refuse('unavailable','no_source_linked_interpretation');
    let verifiedFence=null,verifiedRequestFence=null,valid=true;
    // Awaited before EVERY model attempt and at the request boundary. Any
    // failure latches: a revoked/stale projection never becomes valid again.
    async function verifyPrepared(){
      const fence=store.memoryReadFence;
      verifiedFence=null;
      if(!valid||fence===null||fence===undefined||!current()){valid=false;return false;}
      try{
        const ok=await reader.verifyPrepared(prepared);
        if(!ok||!current()||store.memoryReadFence!==fence){valid=false;return false;}
        verifiedFence=fence;verifiedRequestFence=store.memoryRequestFence??fence;
        return true;
      }catch{valid=false;return false;}
    }
    const sendCurrent=()=>valid&&verifiedFence!==null&&current()&&
      store.memoryReadFence===verifiedFence;
    // The model request is immutable after admission. Ignore unrelated writes
    // in flight, but stop on M5 privacy mutation, profile revision or identity loss.
    const sendCurrentInFlight=()=>valid&&verifiedFence!==null&&current()&&
      (store.memoryRequestFence??store.memoryReadFence)===verifiedRequestFence;
    const invalidationReason=()=>!valid?'verification_failed':!current()?'authority_revoked':
      verifiedFence===null?'not_verified':
      store.memoryRequestFenceFailure?.(verifiedRequestFence)??
      (sendCurrentInFlight()?null:'source_changed');
    // PS4 clones the stamp; compare exact allowlisted values, not identity.
    const opinionCurrent=(_refs,seen,{requestSent=false}={})=>
      (requestSent?sendCurrentInFlight():sendCurrent())&&!!seen&&
      Object.keys(prepared.stamp).length===Object.keys(seen).length&&
      Object.keys(prepared.stamp).every(k=>seen[k]===prepared.stamp[k]);
    return Object.freeze({status:'ready',reason:null,preparedM8:prepared,
      stamp:prepared.stamp,opinionCurrent,verifyPrepared,sendCurrent,
      sendCurrentInFlight,invalidationReason});
  }catch{return refuse('unavailable','m8_prepare_fault');}
}
