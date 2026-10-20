// E0.1-specific evidence audit: numerical native receipts are not GTA acceptance.
// A successful CREATE_* call is insufficient without delayed and delete proof.
const kinds=['ped','vehicle','prop','pickup'];
const checks=['immediate','1000ms','5000ms'];
const deleteChecks=['250ms','750ms'];
const pct=(value,total)=>total===0?null:value/total;
const percentile=(values,p)=>{
  if(!values.length)return null;
  const sorted=values.slice().sort((a,b)=>a-b);
  return sorted[Math.ceil(p*sorted.length)-1];
};
export function e01Evidence(events){
  const starts=[],summaries=[],negatives=[],trials=new Map(),faults=[],modelsByKind=new Map();
  let baseline=null,readbacks=0,postChecks=0,readbackFailed=0,postFailed=0;
  const timings={spawn:[],delete:[]};
  for(const event of events){
    const type=event?.type;
    if(!type?.startsWith('e01_'))continue;
    const data=event.record?.payload||{};
    if(type==='e01_baseline'){if(baseline)faults.push('duplicate_e01_baseline');baseline=data;continue;}
    if(type==='e01_summary'){summaries.push(data);continue;}
    if(type==='e01_negative_control'){negatives.push(data);continue;}
    if(type==='e01_spawn_timing'||type==='e01_delete_timing'){
      const val=data.elapsedWallMs;
      if(typeof val==='number'&&Number.isFinite(val)&&val>=0)
        timings[type==='e01_spawn_timing'?'spawn':'delete'].push(val);
      else faults.push(type+'_invalid_timing');
      continue;
    }
    if(type==='e01_trial_start'){
      const id=data.trial;
      if(typeof id!=='string'||trials.has(id)){faults.push('duplicate_or_missing_trial_id');continue;}
      if(!kinds.includes(data.kind)){faults.push(id+':unknown_kind');continue;}
      trials.set(id,{id,kind:data.kind,model:data.model,delayed:data.delayed===true,
        readbacks:new Map(),post:new Map(),result:null,starts:1});
      starts.push(id);
      if(!modelsByKind.has(data.kind))modelsByKind.set(data.kind,new Set());
      modelsByKind.get(data.kind).add(data.model);
      continue;
    }
    const id=data.trial;
    if(typeof id!=='string'||!trials.has(id)){
      // Population and telemetry may accompany early fail-closed bootstrap.
      if(!['e01_population','e01_spawn_failure'].includes(type))faults.push(type+':unknown_trial');
      continue;
    }
    const trial=trials.get(id);
    if(type==='e01_readback'){
      readbacks++;
      if(!checks.includes(data.phase)||trial.readbacks.has(data.phase))
        faults.push(id+':bad_or_duplicate_readback_'+data.phase);
      else trial.readbacks.set(data.phase,data);
      if(data.success!==true)readbackFailed++;
    }else if(type==='e01_post_delete'){
      postChecks++;
      if(!deleteChecks.includes(data.phase)||trial.post.has(data.phase))
        faults.push(id+':bad_or_duplicate_delete_check_'+data.phase);
      else trial.post.set(data.phase,data);
      if(data.absent!==true)postFailed++;
    }else if(type==='e01_trial_result'){
      if(trial.result)faults.push(id+':duplicate_result');
      trial.result=data;
    }
  }
  const byKind={};
  for(const kind of kinds)byKind[kind]={attempts:0,creationReadbacks:0,
    delayedAttempted:0,delayedVerified:0,postDeleteVerified:0,failed:0,
    modelVariants:[...(modelsByKind.get(kind)||[])],readbackRatio:null};
  let verified=0,delayedAttempted=0,delayedVerified=0,incomplete=0,writeViolations=0;
  for(const trial of trials.values()){
    const out=byKind[trial.kind];out.attempts++;
    if(trial.delayed){out.delayedAttempted++;delayedAttempted++;}
    const result=trial.result;
    if(!result){faults.push(trial.id+':missing_result');incomplete++;continue;}
    const immediate=trial.readbacks.get('immediate');
    if(result.created===true&&!immediate)faults.push(trial.id+':missing_immediate_readback');
    if(result.created===true&&immediate?.success===true)out.creationReadbacks++;
    const delayedComplete=!trial.delayed||result.created!==true||immediate?.success!==true||
      checks.slice(1).every(key=>trial.readbacks.get(key)?.success===true);
    if(trial.delayed&&result.created===true&&immediate?.success===true&&!delayedComplete)
      faults.push(trial.id+':missing_or_failed_delayed_check');
    const postComplete=deleteChecks.every(key=>trial.post.get(key)?.absent===true);
    if(!postComplete)faults.push(trial.id+':post_delete_incomplete_or_present');
    if(result.actorWrites!==0){faults.push(trial.id+':unexpected_actor_write');writeViolations++;}
    if(result.passed===true && !(result.created===true&&
        immediate?.success===true&&delayedComplete&&postComplete&&result.deleted===true&&
        result.postDelete===true&&result.stability===true))
      faults.push(trial.id+':unsupported_pass_claim');
    if(result.passed===true){
      out.postDeleteVerified++;verified++;
      if(trial.delayed){delayedVerified++;out.delayedVerified++;}
    }else out.failed++;
  }
  for(const kind of kinds)byKind[kind].readbackRatio=pct(byKind[kind].creationReadbacks,byKind[kind].attempts);
  const mode=baseline?.mode??null;
  if(baseline){
    if(mode!=='baseline'&&mode!=='extended')faults.push('invalid_e01_mode');
    if(baseline.planned!==80||baseline.perKind!==20)faults.push('unexpected_e01_plan');
    if(summaries.length!==1)faults.push('e01_summary_missing_or_duplicate');
    if(negatives.length!==3||negatives.some(x=>x.rejected!==true||x.actorWrites!==0))
      faults.push('e01_negative_controls_failed_or_missing');
    if(starts.length!==80)faults.push('e01_incomplete_trial_count');
    for(const kind of kinds)if(byKind[kind].attempts!==20)faults.push('e01_kind_denominator_'+kind);
    if(mode==='extended'&&delayedAttempted!==16)faults.push('e01_delayed_trial_denominator');
    if(mode==='baseline'&&delayedAttempted!==0)faults.push('baseline_contains_delayed_trial');
    const s=summaries[0];
    if(s&&(s.attempted!==starts.length||s.fullyVerified!==verified||
      s.failed!==starts.length-verified||s.negativeFailed!==0||s.actorWrites!==0))
      faults.push('e01_summary_disagrees_with_events');
  }else if(starts.length)faults.push('e01_baseline_missing');
  return {
    mode,planned:baseline?.planned??null,observedTrials:starts.length,fullyVerified:verified,
    incomplete,delayedAttempted,delayedVerified,readbacks,readbackFailed,
    postDeleteChecks:postChecks,postDeleteFailures:postFailed,writeViolations,
    negativeControls:negatives.length,
    byKind,spawnTimingMs:{p50:percentile(timings.spawn,0.50),p95:percentile(timings.spawn,0.95)},
    deleteTimingMs:{p50:percentile(timings.delete,0.50),p95:percentile(timings.delete,0.95)},
    integrity:faults.length?'incomplete_or_invalid':'internally_consistent',
    faults,acceptance:'NEEDS_GTA_VIDEO_AND_OWNER_REVIEW',estimatedPoolHeadroom:false,
    scope:'Native readbacks + sampled Essential flags only; no independent game-state truth or frame-time proof'
  };
}
