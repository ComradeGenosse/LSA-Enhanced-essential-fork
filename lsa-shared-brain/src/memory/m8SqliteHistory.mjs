// Source-qualified, restart-durable M8 relationship rollup over ALL P2 history.
// This is read-only and runs on the same P2 SQLite connection. No separate
// relationship copy or 128-source sliding-window reset can split the player.
import {createHash} from 'node:crypto';
import {isUuid,normalizedEvidence} from './evidence.mjs';
import {categoryOf} from './m8Interpretation.mjs';
import {readVerifiedEventEvidence} from './journalSqlite.mjs';
import {listSuppressedMemoryIds} from './integratedSqlite.mjs';
import {supersededTargetIds} from './correctionSemantics.mjs';

const fail=code=>{throw Error(code);};
const sha=s=>createHash('sha256').update(s).digest('hex');
const owner=s=>[s.worldProfileId,s.characterId,s.timelineId];
const where='world_profile_id=? AND character_id=? AND timeline_id=?';
const valid=s=>s&&[s.worldProfileId,s.characterId,s.timelineId].every(isUuid)&&
  ['franklin','michael','trevor','unknown'].includes(s.protagonistKey);
const at=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))?Date.parse(s):NaN;

// Summarize every verified contribution, but expose only a small, recent
// provenance sample in the bounded PS4 projection. Tombstones/corrections are
// reapplied on every read, including after restart and cross-avatar switches.
export function readP2M8HistoricalSignals(db,scope){
 if(!valid(scope))fail('m8_invalid_history_scope');
 const {worldProfileId:world}=scope,keys=owner(scope);
 if(!db.prepare('SELECT 1 FROM promoted_profiles WHERE character_id=?').get(scope.characterId)||
    !db.prepare('SELECT 1 FROM timelines WHERE timeline_id=? AND world_profile_id=?').get(scope.timelineId,world))
   fail('m8_history_owner_missing');
 const revoked=new Set(listSuppressedMemoryIds(db,scope,world));
 for(const id of supersededTargetIds(db,keys))revoked.add(id);
 const counts=new Map(),seen=new Set();
 function contribute(record){
   if(!record||revoked.has(record.recordId)||seen.has(record.recordId))return;
   const category=categoryOf(record);
   if(category===null)return;
   seen.add(record.recordId);
   const timestamp=record.when;
   if(!Number.isFinite(at(timestamp)))fail('m8_history_invalid_time');
   let entry=counts.get(category);
   if(!entry){entry={category,count:0,lastAtUtc:null,refs:[]};counts.set(category,entry);}
   entry.count++;
   if(!entry.lastAtUtc||timestamp>entry.lastAtUtc)entry.lastAtUtc=timestamp;
   entry.refs.push({id:record.recordId,atUtc:timestamp});
   // Keep a constant-size provenance excerpt. Scores/counts include EVERY
   // verified source; the excerpt is not an authorization or recall shortcut.
   entry.refs.sort((a,b)=>b.atUtc.localeCompare(a.atUtc)||b.id.localeCompare(a.id));
   entry.refs.length=Math.min(16,entry.refs.length);
 }
 const lines=db.prepare('SELECT record_id,content,content_sha256,envelope_json,envelope_sha256,'+
   ' protagonist,speaker,source,delivery,committed_at_utc,host_run_id,world_epoch,session_id,receipt_id,turn_identity_hash FROM dialogue_journal WHERE '+where+
   ' ORDER BY committed_at_utc,record_id');
 for(const d of lines.iterate(...keys)){
   if(revoked.has(d.record_id))continue;
   if(sha(d.content)!==d.content_sha256||sha(d.envelope_json)!==d.envelope_sha256)
     fail('m8_history_corrupt_dialogue');
   let envelope;try{envelope=JSON.parse(d.envelope_json);}catch{fail('m8_history_corrupt_dialogue');}
   if(envelope.recordId!==d.record_id||envelope.content!==d.content||
      envelope.speaker!==d.speaker||envelope.source!==d.source||
      envelope.delivery!==d.delivery||envelope.turnIdentityHash!==d.turn_identity_hash||
      envelope.committedAtUtc!==d.committed_at_utc||
      envelope.deliveryReceiptId!==d.receipt_id||
      envelope.attribution?.protagonist&&envelope.attribution.protagonist!==d.protagonist)
     fail('m8_history_corrupt_dialogue');
   // A legacy/local journal without an authenticated host/session proves only
   // that bytes were stored, not that a player or NPC said them in GTA.
   // Historical relationship totals must not turn such rows into opinions.
   if(!isUuid(d.session_id)||!isUuid(d.host_run_id)||
      !Number.isSafeInteger(d.world_epoch)||d.world_epoch<0)continue;
   const accepted=d.speaker==='player'&&['typed','stt'].includes(d.source)&&d.delivery==='accepted';
   const played=d.speaker==='npc'&&d.source==='npc_generated'&&d.delivery==='completed'&&
     isUuid(d.receipt_id)&&isUuid(envelope.deliveryReceiptId);
   if(!accepted&&!played)continue;
   const evidence={...envelope,kind:'dialogue_line',recordId:d.record_id,
     characterId:scope.characterId,worldProfileId:world,timelineId:scope.timelineId,
     committedAtUtc:d.committed_at_utc,
     attribution:{...envelope.attribution,protagonist:d.protagonist}};
   let normalized;try{normalized=normalizedEvidence(evidence);}catch{fail('m8_history_invalid_dialogue');}
   contribute(normalized);
 }
 const events=db.prepare('SELECT record_id FROM event_journal WHERE '+where+
   " AND receipt_status='witnessed' ORDER BY received_at_utc,record_id");
 for(const row of events.iterate(...keys)){
   if(revoked.has(row.record_id))continue;
   const proof=readVerifiedEventEvidence(db,{
     characterId:scope.characterId,timelineId:scope.timelineId,recordId:row.record_id},world);
   if(!proof)fail('m8_history_event_evidence_missing');
   let normalized;try{normalized=normalizedEvidence(proof.event);}catch{fail('m8_history_invalid_event');}
   if(normalized.recordId!==row.record_id)fail('m8_history_corrupt_event');
   contribute(normalized);
 }
 return Object.freeze({version:1,sourceVerified:true,...Object.fromEntries(
   ['worldProfileId','characterId','timelineId'].map(k=>[k,scope[k]])),
   categories:Object.freeze([...counts.values()].sort((a,b)=>a.category.localeCompare(b.category))
     .map(e=>Object.freeze({category:e.category,count:e.count,lastAtUtc:e.lastAtUtc,
       sourceEvidenceIds:Object.freeze(e.refs.map(r=>r.id))})))});
}

// Integration convenience: serialized P2-owned read, not an independent DB.
export function createP2M8HistoryReader({store}={}){
 if(typeof store?.withP2SqliteRead!=='function')fail('m8_history_p2_port_required');
 return async scope=>store.withP2SqliteRead(scope,db=>readP2M8HistoricalSignals(db,scope));
}
