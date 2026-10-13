// Production D02 wiring, shared by bootstrap and integration tests so both
// exercise the same code. The authority receives frames ONLY through the
// IntelligenceClient's post-authentication subscription; this port exposes
// the synchronous read-through lease/verification API and nothing that could
// submit a native frame or attest accepted dialogue.
import {createNativeCurrentOwnerPlayerAuthority} from './nativeCurrentOwnerPlayerAuthority.mjs';
import {resolveLivePromotedProfile} from './livePromotedProfile.mjs';

export function createMemoryD02Port({intelligence,memoryStore,now}={}){
  if(typeof intelligence?.subscribeAuthenticatedNativeOwnerPlayer!=='function'||!memoryStore)
    throw new TypeError('memory_d02_private_ports_required');
  const authority=createNativeCurrentOwnerPlayerAuthority({
    subscribeAuthenticatedNativeOwnerPlayerFrames:(onFrame,onRetire)=>
      intelligence.subscribeAuthenticatedNativeOwnerPlayer(onFrame,onRetire),
    sourceStillCurrent:(context,owner,player)=>{
      const source=intelligence.runtime;
      const row=source.observerIndex.get(owner.observerCaptureRef);
      const anchor=source.anchors.get(owner.observerCaptureRef);
      return source.epoch===context?.adapterEpoch &&
        source.stream===context?.streamId &&
        source.hostContext?.hostRunId===context?.hostRunId &&
        source.hostContext?.worldEpoch===context?.worldEpoch &&
        source.current(owner.observerCaptureRef) &&
        source.current(player.playerCaptureRef) &&
        anchor?.kind==='ped' && anchor.observer===true &&
        anchor.owned===true && row?.owned===true &&
        row.incarnationId===owner.incarnationId &&
        row.encounterId===owner.encounterId &&
        source.anchors.get(player.playerCaptureRef)?.kind==='player';
    },
    profileForAlias:alias=>resolveLivePromotedProfile(memoryStore,alias),
    ...(typeof now==='function'?{now}:{}),
  });
  const port=Object.freeze({
    bindActorAtTurnStart:x=>authority.bindActorAtTurnStart(x),
    verifyCurrentOwnerAndPlayer:x=>authority.verifyCurrentOwnerAndPlayer(x),
    revokeLease:x=>authority.revokeLease(x),
    status:()=>authority.status(),
  });
  return Object.freeze({port,close:()=>authority.close()});
}
