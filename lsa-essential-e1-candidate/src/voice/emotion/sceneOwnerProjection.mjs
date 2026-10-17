import { assertOwnedKnowledgeCurrent } from '../../context/knowledgeInputs.mjs';

// Never substitute global scene text or another pedestrian's observation.
export function projectActingEvidence({identity,turn,perception,identityService} = {}) {
  try {
    const inputs=turn?.knowledgeInputs, snapshot=turn?.characterSnapshot;
    if (!inputs?.association?.owned || inputs.ownerPendingProof ||
        inputs.reason || snapshot?.resolution?.kind !== 'persistent' ||
        !perception?.epoch || typeof perception.now !== 'function' ||
        !perception.observations?.entries) return null;
    if (assertOwnedKnowledgeCurrent(inputs,{identity,snapshot,identityService,perception}) !== null)
      return null;
    const ref=inputs.association.captureRef;
    const proof=perception.directorOwnerProofFor?.(ref);
    if (!proof || proof.speakerCaptureRef !== ref ||
        proof.hostRunId !== inputs.hostRunId ||
        proof.worldEpoch !== inputs.worldEpoch ||
        proof.ownerIncarnationId !== inputs.association.incarnationId ||
        !Number.isSafeInteger(proof.proofRevision) || proof.proofRevision < 1)
      return null;
    const now=perception.now();
    if (!Number.isSafeInteger(now) || now < 0) return null;
    const actorIdentity=Object.freeze({
      characterId:snapshot.resolution.characterId,
      observerCaptureRef:ref,
      incarnationId:proof.ownerIncarnationId,
      ownerProofRevision:proof.proofRevision,
      hostRunId:proof.hostRunId,
      worldEpoch:proof.worldEpoch,
      nativeRun:perception.epoch,
      pedId:identity.pedId, sessionNonce:identity.sessionNonce,
      turnId:identity.turnId, generationId:identity.generationId,
    });
    const observations=[];
    for (const entry of perception.observations.entries.values()) {
      const item=entry?.value;
      if (item?.observer?.captureRef !== ref ||
          !Number.isSafeInteger(entry.observedAtMonotonicMs) ||
          entry.observedAtMonotonicMs > now ||
          item.expiresAtMonotonicMs <= now) continue;
      observations.push(Object.freeze({
        observation:item, observedAtMonotonicMs:entry.observedAtMonotonicMs,
      }));
      if (observations.length === 32) break;
    }
    return Object.freeze({
      verifiedOwner:true, lifetimeCurrent:true, channelHealthy:true,
      identity:actorIdentity, observations:Object.freeze(observations),
    });
  } catch { return null; }
}
