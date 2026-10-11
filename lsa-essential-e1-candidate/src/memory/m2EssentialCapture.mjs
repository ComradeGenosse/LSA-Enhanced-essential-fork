// Source-fenced Essential M2 adapter. No database, playback observer or Luna worker.
// The host supplies A's authenticated native ledger, the actual accepted input
// ledger, RAM-history + native terminal ledger, and real PCM forwarding ledger.
import {createM2TurnCapture} from '../../../lsa-shared-brain/src/memory/m2TurnCapture.mjs';

const identityKeys=['pedId','turnId','generationId','sessionNonce'];
const same=(a,b)=>!!a&&!!b&&identityKeys.every(k=>a[k]===b[k]);
const fail=code=>{throw new Error(code);};
const immutable=x=>Object.freeze({...x});
const result=(reason)=>immutable({status:'not_stored',reason});

/**
 * A-native contract (synchronous, authenticated; mocks are TEST-ONLY):
 * nativeAuthority.verifyCurrentTurn({identity,characterId,ownerAlias,
 *   hostRunId,worldEpoch}) => {nativeVerified:true,current:true,identity,
 *     characterId,ownerAlias,hostRunId,worldEpoch,protagonistKey,
 *     incarnationId,encounterId,observerIndex}
 *
 * The other ports MUST derive results from the host's own ledgers, not from
 * claims in a Luna decision or from a caller's Boolean flags.
 */
