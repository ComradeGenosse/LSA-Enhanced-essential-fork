// W02: Post-authentication native PS2 source-time evidence reader.
// There is deliberately NO public push/setNativeVerified/test-fixture API.
// K must subscribe ONLY after original authenticated pipe host/stream/sequence
// validation, and must negotiate a new m3_source_time message/capability.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuid=x=>typeof x==='string'&&UUID.test(x);
const tick=x=>Number.isSafeInteger(x)&&x>=0&&x<=0xffffffff;
const epoch=x=>Number.isSafeInteger(x)&&x>0;
const freeze=x=>x&&typeof x==='object'?Object.freeze(Array.isArray(x)?x.map(freeze):
  Object.fromEntries(Object.entries(x).map(([k,v])=>[k,freeze(v)]))):x;
const match=(a,b,keys)=>a&&b&&keys.every(k=>a[k]===b[k]);
const OWNER=['hostRunId','worldEpoch','observerCaptureRef','incarnationId','encounterId','ownerAlias'];
const KINDS=new Set(['witnessed','reported','did_not_witness']);
const modalities=new Set(['visual','auditory','self','report']);
const proofsMax=32,storedMax=2048;
const srcKey=(run,epoch,signal,observer)=>[run,epoch,signal,observer].join('|');

export function createM3SourceTimeAuthority({subscribeAuthenticatedNativeFrames,
  currentAuthority,now=()=>performance.now(),maxAgeMs=120000,onLoss=()=>{}}={}) {
  if(typeof subscribeAuthenticatedNativeFrames!=='function'||
    typeof currentAuthority?.resolveNativeOwner!=='function'||
    typeof now!=='function'||typeof onLoss!=='function'||
    !Number.isSafeInteger(maxAgeMs)||maxAgeMs<1000||maxAgeMs>120000)
    throw new TypeError('m3_source_time_authenticated_ports_required');
  let context=null,sequence=0,entries=new Map(),retired=new Set(),connected=false;
  const counters={accepted:0,duplicate:0,rejected:0,overflow:0,retired:0,sourceMissing:0,collision:0};
  const note=(kind,detail)=>{counters[kind]=Math.min(2147483647,counters[kind]+1);
    if(kind==='overflow'||kind==='collision')try{onLoss(kind,detail)}catch{};};
  const retire=()=>{
    if(context?.streamId){retired.add(context.streamId);
      if(retired.size>64)retired.delete(retired.values().next().value);}
    counters.retired=Math.min(2147483647,counters.retired+entries.size);
    context=null;sequence=0;entries=new Map();connected=false;
  };
  const valid=p=>p&&uuid(p.sourceReceiptId)&&uuid(p.signalId)&&
    uuid(p.hostRunId)&&epoch(p.worldEpoch)&&uuid(p.adapterEpoch)&&
    uuid(p.observerCaptureRef)&&uuid(p.incarnationId)&&uuid(p.encounterId)&&
    typeof p.ownerAlias==='string'&&/^promoted\.[0-9a-f-]{36}$/.test(p.ownerAlias)&&
    tick(p.sampledGameTick)&&KINDS.has(p.status)&&modalities.has(p.channel)&&
    typeof p.basis==='string'&&p.basis.length<=40&&
    p.source==='original_native_ps2_witness_sample'&&
    ((p.status==='reported')===(p.channel==='report'))&&
    (p.status!=='did_not_witness'||p.coverageCertified===true);
  const accept=(receipt)=>{
    if(!receipt?.frame)return retire();
    const f=receipt.frame,p=f.payload;
    if(f.type!=='m3_source_time'||f.version!==1||!uuid(f.streamId)||
       !uuid(f.adapterEpoch)||!Number.isSafeInteger(f.sequence)||f.sequence<1||
       p?.sourceProofVersion!==1||!uuid(p.hostRunId)||!epoch(p.worldEpoch)||
       !Array.isArray(p.proofs)||p.proofs.length>proofsMax||
       p.proofs.some(x=>!valid(x)||x.hostRunId!==p.hostRunId||
         x.worldEpoch!==p.worldEpoch||x.adapterEpoch!==f.adapterEpoch)){
      note('rejected');retire();return;
    }
    if(retired.has(f.streamId))return;
    if(context&&(f.streamId!==context.streamId ||
      f.adapterEpoch!==context.adapterEpoch||p.hostRunId!==context.hostRunId||
      p.worldEpoch!==context.worldEpoch)){
      retire(); // Require explicit, fresh adapter registration; never rebase evidence.
      if(retired.has(f.streamId))return;
    }
    if(context&&f.sequence<=sequence){note('rejected');retire();return;}
    const stamp=now();
    if(!Number.isFinite(stamp)){retire();return;}
    const scope=freeze({streamId:f.streamId,adapterEpoch:f.adapterEpoch,
      hostRunId:p.hostRunId,worldEpoch:p.worldEpoch});
    const incoming=new Set();
    for(const v of p.proofs){
      const key=srcKey(v.hostRunId,v.worldEpoch,v.signalId,v.observerCaptureRef);
      if(incoming.has(key)){note('collision');retire();return;}
      incoming.add(key);
      const prior=entries.get(key);
      if(prior && JSON.stringify(prior.proof)!==JSON.stringify(v)){
        note('collision');retire();return; // Native redelivery cannot mutate history.
      }
    }
    context=scope;sequence=f.sequence;connected=true;
    for(const v of p.proofs){
      const key=srcKey(v.hostRunId,v.worldEpoch,v.signalId,v.observerCaptureRef);
      if(entries.has(key)){note('duplicate');continue;}
      if(entries.size>=storedMax){
        const oldest=entries.keys().next().value;
        entries.delete(oldest);note('overflow',{droppedKey:oldest});
      }
      entries.set(key,{proof:freeze(v),receivedAt:stamp});
      note('accepted');
    }
    for(const [key,v] of entries)if(stamp-v.receivedAt>maxAgeMs)entries.delete(key);
  };
  const unsubscribe=subscribeAuthenticatedNativeFrames(accept,retire);
  if(unsubscribe!==undefined&&typeof unsubscribe!=='function')
    throw new TypeError('m3_authenticated_subscription_invalid');
  const live=(input)=>connected&&context&&input?.hostRunId===context.hostRunId&&
    input?.worldEpoch===context.worldEpoch&&input?.adapterEpoch===context.adapterEpoch;
  const get=(signalId,ref)=>{
    const key=srcKey(context.hostRunId,context.worldEpoch,signalId,ref);
    const row=entries.get(key),stamp=now();
    if(!row||!Number.isFinite(stamp)||stamp<row.receivedAt||
      stamp-row.receivedAt>maxAgeMs){
      if(row)entries.delete(key);return null;
    }
    return row.proof;
  };
  function resolveNativeOwner(input={}){
    if(!live(input)||!uuid(input.observationId)||!Number.isSafeInteger(input.observationRevision)||
      input.observationRevision<1||!Array.isArray(input.observation?.claims)||
      input.observation.claims.length<1||input.observation.claims.length>4||
      input.observation.observationId!==input.observationId||
      input.observation.revision!==input.observationRevision||
      input.observation.observer?.captureRef!==input.observerCaptureRef)return null;
    const base=currentAuthority.resolveNativeOwner(input);
    if(!base?.current||!base.nativeVerified||!base.ownerProof)return null;
    const results=[],seen=new Set();
    for(const claim of input.observation.claims){
      const signalId=claim?.details?.eventSignalId;
      const sampled=claim?.evidence?.sampledGameTick;
      if(!uuid(signalId)||!tick(sampled)||!uuid(claim.claimId)){
        note('sourceMissing');return null;
      }
      const native=get(signalId,input.observerCaptureRef);
      if(!native||native.status!==(claim.evidence.channel==='report'?'reported':'witnessed')||
        native.sampledGameTick!==sampled||
        native.channel!==claim.evidence.channel||
        native.basis!==claim.evidence.basis||
        !match(native,base.ownerProof,OWNER)||
        seen.has(claim.claimId)){note('sourceMissing');return null;}
      seen.add(claim.claimId);
      results.push(freeze({claimId:claim.claimId,signalId,
        sourceReceiptId:native.sourceReceiptId,sampledGameTick:sampled,
        channel:native.channel,basis:native.basis}));
    }
    if(!results.some(x=>x.sampledGameTick===input.observedGameTick))return null;
    return freeze({...base,sourceAtObservation:{
      nativeVerified:true,source:'original_native_ps2_witness_sample',
      hostRunId:context.hostRunId,worldEpoch:context.worldEpoch,
      adapterEpoch:context.adapterEpoch,observerCaptureRef:input.observerCaptureRef,
      ownerAlias:base.ownerAlias,incarnationId:base.ownerProof.incarnationId,
      encounterId:base.ownerProof.encounterId,gameTick:input.observedGameTick,
      observationId:input.observationId,revision:input.observationRevision,
      signalProofs:results}});
  }
  // Future native participant proof must be a separately sampled SOURCE-TIME
  // participant table. Current owner/protagonist from a later tick is NOT proof.
  const resolveParticipants=()=>[];
  // No continuous negative-coverage ABI at this baseline. A witness-negative
  // policy decision alone is not a certified complete coverage proof.
  const verifyNativeCoverage=()=>null;
  // No native reservation of future P2 CharacterId has been established.
  const resolvePrepromotion=()=>null;
  return Object.freeze({resolveNativeOwner,resolveParticipants,resolvePrepromotion,
    verifyNativeCoverage,retire,close(){retire();unsubscribe?.();},
    status(){return freeze({...counters,connected,retained:entries.size,
      negativeCoverageSupported:false,prepromotionSupported:false,
      participantAttributionSupported:false,gate:'K_native_registration_required'});}});
}
