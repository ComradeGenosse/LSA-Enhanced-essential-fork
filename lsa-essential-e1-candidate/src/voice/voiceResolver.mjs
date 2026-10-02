import { resolveVoiceProfile, createPersistentVoiceAssignment, resolvePersistentVoiceProfile } from './voiceProfile.mjs';

export class VoiceResolver {
  #config;
  constructor(config) { this.#config = config; }
  resolve(identity, actor = {}) { return resolveVoiceProfile({ identity, actor, config: this.#config }); }
  createPersistentAssignment(characterId, worldProfileId, actor = {}) {
    return createPersistentVoiceAssignment({ characterId, worldProfileId, actor, config: this.#config });
  }
  assignmentFromSession(characterId,worldProfileId,profile,actor = {}) {
    const assignment = this.createPersistentAssignment(characterId,worldProfileId,actor);
    // Reuse the application's actual current voice, never a model-provided name.
    const preserved = Object.freeze({ ...assignment,voice:profile.voice });
    this.resolvePersistent({voiceAssignment:preserved},worldProfileId,actor);
    return preserved;
  }
  resolvePersistent(record, worldProfileId, actor = {}) {
    return resolvePersistentVoiceProfile({ assignment: record.voiceAssignment, actor, config: this.#config });
  }
}
