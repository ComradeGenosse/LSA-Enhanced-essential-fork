// Permanent, content-free forgetting receipts in the original P2 database.
// Reads never repair state. Mutations run inside the caller's P2 transaction.
import {createHash} from 'node:crypto';
import {isUuid} from '../util/identity.mjs';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const hex=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const args=s=>[s.worldProfileId,s.characterId,s.timelineId];
const where='world_profile_id=? AND character_id=? AND timeline_id=?';
const fail=()=>{throw new Error('memory_suppression_integrity_unavailable');};
const receiptHash=r=>sha(JSON.stringify([r.world_profile_id,r.character_id,r.timeline_id,
 r.command_id,r.target_id,r.source_kind,r.content_sha256,r.evidence_key]));
export function ensureSuppressionSchema(db){
 db.exec(`CREATE TABLE IF NOT EXISTS memory_suppressions (
 world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,timeline_id TEXT NOT NULL,
 command_id TEXT NOT NULL,target_id TEXT NOT NULL,source_kind TEXT NOT NULL,
 content_sha256 TEXT,evidence_key TEXT,receipt_sha256 TEXT NOT NULL,
 PRIMARY KEY(world_profile_id,character_id,timeline_id,command_id,target_id));`);
}
function links(db,s){
 return db.prepare('SELECT memory_id AS id,evidence_ids_json AS sources FROM memory_records WHERE '+where).all(...args(s)).map(r=>{
  const sources=JSON.parse(r.sources);
  if(!isUuid(r.id)||!Array.isArray(sources)||sources.length>64||!sources.every(isUuid))fail();
  return {id:r.id,sources};
 });
}
// Same upwards/downwards closure for forgetting, read visibility and writes.
export function suppressionClosure(db,s,seeds){
 const ids=new Set(seeds),edges=links(db,s);
 let changed=true;
 while(changed){changed=false;for(const edge of edges){
  if(ids.has(edge.id)){
   for(const id of edge.sources)if(!ids.has(id)){ids.add(id);changed=true;}
  }else if(edge.sources.some(id=>ids.has(id))){ids.add(edge.id);changed=true;}
 }}
 return ids;
}
function receipts(db,s){
 const rows=db.prepare('SELECT * FROM memory_suppressions WHERE '+where).all(...args(s));
 for(const r of rows){
  if(r.receipt_sha256!==receiptHash(r)||!isUuid(r.target_id)||!isUuid(r.command_id)||
     !['dialogue_line','journal_event','permanent_memory'].includes(r.source_kind)||
     !hex(r.content_sha256)||r.source_kind==='dialogue_line'&&!hex(r.evidence_key)||
     r.source_kind==='journal_event'&&!isUuid(r.evidence_key))fail();
 }
 // v4 upgrades reconcile all legacy tombstones before opening P2. A missing
 // permanent receipt later must not silently downgrade to ID-only suppression.
 if(db.prepare('PRAGMA user_version').get().user_version===4){
  for(const t of db.prepare('SELECT target_id,command_id FROM memory_tombstones WHERE '+where).all(...args(s)))
   if(!rows.some(r=>r.target_id===t.target_id&&r.command_id===t.command_id))fail();
 }
 return rows;
}
export function isSuppressedSource(db,s,{recordId,kind,contentHash,evidenceKey=null}){
 return receipts(db,s).some(r=>r.target_id===recordId||
  r.source_kind===kind&&(r.content_sha256===contentHash||evidenceKey!==null&&r.evidence_key===evidenceKey));
}
export function suppressedMemoryIds(db,s,{includeCorrections=false}={}){
 const rows=receipts(db,s),ids=new Set(rows.map(r=>r.target_id));
 for(const r of db.prepare('SELECT target_id FROM memory_tombstones WHERE '+where).all(...args(s)))ids.add(r.target_id);
 if(includeCorrections)for(const r of db.prepare('SELECT target_id FROM memory_corrections WHERE '+where).all(...args(s)))ids.add(r.target_id);
 // A source already stored under a fresh ID is still suppressed by its bytes
 // or evidence key; avatar is provenance, never a privacy partition.
 const scan=(table,id,kind,hash,key=null)=>{
  const cols=new Set(db.prepare('PRAGMA table_info('+table+')').all().map(r=>r.name));
  if(!cols.has(hash)){
   if(db.prepare('PRAGMA user_version').get().user_version===4)fail();
   return; // Minimal offline source fixtures have no bytes.
  }
  const fingerprints=rows.filter(r=>r.source_kind===kind);
  if(!fingerprints.length)return;
  for(const r of db.prepare('SELECT '+id+' AS id,'+hash+' AS hash,'+(key??'NULL')+' AS key FROM '+table+' WHERE '+where).all(...args(s)))
   if(fingerprints.some(f=>f.content_sha256===r.hash||r.key!==null&&f.evidence_key===r.key))ids.add(r.id);
 };
 scan('dialogue_journal','record_id','dialogue_line','content_sha256','turn_identity_hash');
 scan('event_journal','record_id','journal_event','source_hash','observation_id');
 scan('memory_records','memory_id','permanent_memory','content_sha256');
 return suppressionClosure(db,s,ids);
}
export function retainSuppression(db,s,ids,commandId){
 const insert=db.prepare('INSERT OR IGNORE INTO memory_suppressions VALUES(?,?,?,?,?,?,?,?,?)');
 for(const id of ids){
  // Verify bytes before turning them into a permanent privacy fingerprint.
  let r=db.prepare('SELECT content,content_sha256 AS hash,turn_identity_hash AS key,envelope_json AS raw,envelope_sha256 AS rawHash FROM dialogue_journal WHERE '+where+' AND record_id=?').get(...args(s),id);
  let kind='dialogue_line';
  if(r){
   if(sha(r.content)!==r.hash||sha(r.raw)!==r.rawHash)fail();
   const e=JSON.parse(r.raw);
   if(e.recordId!==id||e.content!==r.content||e.turnIdentityHash!==r.key||
      e.worldProfileId!==s.worldProfileId||e.characterId!==s.characterId||e.timelineId!==s.timelineId)fail();
  }
  else{
   kind='permanent_memory';
   r=db.prepare('SELECT content,content_sha256 AS hash,NULL AS key FROM memory_records WHERE '+where+' AND memory_id=?').get(...args(s),id);
   if(r){if(sha(r.content)!==r.hash)fail();}
   else{
    kind='journal_event';
    r=db.prepare('SELECT source_hash AS hash,observation_id AS key,envelope_json AS raw,envelope_sha256 AS rawHash FROM event_journal WHERE '+where+' AND record_id=?').get(...args(s),id);
    if(r){
     if(sha(r.raw)!==r.rawHash)fail();
     const e=JSON.parse(r.raw);
     if(e.recordId!==id||e.sourceHash!==r.hash||e.observationId!==r.key||
        e.worldProfileId!==s.worldProfileId||e.characterId!==s.characterId||e.timelineId!==s.timelineId)fail();
    }
   }
  }
  // Lost legacy provenance cannot be guessed. Keep an unresolved receipt so
  // this scope fails closed, even if an old purge already removed its bytes.
  const values=[...args(s),commandId,id,r?kind:'unverified',r?.hash??null,r?.key??null];
  insert.run(...values,sha(JSON.stringify(values)));
 }
}
export function releaseSuppression(db,s,commandId){
 db.prepare('DELETE FROM memory_suppressions WHERE '+where+' AND command_id=?').run(...args(s),commandId);
}
