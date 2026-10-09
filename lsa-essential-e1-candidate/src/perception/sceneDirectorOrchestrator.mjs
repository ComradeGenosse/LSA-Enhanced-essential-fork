import {selectDirectorIntent} from './sceneDirector.mjs';

// Coordinator for the existing PS3 -> C-11 -> Essential seam. No world scan,
// second executor, retry policy, provider, memory writer or TASK is created.
// The native request and actual kb driver are mandatory injected authorities.
export class SceneDirectorSpeech {
  constructor({admission,nativeRequest,dispatch,now,mode='off'}={}) {
    if(!admission || typeof nativeRequest!=='function' ||
       typeof dispatch!=='function' || typeof now!=='function')
      throw new TypeError('director_dependencies_required');
    this.admission=admission;this.nativeRequest=nativeRequest;
    this.dispatch=dispatch;this.now=now;
    this.mode=['off','shadow','active'].includes(mode)?mode:'off';
  }
  setMode(mode){
    if(!['off','shadow','active'].includes(mode))throw new TypeError('director_mode');
    this.mode=mode;
    if(mode!=='active')this.admission.setEnabled(false);
  }
  async attempt({candidates=[],facts,stamp}={}) {
    if(this.mode==='off')return Object.freeze({status:'off'});
    const proposal=selectDirectorIntent(candidates,facts);
    if(!proposal)return Object.freeze({status:'no_eligible_evidence'});
    if(this.mode==='shadow')return Object.freeze({status:'shadow',observationId:proposal.observationId});
    // Active is impossible with the current native preview-only endpoint; the
    // caller must supply an authenticated native submit and exact stock driver.
    const ticket=this.admission.reserve(proposal,stamp);
    if(!ticket)return Object.freeze({status:'not_admitted'});
    let nativeReserved=false;
    const currentAge=()=>Math.max(0,this.now()-facts.nowMonotonicMs);
    const request=async operation=>this.nativeRequest({operation,ticket,proposal,stamp,ageMs:currentAge()});
    try {
      let receipt=await request('reserve');
      if(receipt?.ticketId!==ticket.ticketId || receipt.status!=='reserved')
        return Object.freeze({status:'native_rejected'});
      nativeReserved=true;
      if(!this.admission.consume(ticket.ticketId,stamp))
        return Object.freeze({status:'stale_after_reserve'});
      receipt=await request('submit');
      if(receipt?.ticketId!==ticket.ticketId || receipt.status!=='submitted')
        return Object.freeze({status:'native_submit_rejected'});
      let hydrated=false,publication=false;
      const gates=Object.freeze({
        hydrated:()=>hydrated=this.admission.afterHydration(ticket.ticketId,stamp),
        publication:()=>publication=this.admission.beforePublication(ticket.ticketId,stamp),
      });
      const result=await this.dispatch(Object.freeze({
        ticket,proposal,stamp,gates,
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
