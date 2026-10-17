// W09 D04: independent parent-process measurement, never test stdout.
// The observed runner coverage is an execution fact, NOT input acceptance;
// P2 SQLite journal rows alone do not attest native or backend provenance.
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hex=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const runnerRel='lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs';
const p2Rel='lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
const coverageFiles=dir=>existsSync(dir)?readdirSync(dir).filter(x=>/^coverage-.*\.json$/.test(x)):[];
function measuredCoverage(dir,relative) {
  let found=false,entered=0,functions=[];
  for(const f of coverageFiles(dir)){
    let report;
    try{report=JSON.parse(readFileSync(path.join(dir,f),'utf8'));}catch{continue;}
    for(const script of report.result??[]){
      const url=String(script.url||'').replace(/\\/g,'/');
      if(!url.endsWith('/'+relative))continue;
      found=true;
      for(const fun of script.functions??[]){
        const active=(fun.ranges??[]).some(r=>r.count>0);
        if(active){functions.push(fun.functionName); if(fun.functionName==='runSequentialTurn'||fun.functionName==='createP2MemoryStorage') entered++;}
      }
    }
  }
  return {loaded:found,entryExecuted:entered>0,entryExecutions:entered,activeFunctionNames:[...new Set(functions)].sort().slice(0,50)};
}
export function measureP2Database(dbPath) {
  if(!dbPath||!existsSync(dbPath))return {exists:false,valid:false,dialogue:[],events:[],reason:'NO_P2_SQLITE_FILE'};
  let db;
  try{
    db=new DatabaseSync(dbPath,{readOnly:true});
    const integrity=db.prepare('PRAGMA quick_check').get();
    if(Object.values(integrity||{})[0]!=='ok')throw new Error('p2_integrity_check_failed');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
    for(const name of ['p2_store','promoted_profiles','timelines','dialogue_journal','event_journal','event_source_evidence'])
      if(!tables.has(name))throw new Error('missing_real_p2_table_'+name);
    const dialogue=db.prepare('SELECT record_id,character_id,timeline_id,protagonist,speaker,source,content,content_sha256,envelope_json,envelope_sha256 FROM dialogue_journal ORDER BY rowid').all();
    const events=db.prepare('SELECT record_id,character_id,timeline_id,source_hash,envelope_json,envelope_sha256 FROM event_journal ORDER BY rowid').all();
    const bad=[];
    for(const row of dialogue){
      if(!uuid(row.record_id)||sha(Buffer.from(row.content,'utf8'))!==row.content_sha256||
         sha(Buffer.from(row.envelope_json,'utf8'))!==row.envelope_sha256)bad.push(row.record_id||'invalid_dialogue');
    }
    for(const row of events){
      if(!uuid(row.record_id)||!hex(row.source_hash)||
         sha(Buffer.from(row.envelope_json,'utf8'))!==row.envelope_sha256)bad.push(row.record_id||'invalid_event');
      if(!db.prepare('SELECT 1 FROM event_source_evidence WHERE record_id=?').get(row.record_id))
        bad.push('missing_sidecar_'+row.record_id);
    }
    return {exists:true,valid:bad.length===0,dialogue:dialogue.map(r=>({
      recordId:r.record_id,characterId:r.character_id,timelineId:r.timeline_id,
      avatar:r.protagonist,speaker:r.speaker,source:r.source,contentSha256:r.content_sha256
    })),events:events.map(r=>({recordId:r.record_id,characterId:r.character_id,
      timelineId:r.timeline_id,sourceHash:r.source_hash})),tampered:bad,
      sqliteSha256:sha(readFileSync(dbPath))};
  }catch(error){
    return {exists:true,valid:false,dialogue:[],events:[],reason:String(error?.message||error)};
  }finally{try{db?.close();}catch{}}
}
export function measureScenarioEvidence({root,coverageDir,dbPath,childStatus,stdout='',scenarioId}){
  const runner=measuredCoverage(coverageDir,runnerRel);
  const p2=measuredCoverage(coverageDir,p2Rel);
  const sqlite=measureP2Database(dbPath);
  const sourceHashes={};
  for(const relative of [runnerRel,p2Rel]){
    try{sourceHashes[relative]=sha(readFileSync(path.join(root,relative)));}catch{}
  }
  const facts={
    scenarioId,processExitCode:childStatus,runner,p2,
    sqlite:{exists:sqlite.exists,valid:sqlite.valid,
      dialogueCount:sqlite.dialogue?.length??0,eventCount:sqlite.events?.length??0,
      recordIds:(sqlite.dialogue||[]).map(x=>x.recordId),
      eventRecordIds:(sqlite.events||[]).map(x=>x.recordId),
      storedContentHashes:(sqlite.dialogue||[]).map(x=>x.contentSha256),
      sqliteSha256:sqlite.sqliteSha256??null,
      reason:sqlite.reason??null,tampered:sqlite.tampered??[]},
    sourceHashes
  };
  // No known production schema in this pinned T9 baseline binds *both*
  // D01 original backend accepted generation/source revision and *D02*
  // native current owner/player capture at single P2 SQLite commit.
  // A source-sim row is not that receipt; returning "pass" would be a lie.
  const evidenceMissing=[];
  if(!runner.entryExecuted)evidenceMissing.push('ORIGINAL_RUNNER_NOT_EXECUTED');
  if(!p2.entryExecuted)evidenceMissing.push('P2_STORAGE_NOT_EXECUTED');
  if(!sqlite.exists||!sqlite.valid)evidenceMissing.push('NO_VERIFIED_P2_SQLITE');
  if(!sqlite.dialogue?.length)evidenceMissing.push('NO_DURABLE_ACCEPTED_PLAYER_ROW');
  evidenceMissing.push('D01_D02_ATOMIC_ORIGIN_RECEIPT_UNAVAILABLE');
  // stdout deliberately absent from acceptance calculus. A perfect forged
  // @@MEMORY_K_W09_RECEIPT@@ payload changes none of these facts.
  void stdout;
  return Object.freeze({pass:false,classification:'original_runner_probe_source_blocked',
    facts,missing:evidenceMissing});
}
