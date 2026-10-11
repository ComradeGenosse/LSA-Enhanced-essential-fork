// M7 opt-in OFF-TURN scheduler. Importing and constructing never starts a timer,
// captures native activity or makes a paid request. K owns lifecycle/bootstrap.
import {randomUUID} from 'node:crypto';
import {processIdleCuration} from './lunaCurator.mjs';
import {isUuid} from './evidence.mjs';
import {validateM7Consent,validateM7IdleProof,M7_OFF_CONSENT} from './m7Consent.mjs';

const empty=status=>Object.freeze({status,processed:0});
const clockUtc=now=>{
 const at=now(),date=at instanceof Date?at:new Date(at);
 if(!Number.isFinite(date.getTime()))throw new Error('curation_invalid_clock');
 return date.toISOString();
};
const sameAuthority=(a,b)=>!!a&&!!b&&Object.keys(a).every(k=>a[k]===b[k]);
const activeStores=new WeakSet();

/**
 * Native adapter contract:
 * nativeIdle.snapshot() synchronously returns a fresh verified_native_idle_v1
 * proof from the authenticated GTA host and currently P2-bound promoted NPC;
 * nativeIdle.subscribeInvalidation(fn) synchronously subscribes to mic start,
 * turn start, player/Director activity, and owner/session/epoch/save changes.
 * Subscriber invokes fn immediately, even while fetch is in flight.
 *
 * SQLite queue/ledger are adapters to the SAME P2-owned serialized store.
 * Cloud spending requires reconcile({beforeUtc,worldProfileId}) and
 * externally-attested matching budgetLimits in the Essential bridge.
 */
