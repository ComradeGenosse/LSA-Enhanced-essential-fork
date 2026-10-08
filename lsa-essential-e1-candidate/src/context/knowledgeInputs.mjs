import { immutableSnapshot } from './turnSnapshot.mjs';
import { KNOWLEDGE_LIMITS,jsonBytes } from './knowledgeSelector.mjs';
import { sameHostContext } from './hostContext.mjs';
import { isUuid, actorClaim, sameAssociation } from '../identity/identityContract.mjs';

const required=['version','hostRunId','worldEpoch','captureRef','sampledGameTick'];
const optional=['encounterId','incarnationId'];
export function validateActorCapture(value) {
  return value && typeof value==='object' && !Array.isArray(value) && required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>required.includes(key)||optional.includes(key)) &&
    value.version===1 && isUuid(value.hostRunId) && Number.isSafeInteger(value.worldEpoch) && value.worldEpoch>0 && value.worldEpoch<=0x7fffffff && isUuid(value.captureRef) && Number.isSafeInteger(value.sampledGameTick) && value.sampledGameTick>=0 && value.sampledGameTick<=0xffffffff &&
    Object.hasOwn(value,'encounterId')===Object.hasOwn(value,'incarnationId') && (!Object.hasOwn(value,'encounterId') || isUuid(value.encounterId) && isUuid(value.incarnationId));
}

// Synchronous private capture at P0. No lookup by current conversation, display
// identity or handle, and no proof/model/network work occurs here.
export function captureKnowledgeInputs({identity,source,p0Snapshot,perception,identityConfig,ownerEvidence}) {
  const base={version:1,turn:identity,source,p0Revision:p0Snapshot?.revision,frozenAt:perception?.now?.()??0,association:null,ownerClaim:null,pairs:[],reason:'no_actor_capture'};
  const finish=patch=>immutableSnapshot({...base,...patch});
  const actor=p0Snapshot?.actor;
  if(!identity || actor?.pedId!==identity.pedId || p0Snapshot?.identity?.pedId!==identity.pedId || p0Snapshot?.identity?.turnId!==identity.turnId || p0Snapshot?.identity?.generationId!==identity.generationId || p0Snapshot?.identity?.sessionNonce!==identity.sessionNonce) return finish({reason:'wrong_actor'});
  const block=actor.integrations?.turnKnowledge;
  if(!validateActorCapture(block) || Object.hasOwn(actor,'turnKnowledge')) return finish({});
  // EO keeps a raw namespace copy. It is never sufficient to join, and a
  // conflicting duplicate invalidates the direct captured block.
  const raw=actor.integrations?.raw?.turnKnowledge;
  if(raw!==undefined && (!validateActorCapture(raw) || JSON.stringify(raw)!==JSON.stringify(block))) return finish({});
  if(!perception?.epoch || !perception.hostContext || perception.now()-perception.lastReceipt>3000) return finish({reason:'channel_unhealthy'});
  const fence={hostContextVersion:1,hostRunId:block.hostRunId,worldEpoch:block.worldEpoch};
  if(!sameHostContext(fence,perception.hostContext)) return finish({reason:block.hostRunId!==perception.hostContext.hostRunId?'host_mismatch':'world_epoch_changed'});
  if(perception.observerIndexVersion!==1) return finish({reason:'unsupported_contract'});
  const anchor=perception.anchors.get(block.captureRef),index=perception.observerIndex.get(block.captureRef);
  if(!perception.current(block.captureRef) || anchor?.kind!=='ped' || !anchor.observer) return finish({reason:'anchor_expired'});
  if(!index || index.kind!=='ped') return finish({reason:'no_observer_index'});
  let ownerClaim=null;
  if(index.owned) {
    const profile=actor.integrations?.characterProfile;
    ownerClaim=identityConfig ? actorClaim(actor,identityConfig).claim : null;
    if(!ownerClaim || profile?.version!==1 || profile.encounterId!==index.encounterId || block.encounterId!==index.encounterId || block.incarnationId!==index.incarnationId || ownerClaim.incarnationId!==index.incarnationId) return finish({reason:'owner_unverified'});
    if(ownerEvidence?.hostContext && !sameHostContext(ownerEvidence.hostContext,fence)) return finish({reason:'owner_unverified'});
  } else if(block.encounterId!==undefined || block.incarnationId!==undefined || index.encounterId!==undefined) return finish({reason:'owner_unverified'});
  const liveReferences=Object.fromEntries([...perception.anchors].filter(([ref])=>perception.current(ref)).map(([ref,anchor])=>[ref,anchor.kind]));
  let poolBytes=0;
  const pairs=perception.salience.snapshotForObserver(block.captureRef,perception.observations,perception.now()).filter(pair=>pair.observation.claims.every(claim=>[claim.source,claim.target].every(ref=>!ref || liveReferences[ref.captureRef]===ref.kind) && (!claim.details?.vehicle || liveReferences[claim.details.vehicle]==='vehicle'))).filter((pair,index)=>{
    const bytes=jsonBytes(pair);if(index>=KNOWLEDGE_LIMITS.poolCount || poolBytes+bytes>KNOWLEDGE_LIMITS.poolBytes) return false;poolBytes+=bytes;return true;
  });
  return finish({reason:null,hostRunId:block.hostRunId,worldEpoch:block.worldEpoch,psAdapterEpoch:perception.epoch,psStreamId:perception.stream,association:{...index,sampledGameTick:block.sampledGameTick},ownerClaim,ownerPendingProof:!!index.owned,pairs,liveReferences});
}

