// Explicit Essential M7 seam. No cloud calls, subscriptions or timers on import.
import {requestJson} from '../openai/request.mjs';
import {createLunaCurationAdapter} from '../../../lsa-shared-brain/src/memory/lunaCurator.mjs';
import {createIdleCurationScheduler} from '../../../lsa-shared-brain/src/memory/idleCurationScheduler.mjs';
import {validateM7Consent,validateM7Pricing,M7_OFF_CONSENT} from
  '../../../lsa-shared-brain/src/memory/m7Consent.mjs';

/** Only the existing Essential Luna Responses transport, never a local model. */
export function createEssentialLunaCurator(config,{fetchImpl=globalThis.fetch}={}){
 if(config?.provider!=='openai')throw new Error('curation_requires_existing_openai_provider');
 if(!/luna/i.test(config?.reasoningModel??''))throw new Error('curation_requires_luna_model');
 validateM7Pricing(config);
 return createLunaCurationAdapter({config,requestJson:args=>requestJson({...args,fetchImpl})});
}

/**
 * K supplies a P2 store and durable queue/ledger from the SAME connection,
 * config from the existing Luna provider, nativeIdle from its authenticated
 * native-channel owner, and independently persisted explicit consent.
 *
 * The ledger must attest it enforces THESE limits in P2 SQLite and expose
 * reconcile({beforeUtc,worldProfileId}) to settle crash-era uncertainty.
 * No scheduler or provider is automatically started/registered by this file.
 */
export function createEssentialM7Scheduler({config,store,queue,ledger,
 consent=M7_OFF_CONSENT,mode='off',cloudOptIn=false,nativeIdle=null,
 fetchImpl=globalThis.fetch,ownerId,now,onError,maxBatch,
 leaseMs,maxProviderMs,maxAttempts,intervalMs,minIntervalMs,
 maxIdleProofAgeMs}={}){
 // Deprecated flags are disable-only; turning on cloud requires a complete
 // separately persisted consent object, not mode='experimental',optIn=true.
 if(mode==='experimental'||cloudOptIn===true)
   throw new Error('m7_explicit_consent_required');
 const approved=validateM7Consent(consent);
 if(approved.mode==='experimental'){
   validateM7Pricing(config);
   if(!ledger?.budgetLimits||
      ledger.budgetLimits.dailyUsd!==approved.dailyUsd||
      ledger.budgetLimits.monthlyUsd!==approved.monthlyUsd||
      typeof ledger.reconcile!=='function')
     throw new Error('m7_durable_budget_caps_and_recovery_required');
 }
 // Lazy transport only. The cost estimator is intentionally forwarded, so a
 // real batch cannot bypass the ceiling with a wrapper missing this method.
 const existing=()=>createEssentialLunaCurator(config,{fetchImpl});
 const provider=Object.freeze({
   estimateMaxCostUsd:proposals=>existing().estimateMaxCostUsd(proposals),
   curateBatch:(proposals,options)=>existing().curateBatch(proposals,options)
 });
 return createIdleCurationScheduler({store,queue,ledger,provider,
   consent:approved,nativeIdle,ownerId,now,onError,maxBatch,leaseMs,
   maxProviderMs,maxAttempts,intervalMs,minIntervalMs,maxIdleProofAgeMs,
   requireRecovery:true});
}
