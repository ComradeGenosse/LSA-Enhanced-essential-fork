import {selectDirectorIntent} from './sceneDirector.mjs';

// Bounded companion-side source adapter. Runs only when the authenticated PS
// pipeline changes; it never scans GTA, drives kb, creates turns, or fabricates
// source receipts. The coordinator owns all native and stock admission gates.
export class DirectorObservationPump {
  constructor({client,coordinator,now=()=>client.runtime.now(),stampFor=()=>null,onResult=()=>{}}={}) {
    if(!client?.runtime || typeof coordinator?.attempt!=='function' ||
       typeof now!=='function' || typeof stampFor!=='function' ||
       typeof onResult!=='function')throw new TypeError('director_pump_dependencies');
    this.client=client;this.coordinator=coordinator;
    this.now=now;this.stampFor=stampFor;this.onResult=onResult;
    this.seen=new Map();this.epoch=null;this.world=null;this.inFlight=false;this.stopped=false;
  }
  stop() {this.stopped=true;this.seen.clear();}
  // The original P2 source supplies ownership; the native Core read supplies
  // the actual current player-turn revision. No JS zero/quiet fallback.
  currentStamp(proposal) {
    const runtime=this.client.runtime, priority=runtime.directorPriority;
    const owner=runtime.directorOwnerProofFor(proposal.speakerCaptureRef);
    const now=this.now();
    if(!priority || !priority.experimentalEnabled || !owner ||
       !Number.isSafeInteger(priority.playerTurnVersion) ||
       priority.playerTurnVersion<0 || !Number.isSafeInteger(priority.receivedAt) ||
       now<priority.receivedAt || now-priority.receivedAt>1500 ||
       priority.hostRunId!==owner.hostRunId ||
       priority.worldEpoch!==owner.worldEpoch || !runtime.current(proposal.playerCaptureRef))
      return null;
    return Object.freeze({...owner,
      playerCaptureRef:proposal.playerCaptureRef,
      playerTurnVersion:priority.playerTurnVersion,
      policyVersion:proposal.policyVersion});
  }
  async tick() {
    if(this.stopped || this.inFlight)return null;
    const runtime=this.client.runtime,epoch=runtime.epoch;
    const world=runtime.hostContext?.worldEpoch??null;
    if(epoch!==this.epoch || world!==this.world){
      this.seen.clear();this.epoch=epoch;this.world=world;
    }
    if(!epoch || runtime.directorRequestVersion!==1)return null;
    const players=[...runtime.anchors.values()].filter(a=>a.kind==='player' && runtime.current(a.captureRef));
    if(players.length!==1)return null;
    const player=players[0].captureRef,now=this.now();
    if(!Number.isSafeInteger(now) || now<0)return null;
    // Expire old attempted decisions; extended sessions must not permanently
    // exhaust a bounded 128-entry de-duplication table.
    for(const [key,at] of this.seen)if(at<=now-600_000)this.seen.delete(key);
    // Native observer membership and P2 owner lifetime are prerequisite
    // evidence. Never infer ownership from the latest conversation target.
    const eligible=[];
    for(const [speaker,index] of runtime.observerIndex) {
      if(eligible.length>=16)break;
      if(!index?.owned || index.kind!=='ped' || !runtime.current(speaker) ||
         !runtime.directorOwnerProofFor(speaker))continue;
      const candidates=runtime.directorCandidatesFor(speaker);
      const facts={speakerCaptureRef:speaker,playerCaptureRef:player,nowMonotonicMs:now};
      const proposal=selectDirectorIntent(candidates,facts);
      if(!proposal || this.seen.has(proposal.decisionKey))continue;
      eligible.push({speaker,candidates,facts,proposal});
    }
    eligible.sort((a,b)=>(b.proposal.urgency==='urgent')-(a.proposal.urgency==='urgent') ||
      a.proposal.expiresAtMonotonicMs-b.proposal.expiresAtMonotonicMs ||
      a.proposal.observationId.localeCompare(b.proposal.observationId));
    const selected=eligible[0];
    if(!selected)return null;
    // An attempted original decision key is spent for this producer epoch.
    // Capacity exhaustion is a veto, never implicit eviction/retry.
    if(this.seen.size>=128)return null;
    this.seen.set(selected.proposal.decisionKey,now);
    this.inFlight=true;
    try {
      let stamp=null;
      try {stamp=this.stampFor(selected.proposal,selected.facts);}catch{}
      const outcome=await this.coordinator.attempt({
        candidates:selected.candidates,facts:selected.facts,stamp,
      });
      try {this.onResult(outcome);}catch{}
      return outcome;
    } catch {
      const result=Object.freeze({status:'producer_failed'});
      try {this.onResult(result);}catch{}
      return result;
    } finally {this.inFlight=false;}
  }
}
