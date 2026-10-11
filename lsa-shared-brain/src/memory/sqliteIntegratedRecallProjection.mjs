// M4-only read projection over the actual M2/M3/M5/M6 v4 P2 SQLite schema.
// No migrations, writes, native owner selection, or speculative witness claims.
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const token=s=>typeof s==='string'&&/^[\p{L}\p{N}]{2,48}$/u.test(s);
const textMatch=terms=>terms.map(t=>'"'+t.replace(/"/g,'""')+'"').join(' OR ');
const parse=s=>JSON.parse(s);
function verifyEnvelope(raw,digest){
  if(typeof raw!=='string'||sha(raw)!==digest)throw new Error('m4_corrupt_envelope');
  return parse(raw);
}
function all(db,sql,values,limit){
  return db.prepare(sql+' LIMIT ?').all(...values,limit);
}
function sourceFilters(scope,{fromUtc,toUtc}){
  let clause='world_profile_id=? AND character_id=? AND timeline_id=?';
  const args=[scope.worldProfileId,scope.characterId,scope.timelineId];
  if(fromUtc){clause+=' AND TIME_COLUMN>=?';args.push(fromUtc);}
  if(toUtc){clause+=' AND TIME_COLUMN<?';args.push(toUtc);}
  return {clause,args};
}
function suppression(db,scope){
  const args=[scope.worldProfileId,scope.characterId,scope.timelineId];
  const forgotten=new Set(db.prepare('SELECT target_id FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=?').all(...args).map(r=>r.target_id));
  const records=db.prepare('SELECT memory_id,evidence_ids_json FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=?').all(...args);
  const links=records.map(row=>({id:row.memory_id,sources:parse(row.evidence_ids_json)}));
  if(links.some(x=>!Array.isArray(x.sources)||x.sources.some(id=>!uuid.test(id))))throw new Error('m4_invalid_memory_evidence');
  let changed=true;
  while(changed){
    changed=false;
    for(const l of links){
      if(forgotten.has(l.id)){
        for(const id of l.sources)if(!forgotten.has(id)){forgotten.add(id);changed=true;}
      }else if(l.sources.some(id=>forgotten.has(id))){forgotten.add(l.id);changed=true;}
    }
  }
  return forgotten;
}
function correctionRows(db,scope,forgotten){
  const args=[scope.worldProfileId,scope.characterId,scope.timelineId,scope.protagonistKey];
  const source=db.prepare('SELECT c.command_id AS id,c.target_id AS target,c.preferred_text AS content,c.content_sha256 AS digest,c.created_at_utc AS atUtc FROM memory_corrections c JOIN memory_commands m ON m.command_id=c.command_id WHERE c.world_profile_id=? AND c.character_id=? AND c.timeline_id=? AND m.protagonist_key=? ORDER BY c.created_at_utc DESC,c.command_id DESC').all(...args);
  const corrected=new Set(source.map(x=>x.target));
  const overlays=[],seenTargets=new Set();
  for(const c of source){
    if(!uuid.test(c.id)||!uuid.test(c.target)||sha(c.content)!==c.digest)throw new Error('m4_corrupt_correction');
    if(seenTargets.has(c.target)||forgotten.has(c.target)||forgotten.has(c.id)||corrected.has(c.id))continue;
    seenTargets.add(c.target);
    const envelope={version:1,kind:'permanent_memory',recordId:c.id,
      characterId:scope.characterId,worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
      content:'Player correction (reported): '+c.content,mode:'reported_claim',sourceEvidenceIds:[c.target]};
    overlays.push({...scope,recordId:c.id,sourceKind:'permanent_memory',atUtc:c.atUtc,
      evidenceState:'verified',envelope});
  }
  return {corrected,overlays};
}
export function readIntegratedRecall(db,{scope,terms=[],fromUtc=null,toUtc=null,sourceKind=null,speaker=null,limit=384}){
  if(!scope||!['franklin','michael','trevor','unknown'].includes(scope.protagonistKey)||
    !['characterId','worldProfileId','timelineId'].every(k=>uuid.test(scope[k]))||
    !Number.isSafeInteger(limit)||limit<1||limit>768)throw new TypeError('m4_invalid_integrated_scope');
  if(sourceKind&&!['dialogue_line','journal_event','permanent_memory','canon'].includes(sourceKind))throw new TypeError('m4_invalid_kind');
  if(speaker&&!['player','npc'].includes(speaker))throw new TypeError('m4_invalid_speaker');
  const tokens=[...new Set(terms.filter(token))].slice(0,12),limitLex=tokens.length?Math.min(128,Math.floor(limit/3)):0;
  const forgotten=suppression(db,scope),{corrected,overlays}=correctionRows(db,scope,forgotten);
  const result=new Map(),add=(r)=>{
    if(!r||forgotten.has(r.recordId)||corrected.has(r.recordId))return;
    if(r.protagonistKey!==scope.protagonistKey)return;
    if((fromUtc&&r.atUtc<fromUtc)||(toUtc&&r.atUtc>=toUtc))return;
    result.set(r.recordId,r);
  };
  if(!sourceKind||sourceKind==='dialogue_line'){
    const {clause,args}=sourceFilters(scope,{fromUtc,toUtc});
    let where=clause.replaceAll('TIME_COLUMN','committed_at_utc')+' AND protagonist=?';
    const values=[...args,scope.protagonistKey];
    if(speaker){where+=' AND speaker=?';values.push(speaker);}
    const cols='SELECT d.record_id AS recordId,d.committed_at_utc AS atUtc,d.protagonist AS protagonistKey,d.content AS text,d.content_sha256 AS textHash,d.envelope_json AS raw,d.envelope_sha256 AS rawHash';
    const rows=[];
    if(limitLex){
      const fts=' FROM dialogue_journal_fts JOIN dialogue_journal d ON d.rowid=dialogue_journal_fts.rowid WHERE '+where.replaceAll(/\b(world_profile_id|character_id|timeline_id|committed_at_utc|protagonist|speaker)\b/g,'d.$1')+' AND dialogue_journal_fts MATCH ? ORDER BY bm25(dialogue_journal_fts),d.committed_at_utc DESC';
      rows.push(...all(db,cols+fts,[...values,textMatch(tokens)],limitLex));
    }
    rows.push(...all(db,cols+' FROM dialogue_journal d WHERE '+where.replaceAll(/\b(world_profile_id|character_id|timeline_id|committed_at_utc|protagonist|speaker)\b/g,'d.$1')+' ORDER BY d.committed_at_utc DESC,d.rowid DESC',values,limit-limitLex));
    for(const r of rows){
      const e=verifyEnvelope(r.raw,r.rawHash);
      if(!uuid.test(e.recordId)||e.recordId!==r.recordId||sha(r.text)!==r.textHash||e.content!==r.text)
        throw new Error('m4_corrupt_dialogue');
      if(!((e.speaker==='player'&&['typed','stt'].includes(e.source)&&e.delivery==='accepted')||
        (e.speaker==='npc'&&e.source==='npc_generated'&&e.delivery==='completed'&&uuid.test(e.deliveryReceiptId))))continue;
      add({...scope,recordId:r.recordId,sourceKind:'dialogue_line',atUtc:r.atUtc,
        evidenceState:'verified',envelope:e});
    }
  }
  if((!sourceKind||sourceKind==='journal_event')&&scope.protagonistKey==='unknown'){
    const {clause,args}=sourceFilters(scope,{fromUtc,toUtc}),where=clause.replaceAll('TIME_COLUMN','received_at_utc');
    const cols='SELECT e.record_id AS recordId,e.received_at_utc AS atUtc,e.envelope_json AS raw,e.envelope_sha256 AS rawHash,s.source_evidence_json AS evidence,s.source_evidence_sha256 AS evidenceHash';
    const rows=all(db,cols+' FROM event_journal e JOIN event_source_evidence s ON s.record_id=e.record_id WHERE '+where.replaceAll(/\b(world_profile_id|character_id|timeline_id|received_at_utc)\b/g,'e.$1')+' ORDER BY e.received_at_utc DESC,e.rowid DESC',args,limit);
    for(const r of rows){
      const e=verifyEnvelope(r.raw,r.rawHash),proof=verifyEnvelope(r.evidence,r.evidenceHash);
      if(e.recordId!==r.recordId||proof.sourceHash!==e.sourceHash||
        proof.observation?.observationId!==e.observationId||
        proof.observation?.revision!==e.revision||proof.ownerProof?.hostRunId!==e.ownerProof?.hostRunId||
        proof.ownerProof?.worldEpoch!==e.ownerProof?.worldEpoch)throw new Error('m4_corrupt_event_proof');
      // Events remain under 'unknown': no observed player identity can be deduced.
      add({...scope,recordId:r.recordId,sourceKind:'journal_event',atUtc:r.atUtc,
        evidenceState:'verified',envelope:e});
    }
  }
  if(!sourceKind||sourceKind==='permanent_memory'){
    const {clause,args}=sourceFilters(scope,{fromUtc,toUtc});
    let where=clause.replaceAll('TIME_COLUMN','created_at_utc')+' AND protagonist_key=?';
    const values=[...args,scope.protagonistKey];
    const sql='SELECT memory_id AS recordId,content,content_sha256 AS digest,mode,created_at_utc AS atUtc,evidence_ids_json AS evidence FROM memory_records WHERE '+where;
    const rows=all(db,sql+' ORDER BY created_at_utc DESC, memory_id DESC',values,Math.min(limit,384));
    for(const r of rows){
      if(!uuid.test(r.recordId)||sha(r.content)!==r.digest)throw new Error('m4_corrupt_memory');
      const evidence=parse(r.evidence);
      if(!Array.isArray(evidence)||evidence.some(id=>!uuid.test(id)))throw new Error('m4_corrupt_memory_sources');
      if(evidence.some(id=>forgotten.has(id)||corrected.has(id)))continue;
      const e={version:1,kind:'permanent_memory',recordId:r.recordId,
        characterId:scope.characterId,worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
        content:r.content,mode:r.mode,sourceEvidenceIds:evidence};
      add({...scope,recordId:r.recordId,sourceKind:'permanent_memory',atUtc:r.atUtc,
        evidenceState:'verified',envelope:e});
    }
    for(const r of overlays)add(r);
  }
  // No legacy all-complete certificate exists in v4. Lack of a row is UNKNOWN.
  const rows=[...result.values()].sort((a,b)=>b.atUtc.localeCompare(a.atUtc)||a.recordId.localeCompare(b.recordId));
  return {rows:rows.slice(0,limit),coverageComplete:false};
}
