// M1 opt-in SQLite-backed P2 ProfileStore parity layer.
// It is NOT automatically enabled in the Essential runtime or standalone host.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { P2SqliteFoundation } from './sqliteFoundation.mjs';
import { validateProfile, validateProfiles } from './profileSchema.mjs';
import { addProfile, editProfile, changeMemory, removeProfile } from './profileCommands.mjs';
import { TimelineGuard } from './timelineGuard.mjs';

const fail = code => { throw new Error(code); };

export class P2SqliteProfileStore {
  #db; #writer; #token; #initializing; #queue = Promise.resolve();
  #available = true; #closed = false; #timeline = new TimelineGuard();
  #sourceRequired; #sourceContext = null; #confirmedSource = null;
  constructor({ filePath, worldProfileId, legacyJsonPath = null, sourceRequired = false }) {
    if (typeof sourceRequired !== 'boolean') throw new TypeError('invalid_timeline_source_config');
    this.#sourceRequired = sourceRequired;
    if (typeof filePath !== 'string' || !filePath.trim()) throw new TypeError('invalid_sqlite_profile_config');
    this.filePath = path.resolve(filePath);
    this.lockPath = this.filePath + '.writer.lock';
    this.worldProfileId = worldProfileId;
    this.legacyJsonPath = legacyJsonPath;
    this.#db = new P2SqliteFoundation({ filePath:this.filePath, worldProfileId, legacyJsonPath });
  }
  get loaded() { return this.#db.initialized; }
  get available() { return this.#available && !this.#closed; }
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
  // Runtime adapters may only call this from an authenticated, accepted native
  // C-13 hello/world epoch. Never accept direct model/ped/user text as proof.
  setVerifiedHostContext(context) {
    if (!this.#sourceRequired) return false;
    if (context === null) {
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
    if (!this.#sourceContext || this.#sourceKey(context) !== this.#sourceKey(this.#sourceContext))
      this.#confirmedSource = null;
    this.#sourceContext = Object.freeze({hostRunId:context.hostRunId,worldEpoch:context.worldEpoch});
    return true;
  }
  #serial(operation) {
    const job = this.#queue.then(operation);
    this.#queue = job.catch(() => {});
    return job;
  }
  async #releaseWriter() {
    const writer = this.#writer;
    this.#writer = null;
    if (!writer) return;
    await writer.close();
    try {
      // A replaced lock is never removed by this instance.
      const contents = await fs.readFile(this.lockPath, 'utf8');
      if (contents === this.#token + '\n') await fs.rm(this.lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  async initialize() {
    if (this.#closed || !this.#available) fail('profile_store_unavailable');
    return this.#initializing ||= (async () => {
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive:true });
        this.#token = randomUUID();
        try { this.#writer = await fs.open(this.lockPath, 'wx', 0o600); }
        catch (error) {
          if (error.code === 'EEXIST') fail('sqlite_writer_busy');
          throw error;
        }
        await this.#writer.writeFile(this.#token + '\n');
        await this.#writer.sync();
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
    // Invalidate verified native source on any actual epoch transition; the
    // next trusted hello/epoch establishes new provenance but not permission.
    if (boundary?.reason === 'clock_regression' || boundary?.reason === 'timeline_change') {
      if (this.#sourceRequired) this.#confirmedSource = null;
    }
    return this.#timeline.onBoundary(boundary);
  }
  async confirmTimeline(timelineId) {
    await this.initialize();
    return this.#serial(() => {
      // Native/UX layer must ask the user when clock/save-lineage is ambiguous.
      // Never auto-create/select from an unverified host assertion.
      // A user can select a timeline offline, but cannot enable provenance-
      // scoped writes until current native source exists and is verified.
      this.#db.activateTimeline(timelineId);
      this.#timeline.selectTimeline(timelineId);
      this.#confirmedSource = this.#sourceContext ? this.#sourceKey(this.#sourceContext) : null;
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
    await this.initialize();
    return this.#serial(() => {
      if (!this.available) fail('profile_store_unavailable');
      this.assertTimelineWrite(timelineId);
      const result = commit(this.#db, this.#db.snapshot);
      if (result && typeof result.then === 'function') fail('timeline_write_async_not_supported');
      return result;
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
  async listSuppressedMemoryIds(scope){
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.listSuppressedMemoryIds(scope);
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
  // Read-only M3 coverage projection. Writes are deliberately available only
  // via the verified binder -> recorder -> M1 fenced foundation port.
  async readM3Coverage(scope){
    await this.initialize();
    return this.#serial(()=>{
      if(!this.available)fail('profile_store_unavailable');
      return this.#db.readM3Coverage(scope);
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
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#initializing) await this.#initializing.catch(() => {});
    await this.#serial(async () => {
      this.#db.close();
      await this.#releaseWriter();
    });
  }
}

// Both thin host adapters use this function; neither gets its own database.
export function createP2MemoryStorage(options) {
  return new P2SqliteProfileStore(options);
}
