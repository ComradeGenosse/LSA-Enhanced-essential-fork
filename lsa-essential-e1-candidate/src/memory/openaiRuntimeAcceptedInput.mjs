// D01 positive source for the production OpenAI pipeline ONLY.
//
// The stock Gemini path (originalBackendAcceptedInput.mjs) still has no final
// accepted-input transition and stays denial-only. With provider "openai" the
// patched original backend delegates the whole provider lifecycle of a player
// turn to the E1 runtime: Td/Sd are disabled for OpenAI, vi/_d call
// OpenAIConnection.sendText/endRealtimeInput, and runSequentialTurn performs
// the only STT call (one non-streaming final transcript per turn, retried at
// most once by the provider executor before any result is returned), routes
// that transcript once through the original pinned AP router, and then makes
// the runtime's one commit decision, DialogueHistory.commitPlayerInput (D-016
// "genuine player input commits once accepted"; memory plan §3.3/G1/§5.5).
//
// The issuer below is that commit decision's own capability. It is handed
// privately to OpenAIConnection (never to runtime/services/bridge/config) and
// opened per launch as a one-shot token bound to that launch's AbortSignal and
// connection. A receipt is minted only when, at the commit instant:
//   - the launch is not aborted and the connection is not closed;
//   - the original registry (patched bridge) still reports the exact tuple as
//     the CURRENT OpenAI turn of the session this connection is registered for
//     (turn not terminal, generation current, session nonce current);
//   - P1 identity currency still holds (when P1 is configured);
//   - the original turn record's own input.transcript equals the adopted bytes
//     (typed: set by original Xi from Fr(t.text); STT: set once by original
//     AP/SK from the single routed input_transcript);
//   - the turn was recorded at original turn creation with the same native
//     ped and source, and typed text was player-authored (not the stock
//     "Hello, what are you doing here?" substitution, not testPrompt);
//   - the bytes are valid UTF-16, non-empty, already trimmed and within the
//     12000-unit bound, so RAM history and journal store the identical string.
// Nothing a caller passes (flags, hashes, receipts, nativeVerified, model
// output, config) can mint or upgrade a receipt.
//
// Lifecycle (memory plan §5.5: an accepted line stands if the turn is later
// interrupted): turn abort/supersession/new generation fences FUTURE issuance
// only; an issued receipt stays verifiable until the turn releases it after its
// D03 write settled, or it is revoked by session retirement/close/disconnect,
// source-run retirement (bridge re-attach, host/world epoch change, shutdown).
// D02 independently revokes on actor/player change; D03 rechecks at COMMIT.
import {randomUUID} from 'node:crypto';
import {ORIGINAL_BACKEND_PIN,ORIGINAL_BACKEND_ACCEPTED_INPUT_V1,digestExactUtf8} from './originalBackendAcceptedInput.mjs';

export const OPENAI_COMMIT_DECISION_RECEIPT_SOURCE='essential_openai_runtime_commit_decision';
export const OPENAI_RUNTIME_ACCEPTANCE_PIN=Object.freeze({
  // The original backend that owns the turn/session/generation tuple, the
  // pinned AP transcript router and the Xi typed-input adoption (unchanged).
  originalBundleSha256:ORIGINAL_BACKEND_PIN.originalBundleSha256,
  stockCoreDllSha256:ORIGINAL_BACKEND_PIN.stockCoreDllSha256,
  // The acceptance transition itself is E1 runtime code inside that backend.
  sourceRevision:'lsa-e1-openai-commit-decision-v1+'+ORIGINAL_BACKEND_PIN.sourceRevision,
  receiptSource:OPENAI_COMMIT_DECISION_RECEIPT_SOURCE,
  acceptedSourceHookAvailable:true,
  provider:'openai',
  acceptanceTransition:'runSequentialTurn:DialogueHistory.commitPlayerInput',
  finalAcceptedInputRevision:1,
  status:'openai_runtime_commit_decision_source',
});

