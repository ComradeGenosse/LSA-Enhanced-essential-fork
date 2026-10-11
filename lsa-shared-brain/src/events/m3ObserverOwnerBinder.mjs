// M3 PS2 -> P2 proof binder. The caller MUST supply an authenticated PS2 runtime
// and a synchronous, independently native-verified P2 owner ledger. A candidate
// returned here is a hint, never authority: authorize rechecks every boundary.
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

export class M3ObserverOwnerBinder {
  #ps2;#p2;#native;#participant;#prepromotion;#verifyCoverage;#requireSourceTime;#pre=new Map();
  constructor({ps2,p2,resolveNativeOwner,resolveParticipants=null,resolvePrepromotion=null,verifyNativeCoverage=null,requireSourceTimeProof=true}={}){
    if(!ps2||typeof ps2.current!=='function'||!ps2.observations?.entries||
       !ps2.observerIndex||!ps2.anchors||!p2||typeof resolveNativeOwner!=='function')
      throw new TypeError('m3_verified_ps2_p2_ports_required');
    this.#ps2=ps2;this.#p2=p2;this.#native=resolveNativeOwner;
    this.#participant=resolveParticipants;this.#prepromotion=resolvePrepromotion;
    this.#verifyCoverage=verifyNativeCoverage;this.#requireSourceTime=requireSourceTimeProof;
  }
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
      observationRevision:observation.revision})));
    if(!native?.current||native.nativeVerified!==true||!currentProof(native.ownerProof,row,host)||
       native.ownerProof.ownerAlias!==native.ownerAlias||
       !isUuid(native.characterId))return null;
    // A source-time ledger attests ownership of this exact observer at the PS2
    // observation's game tick. Current ownership alone cannot prove historical
    // witnessing after a ped handle/encounter has been recycled.
    const at=native.sourceAtObservation;
    if(this.#requireSourceTime && (!at||at.nativeVerified!==true||
       at.gameTick!==observation.observedAt.gameTick||at.adapterEpoch!==ps.epoch||
       at.hostRunId!==host.hostRunId||at.worldEpoch!==host.worldEpoch||
       at.observerCaptureRef!==ref||at.ownerAlias!==native.ownerAlias||
       at.incarnationId!==row.incarnationId||at.encounterId!==row.encounterId))return null;
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
      const proof=sync(this.#participant(Object.freeze({
        observation:source,hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,
        adapterEpoch:ps.epoch,ownerProof:native.ownerProof
      })));
      if(!Array.isArray(proof)||proof.length>16)return null;
      const refs=new Set();
      for(const p of proof){
        if(!isUuid(p?.captureRef)||refs.has(p.captureRef)||p.verified!==true||p.nativeVerified!==true||
           p.hostRunId!==host.hostRunId||p.worldEpoch!==host.worldEpoch||
           p.adapterEpoch!==ps.epoch||!ps.current(p.captureRef)||
           !['character','protagonist'].includes(p.subjectKind)||
           (p.subjectKind==='character'?!isUuid(p.subjectKey):
             !['franklin','michael','trevor'].includes(p.subjectKey)))return null;
        refs.add(p.captureRef);
        // Subject identity is attributed to a claim only if the independent
        // native participant ledger attests the source captureRef at *that*
        // claim's evidence tick. A generic current-player identity must never
        // become every actor in an entire multi-tick PS2 episode.
        const atClaims=source.claims.filter(c=>c.source?.captureRef===p.captureRef ||
          c.target?.captureRef===p.captureRef);
        if(!atClaims.length || !Number.isSafeInteger(p.sampledGameTick) ||
           atClaims.some(c=>c.evidence.sampledGameTick!==p.sampledGameTick))
          continue; // retain witnessed claim, but unknown durable actor
        participantProofs.push(p);
      }
    }
    return immutableSnapshot({promoted,current:true,characterId:native.characterId,
      worldProfileId:world,timelineId:selected,adapterEpoch:ps.epoch,
      ownerProof:native.ownerProof,participantProofs});
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
    return Object.freeze({accepted:true,observation:receipt.observation,
      candidate:immutableSnapshot({characterId:identity.characterId,
        worldProfileId:identity.worldProfileId,timelineId:identity.timelineId,
        adapterEpoch:identity.adapterEpoch,ownerProof:identity.ownerProof}),
      prepromotion});
  }
  authorize({observation,candidate,stage,prePromotionProof}={}){
    if(!['commit','promotion_commit','prepromotion'].includes(stage))return null;
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
  reset(){this.#pre.clear();}
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