export function assertKnowledgeCurrent(inputs,perception) {
  if(!inputs?.association) return inputs?.reason??'no_actor_capture';
  if(!perception?.epoch || perception.now()-perception.lastReceipt>3000) return 'channel_unhealthy';
  if(inputs.hostRunId!==perception.hostContext?.hostRunId) return 'host_mismatch';
  if(inputs.worldEpoch!==perception.hostContext?.worldEpoch) return 'world_epoch_changed';
  if(inputs.psAdapterEpoch!==perception.epoch || inputs.psStreamId!==perception.stream) return 'channel_unhealthy';
  const ref=inputs.association.captureRef,index=perception.observerIndex.get(ref);
  if(!perception.current(ref) || !index || index.kind!=='ped' || perception.anchors.get(ref)?.kind!=='ped' || perception.anchors.get(ref)?.observer!==true) return 'participant_retired';
  if(index.owned!==inputs.association.owned || index.encounterId!==inputs.association.encounterId || index.incarnationId!==inputs.association.incarnationId) return 'owner_unverified';
  return null;
}

// Release only the original owned candidate after the existing P1 preparation.
// No observer/profile lookup or observation resampling is permitted here.
export function assertOwnedKnowledgeCurrent(inputs,{identity,snapshot,identityService,perception}) {
  if(!inputs?.association?.owned)return null;
  if(!identity || !['pedId','turnId','generationId','sessionNonce'].every(key=>identity[key]===inputs.turn?.[key]) || assertKnowledgeCurrent(inputs,perception))return 'owner_unverified';
  const binding=identityService?.bindings.get(identity),fence={hostContextVersion:1,hostRunId:inputs.hostRunId,worldEpoch:inputs.worldEpoch};
  if(!['pedId','turnId','generationId','sessionNonce'].every(key=>snapshot?.nativeIdentity?.[key]===identity[key]) || snapshot?.resolution?.kind!=='persistent' || snapshot.bindingRevision!==binding?.bindingRevision || snapshot.bindingId!==binding?.bindingId || snapshot.resolution.characterId!==binding?.characterId || !sameAssociation(inputs.ownerClaim,binding?.claim) || !sameHostContext(identityService?.evidence?.hostContext,fence) || !identityService.evidence.isCurrent(binding.claim))return 'owner_unverified';
  return null;
}
export function releaseOwnedKnowledge(inputs,options) {
  if(!inputs?.ownerPendingProof)return inputs;
  const reason=inputs.association?.owned?assertOwnedKnowledgeCurrent(inputs,options):'owner_unverified';
  return immutableSnapshot({...inputs,reason,ownerPendingProof:!!reason});
}


export function assertKnowledgeItemsCurrent(inputs,frame,perception) {
 const reason=assertKnowledgeCurrent(inputs,perception);if(reason)return reason;
 if(inputs.ownerPendingProof || inputs.reason)return inputs.reason??'owner_unverified';
 for(const item of frame.delivery){
  const pair=inputs.pairs.find(pair=>pair.observation.observationId===item.observationId && pair.observation.revision===item.revision && pair.decision.decisionKey===item.decisionKey);
  if(!pair)return 'revision_mismatch';
  if(pair.observation.expiresAtMonotonicMs<=perception.now() || pair.decision.expiresAtMonotonicMs<=perception.now())return 'observation_expired';
  for(const claim of pair.observation.claims){
   for(const ref of [claim.source,claim.target])if(ref && (!perception.current(ref.captureRef) || perception.anchors.get(ref.captureRef)?.kind!==ref.kind))return 'participant_retired';
   if(claim.details?.vehicle && (!perception.current(claim.details.vehicle) || perception.anchors.get(claim.details.vehicle)?.kind!=='vehicle'))return 'participant_retired';
  }
 }
 return null;
}
