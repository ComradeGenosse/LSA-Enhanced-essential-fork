// D02: CURRENT native P2 owner/controlled-player corroboration. Not an
// ordinary accepted typed/STT callback and never an acceptance producer.
// Only K can provide the private post-authenticated intelligence-pipe port.
// A caller-supplied frame, callback, nativeVerified flag, pedId, or transcript
// is NOT native provenance. K must keep admission and registration private.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ALIAS=/^promoted\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PED=/^[1-9][0-9]{0,9}$/;
const AVATARS=new Set(['franklin','michael','trevor','unknown']);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const uuid=x=>typeof x==='string'&&UUID.test(x);
const exact=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===k.length&&k.every(key=>Object.hasOwn(o,key));
const ownerFields=['observerCaptureRef','incarnationId','encounterId',
  'ownerAlias','hostRunId','worldEpoch','nativeActorPedId','sampledGameTick'];
const playerFields=['source','key','playerCaptureRef','sampledGameTick'];
const contextFields=['streamId','adapterEpoch','hostRunId','worldEpoch'];
const turnFields=['pedId','turnId','generationId','sessionNonce'];
const same=(a,b,keys)=>!!a&&!!b&&keys.every(k=>a[k]===b[k]);
const freeze=v=>v&&typeof v==='object'?Object.freeze(Array.isArray(v)?
  v.map(freeze):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,freeze(x)]))):v;
const validTurn=i=>exact(i,turnFields)&&PED.test(i.pedId)&&
  typeof i.turnId==='string'&&i.turnId.length>0&&i.turnId.length<=128&&
  integer(i.generationId)&&integer(i.sessionNonce)&&i.sessionNonce>0;
const validOwner=(o,p)=>exact(o,ownerFields)&&uuid(o.observerCaptureRef)&&
  uuid(o.incarnationId)&&uuid(o.encounterId)&&ALIAS.test(o.ownerAlias)&&
  o.hostRunId===p.hostRunId&&o.worldEpoch===p.worldEpoch&&
  PED.test(o.nativeActorPedId)&&o.sampledGameTick===p.sampledGameTick;
const validPlayer=(s,p)=>exact(s,playerFields)&&
  s.source==='native_player_model'&&AVATARS.has(s.key)&&
  uuid(s.playerCaptureRef)&&s.sampledGameTick===p.sampledGameTick;
const MAX_OWNERS=16, SOURCE='native_p2_owner_fiber_current_only';
const PAYLOAD=['nativeOwnerPlayerProofVersion','source','hostRunId',
  'worldEpoch','sampledGameTick','owners','protagonist'];