const PED=/^[1-9][0-9]{0,9}$/;
const KEYS=Object.freeze(['pedId','turnId','generationId','sessionNonce']);
const PLAYER=Object.freeze({player_text:'typed',player_mic:'stt'});
const MAX_INPUT_UNITS=12_000; // DialogueHistory slice and journal content bound
const validIdentity=i=>!!i&&typeof i==='object'&&
  typeof i.pedId==='string'&&PED.test(i.pedId)&&
  typeof i.turnId==='string'&&i.turnId.length>0&&i.turnId.length<=128&&
  i.turnId.trim()===i.turnId&&
  Number.isSafeInteger(i.generationId)&&i.generationId>=0&&
  Number.isSafeInteger(i.sessionNonce)&&i.sessionNonce>=1;
const keyOf=i=>KEYS.map(k=>String(i[k])).join('\u0000');
const sessionKeyOf=i=>String(i.pedId)+'\u0000'+String(i.sessionNonce);
const same=(a,b)=>!!a&&!!b&&KEYS.every(k=>a[k]===b[k]);
const pick=i=>Object.freeze(Object.fromEntries(KEYS.map(k=>[k,i[k]])));
const bounded=(set,max)=>{while(set.size>max)set.delete(set.values().next().value);};

export function createOpenAIRuntimeAcceptedInputSource({
  originalTurnFacts,available,identityCurrent=null,ledger,
  now=()=>new Date(),newRunId=randomUUID,maxReceipts=64,maxFences=1024,
}={}){
  if(typeof originalTurnFacts!=='function'||typeof available!=='function'||
     (identityCurrent!==null&&typeof identityCurrent!=='function')||
     typeof ledger?.factsFor!=='function'||typeof now!=='function'||
     typeof newRunId!=='function')
    throw new TypeError('openai_acceptance_private_ports_required');
  let sourceRunId=String(newRunId()),closed=false;
  const receipts=new Map(),fenced=new Set(),retiredSessions=new Set(),latestGeneration=new Map();
  const fence=key=>{fenced.add(key);bounded(fenced,maxFences);};
  const release=identity=>{const key=keyOf(identity);receipts.delete(key);fence(key);};

  function mint({identity,source,connection,signal,input,inputMode}){
    if(closed||signal.aborted===true||connection.closed===true)return null;
    if(PLAYER[source]!==inputMode||typeof input!=='string')return null;
    const key=keyOf(identity),sessionKey=sessionKeyOf(identity);
    if(fenced.has(key)||receipts.has(key)||retiredSessions.has(sessionKey))return null;
    const latest=latestGeneration.get(sessionKey);
    if(latest!==undefined&&identity.generationId<latest)return null;
    const bytes=digestExactUtf8(input);
    if(!bytes||input.trim().slice(0,MAX_INPUT_UNITS)!==input)return null;
    // Source-owned facts read from the original registry at this instant.
    const facts=originalTurnFacts(identity,connection);
    if(!facts||!same(facts,identity)||facts.source!==source||
       facts.inputTranscript!==input)return null;
    if(identityCurrent&&identityCurrent(identity)!==true)return null;
    const recorded=ledger.factsFor(identity);
    if(!recorded||recorded.nativeActorPedId!==identity.pedId||recorded.source!==source)return null;
    if(source==='player_text'?
       recorded.typedInput?.playerAuthored!==true||recorded.typedInput.text!==input:
       recorded.typedInput!==null)return null;
    const timestamp=now();
    if(!(timestamp instanceof Date)||!Number.isFinite(timestamp.getTime()))return null;
    const receipt=Object.freeze({
      kind:ORIGINAL_BACKEND_ACCEPTED_INPUT_V1.kind,
      source:OPENAI_COMMIT_DECISION_RECEIPT_SOURCE,
      lifecycleStatus:'accepted',
      ...identity,
      sourceRunId,
      sourceRevision:OPENAI_RUNTIME_ACCEPTANCE_PIN.sourceRevision,
      originalBundleSha256:OPENAI_RUNTIME_ACCEPTANCE_PIN.originalBundleSha256,
      inputMode,
      finalAcceptedInputRevision:OPENAI_RUNTIME_ACCEPTANCE_PIN.finalAcceptedInputRevision,
      acceptedUtf8Sha256:bytes.sha256,
      acceptedUtf8ByteLength:bytes.byteLength,
      sourceTimestamp:timestamp.toISOString(),
      retirementIdentity:Object.freeze({...identity,sourceRunId}),
    });
    receipts.set(key,Object.freeze({receipt,sessionKey}));
    // Bounded: evicting the oldest live receipt only revokes it (fail closed).
    while(receipts.size>maxReceipts)receipts.delete(receipts.keys().next().value);
    return receipt;
  }

  // Private to OpenAIConnection; never exposed on runtime/services.
  const issuer=Object.freeze({
    openTurn({identity,source,connection,signal}={}){
      if(closed||!validIdentity(identity)||!Object.hasOwn(PLAYER,source)||
         !connection||typeof connection!=='object'||
         !signal||typeof signal.aborted!=='boolean')return null;
      const exact=pick(identity);
      let used=false;
      return Object.freeze({
        // One shot per launch, even when it fails.
        accept({input,inputMode}={}){
          if(used)return null;
          used=true;
          try{return mint({identity:exact,source,connection,signal,input,inputMode});}
          catch{return null;}
        },
        // Called after the turn (including any awaited D03 write) settled.
        release(){used=true;release(exact);},
      });
    },
  });

  const verifier=Object.freeze({
    source:OPENAI_RUNTIME_ACCEPTANCE_PIN,
    hasAuthenticatedSource(){
      try{return !closed&&available()===true;}catch{return false;}
    },
    // Synchronous read-through for D03. Returns the frozen receipt minted by
    // the commit decision for these exact bytes, or null.
    verifyAccepted({identity,source,text}={}){
      if(closed||!validIdentity(identity))return null;
      const item=receipts.get(keyOf(identity));
      if(!item||retiredSessions.has(item.sessionKey))return null;
      const r=item.receipt;
      if(!same(r,identity)||r.sourceRunId!==sourceRunId||r.inputMode!==source)return null;
      const bytes=digestExactUtf8(text);
      return bytes&&bytes.sha256===r.acceptedUtf8Sha256&&
        bytes.byteLength===r.acceptedUtf8ByteLength?r:null;
    },
    // Turn aborted/cancelled/failed: no further issuance. Does NOT revoke an
    // already-issued receipt (§5.5).
    fenceTurn(identity){if(validIdentity(identity))fence(keyOf(identity));},
    retire(identity){if(validIdentity(identity))release(identity);},
    supersede({pedId,sessionNonce,generationId}={}){
      if(!validIdentity({pedId,turnId:'x',generationId,sessionNonce}))return false;
      const key=sessionKeyOf({pedId,sessionNonce});
      latestGeneration.set(key,Math.max(generationId,latestGeneration.get(key)??-1));
      bounded(latestGeneration,maxFences);
      return true;
    },
    retireSession({pedId,sessionNonce}={}){
      if(typeof pedId!=='string'||!pedId||!Number.isSafeInteger(sessionNonce))return false;
      const key=sessionKeyOf({pedId,sessionNonce});
      retiredSessions.add(key);bounded(retiredSessions,maxFences);
      for(const [k,item] of receipts)if(item.sessionKey===key)receipts.delete(k);
      return true;
    },
    retireSourceRun(runId=sourceRunId){
      if(closed||runId!==sourceRunId)return false;
      receipts.clear();
      sourceRunId=String(newRunId());
      return true;
    },
    disconnect(){
      closed=true;receipts.clear();fenced.clear();retiredSessions.clear();latestGeneration.clear();
    },
    status(){
      return Object.freeze({provider:'openai',connected:verifier.hasAuthenticatedSource(),
        liveReceipts:receipts.size,receiptSource:OPENAI_COMMIT_DECISION_RECEIPT_SOURCE});
    },
  });
  return Object.freeze({issuer,verifier});
}
