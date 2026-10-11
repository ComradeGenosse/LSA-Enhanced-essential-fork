// M1 opt-in SQLite-backed P2 ProfileStore parity layer.
// It is NOT automatically enabled in the Essential runtime or standalone host.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { P2SqliteFoundation } from './sqliteFoundation.mjs';
import { validateProfile, validateProfiles } from './profileSchema.mjs';
import { addProfile, editProfile, changeMemory, removeProfile } from './profileCommands.mjs';
import { TimelineGuard } from './timelineGuard.mjs';

const fail = code => { throw new Error(code); };

export class P2SqliteProfileStore {
  #db; #writer; #token; #initializing; #queue = Promise.resolve();
  #available = true; #closed = false; #timeline = new TimelineGuard();
  constructor({ filePath, worldProfileId, legacyJsonPath = null }) {
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
  get timelineWritable() { return this.#timeline.writable; }
  get timelinePendingReason() { return this.#timeline.pendingReason; }
  get snapshot() { return this.#db.snapshot; }
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
        this.#timeline = new TimelineGuard({ timelineId:selected });
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
  async createTimeline(options = {}) {
    await this.initialize();
    return this.#serial(() => this.#db.createTimeline(options));
  }
  async listTimelines() {
    await this.initialize();
    return this.#serial(() => this.#db.listTimelines());
  }
  onBoundary(boundary) { return this.#timeline.onBoundary(boundary); }
  async confirmTimeline(timelineId) {
    await this.initialize();
    return this.#serial(() => {
      // Native/UX layer must ask the user when clock/save-lineage is ambiguous.
      // Never auto-create/select from an unverified host assertion.
      this.#db.activateTimeline(timelineId);
      this.#timeline.selectTimeline(timelineId);
      return this.#timeline.activeTimelineId;
    });
  }
  assertTimelineWrite(timelineId) { this.#timeline.assertWrite(timelineId); }
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
