// Optional additive M3 SQL tables: Agent H must install in the P2-owned
// migration and expose a port on the SAME serialized timeline write fence.
// This module does not reach into SQLite Foundation or start nested transactions.
import {createHash} from 'node:crypto';
import {isUuid,immutableSnapshot} from '../util/identity.mjs';
import {validOwnerProof} from './journalEventNormalizer.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const statuses=new Set(['did_not_witness','unknown','unavailable']);
const fail=s=>{throw new Error(s);};
export const M3_COVERAGE_DDL=`
CREATE TABLE IF NOT EXISTS m3_coverage (
 world_profile_id TEXT NOT NULL, timeline_id TEXT NOT NULL,
 character_id TEXT NOT NULL, observation_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('did_not_witness','unknown','unavailable')),
 evidence_json TEXT NOT NULL, evidence_hash TEXT NOT NULL,
 PRIMARY KEY(world_profile_id,timeline_id,character_id,observation_id)
);
CREATE INDEX IF NOT EXISTS m3_coverage_scope
 ON m3_coverage(world_profile_id,character_id,timeline_id,status);
`;
export function ensureM3CoverageSchema(db){db.exec(M3_COVERAGE_DDL);}
export function validateM3Coverage(record){
  if(!record||!isUuid(record.characterId)||!isUuid(record.worldProfileId)||
     !isUuid(record.timelineId)||!isUuid(record.observationId)||
     !statuses.has(record.status)||typeof record.reason!=='string'||
     record.reason.length>80||!validOwnerProof(record.ownerProof))
    fail('m3_coverage_invalid');
  if(record.status==='did_not_witness'){
    // Only a separately authenticated native receipt can certify a negative.
    // This fact must be supplied by the binder's checked native authority, NOT
    // from a model, absence of a PS2 observation, or a generic listener.
    const c=record.nativeCoverage;
    if(!c||c.certified!==true||!isUuid(c.sourceReceiptId)||
       c.status!=='did_not_witness'||c.observerCaptureRef!==record.ownerProof.observerCaptureRef||
       c.hostRunId!==record.ownerProof.hostRunId||
       c.worldEpoch!==record.ownerProof.worldEpoch||
       !Number.isSafeInteger(c.sampledGameTick)||c.sampledGameTick<0||
       !['visual','auditory','self'].includes(c.channel)||
       !['native_awareness','sampled_state','native_callback','audibility_model'].includes(c.basis))
      fail('m3_negative_not_certified');
  }else if(record.nativeCoverage!==null&&record.nativeCoverage!==undefined)
    fail('m3_unknown_cannot_carry_negative_proof');
  return immutableSnapshot(record);
}
export function appendM3Coverage(db,input){
  const record=validateM3Coverage(input);
  const raw=JSON.stringify(record),digest=hash(record);
  const key=[record.worldProfileId,record.timelineId,record.characterId,record.observationId];
  const old=db.prepare('SELECT evidence_json,evidence_hash FROM m3_coverage WHERE world_profile_id=? AND timeline_id=? AND character_id=? AND observation_id=?').get(...key);
  if(old){
    if(old.evidence_hash!==hash(JSON.parse(old.evidence_json))||
       old.evidence_hash!==digest||old.evidence_json!==raw)fail('m3_coverage_conflicting_receipt');
    return Object.freeze({inserted:false,duplicate:true});
  }
  db.prepare('INSERT INTO m3_coverage (world_profile_id,timeline_id,character_id,observation_id,status,evidence_json,evidence_hash) VALUES (?,?,?,?,?,?,?)')
    .run(...key,record.status,raw,digest);
  return Object.freeze({inserted:true,duplicate:false});
}
export function readM3Coverage(db,{characterId,worldProfileId,timelineId,observationId}={}){
  if(![characterId,worldProfileId,timelineId,observationId].every(isUuid))fail('m3_coverage_invalid_scope');
  const row=db.prepare('SELECT evidence_json,evidence_hash FROM m3_coverage WHERE world_profile_id=? AND timeline_id=? AND character_id=? AND observation_id=?')
    .get(worldProfileId,timelineId,characterId,observationId);
  if(!row)return Object.freeze({status:'unavailable',certified:false});
  const record=JSON.parse(row.evidence_json);
  if(hash(record)!==row.evidence_hash)fail('m3_coverage_corrupt');
  validateM3Coverage(record);
  return Object.freeze({status:record.status,certified:record.status==='did_not_witness',record:immutableSnapshot(record)});
}
