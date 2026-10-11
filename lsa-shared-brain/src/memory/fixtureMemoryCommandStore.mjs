// M5 file-backed OFFLINE FIXTURE adapter. This is not a GTA/SQLite adapter.
// Writes use exclusive temp files, file fsync and atomic rename; read-back
// verification is required. No in-memory fake can claim committed durability.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { isUuid } from '../util/identity.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
const fail = code => { throw new Error(code); };
const same = (a,b) => a.characterId===b.characterId &&
  a.worldProfileId===b.worldProfileId && a.timelineId===b.timelineId &&
  (a.protagonistKey ?? 'unknown') === (b.protagonistKey ?? 'unknown');
const snapshot = value => JSON.parse(JSON.stringify(value));
const validScope = s => s && [s.characterId,s.worldProfileId,s.timelineId].every(isUuid) &&
  ['franklin','michael','trevor','unknown'].includes(s.protagonistKey??'unknown');

export class FixtureMemoryCommandStore {
  #queue=Promise.resolve();
  #assertWrite;
  #failAt=null;
  constructor({filePath,scope,assertTimelineWrite}) {
    if (!filePath || !validScope(scope) || typeof assertTimelineWrite!=='function')
      fail('invalid_fixture_store');
    this.filePath=path.resolve(filePath);
    this.scope=snapshot(scope);
    this.#assertWrite=assertTimelineWrite;
  }
  // Test-only fault injection to exercise failures, lost acknowledgements,
  // and idempotent retries. Never install this class into a live companion.
  injectFailure(phase) {this.#failAt=phase;}
  #serial(work) {
    const job=this.#queue.then(work);
    this.#queue=job.catch(()=>{});
    return job;
  }
  #assertScope(scope) {
    if (!validScope(scope) || !same(scope,this.scope)) fail('memory_scope_conflict');
  }
  async #load() {
    let raw;
    try {raw=await fs.readFile(this.filePath,'utf8');}
    catch(error){if(error.code==='ENOENT') return {
      version:1,scope:this.scope,candidates:[],memories:[],commands:[],
      tombstones:[],corrections:[]
    }; throw error;}
    const data=JSON.parse(raw);
    if (data.version!==1 || !same(data.scope,this.scope) ||
      !['candidates','memories','commands','tombstones','corrections'].every(k=>Array.isArray(data[k])))
      fail('fixture_corrupt');
    return data;
  }
  async #write(data) {
    const raw=JSON.stringify(data)+'\n';
    const temporary=this.filePath+'.'+randomUUID()+'.tmp';
    await fs.mkdir(path.dirname(this.filePath),{recursive:true});
    let handle;
    try {
      handle=await fs.open(temporary,'wx',0o600);
      await handle.writeFile(raw,'utf8');
      await handle.sync();
      await handle.close();handle=null;
      if (this.#failAt==='before_rename') {this.#failAt=null;fail('injected_before_rename');}
      await fs.rename(temporary,this.filePath);
      if (this.#failAt==='after_rename') {this.#failAt=null;fail('injected_after_rename');}
      // Windows may not permit directory handles; file flush + rename +
      // on-disk read-back still provide observable test persistence.
      try {
        const directory=await fs.open(path.dirname(this.filePath),'r');
        try {await directory.sync();} finally {await directory.close();}
      } catch(error){if(process.platform!=='win32')throw error;}
      const persisted=await fs.readFile(this.filePath,'utf8');
      if (digest(persisted)!==digest(raw)) fail('fixture_verify_failed');
    } finally {
      if (handle) await handle.close().catch(()=>{});
      await fs.rm(temporary,{force:true}).catch(()=>{});
    }
  }
  async seedCandidate(record) {
    // Source records are fixtures, never manufactured as verified GTA facts.
    const candidate=snapshot(record);
    this.#assertScope(candidate);
    if (!isUuid(candidate.recordId) || !['dialogue_line','journal_event','permanent_memory','manual_memory'].includes(candidate.kind) ||
        typeof candidate.content!=='string' || !candidate.content.trim() ||
        !Number.isFinite(Date.parse(candidate.occurredAtUtc))) fail('invalid_fixture_candidate');
    return this.#serial(async()=>{
      this.#assertWrite(this.scope);
      const data=await this.#load();
      if (data.candidates.some(c=>c.recordId===candidate.recordId))fail('duplicate_fixture_candidate');
      data.candidates.push(candidate);
      await this.#write(data);
      return candidate.recordId;
    });
  }
  async findCandidates({scope}) {
    this.#assertScope(scope);
    const data=await this.#load();
    const suppressed=new Set(data.tombstones.map(t=>t.targetRecordId));
    const stored=data.memories.filter(m=>!suppressed.has(m.memoryId)).map(m=>({
      recordId:m.memoryId,kind:'permanent_memory',
      characterId:scope.characterId,worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
      protagonistKey:scope.protagonistKey,occurredAtUtc:m.requestedAtUtc,
      content:m.content,label:m.content.slice(0,80)
    }));
    return snapshot([...data.candidates.filter(c=>!suppressed.has(c.recordId)),...stored]);
  }
  async verifyCommand({scope,commandId}) {
    this.#assertScope(scope);
    if (!isUuid(commandId)) fail('invalid_command_id');
    const data=await this.#load();
    const receipt=data.commands.find(c=>c.commandId===commandId);
    return receipt?snapshot(receipt):null;
  }
  async commitCommand(op) {
    this.#assertScope(op.scope);
    if (!isUuid(op.commandId) || !isUuid(op.requestedByLineId) ||
      !['remember','forget','correct'].includes(op.operation) ||
      !Array.isArray(op.evidenceRecordIds) || !op.evidenceRecordIds.every(isUuid) ||
      !op.evidenceRecordIds.includes(op.requestedByLineId) ||
      typeof op.content!=='string' || !op.content.trim() ||
      digest(op.content)!==op.contentHash ||
      (op.operation!=='remember' && !isUuid(op.targetRecordId)))
      fail('invalid_fixture_command');
    return this.#serial(async()=>{
      // Must be tested *inside* writer serialization, not only at selection.
      if (this.#assertWrite(op.scope)!==true) fail('timeline_write_suspended');
      const data=await this.#load();
      const existing=data.commands.find(c=>c.commandId===op.commandId);
      if (existing) {
        if (existing.requestHash!==digest(JSON.stringify(op)))fail('command_replay_conflict');
        return snapshot(existing);
      }
      const candidates=[...data.candidates,...data.memories.map(m=>({
        recordId:m.memoryId,characterId:this.scope.characterId,worldProfileId:this.scope.worldProfileId,
        timelineId:this.scope.timelineId,protagonistKey:this.scope.protagonistKey
      }))];
      if (op.targetRecordId && (!candidates.some(c=>c.recordId===op.targetRecordId && same(c,op.scope)) ||
          data.tombstones.some(t=>t.targetRecordId===op.targetRecordId)))
        fail('memory_referent_missing');
      let memoryId=randomUUID();
      if (op.operation==='remember') {
        const recent=data.memories.find(m=>m.targetRecordId===op.targetRecordId &&
          m.contentHash===op.contentHash && !data.tombstones.some(t=>t.targetRecordId===m.memoryId) &&
          Math.abs(Date.parse(op.requestedAtUtc)-Date.parse(m.requestedAtUtc)) <= 60000);
        if(recent)memoryId=recent.memoryId;
        else data.memories.push({
          memoryId,origin:'explicit_player',content:op.content,contentHash:op.contentHash,
          targetRecordId:op.targetRecordId,requestedAtUtc:op.requestedAtUtc,
          evidenceRecordIds:op.evidenceRecordIds,importance:op.pin?95:85,pinned:!!op.pin,
          subjectCertainty:op.subjectCertainty||'evidence_linked',recordType:op.recordType
        });
      } else if (op.operation==='forget') {
        // Suppress in retrieval; never mutate immutable journal evidence.
        const target=candidates.find(c=>c.recordId===op.targetRecordId);
        data.tombstones.push({
          tombstoneId:memoryId,targetRecordId:op.targetRecordId,
          evidenceRecordIds:op.evidenceRecordIds,contentHash:digest(target.content??''),
          createdAtUtc:op.requestedAtUtc,origin:'explicit_player'
        });
      } else {
        data.corrections.push({
          correctionId:memoryId,targetRecordId:op.targetRecordId,
          content:op.content,contentHash:op.contentHash,mode:op.correctionMode,
          evidenceRecordIds:op.evidenceRecordIds,createdAtUtc:op.requestedAtUtc,
          originalUnchanged:true
        });
      }
      const receipt={
        commandId:op.commandId,requestedByLineId:op.requestedByLineId,
        requestHash:digest(JSON.stringify(op)),operation:op.operation,
        status:'committed',durableCommit:true,memoryId,evidenceRecordIds:op.evidenceRecordIds
      };
      data.commands.push(receipt);
      await this.#write(data);
      return snapshot(receipt);
    });
  }
  async inspect({scope}) {
    this.#assertScope(scope);
    const data=await this.#load();
    return snapshot({
      memoryCount:data.memories.length,
      memories:data.memories,tombstones:data.tombstones,
      corrections:data.corrections,commandCount:data.commands.length
    });
  }
  async export({scope}) {
    this.#assertScope(scope);
    const data=await this.#load();
    const exportPath=this.filePath+'.export-'+randomUUID()+'.json';
    const raw=JSON.stringify(data)+'\n';
    const handle=await fs.open(exportPath,'wx',0o600);
    try {await handle.writeFile(raw,'utf8');await handle.sync();}
    finally {await handle.close();}
    return {path:exportPath,sha256:digest(raw),records:data.memories.length,
      readOnlySnapshot:true};
  }
}
