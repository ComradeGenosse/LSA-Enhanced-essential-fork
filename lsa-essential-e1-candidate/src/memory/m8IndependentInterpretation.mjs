// Memory K L: independently callable M8 interpretation preparation.
//
// This is NOT a new memory engine, database, worker, personality system or
// prompt assembler. It composes the existing, unchanged pieces:
//   openH1ConversationSource (M2/D03 accepted-line authority, read-only) ->
//   createP2M8ProductionReader (authenticated P2 SQLite history, M8 evaluator) ->
//   projectPreparedM8 (PS4 RECALLED-lane projection, admitted by essentialGlue).
// It never imports or requires M4 recall, H1 conversation history, M5 commands
// or M6/M7 curation, adds no writer, and makes no model request.
//
// Authority is never accepted from the caller as data: the accepted player line
// is read back from the P2 journal and the native owner identity comes from the
// turn's own M2 capture (D02), exactly as for H1/H2.
import {createP2M8ProductionReader} from './p2M8ProductionRead.mjs';
import {openH1ConversationSource} from './h1ConversationHistory.mjs';
import {projectPreparedM8} from '../context/knowledgeSelector.mjs';

export const M8_STATUSES=Object.freeze(['ready','abstained','unavailable','blocked']);
export const M8_INDEPENDENT_MAX_BYTES=2048;

const refuse=(status,reason)=>Object.freeze({status,reason,stamp:null,preparedM8:null,
  opinionCurrent:()=>false,verifyPrepared:async()=>false,sendCurrent:()=>false});

// The profile schema only allows editor-approved `personality.description` and
// `personality.traits` (short strings). The M8 evaluator reads structured inputs
// (humor.style, caution, loyalty, interests). This is a deterministic, whole-word
// map from approved traits to exactly those existing inputs. It never reads free
// prose, never calls a model, and a structured value already on the canon wins.
// An NPC with no recognised trait keeps the evaluator's own defaults.
const STYLE_TRAITS=Object.freeze({sarcastic:'sarcastic',sardonic:'sarcastic',snarky:'sarcastic',
  goofy:'goofy',silly:'goofy',playful:'goofy',dry:'dry',deadpan:'dry',
  dark:'dark',morbid:'dark',wholesome:'wholesome',warm:'wholesome'});
const HIGH_CAUTION=new Set(['cautious','careful','anxious','nervous','timid','wary']);
const LOW_CAUTION=new Set(['reckless','fearless','daring','impulsive']);
const HIGH_LOYALTY=new Set(['loyal','devoted','faithful']);
const LOW_LOYALTY=new Set(['disloyal','treacherous','fickle']);
const INTERESTS=new Set(['cars','music','food','travel']);
export function deriveM8PersonalityFromCanon(personality){
  const raw=personality&&typeof personality==='object'?personality:{};
  const words=(Array.isArray(raw.traits)?raw.traits:[]).filter(x=>typeof x==='string')
    .flatMap(x=>x.toLowerCase().split(/[^a-z]+/u).filter(Boolean));
  const out={};
  const style=words.map(w=>STYLE_TRAITS[w]).find(Boolean);
  if(style)out.humor={style};
  if(words.some(w=>HIGH_CAUTION.has(w)))out.caution=.9;
  else if(words.some(w=>LOW_CAUTION.has(w)))out.caution=.1;
  if(words.some(w=>HIGH_LOYALTY.has(w)))out.loyalty=.9;
  else if(words.some(w=>LOW_LOYALTY.has(w)))out.loyalty=.1;
  const interests=[...new Set(words.filter(w=>INTERESTS.has(w)))];
  if(interests.length)out.interests=interests;
  return {...out,...raw};
}

/**
 * Prepare bounded, source-linked M8 interpretation for ONE durably accepted
 * player turn.
 *
 * @returns frozen {status, reason, stamp, preparedM8, opinionCurrent,
 *   verifyPrepared, sendCurrent}. status: ready | abstained | unavailable |
 *   blocked. preparedM8 is non-null only when ready; ready means at least one
 *   source-linked interpretation, joke or relationship entry was projected.
 */
