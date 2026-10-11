// Production opt-in Essential seam; no live hooks and no paid calls on import.
import {requestJson} from '../openai/request.mjs';
import {createLunaCurationAdapter} from '../../../lsa-shared-brain/src/memory/lunaCurator.mjs';
import {createIdleCurationScheduler} from '../../../lsa-shared-brain/src/memory/idleCurationScheduler.mjs';
export function createEssentialLunaCurator(config,{fetchImpl=globalThis.fetch}={}){
  if(config?.provider!=='openai')throw new Error('curation_requires_existing_openai_provider');
  if(!/luna/i.test(config?.reasoningModel??''))throw new Error('curation_requires_luna_model');
  return createLunaCurationAdapter({config,requestJson:args=>requestJson({...args,fetchImpl})});
}
/**
 * Agent H must supply P2 store, ledger/queue ports, actual idle detection and
 * explicit cloud consent. Configuration does not install a timer/bootstrap hook.
 * 'shadow' validates scheduling behavior but cannot call a provider.
 */
export function createEssentialM7Scheduler({config,store,queue,ledger,
  mode='off',cloudOptIn=false,isIdle,fetchImpl=globalThis.fetch,
  ownerId,now,onError,maxBatch,estimatedMaxCostUsd,leaseMs,maxProviderMs,
  maxAttempts,intervalMs,minIntervalMs}={}){
 const provider=Object.freeze({async curateBatch(proposals,options){
   // Lazily resolve the existing transport only after explicit consent; a
   // scheduler created off/shadow can later be deliberately enabled.
   return createEssentialLunaCurator(config,{fetchImpl}).curateBatch(proposals,options);
 }});
 return createIdleCurationScheduler({store,queue,ledger,provider,mode,
   cloudOptIn,isIdle,ownerId,now,onError,maxBatch,estimatedMaxCostUsd,
   leaseMs,maxProviderMs,maxAttempts,intervalMs,minIntervalMs});
}
