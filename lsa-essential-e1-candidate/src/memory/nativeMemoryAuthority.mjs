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
const validIdentity=i=>i&&turnKeys.every(k=>i[k]!==null&&i[k]!==undefined&&
  String(i[k]).length>0&&String(i[k]).length<=128)&&whole(Number(i.sessionNonce))&&
  Number(i.sessionNonce)>0&&whole(Number(i.generationId));
const validContext=c=>c&&isUUID(c.hostRunId)&&whole(c.worldEpoch)&&c.worldEpoch>0&&isUUID(c.adapterEpoch);
const protagonistKeys=new Set(['franklin','michael','trevor','unknown']);
const maxOwners=16;
const MAX_AGE=1000;

// The subscription MUST be the callback emitted only after successful
// ShadowRuntime.ingest(...,{authenticated:true}) on the genuine named pipe.
// Never expose a public push/setVerified method to UI, caller flags, or mocks.
export function createNativeMemoryAuthority({
  subscribeAuthenticatedNativeFrames,profileForAlias,now=()=>performance.now(),
  maxAgeMs=MAX_AGE
}={}) {
  if(typeof subscribeAuthenticatedNativeFrames!=='function'||
     typeof profileForAlias!=='function'||typeof now!=='function'||
     !Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>2000)
    throw new TypeError('memory_native_authenticated_ports_required');
  let context=null,owners=new Map(),player=null,turns=new Map(),seq=-1,lastAt=-1;
  let disconnect=null;
  const clear=()=>{
    context=null;owners=new Map();player=null;turns=new Map();seq=-1;lastAt=-1;
  };
  const live=()=>context&&lastAt>=0&&Number.isFinite(now())&&
    now()>=lastAt&&now()-lastAt<=maxAgeMs;
  const profileFor=alias=>{
    try {
      const p=profileForAlias(alias);
      return p&&!p.then&&isUUID(p.characterId)&&p.promotion?.ownerAlias===alias&&
        p.status!=='retired'?p:null;
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
       !Array.isArray(p.acceptedTurns||[])||(p.acceptedTurns||[]).length>32)
      return clear();
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
         (x.key!=='unknown'&&!isUUID(x.playerCaptureRef)))return clear();
      subject=immutable(x);
    }
    // Exact native C-01 accepted-turn receipts only, when that producer
    // exists. Director stock generation receipts are NOT C-01 evidence.
    const turnMap=new Map();
    for(const t of p.acceptedTurns||[]){
      if(!validIdentity(t.identity)||!validOwner(t.ownerProof)||
         !copy.has(t.ownerProof.observerCaptureRef)||
         !same(t.ownerProof,copy.get(t.ownerProof.observerCaptureRef),ownerKeys)||
         t.source!=='original_c01_accepted_turn'||t.status!=='accepted'||
         typeof t.ownerAlias!=='string'||t.ownerAlias!==t.ownerProof.ownerAlias||
         !protagonistKeys.has(t.protagonistKey))return clear();
      const k=turnKeys.map(key=>String(t.identity[key])).join('\u001f');
      if(turnMap.has(k))return clear();
      turnMap.set(k,immutable(t));
    }
    context=next;owners=copy;player=subject;turns=turnMap;seq=f.sequence;lastAt=now();
  };
  // Called by K's native-validated pipe adapter. An untrusted direct
  // function result, mock-supplied "nativeVerified", or PS3 score is not proof.
  const stop=subscribeAuthenticatedNativeFrames(accept,clear);
  if(stop!==undefined&&typeof stop!=='function')
    throw new TypeError('memory_native_invalid_subscription');
  disconnect=stop??null;

  function resolveNativeOwner(input={}) {
    if(!live()||!input||input.hostRunId!==context.hostRunId||
       input.worldEpoch!==context.worldEpoch||
       input.adapterEpoch!==context.adapterEpoch||
       !isUUID(input.observerCaptureRef))return null;
    const o=owners.get(input.observerCaptureRef),r=input.observerIndex;
    if(!o||!r||r.captureRef!==o.observerCaptureRef||r.kind!=='ped'||
       r.owned!==true||r.incarnationId!==o.incarnationId||
       r.encounterId!==o.encounterId)return null;
    const p=profileFor(o.ownerAlias);
    if(!p)return null;
    return immutable({nativeVerified:true,current:true,promoted:true,
      characterId:p.characterId,ownerAlias:o.ownerAlias,
      ownerProof:{ownerAlias:o.ownerAlias,hostRunId:o.hostRunId,
        worldEpoch:o.worldEpoch,observerCaptureRef:o.observerCaptureRef,
        incarnationId:o.incarnationId,encounterId:o.encounterId}});
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
        adapterEpoch:context.adapterEpoch}));
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
    if(!t||t.ownerAlias!==input.ownerAlias||
       player?.key!==t.protagonistKey||
       ![...owners.values()].some(o=>same(o,t.ownerProof,ownerKeys)))return null;
    const p=profileFor(t.ownerAlias);
    if(!p||p.characterId!==input.characterId)return null;
    return immutable({nativeVerified:true,current:true,characterId:p.characterId,
      ownerAlias:t.ownerAlias,hostRunId:context.hostRunId,
      worldEpoch:context.worldEpoch,protagonistKey:t.protagonistKey});
  }
  // No native-certified NEGATIVE PS2 coverage producer exists at this SHA;
  // never infer a negative from an omitted signal or generic visual geometry.
  const verifyNativeCoverage=()=>null;
  // Pre-promotion has no native-reserved CharacterId + ownerAlias binding;
  // generic ambient observers must NOT receive memory ownership.
  const resolvePrepromotion=()=>null;
  const status=()=>immutable({connected:!!live(),
    ownerCount:live()?owners.size:0,
    c01TurnProofAvailable:live()&&turns.size>0,
    nativeNegativeCoverageAvailable:false,nativePrepromotionAvailable:false});
  return Object.freeze({verifyCurrentTurn,resolveNativeOwner,resolveParticipants,
    verifyNativeCoverage,resolvePrepromotion,status,
    close(){clear();disconnect?.();disconnect=null;}});
}
