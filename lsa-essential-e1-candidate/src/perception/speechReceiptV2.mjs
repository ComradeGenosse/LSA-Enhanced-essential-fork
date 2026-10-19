import {isUuid} from '../identity/identityContract.mjs';
import {validateCaptureReceipt} from './speechContract.mjs';

const exact=(v,fields)=>!!v && typeof v==='object' && !Array.isArray(v) &&
  fields.every(k=>Object.hasOwn(v,k)) && Object.keys(v).every(k=>fields.includes(k));
const integer=(n,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const fields=['speechVersion','nativeHostRunId','worldEpoch','utteranceId',
  'source','startGameTick','endGameTick','startMonotonicMs','endMonotonicMs',
  'durationMs','ageMs','producerSequence','captureReceiptRef','observers'];

// The wire carries ONLY host-monotonic times. A native callback may not know
// where Node's performance clock began. We translate from native end-age
// measured at send, never compare two absolute clock domains.
export function validateSpeechReceiptV2Shape(p) {
  return exact(p,fields) && p.speechVersion===2 &&
     isUuid(p.nativeHostRunId) &&
     integer(p.worldEpoch,2147483647) && p.worldEpoch>=1 &&
     isUuid(p.utteranceId) && isUuid(p.captureReceiptRef) &&
     exact(p.source,['captureRef','kind']) &&
     isUuid(p.source.captureRef) && p.source.kind==='player' &&
     integer(p.startGameTick,0xffffffff) && integer(p.endGameTick,0xffffffff) &&
     integer(p.startMonotonicMs) && integer(p.endMonotonicMs) &&
     integer(p.durationMs,30000) && p.durationMs>=1 &&
     p.endMonotonicMs-p.startMonotonicMs===p.durationMs &&
     integer(p.ageMs,30000) && integer(p.producerSequence) &&
     p.producerSequence>=1 && Array.isArray(p.observers) && p.observers.length<=16;
}
export function normalizeSpeechReceiptV2(p,{host,adapterEpoch,now}={}) {
  if(!validateSpeechReceiptV2Shape(p) || !host ||
     p.nativeHostRunId!==host.hostRunId || p.worldEpoch!==host.worldEpoch ||
     !isUuid(adapterEpoch) || !integer(now))return null;
  // Cross-process pipe delay is NOT known. It can only widen the end-age;
  // conservative 30-second expiry still bounds the receipt.
  const end=now-p.ageMs;
  if(end<0)return null;
  const receipt=Object.freeze({
    speechVersion:1,nativeRun:adapterEpoch,producerId:'player_mic',
    producerSequence:p.producerSequence,utteranceId:p.utteranceId,
    captureReceiptRef:p.captureReceiptRef,source:p.source,
    startGameTick:p.startGameTick,endGameTick:p.endGameTick,
    startMonotonicMs:end-p.durationMs,endMonotonicMs:end,
    durationMs:p.durationMs,observers:p.observers
  });
  return receipt.startMonotonicMs>=0 && validateCaptureReceipt(receipt)?
    receipt:null;
}
