// M1 opt-in SQLite-backed P2 ProfileStore parity layer.
// It is NOT automatically enabled in the Essential runtime or standalone host.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import { P2SqliteFoundation, inspectP2ReadOnlyRecovery } from './sqliteFoundation.mjs';
import { acquireWriterLock, releaseWriterLock, inspectWriterLock } from './sqliteDurability.mjs';
import { validateProfile, validateProfiles } from './profileSchema.mjs';
import { addProfile, editProfile, changeMemory, removeProfile } from './profileCommands.mjs';
import { TimelineGuard } from './timelineGuard.mjs';

const fail = code => { throw new Error(code); };

export class P2SqliteProfileStore {
  #db; #writer; #initializing; #queue = Promise.resolve();
  #durabilityWarning = null; #lockState = 'unlocked';
  #available = true; #closed = false; #timeline = new TimelineGuard();
  #sourceRequired; #sourceContext = null; #confirmedSource = null;
  // Monotone revocation epoch: an operation admitted before source loss or a
  // timeline selection cannot execute after later reauthorization (ABA).
  #authorityGeneration = 0;
  #optionalMemoryFence=new AsyncLocalStorage();
  constructor({ filePath, worldProfileId, legacyJsonPath = null, sourceRequired = false, journalLimits = {} }) {
    if (typeof sourceRequired !== 'boolean') throw new TypeError('invalid_timeline_source_config');
    this.#sourceRequired = sourceRequired;
    if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('invalid_sqlite_profile_config');
    this.filePath = path.resolve(filePath);
    this.lockPath = this.filePath + '.writer.lock';
    this.worldProfileId = worldProfileId;
    this.legacyJsonPath = legacyJsonPath;
    this.#db = new P2SqliteFoundation({ filePath:this.filePath, worldProfileId, legacyJsonPath, journalLimits });
  }
  get loaded() { return this.#db.initialized; }
  get available() { return this.#available && !this.#closed; }
  get memoryReadFence() {
    return this.available&&this.timelineWritable&&this.#db.initialized
      ? this.#authorityGeneration+':'+this.#db.readFence : null;
  }
  // Source/timeline authority only. An authorized privacy transaction changes
  // the data read fence itself and must not mistake its own commit for a revoke.
  get memoryAuthorityFence() {
    return this.available&&this.timelineWritable&&this.#db.initialized?this.#authorityGeneration:null;
  }
  get activeTimelineId() { return this.#timeline.activeTimelineId; }
  get timelineWritable() { return this.#timeline.writable && this.#sourceValid(); }
  // Read-only source used for journal attribution; only verified/current after
  // an explicit timeline confirmation. No unverified native input is exposed.
  get verifiedHostContext() {
    return this.timelineWritable && this.#sourceContext
      ? Object.freeze({...this.#sourceContext}) : null;
  }
  get timelineSourceStatus() { return !this.#sourceRequired ? 'not_required' : !this.#sourceContext ? 'unavailable' : this.#confirmedSource !== this.#sourceKey(this.#sourceContext) ? 'confirmation_required' : 'verified'; }
  #sourceKey(context) { return context?.hostRunId + ':' + context?.worldEpoch; }
  #sourceValid() { return !this.#sourceRequired || this.#sourceContext !== null && this.#confirmedSource === this.#sourceKey(this.#sourceContext); }
  get timelinePendingReason() {
    if (this.#timeline.pendingReason) return this.#timeline.pendingReason;
    if (this.#sourceRequired && !this.#sourceContext) return 'native_source_unavailable';
    if (this.#sourceRequired && !this.#sourceValid()) return 'native_source_confirmation_required';
    return null;
  }
  get snapshot() { return this.#db.snapshot; }
  get durabilityStatus() {
    return Object.freeze({writer:this.#lockState,warning:this.#durabilityWarning,
      mode:this.available&&this.loaded?'read_write':'unavailable'});
  }
  async inspectWriterStatus() {return inspectWriterLock(this.lockPath);}
  // Safe even after initialize() fails: reads verified snapshots, never the
  // damaged live SQLite database and never claims successful restoration.
  async inspectReadOnlyRecovery(scope=null) {
    return inspectP2ReadOnlyRecovery({filePath:this.filePath,worldProfileId:this.worldProfileId,scope});
  }
  // Runtime adapters may only call this from an authenticated, accepted native
  // C-13 hello/world epoch. Never accept direct model/ped/user text as proof.
  setVerifiedHostContext(context) {
    if (!this.#sourceRequired) return false;
    if (context === null) {
      ++this.#authorityGeneration;
      this.#sourceContext = null;
      this.#confirmedSource = null;
      return false;
    }
    if (!context || context.hostContextVersion !== 1 ||
        typeof context.hostRunId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(context.hostRunId) ||
        !Number.isSafeInteger(context.worldEpoch) || context.worldEpoch < 1 || context.worldEpoch > 0x7fffffff)
      throw new TypeError('invalid_timeline_source_context');
    // Any host incarnation/epoch change requires a fresh explicit user
    // confirmation even when the stored active timeline id remains unchanged.
    const sameSource = this.#sourceContext &&
      this.#sourceKey(context) === this.#sourceKey(this.#sourceContext);
    // A repeat sample from the SAME authenticated host does not retire queued
    // work. Rebinding a changed host/epoch does, even if the same save is chosen.
    if (!sameSource) {
      ++this.#authorityGeneration;
      this.#confirmedSource = null;
      this.#sourceContext = Object.freeze({hostRunId:context.hostRunId,worldEpoch:context.worldEpoch});
    }
    return true;
  }
  #serial(operation) {
    const fence=this.#optionalMemoryFence.getStore();
    const job = this.#queue.then(()=>{fence?.();return operation();});
    this.#queue = job.catch(() => {});
    return job;
  }
  // I2 narrow queue-admission fence. Optional runtime ports carry their
  // revocation check across awaits; privileged privacy/profile calls do not.
  // Storage ownership, source checks and transaction boundaries are unchanged.
  withOptionalMemoryFence(check,operation) {
    if(typeof check!=='function'||typeof operation!=='function')fail('invalid_memory_fence');
    const parent=this.#optionalMemoryFence.getStore();
    const current=()=>{parent?.();check();};
    current();return this.#optionalMemoryFence.run(current,operation);
  }
  async #releaseWriter() {
    const lease=this.#writer;this.#writer=null;
    await releaseWriterLock(this.lockPath,lease);
    this.#lockState='unlocked';
  }
  async initialize() {
    if (this.#closed || !this.#available) fail('profile_store_unavailable');
    return this.#initializing ||= (async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive:true });
        this.#writer=await acquireWriterLock(this.lockPath);
        this.#lockState=this.#writer.reclaimed?'stale_reclaimed':'live_owned';
        await this.#db.initialize();
        const selected = this.#db.activeTimelineId();
        // A trusted reset can arrive before async SQLite bootstrap finishes.
        // Never allow bootstrap to silently clear that pending write veto.
        const pending = this.#timeline.pendingReason;
        this.#timeline = new TimelineGuard({ timelineId:selected });
        if (pending === 'clock_regression' || pending === 'timeline_change')
          this.#timeline.onBoundary({ reason:pending });
        return this.#db.snapshot;
      } catch (error) {
        this.#available = false;
        this.#durabilityWarning=error.message;
        this.#db.close();
        try { await this.#releaseWriter(); } catch {}
        throw error;
      }
    })();
  }
  list() { return this.#db.initialized ? this.#db.list() : Object.freeze([]); }
  get(characterId) { return this.#db.initialized ? this.#db.get(characterId) : null; }
  async #mutate(change) {
    await this.initialize();
    return this.#serial(() => {
      if (!this.available || !this.#db.initialized) fail('profile_store_unavailable');
      const previous = this.#db.snapshot;
      const profiles = change(previous.profiles);
      const next = validateProfiles({
        ...previous, revision:previous.revision + 1, profiles
      }, this.worldProfileId);
      // This is a single SQLite transaction with an exact global CAS revision.
      // A stale second process cannot silently overwrite a newer snapshot.
      return this.#db.replaceSnapshot(next, previous.revision);
    });
  }
  async create(profile) {
    validateProfile(profile);
    const next = await this.#mutate(profiles => addProfile(profiles,profile));
    return next.profiles.find(item => item.characterId === profile.characterId);
  }
  async edit(characterId,patch,expectedRevision) {
    await this.#mutate(profiles => editProfile(profiles,characterId,patch,expectedRevision));
    return this.get(characterId);
  }
  async memory(characterId,operation,args = {}) {
    let memoryId = args.memoryId;
    await this.#mutate(profiles => {
      const result = changeMemory(profiles,characterId,operation,args);
      memoryId = result.memoryId;
      return result.profiles;
    });
    return { profile:this.get(characterId), memoryId };
  }
  async remove(characterId,confirmation,expectedRevision) {
    await this.#mutate(profiles => removeProfile(profiles,characterId,confirmation,expectedRevision));
    return true;
  }
  // Safely materialize a new v1 profile snapshot for an explicitly supervised
  // downgrade/rollback. Never overwrite either the old JSON or active SQLite.
  // Future M2+ journals/timeline records are NOT represented by v1 JSON.
  async exportRollbackSnapshot() {
    await this.initialize();
    return this.#serial(async () => {
      if (!this.available) fail('profile_store_unavailable');
      const output = this.filePath + '.rollback-' + randomUUID() + '.json';
      const raw = this.#db.exportSnapshot();
      const value = validateProfiles(JSON.parse(raw), this.worldProfileId);
      let handle=null, created=false;
      try {
        handle=await fs.open(output, 'wx', 0o600);
        created=true;
        await handle.writeFile(raw, 'utf8');
        await handle.sync();
        await handle.close();handle=null;
        return Object.freeze({
          path:output, revision:value.revision, profileCount:value.profiles.length,
          sha256:createHash('sha256').update(raw).digest('hex')
        });
      } catch (error) {
        if (handle) await handle.close().catch(()=>{});
        if (created) await fs.rm(output,{force:true}).catch(()=>{});
        throw error;
      }
    });
  }
  async createTimeline(options = {}) {
    await this.initialize();
    return this.#serial(() => this.#db.createTimeline(options));
  }
  async listTimelines() {
    await this.initialize();
    return this.#serial(() => this.#db.listTimelines());
  }
  onBoundary(boundary) {
    const reason=boundary?.reason;
    const sourceLoss=['native_disconnect','unknown_source','source_change'].includes(reason);
    const ambiguous=['clock_regression','timeline_change','save_fork','world_epoch'].includes(reason);
    if(sourceLoss||ambiguous){
      ++this.#authorityGeneration;
      if(this.#sourceRequired)this.#confirmedSource=null;
      if(sourceLoss)this.#sourceContext=null;
    }
    // Keep innocuous host_reload as a no-op (M1 contract). Unsupported or
    // ambiguous provenance boundaries cannot silently authorize new writes.
    return this.#timeline.onBoundary({reason:sourceLoss||['save_fork','world_epoch'].includes(reason)
      ? 'timeline_change' : reason});
  }
  async confirmTimeline(timelineId,{confirmation}={}) {
    // For callers that pass an explicit selection token, never accept a
    // mismatched token. Existing trusted editor/bootstrap callers use the
    // legacy one-argument form; their authority boundary remains unchanged.
    if(confirmation!==undefined&&confirmation!==timelineId)
      fail('explicit_confirmation_required');
    const expectedGeneration=this.#authorityGeneration;
    const expectedContext=this.#sourceContext;
    await this.initialize();
    return this.#serial(() => {
      if(this.#authorityGeneration!==expectedGeneration ||
         this.#sourceContext!==expectedContext)fail('timeline_write_suspended');
      // Native/UX layer must ask the user when clock/save-lineage is ambiguous.
      // A user can select a timeline offline, but cannot enable provenance-
      // scoped writes until current native source exists and is verified.
      this.#db.activateTimeline(timelineId);
      this.#timeline.selectTimeline(timelineId);
      this.#confirmedSource = this.#sourceContext ? this.#sourceKey(this.#sourceContext) : null;
      ++this.#authorityGeneration;
      return this.#timeline.activeTimelineId;
    });
  }
  assertTimelineWrite(timelineId) {
    this.#timeline.assertWrite(timelineId);
    if (!this.#sourceValid()) fail('timeline_write_suspended');
  }
  // M2+ may only write timeline-scoped evidence through an operation that
  // checks provenance INSIDE the serialized writer queue, immediately before
  // invoking the durable commit. Profile/editor metadata remains global.
  async withTimelineWrite(timelineId, commit) {
    if (typeof commit !== 'function') throw new TypeError('invalid_timeline_operation');
    // Capture at admission, BEFORE initialize/queue await. A revoked source
    // cannot resurrect an already queued write under the same host/save.
    const expectedGeneration=this.#authorityGeneration;
    const expectedContext=this.#sourceContext;
    await this.initialize();
    return this.#serial(() => {
      if (!this.available) fail('profile_store_unavailable');
      if(this.#authorityGeneration!==expectedGeneration ||
         this.#sourceContext!==expectedContext)fail('timeline_write_suspended');
      this.assertTimelineWrite(timelineId);
      let result;
      try { result=commit(this.#db, this.#db.snapshot); }
      catch(error) {
        if(/^sqlite_journal_.*_cap$/.test(error.message))
          this.#durabilityWarning=error.message;
        throw error;
      }
      if (result && typeof result.then === 'function') fail('timeline_write_async_not_supported');
      // Legacy P2 methods can internally commit before returning. Their
      // admission/execution generation checks occur above. Transactions through
      // withP2SqliteTransaction additionally recheck INSIDE SQLite before
      // the physical COMMIT, so those can still roll back source revocations.
      return result;
    });
  }
  // Synchronous callbacks only: never await or call another queued store
  // method from inside these callbacks. The original P2 writer is the ONLY
  // mutable SQLite connection; this preserves the editor/profile CAS queue.
  #assertMemoryScope(scope) {
    if(!scope||scope.worldProfileId!==this.worldProfileId||
       typeof scope.characterId!=='string'||!this.#db.get(scope.characterId))
      fail('p2_memory_owner_or_world_missing');
    this.assertTimelineWrite(scope.timelineId);
  }
  async withP2SqliteRead(scope,operation) {
    if(typeof operation!=='function')throw new TypeError('p2_sqlite_callback_required');
    const expectedGeneration=this.#authorityGeneration;
    const expectedContext=this.#sourceContext;
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      if(this.#authorityGeneration!==expectedGeneration ||
         this.#sourceContext!==expectedContext)fail('timeline_write_suspended');
      this.#assertMemoryScope(scope);
      const result=this.#db.withP2SqliteRead(operation);
      if(this.#authorityGeneration!==expectedGeneration ||
         this.#sourceContext!==expectedContext)fail('timeline_write_suspended');
      return result;
    });
  }
  async withP2SqliteTransaction(scope,operation) {
    if(typeof operation!=='function')throw new TypeError('p2_sqlite_callback_required');
    return this.withTimelineWrite(scope?.timelineId,foundation=>{
      this.#assertMemoryScope(scope);
      return foundation.withP2SqliteTransaction(db=>{
        const result=operation(db);
        // Recheck synchronously INSIDE P2's transaction immediately before
        // COMMIT; source invalidation in the callback rolls everything back.
        this.#assertMemoryScope(scope);
        return result;
      });
    });
  }
  // API consumed by M5; alias documents that ALL privacy commits are part of
  // P2's write queue and source/timeline gate at actual SQLite COMMIT.
  async withTimelineSqliteWrite(scope,operation) {
    return this.withP2SqliteTransaction(scope,operation);
  }
  // Append/update feed includes every committed M2 line and each M3 event
  // revision. Scanning is bounded; cursor ack is durable and independently
  // gated to prevent crash loss, rollback escapes, and cross-owner leakage.
  async readCommittedEvidencePage({scope,cursor=null,limit=256}) {
    return this.withP2SqliteRead(scope,()=>this.#db.readReplayPage({scope,cursor,limit}));
  }
  async readCommittedEvidenceCursor({scope,consumerId}) {
    return this.withP2SqliteRead(scope,()=>this.#db.readReplayCursor({scope,consumerId}));
  }
  async ackCommittedEvidenceCursor({scope,consumerId,cursor,expectedCursor=null}) {
    return this.withTimelineWrite(scope?.timelineId,foundation=>{
      this.#assertMemoryScope(scope);
      return foundation.withP2SqliteTransaction(()=>{
        const receipt=foundation.acknowledgeReplayCursor({scope,consumerId,cursor,expectedCursor});
        this.#assertMemoryScope(scope);
        return receipt;
      });
    });
  }
  // W06: source-qualified append-order M6 replay, separate from B's per-protagonist
  // consumer cursor. Every read and CAS runs through the original P2 queue.
  // M6 MUST have a current source-authenticated native host. A P2 store
  // configured for unauthenticated/test-only operation cannot authorize a
  // production replay cursor merely because its timeline is writable.
  #requireM6NativeSource(){
    if(this.timelineSourceStatus!=='verified'||!this.verifiedHostContext)
      fail('m6_native_authority_required');
  }
  async readM6Checkpoint({scope}){
    this.#requireM6NativeSource();
    return this.withP2SqliteRead(scope,()=>{
      this.#requireM6NativeSource();
      return this.#db.readM6Checkpoint({scope});
    });
  }
  async readM6JournalPage({scope,afterCursor=null,limit=250}){
    this.#requireM6NativeSource();
    return this.withP2SqliteRead(scope,()=>{
      this.#requireM6NativeSource();
      return this.#db.readM6JournalPage({scope,afterCursor,limit});
    });
  }
  async ackM6Checkpoint(request){
    this.#requireM6NativeSource();
    const scope=request?.scope;
    return this.withP2SqliteTransaction(scope,()=>{
      this.#requireM6NativeSource();
      return this.#db.ackM6Checkpoint(request);
    });
  }
  // Scoped journal writes are serialized WITH the M1 source/lineage check.
  // A player/NPC acknowledgment from a stale native host is never durable.
  async appendDialogueLine(line,attribution) {
    return this.withTimelineWrite(line?.timelineId,db=>{
      if(this.#sourceRequired &&
          (!this.#sourceContext || attribution?.hostRunId!==this.#sourceContext.hostRunId ||
           attribution?.worldEpoch!==this.#sourceContext.worldEpoch)) fail('journal_source_epoch_mismatch');
      return db.appendDialogueLine(line,attribution);
    });
  }
  async appendJournalEvent(event) {
    return this.withTimelineWrite(event?.timelineId,db=>
      db.appendJournalEvent(event,{hostContext:this.#sourceContext}));
  }
  // Reads never switch save lineage or restore revoked write authorization;
  // callers must supply their requested character AND explicit timeline.
  async readFreeRecallWindow(scope) {
    return this.#serial(()=>{if(!this.available)fail('profile_store_unavailable');return this.#db.readFreeRecallWindow(scope);});
  }
  async readDialogueLines(scope) {
    await this.initialize();
    return this.#serial(()=>{if(!this.available)fail('profile_store_unavailable');return this.#db.readDialogueLines(scope);});
  }
  async findExactQuote(scope) {
    await this.initialize();
    return this.#serial(()=>{if(!this.available)fail('profile_store_unavailable');return this.#db.findExactQuote(scope);});
  }
  async searchDialogue(scope) {
    await this.initialize();
    return this.#serial(()=>{if(!this.available)fail('profile_store_unavailable');return this.#db.searchDialogue(scope);});
  }
  async readJournalEvents(scope) {
    await this.initialize();
    return this.#serial(()=>{if(!this.available)fail('profile_store_unavailable');return this.#db.readJournalEvents(scope);});
  }
  async readVerifiedEventEvidence(scope) {
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.readVerifiedEventEvidence(scope);
    });
  }
  // M5 command adapter: all durable changes revalidate M1 lineage/source in
  // the same serialized writer queue, then commit and verify separately.
  async findCandidates({scope,...options}) {
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.listMemoryCandidates(scope,options);
    });
  }
  async commitCommand(operation){
    return this.withTimelineWrite(operation?.scope?.timelineId,foundation=>{
      if(this.#sourceRequired&&!this.verifiedHostContext)fail('memory_native_host_unconfirmed');
      return foundation.commitMemoryCommand(operation);
    });
  }
  async verifyCommand({scope,commandId}){
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.verifyMemoryCommand({scope,commandId});
    });
  }
  async listSuppressedMemoryIds(scope,options){
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.listSuppressedMemoryIds(scope,options);
    });
  }
  async readPermanentMemoryRows(scope,options){
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.readPermanentMemoryRows(scope,options);
    });
  }
  async readCorrectionOverlays(scope){
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.readCorrectionOverlays(scope);
    });
  }
  // M4 reads the actual committed v4 journal through the *same P2 database*
  // and serialized queue; no second SQLite connection or speculative FTS store.
  async readIntegratedRecall(query){
    // No recall from a revoked host, unconfirmed save or different NPC.
    // Reuse the same admission/serialized-execution fence as other P2 reads.
    return this.withP2SqliteRead(query?.scope,()=>this.#db.readIntegratedRecall(query));
  }
  // Read-only M3 coverage projection. Writes are deliberately available only
  // via the verified binder -> recorder -> M1 fenced foundation port.
  async readM3Coverage(scope){
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.readM3Coverage(scope);
    });
  }
  async readObserverCoverage(scope){
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.readObserverCoverage(scope);
    });
  }
  async saveDeterministicMemory(proposal){
    return this.withTimelineWrite(proposal?.timelineId,foundation=>{
      if(this.#sourceRequired&&!this.verifiedHostContext)fail('memory_native_host_unconfirmed');
      return foundation.persistDeterministicMemory(proposal);
    });
  }
  async enqueueCurationJob({job}){
    return this.withTimelineWrite(job?.timelineId,foundation=>
      foundation.enqueueCuration({job},job.timelineId));
  }
  async claimCurationDue(args){
    const timelineId=this.activeTimelineId;
    return this.withTimelineWrite(timelineId,foundation=>foundation.claimCuration(args,timelineId));
  }
  async verifyCurationLease(args){
    const timelineId=this.activeTimelineId;
    return this.withTimelineWrite(timelineId,foundation=>foundation.verifyCurationLease(args,timelineId));
  }
  async completeCurationLease(args){
    const timelineId=this.activeTimelineId;
    return this.withTimelineWrite(timelineId,foundation=>foundation.completeCuration(args,timelineId));
  }
  async retryCurationLease(args){
    const timelineId=this.activeTimelineId;
    return this.withTimelineWrite(timelineId,foundation=>foundation.retryCuration(args,timelineId));
  }
  async releaseCurationLease(args){
    const timelineId=this.activeTimelineId;
    return this.withTimelineWrite(timelineId,foundation=>foundation.releaseCuration(args,timelineId));
  }
  async reserveCurationBudget(args,budget){
    return this.withTimelineWrite(this.activeTimelineId,foundation=>foundation.reserveCurationBudget(args,budget));
  }
  async finishCurationBudget(args,state){
    return this.withTimelineWrite(this.activeTimelineId,foundation=>foundation.finishCurationBudget(args,state));
  }
  async inspect({scope}){
    return this.findCandidates({scope,limit:200});
  }
  async export({scope}){
    // Non-destructive content export. Caller is responsible for access-control
    // to the real promoted character and user-selected save lineage.
    const records=await this.inspect({scope});
    return Object.freeze({version:1,scope,records});
  }
  // Explicit lifecycle checkpoint; the regular close also creates one.
  async snapshotAtSessionEnd() {
    await this.initialize();
    return this.#serial(async()=>{
      if(!this.available)fail('profile_store_unavailable');
      try{return await this.#db.createDurabilitySnapshot('session_end');}
      catch(error){this.#durabilityWarning='sqlite_snapshot_failed: '+error.message;throw error;}
    });
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#initializing) await this.#initializing.catch(() => {});
    await this.#serial(async () => {
      try {
        if(this.#db.initialized)await this.#db.createDurabilitySnapshot('session_end');
      }catch(error){this.#durabilityWarning='sqlite_snapshot_failed: '+error.message;}
      finally{this.#db.close();await this.#releaseWriter();}
    });
  }
}

// Both thin host adapters use this function; neither gets its own database.
export function createP2MemoryStorage(options) {
  return new P2SqliteProfileStore(options);
}
