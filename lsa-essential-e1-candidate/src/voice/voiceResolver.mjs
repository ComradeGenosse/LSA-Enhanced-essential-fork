import { resolveVoiceProfile, createPersistentVoiceAssignment, resolvePersistentVoiceProfile } from './voiceProfile.mjs';

export class VoiceResolver {
  #config;
  constructor(config) { this.#config = config; }
  resolve(identity, actor = {}) { return resolveVoiceProfile({ identity, actor, config: this.#config }); }
  createPersistentAssignment(characterId, worldProfileId, actor = {}) {
    return createPersistentVoiceAssignment({ characterId, worldProfileId, actor, config: this.#config });
  }
  resolvePersistent(record, worldProfileId, actor = {}) {
    return resolvePersistentVoiceProfile({ assignment: record.voiceAssignment, actor, config: this.#config });
  }
}
