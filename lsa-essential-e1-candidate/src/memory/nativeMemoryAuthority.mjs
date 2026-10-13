// Fail-closed synchronous authority for P2 memory; NO caller-controlled nativeVerified
// flags. Only native producer receipts that passed the existing authenticated
// Intelligence pipe's stream/sequence/host validation may enter via subscribe.
// The original C-01 accepted-turn producer is not yet wired: absent an
// independently authenticated turn receipt, verifyCurrentTurn returns null.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ALIAS=/^promoted\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUUID=x=>typeof x==='string'&&UUID.test(x);
const whole=x=>Number.isSafeInteger(x)&&x>=0;
const same=(a,b,keys)=>!!a&&!!b&&keys.every(k=>a[k]===b[k]);
const ownerKeys=['hostRunId','worldEpoch','observerCaptureRef','incarnationId','encounterId','ownerAlias'];
const turnKeys=['pedId','turnId','generationId','sessionNonce'];
const immutable=value=>{
  if(Array.isArray(value))return Object.freeze(value.map(immutable));
  if(value&&typeof value==='object')
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,immutable(v)])));
  return value;
};
const validOwner=p=>p&&isUUID(p.hostRunId)&&whole(p.worldEpoch)&&p.worldEpoch>0&&
  isUUID(p.observerCaptureRef)&&isUUID(p.incarnationId)&&isUUID(p.encounterId)&&
  typeof p.ownerAlias==='string'&&ALIAS.test(p.ownerAlias)&&
  whole(p.sampledGameTick)&&p.sampledGameTick<=0xffffffff;
const validIdentity=i=>i&&typeof i.pedId==='string'&&
  i.pedId.length>0&&i.pedId.length<=128&&typeof i.turnId==='string'&&
  i.turnId.length>0&&i.turnId.length<=128&&whole(i.generationId)&&
  whole(i.sessionNonce)&&i.sessionNonce>0;
const exactKeys=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
const C01_LIFETIME_MS=1000;
const C01_ORIGIN='original_essential_c01_normal_accepted_callback';
// No original normal typed/STT accepted-turn callback is exposed at this pin.
// In particular PS3, Director stock binding, JS history and model outputs
// cannot produce this original-source receipt.
const validContext=c=>c&&isUUID(c.hostRunId)&&whole(c.worldEpoch)&&c.worldEpoch>0&&isUUID(c.adapterEpoch);
const protagonistKeys=new Set(['franklin','michael','trevor','unknown']);
const maxOwners=16;
const MAX_AGE=1000;
const OBSERVATION_SKEW_BACK=5000,OBSERVATION_SKEW_FORWARD=2000;