export function createIdleCurationScheduler({store,queue,ledger,provider,
  consent=M7_OFF_CONSENT,nativeIdle=null,now=()=>Date.now(),ownerId=randomUUID(),
  maxBatch=4,leaseMs=90000,maxProviderMs=45000,maxAttempts=8,
  intervalMs=60000,minIntervalMs=30000,maxIdleProofAgeMs=3000,
  onError=()=>{},requireRecovery=true}={}){
 if(typeof store?.get!=='function'||typeof store?.activeTimelineId!=='string'||
   typeof store.timelineWritable!=='boolean'||typeof now!=='function'||
   !isUuid(ownerId)||typeof onError!=='function'||
   !Number.isSafeInteger(maxBatch)||maxBatch<1||maxBatch>4||
   !Number.isSafeInteger(leaseMs)||leaseMs<5000||leaseMs>300000||
   !Number.isSafeInteger(maxProviderMs)||maxProviderMs<1000||maxProviderMs>=leaseMs-1000||
   !Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>32||
   !Number.isSafeInteger(intervalMs)||intervalMs<1000||intervalMs>3600000||
   !Number.isSafeInteger(minIntervalMs)||minIntervalMs<0||minIntervalMs>3600000||
   !Number.isSafeInteger(maxIdleProofAgeMs)||maxIdleProofAgeMs<100||
   maxIdleProofAgeMs>10000||typeof requireRecovery!=='boolean')
   throw new Error('curation_invalid_scheduler');
 let policy=validateM7Consent(consent),revision=0;
 const limitsMatch=p=>p.mode!=='experimental'||(
   ledger?.budgetLimits?.dailyUsd===p.dailyUsd&&
   ledger?.budgetLimits?.monthlyUsd===p.monthlyUsd);
 if(!limitsMatch(policy))throw new Error('m7_budget_limit_mismatch');
 let busy=null,controller=null,loop=null,stopped=false,lastRun=-Infinity;
 let recoveryKey=null,costSuspended=false;
 const reportError=e=>{try{onError(e?.code||e?.message||'m7_scheduler_failure');}catch{}};
 const takeSnapshot=(characterId,stamp)=>{
   if(typeof nativeIdle?.snapshot!=='function')throw new Error('m7_native_idle_adapter_missing');
   const proof=nativeIdle.snapshot();
   if(proof&&typeof proof.then==='function')throw new Error('m7_async_idle_proof');
   return validateM7IdleProof(proof,{store,
     characterId:characterId??proof?.characterId,
     nowUtc:stamp,maxAgeMs:maxIdleProofAgeMs});
 };
 const entitled=(snapshot,rev,characterId)=>{
   if(stopped||policy.mode!=='experimental'||!policy.cloudOptIn||!limitsMatch(policy)||revision!==rev)
     return false;
   try{return sameAuthority(snapshot,takeSnapshot(characterId,clockUtc(now)));}
   catch{return false;}
 };
 const cancel=()=>{
   controller?.abort(Object.assign(new Error('m7_activity_or_source_changed'),{code:'cancelled'}));
 };
 const api={
   get running(){return loop!==null;},
   get busy(){return busy!==null;},
   get mode(){return policy.mode;},
   get consent(){return policy;},
   /** Replaces policy only on an explicit trusted settings action, not on speech. */
   setConsent(value){
     const next=validateM7Consent(value);
     if(!limitsMatch(next))throw new Error('m7_budget_limit_mismatch');
     cancel();policy=next;revision++;recoveryKey=null;costSuspended=false;
     if(policy.mode!=='experimental'&&loop!==null){clearTimeout(loop);loop=null;}
   },
   /** Backwards-compatible disabling; never grants paid consent. */
   setMode(mode){
     if(mode!=='off'&&mode!=='shadow')throw new Error('m7_set_consent_required');
     api.setConsent({mode});
   },
   cancel,
   /** Called synchronously on any mic/turn/session/owner/timeline activity. */
   notifyActivity(){cancel();},
   async checkpoint({characterId}={}){
     if(policy.mode==='off')return empty('disabled');
     if(policy.mode==='shadow')return empty('shadow');
     if(stopped)return empty('stopped');
     if(costSuspended)return empty('cost_suspended');
     if(busy||activeStores.has(store))return empty('busy');
     if(characterId!==undefined&&!isUuid(characterId))return empty('no_character');
     if(typeof provider?.curateBatch!=='function'||
        typeof provider?.estimateMaxCostUsd!=='function')
       return empty('pricing_unavailable');
     if(!ledger||typeof ledger.reserve!=='function'||typeof ledger.settle!=='function'||
        typeof ledger.release!=='function'||
        (requireRecovery&&typeof ledger.reconcile!=='function'))
       return empty('recovery_unavailable');
     if(!queue||!['enqueueIfAbsent','claimDue','completeLeased','retryLeased','releaseLeased']
       .every(fn=>typeof queue[fn]==='function'))return empty('queue_unavailable');
     if(typeof nativeIdle?.subscribeInvalidation!=='function')
       return empty('activity_subscriber_missing');
     const stamp=clockUtc(now),started=Date.parse(stamp);
     let snapshot;
     try{snapshot=takeSnapshot(characterId,stamp);}
     catch{return empty('source_unverified');}
     if(started-lastRun<minIntervalMs)return empty('throttled');
     const rev=revision,npc=snapshot.characterId;
     lastRun=started;
     controller=new AbortController();
     activeStores.add(store);
     const run=async()=>{
       let unsubscribe=null;
       try{
         unsubscribe=nativeIdle.subscribeInvalidation(()=>cancel());
         if(typeof unsubscribe!=='function')throw new Error('m7_subscription_missing_dispose');
         if(!entitled(snapshot,rev,npc)||controller.signal.aborted)
           return empty('source_unverified');
         // Reconcile outstanding reservations conservatively at the ceiling on
         // first checkpoint after process/session restart; never refund an
         // uncertain cloud transport. B owns the transactional SQL port.
         const key=snapshot.worldProfileId+':'+snapshot.hostRunId+':'+snapshot.sessionId;
         if(requireRecovery&&recoveryKey!==key){
           await ledger.reconcile({beforeUtc:stamp,worldProfileId:snapshot.worldProfileId});
           if(!entitled(snapshot,rev,npc)||controller.signal.aborted)
             return empty('cancelled');
           recoveryKey=key;
         }
         const outcome=await processIdleCuration({mode:'experimental',queue,ledger,provider,
           ownerId,nowUtc:stamp,maxBatch,characterId:npc,
           estimatedMaxCostUsd:policy.maxBatchUsd,leaseMs,maxProviderMs,maxAttempts,
           signal:controller.signal,enforcePricing:true,strictAck:true,
           isAuthorized:job=>entitled(snapshot,rev,npc)&&
             job.characterId===npc&&job.worldProfileId===snapshot.worldProfileId&&
             job.timelineId===snapshot.timelineId});
         if(outcome.status==='cost_overrun'||outcome.status==='settlement_pending'){
           costSuspended=true;reportError(outcome.status);
         }
         return outcome;
       }finally{try{unsubscribe?.();}catch{}}
     };
     const promise=run();
     busy=promise;
     try{return await promise;}
     catch(error){reportError(error);return empty('failed_closed');}
     finally{
       if(busy===promise){busy=null;controller=null;}
       activeStores.delete(store);
     }
   },
   /** Optional one bounded timer; OFF/shadow never keep a timer alive. */
   start(){
     if(stopped)throw new Error('curation_scheduler_stopped');
     if(loop!==null)return false;
     if(policy.mode!=='experimental'||!policy.cloudOptIn)return false;
     const tick=()=>{
       if(stopped||policy.mode!=='experimental')return;
       if(!busy)void api.checkpoint().catch(reportError);
       if(!stopped&&policy.mode==='experimental'){
         loop=setTimeout(tick,intervalMs);loop.unref?.();
       }
     };
     loop=setTimeout(tick,intervalMs);loop.unref?.();
     return true;
   },
   async stop(){
     stopped=true;
     if(loop!==null){clearTimeout(loop);loop=null;}
     cancel();
     if(busy)await busy.catch(()=>{});
   }
 };
 return Object.freeze(api);
}
