// M3 PS2 -> P2 proof binder. The caller MUST supply an authenticated PS2 runtime
// and a synchronous, independently native-verified P2 owner ledger. A candidate
// returned here is a hint, never authority: authorize rechecks every boundary.
import {randomUUID} from 'node:crypto';
import {isUuid, immutableSnapshot} from '../util/identity.mjs';
import {samePhysicalOwner,validOwnerProof} from './journalEventNormalizer.mjs';

const same=(a,b)=>a!==undefined&&a===b;
const currentProof=(p,r,h)=>validOwnerProof(p)&&
  p.hostRunId===h.hostRunId&&p.worldEpoch===h.worldEpoch&&
  p.observerCaptureRef===r.captureRef&&p.incarnationId===r.incarnationId&&
  p.encounterId===r.encounterId;
const matches=(a,b)=>a&&b&&['characterId','worldProfileId','timelineId','adapterEpoch'].every(k=>same(a[k],b[k]))&&
  samePhysicalOwner(a.ownerProof,b.ownerProof);
const sync=v=>{if(v&&typeof v.then==='function')throw new Error('m3_async_authority_refused');return v;};

const TICKET_LIMIT=4096;
// Attribution modes (decision D-023):
//  * 'observation_time' - at the SYNCHRONOUS verified PS2 accepted-observation
//    tap, the PS observer index {captureRef,owned,encounterId,incarnationId}, the
//    native P2 owner inspection {encounterId,incarnationId}, current owner
//    evidence and hostRunId/worldEpoch all agree for ONE live P2 profile. The
//    verified identity is frozen into a single-use ticket; the later commit
//    re-checks the ticket and the P2 write fence, not live ped state. A native
//    source-time ledger is optional corroboration: when present it must verify.
//  * 'source_time' - the legacy strict mode: a native source-time ledger is
//    REQUIRED and the full verification repeats at commit.
export class M3ObserverOwnerBinder {
  #ps2;#p2;#native;#participant;#prepromotion;#verifyCoverage;#attribution;#pre=new Map();#tickets=new Map();
  constructor({ps2,p2,resolveNativeOwner,resolveParticipants=null,resolvePrepromotion=null,verifyNativeCoverage=null,
    attribution,requireSourceTimeProof=true}={}){
    if(!ps2||typeof ps2.current!=='function'||!ps2.observations?.entries||
       !ps2.observerIndex||!ps2.anchors||!p2||typeof resolveNativeOwner!=='function')
      throw new TypeError('m3_verified_ps2_p2_ports_required');
    this.#ps2=ps2;this.#p2=p2;this.#native=resolveNativeOwner;
    this.#participant=resolveParticipants;this.#prepromotion=resolvePrepromotion;
    this.#verifyCoverage=verifyNativeCoverage;
    this.#attribution=attribution??(requireSourceTimeProof===false?'observation_time':'source_time');
    if(!['observation_time','source_time'].includes(this.#attribution))
      throw new TypeError('m3_unknown_attribution_mode');
  }
  get attribution(){return this.#attribution;}
  #key(observation){return [observation.observedAt?.nativeRun,observation.observer?.captureRef,observation.observationId,observation.revision].join(':');}
  #verify(observation,stage,receipt=null,allowArchived=false) {
    if(!observation||observation.version!==1||!isUuid(observation.observationId))return null;
    const ps=this.#ps2,ref=observation.observer?.captureRef;
    const row=ps.observerIndex.get(ref),anchor=ps.anchors.get(ref);
    const stored=ps.observations.entries.get(`${ref}:${observation.episodeId}`)?.value;
    const source=stored??(allowArchived?observation:null);
    const host=ps.hostContext,p2host=this.#p2.verifiedHostContext;
    if(!host||!p2host||!isUuid(ps.epoch)||!ps.current(ref)||
       !row?.owned||row.kind!=='ped'||!anchor?.observer||!anchor.owned||
       anchor.kind!=='ped'||!isUuid(row.incarnationId)||!isUuid(row.encounterId)||
       !source||source.observationId!==observation.observationId||
       source.revision!==observation.revision||
       JSON.stringify(source)!==JSON.stringify(observation)||
       host.hostRunId!==p2host.hostRunId||host.worldEpoch!==p2host.worldEpoch||
       ps.epoch!==observation.observedAt?.nativeRun)return null;
    if(receipt&&(receipt.adapterEpoch!==ps.epoch||
       receipt.hostRunId!==host.hostRunId||receipt.worldEpoch!==host.worldEpoch||
       JSON.stringify(receipt.observerIndex)!==JSON.stringify(row)))return null;
    // Native verification is supplied from the checked owner ledger, not from
    // an actor object, caller candidate, salience score, or observed ped handle.
    const resolver=stage==='prepromotion'?this.#prepromotion:this.#native;
    if(typeof resolver!=='function')return null;
    const native=sync(resolver(Object.freeze({observerCaptureRef:ref,observerIndex:row,
      hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,adapterEpoch:ps.epoch,
      observedGameTick:observation.observedAt.gameTick,observationId:observation.observationId,
      observationRevision:observation.revision,observation:source})));
    if(!native?.current||native.nativeVerified!==true||!currentProof(native.ownerProof,row,host)||
       native.ownerProof.ownerAlias!==native.ownerAlias||
       !isUuid(native.characterId))return null;
    // A source-time ledger attests ownership of this exact observer at the PS2
    // observation's game tick. Current ownership alone cannot prove historical
    // witnessing after a ped handle/encounter has been recycled.
    const at=native.sourceAtObservation;
    if((this.#attribution==='source_time'||(at!==undefined&&at!==null)) && (!at||at.nativeVerified!==true||
       at.gameTick!==observation.observedAt.gameTick||at.adapterEpoch!==ps.epoch||
       at.hostRunId!==host.hostRunId||at.worldEpoch!==host.worldEpoch||
       at.observerCaptureRef!==ref||at.ownerAlias!==native.ownerAlias||
       at.incarnationId!==row.incarnationId||at.encounterId!==row.encounterId||
       at.source!=='original_native_ps2_witness_sample'||
       at.observationId!==observation.observationId||at.revision!==observation.revision||
       !Array.isArray(at.signalProofs)||
       at.signalProofs.length!==source.claims.length||
       source.claims.some((claim,i)=>{
         const proof=at.signalProofs[i];
         return !proof||proof.claimId!==claim.claimId||
           proof.signalId!==claim.details?.eventSignalId||
           proof.sampledGameTick!==claim.evidence?.sampledGameTick||
           proof.channel!==claim.evidence?.channel||
           proof.basis!==claim.evidence?.basis||
           !isUuid(proof.sourceReceiptId);
       })))return null;
    const selected=this.#p2.activeTimelineId,world=this.#p2.worldProfileId;
    if(!isUuid(selected)||!isUuid(world)||this.#p2.timelineWritable!==true)return null;
    const profile=(this.#p2.snapshot?.profiles||[]).find(p=>
      p.characterId===native.characterId&&p.promotion?.ownerAlias===native.ownerAlias&&p.status!=='retired');
    const promoted=!!profile&&stage!=='prepromotion';
    if(stage==='prepromotion') {
      // Grace requires a native-reserved future characterId and the same
      // stable owner alias BEFORE promotion; generic nearby NPCs cannot enter.
      if(profile||native.promoted!==false||native.reserved!==true)return null;
    } else if(!profile||native.promoted!==true)return null;
    let participantProofs=[];
    if(promoted&&this.#participant){
      let raw=null;
      try {
        raw=sync(this.#participant(Object.freeze({
          observation:source,hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,
          adapterEpoch:ps.epoch,ownerProof:native.ownerProof
        })));
      } catch {/* Missing participant authority is not missing PS2 witnessing. */}
      const proofs=Array.isArray(raw)&&raw.length<=16?raw:[];
      // Ambiguous duplicate capture refs prove *no* participant identity.
      const counts=new Map();
      for(const p of proofs)if(isUuid(p?.captureRef))
        counts.set(p.captureRef,(counts.get(p.captureRef)??0)+1);
      for(const p of proofs){
        if(!isUuid(p?.captureRef)||counts.get(p.captureRef)!==1||
           p.verified!==true||p.nativeVerified!==true||
           p.hostRunId!==host.hostRunId||p.worldEpoch!==host.worldEpoch||
           p.adapterEpoch!==ps.epoch||!ps.current(p.captureRef)||
           !['character','protagonist'].includes(p.subjectKind)||
           (p.subjectKind==='character'?!isUuid(p.subjectKey):
             !['franklin','michael','trevor'].includes(p.subjectKey)))continue;
        // A native participant identity is scoped to the claim evidence tick.
        // Invalid, partial, conflicting or missing actor proof stays unknown;
        // it must not discard the real PS2 witnessed observation itself.
        const atClaims=source.claims.filter(c=>c.source?.captureRef===p.captureRef ||
          c.target?.captureRef===p.captureRef);
        if(!atClaims.length || !Number.isSafeInteger(p.sampledGameTick) ||
           atClaims.some(c=>c.evidence.sampledGameTick!==p.sampledGameTick))continue;
        participantProofs.push(p);
      }
    }
    let attribution;
    if(this.#attribution==='observation_time'&&stage!=='prepromotion'){
      const frame=native.ownerEvidence;
      if(frame!==undefined&&frame!==null&&(!isUuid(frame.streamId)||
         !Number.isSafeInteger(frame.sequence)||frame.sequence<0||
         !Number.isSafeInteger(frame.sampledGameTick)||frame.sampledGameTick<0||
         Object.keys(frame).length!==3))return null;
      attribution={version:1,mode:at?'source_time':'observation_time',decision:'D-023',
        observerIndex:{captureRef:ref,incarnationId:row.incarnationId,encounterId:row.encounterId},
        ownerFrame:frame?{streamId:frame.streamId,sequence:frame.sequence,
          sampledGameTick:frame.sampledGameTick}:null,
        observationTick:observation.observedAt.gameTick,
        ...(at?{sourceReceipts:at.signalProofs.map(p=>p.sourceReceiptId)}:{})};
    }
    return immutableSnapshot({promoted,current:true,characterId:native.characterId,
      worldProfileId:world,timelineId:selected,adapterEpoch:ps.epoch,
      ownerProof:native.ownerProof,participantProofs,
      ...(attribution?{attribution}:{}),
      // Optional corroboration only (D-023); never a prerequisite.
      sourceTimeEvidence:at});
  }
  // Called only from ShadowRuntime.acceptedObservationTap, which authenticates
  // its wire input and verifies the correlator actually accepted this receipt.
  bindAcceptedReceipt(receipt,{prepromotion=false}={}){
    const identity=this.#verify(receipt?.observation,prepromotion?'prepromotion':'commit',receipt);
    if(!identity)return Object.freeze({accepted:false,reason:'m3_native_owner_unverified'});
    if(prepromotion){
      const key=this.#key(receipt.observation),now=performance.now();
      for(const [k,v] of this.#pre)if(now-v.at>120000)this.#pre.delete(k);
      if(this.#pre.size>=128)this.#pre.delete(this.#pre.keys().next().value);
      this.#pre.set(key,{at:now,proof:identity.ownerProof,characterId:identity.characterId,raw:JSON.stringify(receipt.observation)});
    }
    let ticketId;
    if(this.#attribution==='observation_time'&&!prepromotion){
      ticketId=randomUUID();
      this.#tickets.set(ticketId,Object.freeze({identity,key:this.#key(receipt.observation),
        raw:JSON.stringify(receipt.observation)}));
      while(this.#tickets.size>TICKET_LIMIT)this.#tickets.delete(this.#tickets.keys().next().value);
    }
    return Object.freeze({accepted:true,observation:receipt.observation,
      candidate:immutableSnapshot({characterId:identity.characterId,
        worldProfileId:identity.worldProfileId,timelineId:identity.timelineId,
        adapterEpoch:identity.adapterEpoch,ownerProof:identity.ownerProof,
        ...(ticketId?{ticketId}:{})}),
      prepromotion});
  }
  // Commit-time check for an observation-time ticket. It never re-resolves live
  // ped state: a later despawn must not erase a witnessed event, and a recycled
  // handle must not rewrite who witnessed it. It does fail closed on every
  // boundary that invalidates the WRITE: native run, host epoch, timeline
  // selection/writability, and the profile still owning the alias.
  #authorizeTicket(observation,candidate) {
    const ticket=this.#tickets.get(candidate?.ticketId);
    if(!ticket||ticket.key!==this.#key(observation)||ticket.raw!==JSON.stringify(observation))return null;
    const id=ticket.identity,ps=this.#ps2,host=ps.hostContext,p2host=this.#p2.verifiedHostContext;
    if(!host||!p2host||host.hostRunId!==id.ownerProof.hostRunId||host.worldEpoch!==id.ownerProof.worldEpoch||
       p2host.hostRunId!==host.hostRunId||p2host.worldEpoch!==host.worldEpoch||ps.epoch!==id.adapterEpoch||
       this.#p2.worldProfileId!==id.worldProfileId||this.#p2.activeTimelineId!==id.timelineId||
       this.#p2.timelineWritable!==true||!matches(id,candidate))return null;
    const profile=(this.#p2.snapshot?.profiles||[]).find(p=>p.characterId===id.characterId&&
      p.promotion?.ownerAlias===id.ownerProof.ownerAlias&&p.status!=='retired');
    if(!profile)return null;
    this.#tickets.delete(candidate.ticketId); // single use: no replay of one verification
    return id;
  }
  authorize({observation,candidate,stage,prePromotionProof}={}){
    if(!['commit','promotion_commit','prepromotion'].includes(stage))return null;
    if(stage==='commit'&&this.#attribution==='observation_time')return this.#authorizeTicket(observation,candidate);
    if(stage==='promotion_commit'){
      const past=this.#pre.get(this.#key(observation));
      if(!past||past.characterId!==candidate?.characterId||performance.now()-past.at>120000||
         past.raw!==JSON.stringify(observation)||
         !samePhysicalOwner(past.proof,prePromotionProof))return null;
      const identity=this.#verify(observation,'commit',null,true);
      return matches(identity,candidate)&&samePhysicalOwner(identity.ownerProof,past.proof)?identity:null;
    }
    const identity=this.#verify(observation,stage);
    return matches(identity,candidate)?identity:null;
  }
  reset(){this.#pre.clear();this.#tickets.clear();}
  // No negative event is inferred from the absence of a PS2 observation.
  // Coverage requires a separately source-authenticated native receipt.
  authorizeCoverage({candidate,coverageReceipt,status,observationId}={}){
    const ps=this.#ps2,ref=candidate?.ownerProof?.observerCaptureRef;
    const row=ps.observerIndex.get(ref),anchor=ps.anchors.get(ref);
    const host=ps.hostContext,p2host=this.#p2.verifiedHostContext;
    if(!host||!p2host||!ps.current(ref)||!anchor?.observer||!anchor.owned||
       !row?.owned||!row.incarnationId||!row.encounterId||
       host.hostRunId!==p2host.hostRunId||host.worldEpoch!==p2host.worldEpoch||
       !currentProof(candidate.ownerProof,row,host)||candidate.adapterEpoch!==ps.epoch||
       this.#p2.activeTimelineId!==candidate.timelineId||!this.#p2.timelineWritable)return null;
    const current=sync(this.#native({observerCaptureRef:ref,observerIndex:row,
      hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,adapterEpoch:ps.epoch}));
    const profile=this.#p2.snapshot?.profiles?.find(p=>p.characterId===candidate.characterId&&
      p.promotion?.ownerAlias===candidate.ownerProof.ownerAlias&&p.status!=='retired');
    if(!current?.current||current.nativeVerified!==true||current.promoted!==true||
       current.characterId!==candidate.characterId||current.ownerAlias!==candidate.ownerProof.ownerAlias||!profile||
       !samePhysicalOwner(current.ownerProof,candidate.ownerProof)||
       candidate.worldProfileId!==this.#p2.worldProfileId)return null;
    let nativeCoverage=null;
    if(status==='did_not_witness'){
      if(typeof this.#verifyCoverage!=='function')return null;
      nativeCoverage=sync(this.#verifyCoverage({candidate,coverageReceipt,
        hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,adapterEpoch:ps.epoch,
        observerCaptureRef:ref,observationId}));
      if(!nativeCoverage||nativeCoverage.certified!==true||
         nativeCoverage.status!=='did_not_witness'||
         nativeCoverage.observerCaptureRef!==ref||
         nativeCoverage.hostRunId!==host.hostRunId||
         nativeCoverage.worldEpoch!==host.worldEpoch||
         nativeCoverage.adapterEpoch!==ps.epoch||
         nativeCoverage.observationId!==observationId||
         nativeCoverage.ownerAlias!==candidate.ownerProof.ownerAlias||
         nativeCoverage.incarnationId!==row.incarnationId||
         nativeCoverage.encounterId!==row.encounterId)return null;
    }
    return immutableSnapshot({...candidate,current:true,promoted:true,nativeCoverage});
  }
}