// The subscription MUST be the callback emitted only after successful
// ShadowRuntime.ingest(...,{authenticated:true}) on the genuine named pipe.
// Never expose a public push/setVerified method to UI, caller flags, or mocks.
export function createNativeMemoryAuthority({
  subscribeAuthenticatedNativeFrames,
  // K-only private validated-pipe callback, unavailable with the pinned ABI.
  subscribeAuthenticatedOriginalC01Frames=null,
  profileForAlias,now=()=>performance.now(),
  maxAgeMs=MAX_AGE,
  // D-023: an observation is attributed at the synchronous PS2 tap against the
  // latest authenticated owner frame. Its sampled tick must be close to that
  // frame's tick, so a stale signal cannot borrow a newer ownership proof.
  observationSkewBackTicks=OBSERVATION_SKEW_BACK,
  observationSkewForwardTicks=OBSERVATION_SKEW_FORWARD,
  // K-13: receives every ACCEPTED authenticated owner frame, and every retire,
  // for observer-coverage accounting. Late-bound object so wiring can follow
  // construction; it can read frames, never supply one.
  coverage=null
}={}) {
  if(typeof subscribeAuthenticatedNativeFrames!=='function'||
     typeof profileForAlias!=='function'||typeof now!=='function'||
     !Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>2000)
    throw new TypeError('memory_native_authenticated_ports_required');
  if(subscribeAuthenticatedOriginalC01Frames!==null&&
     typeof subscribeAuthenticatedOriginalC01Frames!=='function')
    throw new TypeError('memory_c01_authenticated_port_invalid');
  let context=null,owners=new Map(),player=null,turns=new Map(),seq=-1,lastAt=-1,frameTick=-1;
  let disconnect=null,disconnectC01=null;
  const retiredStreams=new Set();
  const sink=(method,arg)=>{try{coverage?.[method]?.(arg);}catch{/* coverage never disturbs authority */}};
  const withinSkew=tick=>Number.isSafeInteger(tick)&&frameTick>=0&&
    tick>=frameTick-observationSkewBackTicks&&tick<=frameTick+observationSkewForwardTicks;
  const clear=()=>{
    sink('retire','stream_retired');
    if(context?.streamId){
      retiredStreams.add(context.streamId);
      if(retiredStreams.size>64)retiredStreams.delete(retiredStreams.values().next().value);
    }
    context=null;owners=new Map();player=null;turns=new Map();seq=-1;lastAt=-1;frameTick=-1;
  };
  const live=()=>context&&lastAt>=0&&Number.isFinite(now())&&
    now()>=lastAt&&now()-lastAt<=maxAgeMs;
  const profileFor=alias=>{
    try {
      const p=profileForAlias(alias);
      return p&&!p.then&&isUUID(p.characterId)&&p.promotion?.ownerAlias===alias&&
        p.status!=='retired'&&p.timelineWritable!==false&&
        (p.worldEpoch===undefined||p.worldEpoch===context?.worldEpoch)?p:null;
    } catch {return null;}
  };
  const accept=receipt=>{
    // The native pipe owns the envelope. A JS-origin nativeVerified flag is
    // ignored. A stream switch invalidates ALL prior owner/turn/subject proof.
    if(!receipt?.frame)return clear();
    const f=receipt.frame,p=f.payload;
    if(f.version!==1||f.type!=='memory_authority'||!isUUID(f.streamId)||
       !isUUID(f.adapterEpoch)||!whole(f.sequence)||f.sequence<1||
       p?.memoryProofVersion!==1||!isUUID(p.hostRunId)||
       !whole(p.worldEpoch)||p.worldEpoch<1||
       !whole(p.sampledGameTick)||p.sampledGameTick>0xffffffff||
       !Array.isArray(p.owners)||p.owners.length>maxOwners||
       !Array.isArray(p.acceptedTurns)||p.acceptedTurns.length!==0)
      return clear();
    if(!context&&retiredStreams.has(f.streamId))return;
    if(context&&context.streamId!==f.streamId&&retiredStreams.has(f.streamId))return clear();
    // A reconnected authenticated stream must first publish a fresh host
    // snapshot. Monotonic sequence is required *within* each stream.
    if(context&&f.streamId===context.streamId&&
       (f.sequence<=seq||f.adapterEpoch!==context.adapterEpoch||
        p.hostRunId!==context.hostRunId||p.worldEpoch!==context.worldEpoch))
      return clear();
    const next=immutable({streamId:f.streamId,adapterEpoch:f.adapterEpoch,
      hostRunId:p.hostRunId,worldEpoch:p.worldEpoch});
    if(!validContext(next))return clear();
    const copy=new Map();
    for(const o of p.owners){
      if(!validOwner(o)||o.hostRunId!==next.hostRunId||
         o.worldEpoch!==next.worldEpoch||copy.has(o.observerCaptureRef))return clear();
      // Native captureRefs are incarnation-scoped; any same-stream recycling
      // across owners is a source-fence violation, even if the handle matches.
      const old=owners.get(o.observerCaptureRef);
      if(context&&f.streamId===context.streamId&&old&&
         !same(old,o,ownerKeys))return clear();
      copy.set(o.observerCaptureRef,immutable(o));
    }
    let subject=null;
    if(p.protagonist!==null&&p.protagonist!==undefined) {
      const x=p.protagonist;
      if(!x||!protagonistKeys.has(x.key)||x.source!=='native_player_model'||
         !whole(x.sampledGameTick)||x.sampledGameTick!==p.sampledGameTick||
         !isUUID(x.playerCaptureRef))return clear();
      subject=immutable(x);
    }
    // v1 remains owners/protagonist ONLY. Preserve a bounded separate v2
    // turn only while the new full roster and native player prove continuity.
    const compatible=context&&context.streamId===next.streamId&&
      player&&subject&&player.key===subject.key&&
      player.playerCaptureRef===subject.playerCaptureRef;
    const retained=new Map();
    if(compatible)for(const [key,receipt] of turns) {
      const owner=copy.get(receipt.ownerProof.observerCaptureRef);
      if(owner&&same(owner,receipt.ownerProof,ownerKeys)&&
         p.sampledGameTick>=receipt.acceptedGameTick&&
         p.sampledGameTick<=receipt.expiresGameTick&&
         now()-receipt.receivedAt<=C01_LIFETIME_MS)
        retained.set(key,receipt);
    }
    if(context&&context.streamId!==next.streamId)retiredStreams.add(context.streamId);
    context=next;owners=copy;player=subject;turns=retained;seq=f.sequence;lastAt=now();
    frameTick=p.sampledGameTick;
    sink('sample',{streamId:f.streamId,adapterEpoch:f.adapterEpoch,sequence:f.sequence,
      hostRunId:p.hostRunId,worldEpoch:p.worldEpoch,sampledGameTick:p.sampledGameTick,
      owners:[...copy.values()].map(o=>({ownerAlias:o.ownerAlias,observerCaptureRef:o.observerCaptureRef,
        incarnationId:o.incarnationId,encounterId:o.encounterId}))});
  };
  // This is a PROPOSED v2 contract and read-through verifier only.
  // K must NOT register it before proving a real original Core accepted
  // typed/STT callback and adding strict validation to the authenticated
  // pipe. An app/JS callback or stock Director binding is not its source.
  const acceptC01=receipt=>{
    if(!live()||!receipt?.frame)return clear();
    const f=receipt.frame,p=f.payload;
    const fields=['c01ProofVersion','source','status','sourceMode','hostRunId',
      'worldEpoch','acceptedGameTick','expiresGameTick','identity',
      'nativeOwnerPedId','ownerProof','protagonist'];
    if(f.version!==2||f.type!=='memory_c01_accepted'||
       f.streamId!==context.streamId||f.adapterEpoch!==context.adapterEpoch||
       !whole(f.sequence)||f.sequence<=seq||!exactKeys(p,fields)||
       p.c01ProofVersion!==2||p.source!==C01_ORIGIN||
       p.status!=='accepted'||!['typed','stt'].includes(p.sourceMode)||
       p.hostRunId!==context.hostRunId||p.worldEpoch!==context.worldEpoch||
       !validIdentity(p.identity)||p.nativeOwnerPedId!==p.identity.pedId||
       !whole(p.acceptedGameTick)||p.acceptedGameTick>0xffffffff||
       !whole(p.expiresGameTick)||p.expiresGameTick>0xffffffff||
       p.expiresGameTick<p.acceptedGameTick||
       p.expiresGameTick-p.acceptedGameTick>C01_LIFETIME_MS||
       !exactKeys(p.ownerProof,ownerKeys)||
       !validOwner({...p.ownerProof,sampledGameTick:p.acceptedGameTick})||
       p.ownerProof.hostRunId!==context.hostRunId||
       p.ownerProof.worldEpoch!==context.worldEpoch||
       !exactKeys(p.protagonist,['source','key','playerCaptureRef','sampledGameTick'])||
       p.protagonist.source!=='native_player_model'||
       !protagonistKeys.has(p.protagonist.key)||
       !isUUID(p.protagonist.playerCaptureRef)||
       !whole(p.protagonist.sampledGameTick)||
       p.protagonist.sampledGameTick!==p.acceptedGameTick||
       !player||player.key!==p.protagonist.key||
       player.playerCaptureRef!==p.protagonist.playerCaptureRef)return clear();
    const owner=owners.get(p.ownerProof.observerCaptureRef);
    if(!owner||!same(owner,p.ownerProof,ownerKeys)||
       p.acceptedGameTick<owner.sampledGameTick||
       p.acceptedGameTick-owner.sampledGameTick>C01_LIFETIME_MS||
       !profileFor(owner.ownerAlias))return clear();
    // A subsequent accepted turn supersedes the old generation/session.
    turns=new Map();
    const key=turnKeys.map(k=>String(p.identity[k])).join('\u001f');
    turns.set(key,immutable({...p,receivedAt:now()}));
    seq=f.sequence;
    lastAt=now();
  };
  // Called by K's native-validated pipe adapter. An untrusted direct
  // function result, mock-supplied "nativeVerified", or PS3 score is not proof.
  const stop=subscribeAuthenticatedNativeFrames(accept,clear);
  if(stop!==undefined&&typeof stop!=='function')
    throw new TypeError('memory_native_invalid_subscription');
  disconnect=stop??null;
  if(subscribeAuthenticatedOriginalC01Frames){
    const stopC01=subscribeAuthenticatedOriginalC01Frames(acceptC01,clear);
    if(stopC01!==undefined&&typeof stopC01!=='function')
      throw new TypeError('memory_c01_invalid_subscription');
    disconnectC01=stopC01??null;
  }

  function resolveNativeOwner(input={}) {
    if(!live()||!input||input.hostRunId!==context.hostRunId||
       input.worldEpoch!==context.worldEpoch||
       input.adapterEpoch!==context.adapterEpoch||
       !isUUID(input.observerCaptureRef))return null;
    const o=owners.get(input.observerCaptureRef),r=input.observerIndex;
    if(!o||!r||r.captureRef!==o.observerCaptureRef||r.kind!=='ped'||
       r.owned!==true||r.incarnationId!==o.incarnationId||
       r.encounterId!==o.encounterId)return null;
    // D-023 freshness: when the caller names the observation's tick, it must
    // sit near THIS frame's sampled tick. Coverage/negative checks pass none.
    if(input.observedGameTick!==undefined&&!withinSkew(input.observedGameTick))return null;
    const p=profileFor(o.ownerAlias);
    if(!p)return null;
    return immutable({nativeVerified:true,current:true,promoted:true,
      characterId:p.characterId,ownerAlias:o.ownerAlias,
      ownerProof:{ownerAlias:o.ownerAlias,hostRunId:o.hostRunId,
        worldEpoch:o.worldEpoch,observerCaptureRef:o.observerCaptureRef,
        incarnationId:o.incarnationId,encounterId:o.encounterId},
      // Which authenticated native frame vouched for this owner (audit trail).
      ownerEvidence:{streamId:context.streamId,sequence:seq,sampledGameTick:frameTick}});
  }
  function resolveParticipants(input={}) {
    if(!live()||!input?.observation||input.hostRunId!==context.hostRunId||
       input.worldEpoch!==context.worldEpoch||
       input.adapterEpoch!==context.adapterEpoch)return null;
    const observed=input.observation;
    const refs=new Set(observed.claims?.flatMap(c=>
      [c?.source?.captureRef,c?.target?.captureRef].filter(isUUID))||[]);
    const output=[];
    for(const ref of refs) {
      // Participant identity is scoped to the tick of the claims that name it.
      // All such claims must agree on one sampled tick (the binder requires the
      // proof tick to equal it) and that tick must be fresh against this frame.
      // A claim carrying no tick at all gets no tick-scoped proof (legacy shape).
      const ticks=(observed.claims||[]).filter(c=>c?.source?.captureRef===ref||c?.target?.captureRef===ref)
        .map(c=>c?.evidence?.sampledGameTick);
      let claimTick;
      if(ticks.some(t=>t!==undefined)){
        if(!ticks.every(t=>t===ticks[0])||!withinSkew(ticks[0]))continue;
        claimTick=ticks[0];
      }
      // Never attribute source/target from closeness, names or dialogue.
      let proof=null;
      const native=owners.get(ref);
      if(native) {
        const profile=profileFor(native.ownerAlias);
        if(profile)proof={captureRef:ref,subjectKind:'character',subjectKey:profile.characterId};
      } else if(player?.key!=='unknown'&&player?.playerCaptureRef===ref)
        proof={captureRef:ref,subjectKind:'protagonist',subjectKey:player.key};
      if(proof)output.push(immutable({...proof,verified:true,nativeVerified:true,
        hostRunId:context.hostRunId,worldEpoch:context.worldEpoch,
        adapterEpoch:context.adapterEpoch,
        ...(claimTick!==undefined?{sampledGameTick:claimTick}:{})}));
      if(output.length>16)return null;
    }
    return immutable(output);
  }
  function verifyCurrentTurn(input={}) {
    if(!live()||!validIdentity(input.identity)||!isUUID(input.characterId)||
       !ALIAS.test(input.ownerAlias||'')||input.hostRunId!==context.hostRunId||
       input.worldEpoch!==context.worldEpoch)return null;
    const key=turnKeys.map(k=>String(input.identity[k])).join('\u001f');
    const t=turns.get(key);
    if(!t||t.ownerProof.ownerAlias!==input.ownerAlias||
       now()-t.receivedAt>C01_LIFETIME_MS||
       player?.key!==t.protagonist.key||
       player?.playerCaptureRef!==t.protagonist.playerCaptureRef||
       (input.adapterEpoch!==undefined&&input.adapterEpoch!==context.adapterEpoch)||
       (input.protagonistKey!==undefined&&input.protagonistKey!==t.protagonist.key)||
       ![...owners.values()].some(o=>same(o,t.ownerProof,ownerKeys)))return null;
    const p=profileFor(t.ownerProof.ownerAlias);
    if(!p||p.characterId!==input.characterId)return null;
    return immutable({nativeVerified:true,current:true,identity:immutable(t.identity),
      characterId:p.characterId,ownerAlias:t.ownerProof.ownerAlias,
      ownerProof:t.ownerProof,hostRunId:context.hostRunId,
      worldEpoch:context.worldEpoch,adapterEpoch:context.adapterEpoch,
      streamId:context.streamId,protagonistKey:t.protagonist.key,
      originalSource:C01_ORIGIN,sourceMode:t.sourceMode});
  }
  // No native-certified NEGATIVE PS2 coverage producer exists at this SHA;
  // never infer a negative from an omitted signal or generic visual geometry.
  const verifyNativeCoverage=()=>null;
  // Pre-promotion has no native-reserved CharacterId + ownerAlias binding;
  // generic ambient observers must NOT receive memory ownership.
  const resolvePrepromotion=()=>null;
  const status=()=>immutable({connected:!!live(),
    ownerCount:live()?owners.size:0,
    c01TurnProofAvailable:live()&&[...turns.values()].some(t=>
      now()-t.receivedAt<=C01_LIFETIME_MS),
    c01ProtocolVersion:2,
    nativeNegativeCoverageAvailable:false,nativePrepromotionAvailable:false});
  return Object.freeze({verifyCurrentTurn,resolveNativeOwner,resolveParticipants,
    verifyNativeCoverage,resolvePrepromotion,status,
    close(){clear();disconnect?.();disconnectC01?.();
      disconnect=null;disconnectC01=null;}});
}
