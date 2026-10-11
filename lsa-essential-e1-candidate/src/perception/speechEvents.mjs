import {randomUUID} from 'node:crypto';

// Translate private SharedTranscriptStore authorizations into the EXISTING
// immutable PS2 Episode/Observation v1 + PS3 salience vocabulary.
// Never put transcript bytes or transcriptRef into public observation claims.
export function publishSpeechObservations({receipt,perceptions,now,current,episodes,
  observations,noteSalience,rights}={}) {
  if(!receipt || !Array.isArray(perceptions) || !perceptions.length ||
     !current(receipt.source.captureRef))return 0;
  const qualified=perceptions.filter(p=>p.hearing==='heard' &&
    current(p.observer?.captureRef) &&
    p.witnessReceiptRef===receipt.captureReceiptRef &&
    p.utteranceId===receipt.utteranceId);
  if(!qualified.length)return 0;
  const stamp=now(),episodeId=randomUUID(),source=receipt.source;
  const originalClaim={claimId:randomUUID(),kind:'sound',certainty:'supported',
    evidence:{channel:'auditory',basis:'audibility_model',
      sampledGameTick:receipt.endGameTick},
    source,details:{eventSignalId:receipt.captureReceiptRef,reason:'speech_heard'}};
  const episode={version:1,episodeId,revision:1,nativeRun:receipt.nativeRun,
    gameTick:receipt.endGameTick,expiresAtMonotonicMs:stamp+30000,
    status:'closed',participants:[source],claims:[originalClaim],
    producerSequences:[{producer:'player_mic',sequence:receipt.producerSequence}]};
  if(!episodes.put(episode))return 0;
  let delivered=0;
  for(const p of qualified){
    const claim={...originalClaim,claimId:randomUUID(),
      evidence:{...originalClaim.evidence,
        sampledGameTick:p.evidence.sampledGameTick}};
    const observation={version:1,observationId:randomUUID(),episodeId,revision:1,
      observer:p.observer,
      observedAt:{nativeRun:receipt.nativeRun,gameTick:p.evidence.sampledGameTick,
        receivedUtc:new Date().toISOString()},
      expiresAtMonotonicMs:stamp+30000,eventType:'speech_heard',
      severity:'routine',claims:[claim],recognizedCharacterIds:[]};
    if(!observations.put(observation))continue;
    if(p.coverage==='full' && typeof p.authorizedTextRef==='string')
      rights.set(observation.observationId,Object.freeze({observerRef:p.observer.captureRef,
        transcriptRef:p.authorizedTextRef,expires:stamp+30000}));
    noteSalience(observation);delivered++;
  }
  return delivered;
}
