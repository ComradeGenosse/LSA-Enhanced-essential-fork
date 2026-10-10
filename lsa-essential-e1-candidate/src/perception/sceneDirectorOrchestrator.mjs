import {selectDirectorIntent} from './sceneDirector.mjs';
import {renderDirectorEventContext} from './directorContext.mjs';

// Coordinator for the existing PS3 -> C-11 -> Essential seam. No world scan,
// second executor, retry policy, provider, memory writer or TASK is created.
// The native request and actual kb driver are mandatory injected authorities.
// Native admission statuses are a small fixed protocol vocabulary; never log
// arbitrary response bodies, claim text, ticket IDs or owner identity.
const NATIVE_VETOES = new Set(['unsafe','busy','stale','invalid','not_found']);
const nativeVeto = receipt => NATIVE_VETOES.has(receipt?.status) ? receipt.status : 'unknown';

export class SceneDirectorSpeech {
  constructor({admission,nativeRequest,dispatch,now,originalEntitlement,mode='off'}={}) {
    if(!admission || typeof nativeRequest!=='function' ||
       typeof dispatch!=='function' || typeof now!=='function')
      throw new TypeError('director_dependencies_required');
    this.admission=admission;this.nativeRequest=nativeRequest;
    this.dispatch=dispatch;this.now=now;
    // The original PS2/PS3 companion receipt must be checked separately
    // from the injected native C-06 check at every prepublication boundary.
    // Missing source authority always rejects, including an active-mode
    // caller created without the optional injected reader.
    this.originalEntitlement=typeof originalEntitlement==='function'
      ?originalEntitlement:()=>null;
    this.mode=['off','shadow','active'].includes(mode)?mode:'off';
  }
  setMode(mode){
    if(!['off','shadow','active'].includes(mode))throw new TypeError('director_mode');
    this.mode=mode;
    if(mode!=='active')this.admission.setEnabled(false);
  }
  originalGrantCurrent(proposal,stamp) {
    let record;
    try {record=this.originalEntitlement(proposal,stamp);}
    catch {return false;}
    return record?.source==='original_companion_ps2_ps3' &&
      record.hostRunId===stamp?.hostRunId &&
      record.worldEpoch===stamp?.worldEpoch &&
      record.speakerCaptureRef===proposal.speakerCaptureRef &&
      record.playerCaptureRef===proposal.playerCaptureRef &&
      record.ownerIncarnationId===stamp?.ownerIncarnationId &&
      record.proofRevision===stamp?.proofRevision &&
      record.observationId===proposal.observationId &&
      record.observationRevision===proposal.observationRevision &&
      record.decisionKey===proposal.decisionKey &&
      record.policyVersion===proposal.policyVersion &&
      record.expiresAtMonotonicMs===proposal.expiresAtMonotonicMs;
  }
  async attempt({candidates=[],facts,stamp}={}) {
    if(this.mode==='off')return Object.freeze({status:'off'});
    const proposal=selectDirectorIntent(candidates,facts);
    if(!proposal)return Object.freeze({status:'no_eligible_evidence'});
    if(this.mode==='shadow')return Object.freeze({status:'shadow',observationId:proposal.observationId});
    // Resolve one exact, original PS2 observation to Luna-visible context.
    // The native stock Content parameter is never made from proposal IDs,
    // player free text, an inferred scene, or a stale alternative candidate.
    const eventContext=renderDirectorEventContext(proposal,candidates);
    if(!eventContext)return Object.freeze({status:'event_context_unavailable'});
    // A real current companion PS3 observation+grant is independently
    // mandatory even if the caller injects an all-positive mock C-06.
    // Native still must independently authorize after this source check.
    if(!this.originalGrantCurrent(proposal,stamp))
      return Object.freeze({status:'original_ps3_unavailable'});
    // Active is impossible with the current native preview-only endpoint; the
    // caller must supply an authenticated native submit and exact stock driver.
    const ticket=this.admission.reserve(proposal,stamp);
    if(!ticket)return Object.freeze({status:'not_admitted',
      diagnosticReason:this.admission.lastReserveFailure??'reservation_unavailable'});
    let nativeReserved=false;
    const currentAge=()=>Math.max(0,this.now()-facts.nowMonotonicMs);
    const request=async operation=>this.nativeRequest({operation,ticket,proposal,stamp,
      // Cancellation remains legal long after the original candidate TTL.
      ageMs:operation==='cancel'?0:currentAge()});
    try {
      let receipt=await request('reserve');
      if(receipt?.ticketId!==ticket.ticketId || receipt.status!=='reserved')
        return Object.freeze({status:'native_rejected',nativeReason:nativeVeto(receipt)});
      nativeReserved=true;
      // Distinguish PS3/P2 source changes from an independent C-11 ticket,
      // cooldown, expiry or player-priority fence. Never retry a spent ticket.
      if(!this.originalGrantCurrent(proposal,stamp))
        return Object.freeze({status:'stale_after_reserve',
          diagnosticReason:'original_ps3_entitlement_changed'});
      if(!this.admission.consume(ticket.ticketId,stamp))
        return Object.freeze({status:'stale_after_reserve',
          diagnosticReason:'reservation_recheck_veto'});
      if(!this.originalGrantCurrent(proposal,stamp))
        return Object.freeze({status:'stale_before_submit'});
      receipt=await request('submit');
      if(receipt?.ticketId!==ticket.ticketId || receipt.status!=='submitted')
        return Object.freeze({status:'native_submit_rejected',nativeReason:nativeVeto(receipt)});
      if(!this.originalGrantCurrent(proposal,stamp))
        return Object.freeze({status:'stale_before_intake'});
      let hydrated=false,publication=false;
      const gates=Object.freeze({
        hydrated:()=>hydrated=this.originalGrantCurrent(proposal,stamp) &&
          this.admission.afterHydration(ticket.ticketId,stamp),
        publication:()=>publication=hydrated &&
          this.originalGrantCurrent(proposal,stamp) &&
          this.admission.beforePublication(ticket.ticketId,stamp),
      });
      const result=await this.dispatch(Object.freeze({
        ticket,proposal,stamp,gates,eventContext,
        source:'scene_director',reason:'ps6_observer',
        faceListener:false,interruptExisting:false,delayMs:0,
      }));
      if(!hydrated || !publication || !result?.tuple || !result?.terminal) {
        return Object.freeze({status:'incomplete_intake'});
      }
      if(!this.admission.bindNativeTuple(ticket.ticketId,stamp,result.tuple))
        return Object.freeze({status:'tuple_rejected'});
      const outcome=await result.terminal;
      const delivered=this.admission.finish(ticket.ticketId,result.tuple,outcome);
      return Object.freeze({status:delivered?'delivered':'not_delivered'});
    } catch {
      return Object.freeze({status:'failed'});
    } finally {
      this.admission.cancel(ticket.ticketId);
      if(nativeReserved)try{await request('cancel');}catch{}
    }
  }
}
