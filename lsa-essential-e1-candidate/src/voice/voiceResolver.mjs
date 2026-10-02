import { resolveVoiceProfile } from './voiceProfile.mjs';

export class VoiceResolver {
  #config;
  constructor(config) { this.#config = config; }
  resolve(identity, actor = {}) { return resolveVoiceProfile({ identity, actor, config: this.#config }); }
}
