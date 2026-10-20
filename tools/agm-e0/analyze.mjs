#!/usr/bin/env node
// Offline: never treats a command acknowledgment as task retention or world truth.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {e01Evidence} from './e01Evidence.mjs';

const critical=new Set(['probe_start','probe_stop','create','task_issued','sample','sensor','cleanup']);
export function analyze(lines){
  const errors=[],events=[],probes=new Map(),owned=new Map(),stops=new Map();
  let prevGame=null, host=null,epoch=null;
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();if(!line)continue;
    let entry;
    try{entry=JSON.parse(line);}catch{errors.push('line_'+(i+1)+':invalid_json');continue;}
    const type=entry?.type,rec=entry?.record,stamp=rec?.payload;
    if(typeof type!=='string'||typeof rec?.hostRunId!=='string'||
      typeof rec?.worldEpoch!=='string'||typeof rec?.gameMs!=='number'){
      errors.push('line_'+(i+1)+':invalid_envelope');continue;
    }
    if(!host){host=rec.hostRunId;epoch=rec.worldEpoch;}
    if(rec.hostRunId!==host||rec.worldEpoch!==epoch)errors.push('line_'+(i+1)+':mixed_host_epoch');
    if(prevGame!=null && rec.gameMs<prevGame && prevGame-rec.gameMs>10000)
      errors.push('line_'+(i+1)+':world_clock_regressed');
    prevGame=rec.gameMs;
    if(critical.has(type)&&(!stamp||typeof stamp!=='object'))
      errors.push('line_'+(i+1)+':missing_payload');
    events.push(entry);
    const probe=rec.probe;
    if(probe&&!probes.has(probe))probes.set(probe,{id:probe,starts:0,stops:0,creates:0,
      taskCommands:0,taskSamples:0,knownTaskSamples:0,lost:0,cleaned:0,orphans:0,
      sensorSamples:0,truthPass:0,truthFail:0,truthUnknown:0,coexistence:0,
      sumSampleMs:0,peakSampleMs:0,conditions:new Set(),siteLabels:new Set(),
      nathan:new Set(),days:new Set()});
    const current=probes.get(probe);
    if(!current)continue;
    current.conditions.add(rec.condition);current.siteLabels.add(rec.site);
    current.nathan.add(rec.nathan);current.days.add(rec.day);
    if(type==='probe_start')current.starts++;
    if(type==='probe_stop'){current.stops++;current.sumSampleMs+=stamp.avgSampleMs||0;
      current.peakSampleMs=Math.max(current.peakSampleMs,stamp.maxSampleMs||0);
      stops.set(probe,stamp);}
    if(type==='create'){
      current.creates++;
      const id=stamp.Incarnation;
      if(!id||owned.has(id))errors.push('line_'+(i+1)+':duplicate_or_absent_incarnation');
      else owned.set(id,{probe,cleaned:false,lost:false});
    }
    if(type==='task_issued')current.taskCommands++;
    if(type==='sample'){
      if(stamp.Task){current.taskSamples++;
        if(Number.isInteger(stamp.taskStatus)&&stamp.taskStatus!==-999)current.knownTaskSamples++;}
    }
    if(type==='sensor')current.sensorSamples++;
    if(type==='entity_lost')current.lost++;
    if(type==='coexistence')current.coexistence++;
    if(type==='ground_truth'){
      if(stamp.videoLabel==='pass')current.truthPass++;
      else if(stamp.videoLabel==='fail')current.truthFail++;
      else current.truthUnknown++;
    }
    if(type==='cleanup'){
      if(stamp.deleted===true){current.cleaned++;if(owned.has(stamp.Incarnation))owned.get(stamp.Incarnation).cleaned=true;}
      else current.orphans++;
    }
    if(type==='error'||type==='cleanup_error'||type==='journal_error')errors.push('line_'+(i+1)+':'+type);
  }
  for(const [id,item] of owned){
    if(!item.cleaned)errors.push('unresolved_entity:'+id);
  }
  const reports=[...probes.values()].map(x=>{
    const stop=stops.get(x.id);
    const taskRetention=x.knownTaskSamples===0?'not_measurable_offline':'runtime_samples_need_review';
    const sensorError=x.truthPass+x.truthFail===0?null:x.truthFail/(x.truthPass+x.truthFail);
    return {...x,conditions:[...x.conditions],siteLabels:[...x.siteLabels],
      nathan:[...x.nathan],days:[...x.days],
      taskRetention,sensorError,completed:stop?.reason==='completed',
      performanceAvgMs:x.stops?x.sumSampleMs/x.stops:null,
      phase:'GTA_logs_not_automatically_validated',runtimeRequired:true};
  });
  const containsE01=reports.some(r=>r.id==='e0.1');
  const e01=containsE01?e01Evidence(events):null;
  if(e01 && e01.integrity!=='internally_consistent')errors.push(...e01.faults.map(x=>'e01:'+x));
  const complete=errors.length===0&&reports.length>0&&reports.every(r=>r.starts===r.stops&&r.orphans===0);
  const tasks=reports.filter(x=>x.id==='e0.2'||x.id==='e0.6');
  const yieldComparisons=tasks.flatMap(x=>x.conditions);
  return {
    schema:'agm-e0-report-v1',observations:events.length,hostRunId:host,worldEpoch:epoch,
    integrity:complete?'parsed_clean':'incomplete_or_error',errors,reports,e01,
    acceptance:{
      creationReadback:'requires actual GTA plus sample counts per capability; see E0.1 per-kind native readback evidence',
      taskRetention:'requires >=10 timed trials per task with Essential yield on/off, and human/video correlation',
      essentialCoexistence:yieldComparisons.includes('yield_on')&&yieldComparisons.includes('yield_off')
        ?'requires joined OBS2/Essential/Nathan logs and video':'not_compared',
      sensorAccuracy:'requires operator timecoded video ground truth; manual labels do not prove sensor fidelity',
      orphanCount:reports.reduce((n,x)=>n+x.orphans,0),
      frameTime:'measured sample callback only, not per-frame total',
      final:'NOT_ACCEPTED_AUTOMATICALLY'
    }
  };
}
export function reportFile(source,destination){
  const report=analyze(readFileSync(source,'utf8').split(/\r?\n/));
  if(destination)writeFileSync(destination,JSON.stringify(report,null,2)+'\n');
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [source,destination]=process.argv.slice(2);
  if(!source){process.stderr.write('Usage: node analyze.mjs input.jsonl [report.json]\n');process.exit(2);}
  const result=reportFile(source,destination);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  process.exitCode=result.integrity==='parsed_clean'?0:1;
}
