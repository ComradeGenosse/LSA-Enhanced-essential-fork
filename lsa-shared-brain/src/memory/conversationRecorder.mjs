// Host-neutral M2 recorder: Essential and standalone supply the same accepted
// turn identity and verified native terminal receipt. No second database/model.
import {createHash,randomUUID} from 'node:crypto';
import {isUuid} from '../util/identity.mjs';
const fail=code=>{throw new Error(code);};
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
// Stable v4-shaped UUID for source-derived identities; NOT a security token.
export function journalIdentityUuid(parts){
  const h=sha(JSON.stringify(parts));
  return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
}
const acceptedIdentity=i=>!!i&&['pedId','turnId','generationId','sessionNonce'].every(key=>
  i[key]!==null&&i[key]!==undefined&&String(i[key]).length>0&&String(i[key]).length<=128);
const sameTurn=(a,b)=>acceptedIdentity(a)&&acceptedIdentity(b)&&
  ['pedId','turnId','generationId','sessionNonce'].every(k=>a[k]===b[k]);
const attrs=(identity,a={},host=null)=>{
  const hostRunId=a.hostRunId??host?.hostRunId??null;
  const worldEpoch=a.worldEpoch??host?.worldEpoch??null;
  return {sessionId:a.sessionId??journalIdentityUuid(['session',hostRunId,identity.sessionNonce,identity.pedId]),
    protagonist:a.protagonist??'unknown',hostRunId,worldEpoch};
};
const turnHash=(identity,attribution,characterId,timelineId,speaker)=>
  sha(JSON.stringify(['memory.turn.v1',characterId,timelineId,speaker,attribution.sessionId,
    attribution.hostRunId,identity.pedId,identity.turnId,identity.generationId,identity.sessionNonce]));
function scope(store,characterId,identity,attribution){
  if(!isUuid(characterId)||!acceptedIdentity(identity))fail('journal_invalid_turn_identity');
  if(!store?.activeTimelineId||!isUuid(store.activeTimelineId))fail('timeline_write_suspended');
  if(!store.get(characterId))fail('journal_character_not_promoted');
  return {worldProfileId:store.worldProfileId,timelineId:store.activeTimelineId,
    attribution:attrs(identity,attribution,store.verifiedHostContext)};
}
const validateText=text=>{
  // NEVER .trim(), sanitize, or truncate the accepted source string.
  if(typeof text!=='string'||text.length<1||text.length>12000||!text.trim())
    fail('journal_invalid_verbatim');
  return text;
};
export function createConversationJournalRecorder(store){
  if(!store||typeof store.appendDialogueLine!=='function')throw new TypeError('journal_store_required');
  return Object.freeze({
    // Invoke only AFTER a real accepted typed/STT turn. Acceptance is signaled
    // by the host callback; a speculative transcript must never use this API.
    async recordPlayerAccepted({characterId,identity,text,source,attribution={},utteranceId=null,
      transcription=null,committedAtUtc=new Date().toISOString()}={}){
      if(!['typed','stt'].includes(source))fail('journal_unaccepted_dialogue');
      const origin=scope(store,characterId,identity,attribution);
      const content=validateText(text);
      const identityHash=turnHash(identity,origin.attribution,characterId,origin.timelineId,'player');
      const line={version:1,characterId,worldProfileId:origin.worldProfileId,timelineId:origin.timelineId,
        kind:'dialogue_line',recordId:journalIdentityUuid(['player',identityHash]),speaker:'player',source,
        content,delivery:'accepted',committedAtUtc,turnIdentityHash:identityHash,
        utteranceId,transcription:source==='stt'?(transcription??{provider:'unknown',model:'unknown',confidence:null}):null,
        deliveryReceiptId:null};
      return store.appendDialogueLine(line,origin.attribution);
    },
    // Requires the source-matched *native* playback_ended(completed) result.
    // A successful model/TTS call or output transcript alone is insufficient.
    async recordNpcCompleted({characterId,identity,text,receipt,attribution={},
      committedAtUtc=new Date().toISOString()}={}){
      if(!sameTurn(identity,receipt)||receipt.type!=='playback_ended'||receipt.reason!=='completed'||
        receipt.playbackStarted!==true||receipt.hadAudio!==true||receipt.wasInterrupted!==false||
        receipt.ok!==true)fail('journal_unverified_playback');
      const origin=scope(store,characterId,identity,attribution);
      const content=validateText(text);
      const identityHash=turnHash(identity,origin.attribution,characterId,origin.timelineId,'npc');
      // Source identity + acknowledged native event yields a stable receipt ID
      // when Essential does not provide an explicit native UUID.
      const receiptId=receipt.receiptId??journalIdentityUuid(['native-completed',identityHash]);
      if(!isUuid(receiptId))fail('journal_invalid_receipt');
      const line={version:1,characterId,worldProfileId:origin.worldProfileId,timelineId:origin.timelineId,
        kind:'dialogue_line',recordId:journalIdentityUuid(['npc',identityHash]),speaker:'npc',source:'npc_generated',
        content,delivery:'completed',committedAtUtc,turnIdentityHash:identityHash,utteranceId:null,
        transcription:null,deliveryReceiptId:receiptId};
      return store.appendDialogueLine(line,origin.attribution);
    }
  });
}
