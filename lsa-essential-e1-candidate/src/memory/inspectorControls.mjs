import path from 'node:path';
import {readFile,open,rename,rm,lstat} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {MEMORY_K_CAPABILITIES} from './capabilityPolicy.mjs';
import {normalizeConfig,defaultConfigPath} from '../config/e1Config.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const optional=id=>id.startsWith('memory.')&&id!=='memory.inspector'||id.startsWith('events.');
const descriptors=MEMORY_K_CAPABILITIES.filter(d=>d.id.startsWith('memory.'));
export function createInspectorControls({runtime,configPath=process.env.LSA_E1_CONFIG||defaultConfigPath,env={}}) {
  const file=path.resolve(configPath);
  let queue=Promise.resolve(),pauseCleanup='not_requested';
  const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
  const read=async()=>{
    try {
      if(!(await lstat(file)).isFile())throw Error('inspector_config_not_regular_file');
      const raw=await readFile(file,'utf8');return {raw,data:JSON.parse(raw),revision:hash(raw)};
    }catch(e){if(e.code==='ENOENT')return {raw:null,data:{},revision:hash('')};throw e;}
  };
  const persist=async(before,data)=>{
    // Validate using the original config normalizer; never save derived secrets.
    normalizeConfig(data,env);
    const temp=file+'.i2-'+randomUUID()+'.tmp';let handle;
    try {
      handle=await open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(data,null,2)+'\n');
      await handle.sync();await handle.close();handle=null;
      if((await read()).revision!==before.revision)throw Error('inspector_config_changed');
      await rename(temp,file);
    }finally{await handle?.close();await rm(temp,{force:true});}
  };
  // M7 consent is NOT a config-file setting: it is an explicit, revisioned P2
  // approval. This view carries only state and limits, never ids or memory text.
  async function cloudView(){
    const store=runtime.characterService?.store,mode=runtime.config.memoryK.capabilities['memory.cloudCuration']??'off';
    let consent={state:'unavailable',revision:null,limits:null};
    try{
      // Consent is world-scoped and survives disabling the worker: always expose
      // persisted approval, so it can be withdrawn without re-enabling M7.
      if(typeof store?.readM7Consent==='function'&&typeof store.activeTimelineId==='string'&&store.activeTimelineId){
        const record=await store.readM7Consent({worldProfileId:store.worldProfileId,timelineId:store.activeTimelineId});
        consent=!record?{state:'not_granted',revision:null,limits:null}:record.mode==='experimental'
          ?{state:'granted',revision:record.consentRevision,
            limits:{dailyUsd:record.dailyUsd,monthlyUsd:record.monthlyUsd,maxBatchUsd:record.maxBatchUsd}}
          :{state:'withdrawn',revision:record.consentRevision,limits:null};
      }
    }catch{}
    return {requestedMode:mode,consent,
      runtime:runtime.services.memoryCloudCurationDiagnostics?.()??null};
  }
  async function snapshot(){
    const stored=await read(),pending=normalizeConfig(stored.data,env).memoryK;
    const diagnostics=runtime.services.memoryKRuntimeDiagnostics();
    const rows=descriptors.map(d=>{
      const policy=diagnostics.policy[d.id],actual=diagnostics.capabilities[d.id];
      const runningMode=actual.requestedMode??policy.requestedMode;
      const requestedMode=pending.capabilities[d.id]??
        (Object.keys(pending.capabilities).length===0?runningMode:'off');
      const inspector=d.id==='memory.inspector';
      const configured=runtime.config.memoryK.capabilities['memory.inspector']==='on';
      const ready=inspector&&configured&&runtime.characterService?.ready===true&&
        runtime.config.promotedCharacters.storageMode==='sqlite';
      const paused=optional(d.id)&&runtime.memoryPause.paused;
      return {id:d.id,modes:d.modes,dependencies:d.dependencies,
        requestedMode,runningRequestedMode:runningMode,
        effectiveMode:paused?'off':inspector?ready?'on':'off':actual.effectiveMode,
        operationalState:paused?'paused':inspector?ready?'scope_verification_required':'disabled':actual.operationalState,
        reason:paused?'learned_memory_paused':inspector?ready?'privileged_p2_scope_required':'inspector_enable_and_restart_required':actual.reason,
        missingDependencies:policy.missingDependencies,blockers:policy.blockers,
        restartRequired:requestedMode!==runningMode,
        changePolicy:'restart_required',legacy:actual.legacy===true};
    });
    return {revision:stored.revision,capabilities:rows,cloudCuration:await cloudView(),
      explicitConfiguration:Object.keys(runtime.config.memoryK.capabilities).length>0,
      pause:{requested:pending.pauseLearned===true,effective:runtime.memoryPause.paused,
        operationalState:runtime.memoryPause.paused?(pauseCleanup==='failed'||runtime.learnedMemoryPauseFailed?'blocked_cleanup_failed':pauseCleanup==='stopping'?'pausing':'paused'):'running',
        cleanup:pauseCleanup,resumeRequiresRestart:true,
        restartRequired:runtime.memoryPause.paused!==(pending.pauseLearned===true)},
      privacy:'Mandatory P2 privacy remains enabled; every operation requires current scope verification.'};
  }
  // Grant/withdraw an explicit M7 cloud-curation approval in P2. Withdrawal is a
  // privacy action: it never depends on config readability, revision or pause.
  const cloudConsent=async body=>{
    const store=runtime.characterService?.store;
    if(typeof store?.grantM7Consent!=='function')throw Error('inspector_cloud_consent_unavailable');
    if(body.action==='withdraw')await store.withdrawM7Consent({});
    else if(body.action==='grant'){
      if(runtime.memoryPause.paused||runtime.config.memoryK.capabilities['memory.cloudCuration']!=='on')
        throw Error('inspector_cloud_consent_unavailable');
      if(body.confirmation!=='approve_off_turn_evidence_upload')
        throw Error('inspector_cloud_consent_confirmation_required');
      await store.grantM7Consent({dailyUsd:body.dailyUsd,monthlyUsd:body.monthlyUsd,maxBatchUsd:body.maxBatchUsd,
        offTurnEvidenceUploadAccepted:true,model:runtime.config.reasoningModel});
    }else throw Error('inspector_invalid_cloud_consent');
    return snapshot();
  };
  const change=body=>body?.operation==='cloud_consent'?serial(()=>cloudConsent(body)):serial(async()=>{
    const stored=await read();
    if(body.revision!==stored.revision)throw Error('inspector_config_changed');
    const data=structuredClone(stored.data),memoryK=data.memoryK??={};
    if(body.operation==='capability'){
      const descriptor=descriptors.find(d=>d.id===body.id);
      if(!descriptor||!descriptor.modes.includes(body.mode))throw Error('inspector_invalid_capability');
      if(Object.keys(runtime.config.memoryK.capabilities).length===0&&body.confirmation!=='use_explicit_capabilities')
        throw Error('inspector_explicit_configuration_confirmation_required');
      memoryK.capabilities={...memoryK.capabilities,[body.id]:body.mode};
    }else if(body.operation==='pause'){
      if(typeof body.paused!=='boolean')throw Error('inspector_invalid_pause');
      memoryK.pauseLearned=body.paused;
      if(body.paused){
        runtime.pauseLearnedMemory();
        pauseCleanup='stopping';
        // Save the latched request before waiting for disposers. A cleanup
        // failure must not cause a later process to resume optional memory.
        try{await persist(stored,data);}catch{pauseCleanup='failed';throw Error('inspector_pause_persistence_failed');}
        try{
          await runtime.memoryM3?.shutdown();
          if(runtime.learnedMemoryPauseFailed)throw Error('inspector_pause_revocation_failed');
          pauseCleanup='stopped';
        }
        catch{pauseCleanup='failed';throw Error('inspector_pause_cleanup_failed');}
        return snapshot();
      }
    }else throw Error('inspector_invalid_control');
    // Pause remains latched even if persistence fails. The response never
    // certifies disk state on failure; a refresh exposes requested vs effective.
    await persist(stored,data);
    return snapshot();
  });
  return Object.freeze({snapshot,change});
}
