// M7 off-path scheduler. Nothing starts, claims or makes a provider request on import.
// Agent H owns the explicit enable/idle hooks in Essential or standalone hosts.
import {randomUUID} from 'node:crypto';
import {processIdleCuration} from './lunaCurator.mjs';
import {isUuid} from './evidence.mjs';

const result=(status)=>Object.freeze({status,processed:0});
const validMode=m=>['off','shadow','experimental'].includes(m);
const isThenable=v=>v&&typeof v.then==='function';
const clockUtc=now=>{
  const value=now();
  const at=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(at.getTime()))throw new Error('curation_invalid_clock');
  return at.toISOString();
};

/** Host must provide the existing single P2 store, durable queue and ledger,
 * and the real existing Luna cloud transport. Opt-in is separate from mode.
 * A checkpoint is intentionally never awaited on the ordinary dialogue path.
 */
export function createIdleCurationScheduler({store,queue,ledger,provider,mode='off',
  cloudOptIn=false,isIdle=()=>false,now=()=>Date.now(),ownerId=randomUUID(),
  maxBatch=4,estimatedMaxCostUsd=.02,leaseMs=90000,maxProviderMs=45000,
  maxAttempts=8,intervalMs=60000,minIntervalMs=30000,onError=()=>{}}={}){
 if(!validMode(mode)||typeof cloudOptIn!=='boolean'||!isUuid(ownerId)||
    typeof isIdle!=='function'||typeof now!=='function'||typeof onError!=='function'||
    !Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>3600000||
    !Number.isInteger(minIntervalMs)||minIntervalMs<0||minIntervalMs>3600000||
    typeof store?.get!=='function'||typeof store?.activeTimelineId!=='string'||
    typeof store?.timelineWritable!=='boolean')
   throw new Error('curation_invalid_scheduler');
 // Runtime proof must originate from the authenticated native P2 source. A
 // sourceRequired:false test store is not sufficient for cloud authorization.
 const proof=()=>store.verifiedHostContext;
 let busy=null,controller=null,loop=null,stopped=false,lastRun=-Infinity;
 const authorize=(snapshot,job)=>{
   const current=proof();
   return !stopped&&isIdle()===true&&store.timelineWritable===true&&
     current?.hostRunId===snapshot.hostRunId&&current?.worldEpoch===snapshot.worldEpoch&&
     store.activeTimelineId===snapshot.timelineId&&
     job.timelineId===snapshot.timelineId&&job.worldProfileId===store.worldProfileId&&
     job.characterId===snapshot.characterId&&!!store.get(job.characterId);
 };
 const reportError=e=>{try{onError(e?.code||e?.message||'curation_scheduler_error');}catch{}};
 const api={
   get running(){return !!loop;},
   get busy(){return !!busy;},
   get mode(){return mode;},
   setMode(next,{optIn=false}={}){
     if(!validMode(next)||typeof optIn!=='boolean')throw new Error('curation_invalid_mode');
     // Enabling experimental never implicitly authorizes paid cloud usage.
     mode=next;cloudOptIn=optIn;
     if(mode!=='experimental'||!cloudOptIn)api.cancel();
   },
   cancel(){controller?.abort(new Error('curation_interrupted'));},
   async checkpoint({characterId}={}){
     if(mode==='off')return result('disabled');
     if(mode==='shadow')return result('shadow');
     if(!cloudOptIn)return result('disabled');
     if(stopped)return result('stopped');
     if(busy)return result('busy');
     if(!isUuid(characterId))return result('no_character');
     if(isIdle()!==true)return result('not_idle');
     const host=proof(),timelineId=store.activeTimelineId;
     if(!store.timelineWritable||!isUuid(host?.hostRunId)||
        !Number.isSafeInteger(host.worldEpoch)||host.worldEpoch<1||
        !isUuid(timelineId)||!store.get(characterId))return result('source_unverified');
     const snapshot={hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,
       timelineId,characterId};
     const stamp=Date.parse(clockUtc(now));
     if(stamp-lastRun<minIntervalMs)return result('throttled');
     lastRun=stamp;
     controller=new AbortController();
     const job=processIdleCuration({mode:'experimental',queue,ledger,provider,ownerId,
       nowUtc:new Date(stamp).toISOString(),maxBatch,characterId,estimatedMaxCostUsd,leaseMs,
       maxProviderMs,maxAttempts,signal:controller.signal,
       isAuthorized:j=>authorize(snapshot,j)});
     busy=job;
     try{return await job;}
     catch(error){reportError(error);return result('failed_closed');}
     finally{if(busy===job){busy=null;controller=null;}}
   },
   start({getIdleCharacterId}={}){
     if(stopped)throw new Error('curation_scheduler_stopped');
     if(loop)return false;
     if(typeof getIdleCharacterId!=='function')throw new TypeError('curation_character_selector_required');
     const tick=()=>{
       if(stopped)return;
       // Explicit checked idle checkpoint: no false timer-driven assumption
       // that gameplay or dialogue is idle.
       try{
         const selected=getIdleCharacterId();
         if(isThenable(selected))throw new Error('curation_async_character_selector');
         if(isUuid(selected))void api.checkpoint({characterId:selected}).catch(reportError);
       }catch(e){reportError(e);}
       if(!stopped){
         loop=setTimeout(tick,intervalMs);
         loop.unref?.();
       }
     };
     loop=setTimeout(tick,intervalMs);
     loop.unref?.();
     return true;
   },
   async stop(){
     stopped=true;if(loop){clearTimeout(loop);loop=null;}
     api.cancel();
     if(busy)await busy.catch(()=>{});
   }
 };
 return Object.freeze(api);
}