// The subscription callback must be invoked ONLY after K's original
// authenticated Native IntelligenceClient socket + ShadowRuntime.ingest
// validates the frame, host epoch, sequence, schema and source negotiation.
// This module enforces a SECOND, independent synchronous read-through fence.
// It cannot authenticate a socket by itself; never use a test fixture as one.
//
// Lease lifetime (D01/D03 integration correction): a lease is bound to the
// exact native owner record (observer captureRef, incarnation, encounter,
// ped, alias), the controlled-player subject and the authenticated stream
// context. It stays usable while that owner remains a CONTINUOUS member of
// every complete owner sample on the same stream. Native re-sends the full
// anchor/observer roster every 1000 ms; that maintenance is not an owner
// change, so it no longer wipes leases. It unsettles the source instead: no
// proof is issued until a complete owner sample NEWER than the roster frame
// re-confirms the identical record. Drop-out from any sample, explicit native
// retirement, record change, avatar/player switch, stream/host/world change,
// invalid frame or replay still revoke. leaseMs is only a turn-scale backstop;
// D03 revokes each lease when its turn ends.
export function createNativeCurrentOwnerPlayerAuthority({
  subscribeAuthenticatedNativeOwnerPlayerFrames,
  profileForAlias,
  sourceStillCurrent=null,
  now=()=>performance.now(),
  maxAgeMs=750,
  leaseMs=60_000
}={}) {
  if(typeof subscribeAuthenticatedNativeOwnerPlayerFrames!=='function'||
     typeof profileForAlias!=='function'||typeof now!=='function'||
     (sourceStillCurrent!==null&&typeof sourceStillCurrent!=='function')||
     !Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>1000||
     !Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>120_000)
    throw new TypeError('native_current_owner_private_ports_required');
  let context=null, owners=new Map(), subject=null, sequence=-1,
    gameTick=-1, receivedAt=-1, stop=null, leases=new WeakMap(), settled=false;
  const retiredStreams=new Set(), retiredRefs=new Set(), ownerHistory=new Map();
  // Roster maintenance keeps the authenticated context, last complete owner
  // set (so the next sample's drop-out diff still retires missing owners),
  // subject, sequence and leases, but unsettles verification. Terminal source
  // faults retire the stream until a new authenticated hello.
  const clear=(reason='terminal',revokedRefs=[])=>{
    if(reason==='roster' && Array.isArray(revokedRefs))
      for(const ref of revokedRefs)if(uuid(ref))retiredRefs.add(ref);
    if(reason==='roster'){settled=false;return;}
    if(reason!=='roster') {
      if(context?.streamId) {
        retiredStreams.add(context.streamId);
        if(retiredStreams.size>64)retiredStreams.delete(retiredStreams.values().next().value);
      }
      ownerHistory.clear();retiredRefs.clear();
    }
    context=null;owners=new Map();subject=null;sequence=-1;
    gameTick=-1;receivedAt=-1;leases=new WeakMap();settled=false;
  };
  const live=()=>!!context&&Number.isFinite(now())&&
    now()>=receivedAt&&now()-receivedAt<=maxAgeMs;
  // K's synchronous live ShadowRuntime check detects expiry or owner retirement
  // even between source-frame deliveries. The optional port is supplied by
  // the production bootstrap; fixture-only standalone policy tests omit it.
  const current=(owner,player)=>{
    try{return sourceStillCurrent===null || sourceStillCurrent(context,owner,player)===true;}
    catch{return false;}
  };
  const profile=alias=>{
    try {
      const p=profileForAlias(alias);
      // Missing P2 timeline state is not an authorization.
      return p&&!p.then&&uuid(p.characterId)&&p.promotion?.ownerAlias===alias&&
        p.status!=='retired'&&p.timelineWritable===true&&
        (p.worldEpoch===undefined||p.worldEpoch===context?.worldEpoch)?p:null;
    }catch {return null;}
  };
  const take=receipt=>{
    const f=receipt?.frame,p=f?.payload, stamp=now();
    if(!Number.isFinite(stamp)||!f||f.type!=='memory_current_owner_player'||
       f.version!==1||!uuid(f.streamId)||!uuid(f.adapterEpoch)||
       !integer(f.sequence)||f.sequence<1||!exact(p,PAYLOAD)||
       p.nativeOwnerPlayerProofVersion!==1||p.source!==SOURCE||
       !uuid(p.hostRunId)||!integer(p.worldEpoch)||p.worldEpoch<1||
       !integer(p.sampledGameTick)||p.sampledGameTick>0xffffffff||
       !Array.isArray(p.owners)||p.owners.length>MAX_OWNERS||
       !validPlayer(p.protagonist,p))return clear();
    if(retiredStreams.has(f.streamId))return clear();
    const next=freeze({streamId:f.streamId,adapterEpoch:f.adapterEpoch,
      hostRunId:p.hostRunId,worldEpoch:p.worldEpoch});
    if(context&&(!same(context,next,contextFields)||
       f.sequence<=sequence||p.sampledGameTick<gameTick))return clear();
    const nextOwners=new Map(),aliases=new Set(),peds=new Set();
    for(const o of p.owners) {
      if(!validOwner(o,p)||nextOwners.has(o.observerCaptureRef)||
         aliases.has(o.ownerAlias)||peds.has(o.nativeActorPedId)||
         retiredRefs.has(o.observerCaptureRef))return clear();
      // A captureRef cannot be rebased to another incarnation/owner/Ped.
      const prior=ownerHistory.get(o.observerCaptureRef);
      if(prior&&!same(prior,o,ownerFields.filter(k=>k!=='sampledGameTick')))
        return clear();
      nextOwners.set(o.observerCaptureRef,freeze(o));
      ownerHistory.set(o.observerCaptureRef,freeze(o));
      aliases.add(o.ownerAlias);peds.add(o.nativeActorPedId);
    }
    // Continuous membership: an owner absent from any complete sample (also
    // across roster maintenance, because the previous set is retained) is
    // retired for the rest of this stream and can never be re-admitted.
    for(const ref of owners.keys())if(!nextOwners.has(ref))retiredRefs.add(ref);
    if(subject&&!same(subject,p.protagonist,
      playerFields.filter(k=>k!=='sampledGameTick'))) {
      // Switching avatar or controlled player irrevocably revokes all leases.
      leases=new WeakMap();
    }
    context=next;owners=nextOwners;subject=freeze(p.protagonist);
    sequence=f.sequence;gameTick=p.sampledGameTick;receivedAt=stamp;settled=true;
  };
  const unsubscribe=subscribeAuthenticatedNativeOwnerPlayerFrames(take,clear);
  if(unsubscribe!==undefined&&typeof unsubscribe!=='function')
    throw new TypeError('native_current_owner_bad_subscription');
  stop=unsubscribe??null;

  // K calls before the original backend accepts the normal player turn.
  // This creates an opaque JS-object-identity lease from an authenticated
  // native roster, NOT from backend text or a caller's trust flag.
  function bindActorAtTurnStart({pedId,characterId,ownerAlias}={}) {
    if(!live()||typeof pedId!=='string'||!PED.test(pedId)||
       !uuid(characterId)||!ALIAS.test(ownerAlias||'')||!subject)return null;
    // Binding while unsettled uses the last complete owner sample plus the
    // synchronous live-roster check below; verification still requires a
    // newer settled sample. A natively retired captureRef never binds.
    const matches=[...owners.values()].filter(o=>
      o.nativeActorPedId===pedId&&o.ownerAlias===ownerAlias&&
      !retiredRefs.has(o.observerCaptureRef));
    if(matches.length!==1)return null;
    const o=matches[0],p=profile(o.ownerAlias);
    if(!p||p.characterId!==characterId||!current(o,subject))return null;
    const lease=Object.freeze({kind:'native_actor_lifetime_lease_v1'});
    leases.set(lease,{owner:o,player:subject,context,
      pedId,characterId,ownerAlias,sequence,startedAt:now(),identity:null});
    return lease;
  }

  // Positive native CURRENT corroboration only: the backend accepted-input
  // receipt must be independently source-verified by K, with the same actor
  // and a LIVE pre-acceptance lease. Demand a NEW native owner-fiber sample
  // after lease creation. Missing next sample or any source gap => null.
  function verifyCurrentOwnerAndPlayer({lease,identity,characterId,ownerAlias}={}) {
    if(!live()||!settled||!lease||!validTurn(identity)||!uuid(characterId)||
       !ALIAS.test(ownerAlias||''))return null;
    const record=leases.get(lease);
    if(!record||!Number.isFinite(now())||now()<record.startedAt||
       now()-record.startedAt>leaseMs||
       retiredRefs.has(record.owner.observerCaptureRef)||
       sequence<=record.sequence||!same(context,record.context,contextFields)||
       record.characterId!==characterId||record.ownerAlias!==ownerAlias||
       identity.pedId!==record.pedId||
       !same(subject,record.player,playerFields.filter(k=>k!=='sampledGameTick')))
      return null;
    const owner=owners.get(record.owner.observerCaptureRef);
    if(!owner||!same(owner,record.owner,
       ownerFields.filter(k=>k!=='sampledGameTick')))return null;
    const p=profile(owner.ownerAlias);
    if(!p||p.characterId!==characterId||!current(owner,subject))return null;
    if(record.identity&&!same(record.identity,identity,turnFields))return null;
    if(!record.identity)record.identity=freeze({...identity});
    return freeze({
      kind:'NativeCurrentPlayerAndOwnerV1',
      nativeCurrentOwnerVerified:true,
      originalBackendAccepted:false,
      source:'authenticated_native_p2_owner_fiber_current_only',
      identity:{...record.identity},characterId:p.characterId,
      ownerAlias:owner.ownerAlias,
      nativeActorPedId:owner.nativeActorPedId,
      observerCaptureRef:owner.observerCaptureRef,
      incarnationId:owner.incarnationId,
      encounterId:owner.encounterId,
      playerCaptureRef:subject.playerCaptureRef,
      avatarKey:subject.key,
      humanPlayerScope:'single_local_human',
      hostRunId:context.hostRunId,worldEpoch:context.worldEpoch,
      streamId:context.streamId,adapterEpoch:context.adapterEpoch,
      sequence,sampledGameTick:gameTick,receivedAtMonotonicMs:receivedAt
    });
  }
  function revokeLease(lease) {if(lease&&typeof lease==='object')leases.delete(lease);}
  const status=()=>freeze({connected:!!live(),settled:!!live()&&settled,
    ownerCount:live()?owners.size:0,
    supportsNativeAcceptedTurn:false,proofKind:'current_owner_player_only'});
  return Object.freeze({bindActorAtTurnStart,verifyCurrentOwnerAndPlayer,
    revokeLease,status,close(){clear();stop?.();stop=null;}});
}
