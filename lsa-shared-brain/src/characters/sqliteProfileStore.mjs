// M1 opt-in SQLite-backed P2 ProfileStore parity layer.
// It is NOT automatically enabled in the Essential runtime or standalone host.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { P2SqliteFoundation } from './sqliteFoundation.mjs';
import { validateProfile, validateProfiles } from './profileSchema.mjs';
import { addProfile, editProfile, changeMemory, removeProfile } from './profileCommands.mjs';
import { TimelineGuard } from './timelineGuard.mjs';
import { isUuid } from '../util/identity.mjs';

const fail = code => { throw new Error(code); };

export class P2SqliteProfileStore {
  #db; #writer; #token; #initializing; #queue = Promise.resolve();
  #available = true; #closed = false; #timeline = new TimelineGuard();
  #sourceRequired; #sourceContext = null; #confirmedSource = null;
  // Increment on every trusted receipt, revocation and operator confirmation.
  // A stale queued operation must never borrow a later authorization (ABA).
  #authorityGeneration = 0;
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
  get timelineWritable() { return this.available && this.loaded && this.#sourceRequired &&
    this.#timeline.writable && this.#sourceValid(); }
  get timelineSourceStatus() {
    if (!this.#sourceRequired) return 'not_required';
    if (!this.available || !this.loaded || !this.#sourceContext) return 'unavailable';
    return this.timelineWritable ? 'verified' : 'confirmation_required';
  }
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
      this.#authorityGeneration++;
      this.#sourceContext = null;
      this.#confirmedSource = null;
      return false;
    }
    if (!context || context.hostContextVersion !== 1 ||
        typeof context.hostRunId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(context.hostRunId) ||
        !Number.isSafeInteger(context.worldEpoch) || context.worldEpoch < 1 || context.worldEpoch > 0x7fffffff)
      throw new TypeError('invalid_timeline_source_context');
    // C-13 emits accepted HELLO/boundary receipts, not periodic cached status.
    // Even an identical host/epoch following disconnect can be a recycled
    // channel. A new receipt always requires fresh operator confirmation.
    this.#authorityGeneration++;
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
    // Treat every uncertain GTA lineage/lifecycle transition as a revocation.
    // Preserve the selected timeline for human inspection, not write authority.
    const reason = boundary?.reason;
    if (!['clock_regression','timeline_change','host_reload','world_epoch',
           'save_fork','native_disconnect','unknown_source','source_change'].includes(reason))
      throw new TypeError('invalid_timeline_boundary');
    this.#authorityGeneration++;
    this.#confirmedSource = null;
    if (['native_disconnect','unknown_source','host_reload','source_change'].includes(reason))
      this.#sourceContext = null;
    return this.#timeline.onBoundary({reason:reason === 'clock_regression' ? reason : 'timeline_change'});
  }
  async confirmTimeline(timelineId,{confirmation}={}) {
    // A direct call without the player's exact selection is NOT a confirmation.
    // Native proof and selected persisted save must both still exist at commit.
    if (!isUuid(timelineId) || confirmation !== timelineId)
      fail('explicit_confirmation_required');
    // Capture the exact accepted source before any async lock/initialization.
    // Do not approve an unrelated host or a newer identical-looking receipt.
    const expectedContext = this.#sourceContext;
    const expectedGeneration = this.#authorityGeneration;
    if (!this.#sourceRequired || !expectedContext) fail('timeline_write_suspended');
    await this.initialize();
    return this.#serial(() => {
      if (!this.available || this.#sourceContext !== expectedContext ||
          this.#authorityGeneration !== expectedGeneration)
        fail('timeline_write_suspended');
      if (!this.#db.listTimelines().some(item => item.timelineId === timelineId))
        fail('timeline_unknown');
      this.#db.activateTimeline(timelineId);
      this.#timeline.selectTimeline(timelineId);
      this.#confirmedSource = this.#sourceKey(this.#sourceContext);
      this.#authorityGeneration++;
      return this.#timeline.activeTimelineId;
    });
  }
  assertTimelineWrite(timelineId) {
    this.#timeline.assertWrite(timelineId);
    if (!this.timelineWritable) fail('timeline_write_suspended');
  }
  // M2+ may only write timeline-scoped evidence through an operation that
  // checks provenance INSIDE the serialized writer queue, immediately before
  // invoking the durable commit. Profile/editor metadata remains global.
  async withTimelineWrite(timelineId, commit) {
    if (typeof commit !== 'function') throw new TypeError('invalid_timeline_operation');
    // A write queued under an old session can never execute under a later
    // native receipt or player re-confirmation of the same save UUID.
    const expectedContext = this.#sourceContext;
    const expectedGeneration = this.#authorityGeneration;
    if (!this.timelineWritable || timelineId !== this.activeTimelineId)
      fail('timeline_write_suspended');
    await this.initialize();
    return this.#serial(() => {
      if (!this.available) fail('profile_store_unavailable');
      if (this.#authorityGeneration !== expectedGeneration ||
          this.#sourceContext !== expectedContext) fail('timeline_write_suspended');
      this.assertTimelineWrite(timelineId);
      const result = commit(this.#db, this.#db.snapshot);
      if (result && typeof result.then === 'function') fail('timeline_write_async_not_supported');
      return result;
    });
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
