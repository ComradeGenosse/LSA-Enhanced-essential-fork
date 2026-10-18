// One definition of "the live promoted P2 profile for a native owner alias",
// shared by every production memory source (M3 owner ledger, D02 lease).
//
// K-03(f): P2 profile rows are exact-key objects with NO `worldProfileId`
// field (brain/characters/profileSchema.mjs); the store itself is bound to
// exactly one world profile. A predicate comparing `row.worldProfileId` to the
// store's world was therefore never true and no owner could ever resolve.
// World scoping is enforced by the store plus the verified-host/timeline gate
// below, and by every later journal write re-checking the world id.
//
// Exactly one non-retired profile may own an alias. Zero matches (unknown or
// retired) and two or more matches (an ambiguous store) both resolve to null:
// memory ownership is never guessed.
export function resolveLivePromotedProfile(memoryStore,alias) {
  if(typeof alias!=='string'||alias.length===0)return null;
  try {
    if(memoryStore?.timelineWritable!==true||!memoryStore.verifiedHostContext||
       typeof memoryStore.worldProfileId!=='string'||!memoryStore.worldProfileId)return null;
    const matches=memoryStore.list().filter(row=>
      row?.promotion?.ownerAlias===alias&&row.status!=='retired');
    if(matches.length!==1)return null;
    return Object.freeze({...matches[0],timelineWritable:true,
      worldEpoch:memoryStore.verifiedHostContext.worldEpoch});
  } catch {return null;}
}