export function createM2EssentialCapture({
  store,characterId,ownerAlias,identity,sessionId=null,isCurrent,
  nativeAuthority,acceptedInput,playbackHistory,speechTransport,
}={}){
  if(!store || !identity || typeof isCurrent!=='function' ||
     typeof nativeAuthority?.verifyCurrentTurn!=='function' ||
     typeof acceptedInput?.verifyAccepted!=='function' ||
     typeof playbackHistory?.verifyCompleted!=='function' ||
     typeof speechTransport?.verifyForwardedSegment!=='function' ||
     typeof speechTransport?.verifyFinalizedAudio!=='function')
    throw new TypeError('m2_trusted_ports_required');
  const frozenIdentity=immutable(Object.fromEntries(identityKeys.map(k=>[k,identity[k]])));
  const host=store.verifiedHostContext;
  if(!host||store.timelineWritable!==true)fail('m2_host_not_ready');
  const originalHost=immutable({hostRunId:host.hostRunId,worldEpoch:host.worldEpoch});
  const nativeQuery=immutable({identity:frozenIdentity,characterId,ownerAlias,
    hostRunId:host.hostRunId,worldEpoch:host.worldEpoch});
  const readNative=()=>nativeAuthority.verifyCurrentTurn(nativeQuery);
  const initial=readNative();
  if(!initial||initial.current!==true||initial.nativeVerified!==true||
     !same(initial.identity,frozenIdentity)||initial.characterId!==characterId||
     initial.ownerAlias!==ownerAlias||initial.hostRunId!==host.hostRunId||
     initial.worldEpoch!==host.worldEpoch)fail('m2_native_owner_unverified');
  const bound=createM2TurnCapture({
    store,characterId,ownerAlias,identity:frozenIdentity,sessionId,
    protagonist:initial.protagonistKey,isCurrent,
    currentProtagonist:()=>readNative()?.protagonistKey??null,
    verifyNative:readNative,
    verifyAcceptedPlayer:({identity,source,text})=>
      acceptedInput.verifyAccepted(immutable({identity,source,text,host:originalHost})),
    verifyCompletedPlayback:({identity,receipt,speechProof,text})=>{
      const admission=playbackHistory.verifyCompleted(immutable({
        identity,receipt,host:originalHost
      }));
      if(!admission||typeof admission.then==='function'||
         admission.nativeVerified!==true||admission.historyAccepted!==true||
         admission.receipt!==receipt||!same(admission.identity,identity))
        return null;
      // The host must attest final TTS reconciliation + complete forwarding.
      // A single successful early segment is not a completed stream.
      const finalized=speechTransport.verifyFinalizedAudio(immutable({
        identity,mode:speechProof?.mode,segments:speechProof?.segments,
        receipt,host:originalHost
      }));
      if(!finalized||typeof finalized.then==='function'||
         finalized.complete!==true||!same(finalized.identity,identity)||
         finalized.receipt!==receipt||finalized.mode!==speechProof?.mode||
         finalized.segmentCount!==speechProof?.segments?.length)return null;
      if(!Array.isArray(speechProof?.segments)||speechProof.segments.some(segment=>{
        const a=speechTransport.verifyForwardedSegment(immutable({
          identity,segment,host:originalHost
        }));
        return !a||typeof a.then==='function'||a.accepted!==true||
          !same(a.identity,identity)||a.sequence!==segment.sequence||
          a.text!==segment.text||a.audioBytes!==segment.audioBytes||
          a.forwardedBytes!==segment.forwardedBytes;
      }))return null;
      return immutable({nativeVerified:true,historyAccepted:true,
        speechVerified:true,identity,receipt,text});
    }
  });
  let retired=false,mode=null,sealed=false;
  const segments=[];
  const check=()=>{
    if(retired)fail('m2_turn_retired');
    if(!isCurrent()){retired=true;bound.retire();fail('m2_turn_retired');}
  };
  return Object.freeze({
    // Call only after the runner's accepted final typed/STT intake and successful
    // DialogueHistory.commitPlayerInput; the trusted port must confirm both.
    acceptPlayer({source,text,utteranceId=null,transcription=null}={}){
      if(retired)return Promise.resolve(result('m2_turn_retired'));
      return bound.recordPlayerAccepted({accepted:true,source,text,utteranceId,transcription});
    },
    // Invoke once for each fully completed TTS segment *and actual* successful
    // native PCM forwarding. Failed provider attempts cannot publish a segment.
    admitSpeechSegment({mode:nextMode,sequence,text,audioBytes,forwardedBytes}={}){
      try{
        check();
        if(sealed||!['buffered','early_streamed'].includes(nextMode)||
           (mode!==null&&mode!==nextMode)||
           !Number.isSafeInteger(sequence)||sequence!==segments.length||
           sequence>=128||(nextMode==='buffered'&&sequence!==0)||
           typeof text!=='string'||!text||
           !Number.isSafeInteger(audioBytes)||audioBytes<=0||
           !Number.isSafeInteger(forwardedBytes)||forwardedBytes!==audioBytes)
          fail('m2_speech_proof_incomplete');
        const segment=immutable({sequence,text,audioBytes,forwardedBytes,providerCompleted:true});
        const confirmation=speechTransport.verifyForwardedSegment(immutable({
          identity:frozenIdentity,segment,host:originalHost
        }));
        if(!confirmation||typeof confirmation.then==='function'||
           confirmation.accepted!==true||
           !same(confirmation.identity,frozenIdentity)||
           confirmation.sequence!==sequence||confirmation.text!==text||
           confirmation.audioBytes!==audioBytes||
           confirmation.forwardedBytes!==forwardedBytes)
          fail('m2_speech_source_unverified');
        mode=nextMode;segments.push(segment);
        return immutable({status:'admitted',segments:segments.length});
      }catch(e){return result(/^m2_[a-z_]+$/.test(e?.message)?e.message:'m2_speech_source_unverified');}
    },
    // The native terminal and source-owned stream-finalization ledger must
    // both agree; an early partial stream is never replayed as final speech.
    // Final Luna draft is intentionally NOT an argument. The only text eligible
    // for the journal is ordered, fully PCM-forwarded TTS source text.
    completeNpc({receipt}={}){
      if(retired)return Promise.resolve(result('m2_turn_retired'));
      if(sealed||!mode||segments.length===0)return Promise.resolve(result('m2_speech_proof_incomplete'));
      sealed=true;
      const proof=Object.freeze({identity:frozenIdentity,mode,sealed:true,
        segments:Object.freeze(segments.map(s=>s))});
      return bound.recordNpcCompleted({historyAccepted:true,receipt,mode,
        spokenSegments:mode==='early_streamed'?segments.map(s=>s.text):null,
        text:segments.map(s=>s.text).join(''),speechProof:proof});
    },
    retire(){retired=true;sealed=true;bound.retire();},
  });
}
