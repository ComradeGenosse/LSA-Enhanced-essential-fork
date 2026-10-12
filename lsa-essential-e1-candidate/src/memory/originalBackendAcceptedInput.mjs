// Original Essential backend accepted-input source fence (D01).
// Pinned upstream has no demonstrable final accepted typed/STT source.
// No exported positive issuer; history/provider/native submissions are not proof.
import {createHash} from 'node:crypto';

export const ORIGINAL_BACKEND_PIN = Object.freeze({
  originalBundleSha256: '5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2',
  stockCoreDllSha256: '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653',
  sourceRevision: 'essential-original-server-5d81de4217bd',
  acceptedSourceHookAvailable: false,
  postAcceptanceEvidence: 'unobservable_in_pinned_original_source',
  status: 'source_capability_unavailable',
});
const SUBMISSION_ONLY = new Set([
  'typed_submission','mic_start','mic_stop','mic_audio','stt_fragment',
  'stt_correction','input_transcript','generation_allocated',
  'generation_started','provider_send_resolved','provider_output',
  'model_complete','history_commit','turn_complete',
  'session_opened','session_ready',
]);
const EXACT_ID_KEYS=Object.freeze(['pedId','turnId','generationId','sessionNonce']);
const keyOf=i=>EXACT_ID_KEYS.map(k=>String(i[k])).join('\u0000');
const validId=i=>!!i&&typeof i==='object'&&
  typeof i.pedId==='string'&&i.pedId.length>0&&i.pedId.trim()===i.pedId&&
  typeof i.turnId==='string'&&i.turnId.length>0&&i.turnId.trim()===i.turnId&&
  Number.isSafeInteger(i.generationId)&&i.generationId>=0&&
  Number.isSafeInteger(i.sessionNonce)&&i.sessionNonce>=1;
const frozen=fields=>Object.freeze(fields);

// Diagnostics ONLY: SHA of caller text is NOT a receipt.
// Reject invalid UTF-16; do not normalize or silently substitute Unicode.
export function digestExactUtf8(text){
  if(typeof text!=='string'||!text.trim())return null;
  for(let i=0;i<text.length;i++){
    const c=text.charCodeAt(i);
    if(c>=0xD800&&c<=0xDBFF){
      if(++i>=text.length||text.charCodeAt(i)<0xDC00||text.charCodeAt(i)>0xDFFF)return null;
    }else if(c>=0xDC00&&c<=0xDFFF)return null;
  }
  const bytes=Buffer.from(text,'utf8');
  return frozen({sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length});
}

// A future K-owned original-source-only patch must define its private issuer.
// This describes the required payload, not an observed accepted event.
export const ORIGINAL_BACKEND_ACCEPTED_INPUT_V1=frozen({
  kind:'OriginalBackendAcceptedInputV1',
  source:'original_essential_backend_post_acceptance',
  lifecycleStatus:'accepted',
  inputModes:frozen(['typed','stt']),
  identityKeys:EXACT_ID_KEYS,
  requiredFields:frozen([
    'kind','pedId','turnId','generationId','sessionNonce',
    'sourceRunId','sourceRevision','originalBundleSha256','inputMode',
    'lifecycleStatus','finalAcceptedInputRevision',
    'acceptedUtf8Sha256','acceptedUtf8ByteLength','sourceTimestamp',
    'retirementIdentity',
  ]),
});

/**
 * Fail-closed read-through to be used by K/T3 if wired.
 * A real post-acceptance source transition must first be proven and patched
 * into the exact original backend AST. A caller, host flag, model or ordinary
 * server callback CANNOT upgrade any of the signals below into accepted proof.
 */
export function createOriginalBackendAcceptedInput(){
  // These are denial-only lifecycle fences. Nothing here grants acceptance.
  const retired=new Set(),retiredSessions=new Set(),retiredRuns=new Set(),latestGeneration=new Map();
  let closed=false;
  const classify=({identity,signal,sourceRevision,originalBundleSha256,text,sourceRunId,sessionConnected=true}={})=>{
    if(closed)return frozen({status:'not_accepted',reason:'authority_retired'});
    if(!validId(identity))return frozen({status:'not_accepted',reason:'invalid_identity'});
    if(sourceRevision!==ORIGINAL_BACKEND_PIN.sourceRevision||
       !sourceRunId||typeof sourceRunId!=='string')
      return frozen({status:'not_accepted',reason:'unverified_source_revision_or_run'});
    if(originalBundleSha256!==undefined&&originalBundleSha256!==ORIGINAL_BACKEND_PIN.originalBundleSha256)
      return frozen({status:'not_accepted',reason:'pinned_build_mismatch'});
    if(!sessionConnected)return frozen({status:'not_accepted',reason:'disconnected_session'});
    if(retired.has(keyOf(identity)))return frozen({status:'not_accepted',reason:'retired_identity'});
    const lifetimeKey=identity.pedId+'\u0000'+identity.sessionNonce;
    const previous=latestGeneration.get(lifetimeKey);
    if(previous!==undefined&&identity.generationId<previous)
      return frozen({status:'not_accepted',reason:'superseded_generation'});
    // A caller-supplied build hash cannot attest its own source. A wrong one
    // can only deny the request; even a correct one never creates authority.
    if(!SUBMISSION_ONLY.has(signal))
      return frozen({status:'not_accepted',reason:'unrecognized_or_unsupported_source_event'});
    if(!digestExactUtf8(text))
      return frozen({status:'not_accepted',reason:'empty_or_invalid_utf8'});
    return frozen({status:'not_accepted',reason:'no_post_acceptance_source_hook'});
  };
  return frozen({
    source:ORIGINAL_BACKEND_PIN,
    describeSignal:classify,
    // Agent C may synchronously query this method, but at the pinned build it
    // MUST ALWAYS return null. A positive issuer requires an independently
    // reviewed original post-acceptance transition and a new source pin.
    verifyAccepted(_request){return null;},
    hasAuthenticatedSource(){return false;},
    retire(identity){if(validId(identity))retired.add(keyOf(identity));},
    supersede({pedId,sessionNonce,generationId}={}){
      if(typeof pedId!=='string'||!pedId||!Number.isSafeInteger(sessionNonce)||
         sessionNonce<1||!Number.isSafeInteger(generationId)||generationId<0)return false;
      const key=pedId+'\u0000'+sessionNonce;
      latestGeneration.set(key,Math.max(generationId,latestGeneration.get(key)??-1));
      return true;
    },
    retireSession({pedId,sessionNonce}={}){
      if(typeof pedId!=='string'||!pedId||!Number.isSafeInteger(sessionNonce)||sessionNonce<1)return false;
      retiredSessions.add(pedId+'\\u0000'+sessionNonce);
      return true;
    },
    retireSourceRun(sourceRunId){
      if(typeof sourceRunId!=='string'||!sourceRunId.trim())return false;
      retiredRuns.add(sourceRunId);
      return true;
    },
    disconnect(){closed=true;retired.clear();retiredSessions.clear();retiredRuns.clear();latestGeneration.clear();},
  });
}