export async function prepareIndependentM8({store,turn,acceptedReceipt,input,source,isCurrent,
  nowUtc=new Date().toISOString(),maxBytes=M8_INDEPENDENT_MAX_BYTES}={}){
  let currentNow=null;
  try{
    if(typeof store?.withP2SqliteRead!=='function'||typeof store.get!=='function')
      return refuse('unavailable','p2_sqlite_unavailable');
    // Same authenticated accepted-player source as H1/H2. This is read-only and
    // does not invoke M4, M5, H1 history assembly or any writer.
    const opened=await openH1ConversationSource({store,turn,acceptedReceipt,input,source,
      isCurrent,nowUtc});
    if(opened.status!=='ready')return refuse('blocked','memory_source_not_current');
    const {scope,line,current,characterId,stamp}=opened;
    currentNow=current;
    const authority=turn.m2Capture.memoryIdentity?.()??null;
    if(!authority)return refuse('blocked','no_source_identity');
    const fenceAtPrepare=store.memoryReadFence;
    if(fenceAtPrepare===null||fenceAtPrepare===undefined)return refuse('blocked','no_read_fence');
    const acceptedSeal=JSON.stringify(line);
    const reader=createP2M8ProductionReader({store,originalCurrent:current,
      currentIdentity:()=>current()?turn.m2Capture.memoryIdentity():null,
      personalityFor:deriveM8PersonalityFromCanon});
    const prepared=await reader.prepare({scope,authority,nowUtc,maxBytes});
    if(!current())return refuse('blocked','memory_source_revoked');
    if(prepared.status!=='ready')return refuse('unavailable',prepared.reason??'m8_unavailable');
    // Nothing the PS4 projection would admit => do not claim a contribution.
    if(projectPreparedM8(prepared,{maxBytes}).references.length===0)
      return refuse('abstained','no_interpretable_evidence');

    // ---- final-send / retry revalidation ---------------------------------
    // Awaited before EVERY model attempt. Any failure latches: a prepared M8
    // that once failed never becomes valid again; the caller prepares afresh.
    let verifiedFence=null,valid=true;
    function fail(){valid=false;verifiedFence=null;return false;}
    async function verifyPrepared(){
      const fence=store.memoryReadFence;
      verifiedFence=null;
      if(!valid||fence===null||fence===undefined||!current())return fail();
      try{
        const fresh=await reader.verifyPrepared(prepared);
        const rows=await store.readDialogueLines({characterId,timelineId:scope.timelineId,limit:200});
        if(!current()||store.memoryReadFence!==fence)return fail();
        // The accepted line itself must still be byte-identical (not forgotten/corrected).
        if(fresh!==true||JSON.stringify(rows.find(r=>r.recordId===line.recordId))!==acceptedSeal)
          return fail();
        verifiedFence=fence;
        return true;
      }catch{return fail();}
    }
    const sendCurrent=()=>valid&&current()&&verifiedFence!==null&&
      store.memoryReadFence===verifiedFence;
    // PS4 snapshots clone the private stamp: compare exact allowlisted values.
    const opinionCurrent=(_refs,seen)=>sendCurrent()&&!!seen&&
      Object.keys(prepared.stamp).length===Object.keys(seen).length&&
      Object.keys(prepared.stamp).every(k=>seen[k]===prepared.stamp[k]);
    return Object.freeze({status:'ready',reason:null,stamp,preparedM8:prepared,
      opinionCurrent,verifyPrepared,sendCurrent});
  }catch{
    // Authority gone => blocked. A fault with authority intact is unavailable.
    let still=false;try{still=currentNow?.()===true;}catch{}
    return still?refuse('unavailable','prepare_fault'):refuse('blocked','memory_source_revoked');
  }
}
