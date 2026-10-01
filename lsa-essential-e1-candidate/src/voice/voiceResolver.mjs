import { resolveVoiceProfile } from './voiceProfile.mjs';

export class VoiceResolver {
  #config;
  constructor(config) { this.#config = config; }
  resolve(identity) { return resolveVoiceProfile({ identity, config: this.#config }); }
}
