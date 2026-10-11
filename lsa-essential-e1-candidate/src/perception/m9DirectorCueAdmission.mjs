// Agent J's PS6 M9 source admission seam. NO new native executor, turn,
// model call, prompt, ticket, PS3 grant, or bypass of original C-06/C-11.
// K injects the real PS4 C-04 contribution registration; without it, fail closed.
import {selectDirectorIntent} from './sceneDirector.mjs';

const safePriority=p=>p?.known===true && p.playerIdle===true &&
  p.micIdle===true && p.typedIdle===true && p.combatIdle===true &&
  p.stockIdle===true && p.interruptionFree===true &&
  p.directorAvailable===true && p.ownerCurrent===true &&
  p.timelineWritable===true;
const sync=(callback,input)=>{
  try {const result=callback(input);
    return result && typeof result.then==='function'?null:result;
  }catch{return null;}
};
const same=(proposal,cue)=>proposal &&
  proposal.speakerCaptureRef===cue.observerCaptureRef &&
  proposal.playerCaptureRef===cue.playerCaptureRef;

// A prepared M9 cue is only an OPTIONAL read-only addition to a currently
// entitled *original* PS3 Director turn. It cannot select its own PS3 event:
// the existing selector, original grant, and native one-shot stock path remain
// the only speech scheduler. If there is no real original entitlement,
// no spontaneous M9 memory callback is possible.
export class M9DirectorCueAdmission {
  #cues;#director;#readPriority;#register;
  #busy=false;
  constructor({cueCandidates,existingSceneDirector,readCurrentPriority,
    registerPs4MemoryCue}={}) {
    if(typeof cueCandidates?.propose!=='function' ||
       typeof existingSceneDirector?.attempt!=='function' ||
       typeof existingSceneDirector?.originalGrantCurrent!=='function' ||
       typeof readCurrentPriority!=='function' ||
       typeof registerPs4MemoryCue!=='function')
      throw new TypeError('m9_ps6_original_director_ports_required');
    this.#cues=cueCandidates;this.#director=existingSceneDirector;
    this.#readPriority=readCurrentPriority;this.#register=registerPs4MemoryCue;
  }
  // Caller: accepted M3 committed witness + current PS3 candidates/stamp.
  // The receipt MUST be a durable readback, not a pending write or nearby ped.
  async attempt({candidate,witness,ps3Candidates,facts,stamp}={}) {
    if(this.#busy)return Object.freeze({status:'busy'});
    if(!Array.isArray(ps3Candidates) || ps3Candidates.length===0 ||
       ps3Candidates.length>128 || !stamp ||
       !witness || !candidate || candidate.playerCaptureRef!==facts?.playerCaptureRef)
      return Object.freeze({status:'missing_original_ps3_source'});
    const proposal=selectDirectorIntent(ps3Candidates,facts);
    if(!proposal || proposal.urgency!=='routine' ||
       proposal.expiresAtMonotonicMs<=facts.nowMonotonicMs ||
       proposal.speakerCaptureRef!==witness.observerCaptureRef ||
       proposal.playerCaptureRef!==candidate.playerCaptureRef)
      return Object.freeze({status:'original_ps3_not_eligible'});
    // This call reads the actual PS3 ledger; a forged
    // entitlementCurrent:boolean does NOT establish authority.
    if(this.#director.originalGrantCurrent(proposal,stamp)!==true)
      return Object.freeze({status:'original_ps3_grant_refused'});
    const current=()=>sync(this.#readPriority,{
      candidate,witness,proposal,stamp,stage:'pre_admission'});
    const priority=current();
    if(!safePriority(priority))
      return Object.freeze({status:'player_or_combat_priority'});
    // All witness/M3 owner checks are independently re-read at proposal.
    const result=this.#cues.propose({candidate,witness,priority});
    if(!result.accepted)
      return Object.freeze({status:'cue_refused',reason:result.reason});
    const cue=result.cue;
    if(!same(proposal,cue))
      return Object.freeze({status:'owner_mismatch'});
    this.#busy=true;
    let registered=null;
    try {
      // Contract: synchronous registration into the EXISTING C-04/PS4 frame,
      // with source-linked M3 journal readback and returned unregister hook.
      // A new system prompt or a direct Luna parameter is NOT allowed.
      registered=sync(this.#register,Object.freeze({cue,candidate,witness,
        proposal,stamp,mode:'sole_ps4_frame'}));
      if(registered?.status!=='registered' ||
         registered?.cueId!==cue.cueId ||
         typeof registered?.unregister!=='function')
        return Object.freeze({status:'ps4_memory_not_registered'});
      if(!safePriority(sync(this.#readPriority,{
        candidate,witness,proposal,stamp,stage:'before_director'})) ||
         this.#director.originalGrantCurrent(proposal,stamp)!==true)
        return Object.freeze({status:'priority_or_original_grant_changed'});
      // Only the existing SceneDirectorSpeech -> DirectorSpeechReservations ->
      // native C-06/C-11 -> stock Essential turn path can deliver anything.
      const delivered=await this.#director.attempt({
        candidates:ps3Candidates,facts,stamp});
      return Object.freeze(delivered?.status==='delivered'?
        {status:'director_delivered',cueId:cue.cueId,
          // PS4 frame injection must be separately audited by K.
          requiresVerifiedPs4Receipt:true}:
        {status:'director_not_delivered',directorStatus:delivered?.status??'unknown'});
    }catch {
      return Object.freeze({status:'director_or_ps4_failed'});
    }finally {
      try {registered?.unregister?.();}catch {}
      this.#busy=false;
    }
  }
}
