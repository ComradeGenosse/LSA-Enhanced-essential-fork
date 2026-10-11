import { createHash } from 'node:crypto';

export const PCM_FORMAT = 'pcm_s16le_mono_24000';
export const SPEECH_PROVIDERS = Object.freeze(['openai', 'faster-qwen3-tts']);
const VOICE = /^[a-z][a-z0-9_-]{0,31}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const control = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export function validateSpeechProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
      Object.keys(profile).some(k => !['provider','voice','instructions','profileRevision'].includes(k)) ||
      !SPEECH_PROVIDERS.includes(profile.provider) || !VOICE.test(profile.voice) ||
      (profile.instructions !== undefined &&
        (typeof profile.instructions !== 'string' || profile.instructions.length > 1024 ||
         control.test(profile.instructions))) ||
      (profile.profileRevision !== undefined &&
        (!Number.isSafeInteger(profile.profileRevision) || profile.profileRevision < 1)))
    throw new Error('invalid_speech_profile');
  return Object.freeze({ ...profile });
}

export function assertSpeechProvider(provider) {
  if (!provider || !SPEECH_PROVIDERS.includes(provider.id) ||
      provider.capabilities?.outputFormat !== PCM_FORMAT ||
      provider.capabilities?.cancellation !== true ||
      provider.capabilities?.streaming !== true ||
      typeof provider.streamPcm !== 'function')
    throw new Error('speech_provider_contract_mismatch');
  return provider;
}

// Stable character identity (world+character) is NOT the same as an RAGE Ped
// handle or actor incarnation. The ledger only stores immutable VOICE choices.
// It cannot authorize a game action or assert physical speaker ownership.
export function parseVoiceAssignments(input) {
  const bad = () => { throw new Error('invalid_voice_assignment_registry'); };
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !==
        ['assignments','schemaVersion','worldProfileId'].join(',') ||
      input.schemaVersion !== 1 || !UUID.test(input.worldProfileId) ||
      !Array.isArray(input.assignments) || input.assignments.length > 64) bad();
  const assignments = new Map();
  for (const entry of input.assignments) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !==
          ['assignmentVersion','characterId','profile','recordRevision'].join(',') ||
        !UUID.test(entry.characterId) || entry.assignmentVersion !== 1 ||
        !Number.isSafeInteger(entry.recordRevision) || entry.recordRevision < 1 ||
        assignments.has(entry.characterId)) bad();
    let profile;
    try { profile = validateSpeechProfile(entry.profile); }
    catch { bad(); }
    assignments.set(entry.characterId, profile);
  }
  return Object.freeze({
    worldProfileId: input.worldProfileId,
    find(characterId) { return assignments.get(characterId) ?? null; },
    count: assignments.size
  });
}

function sessionVoice(nativeIdentity, voices) {
  if (voices.length === 1) return voices[0];
  // Incarnation-specific fallback only: different spawned actors can get
  // different voices, but this is NEVER called persistent character identity.
  const key = nativeIdentity?.hostRunId + ':' + nativeIdentity?.actorIncarnationId;
  const hash = createHash('sha256').update('lsa-ephemeral-voice-v1\0' + key).digest();
  return voices[hash.readUInt32BE(0) % voices.length];
}

export function createSpeechRouter({
  providers, defaultProfile, sessionVoices = null, assignments = null,
  resolveVerifiedCharacter = null
} = {}) {
  if (!providers || typeof providers !== 'object')
    throw new Error('invalid_speech_router');
  const known = new Map();
  for (const [id, provider] of Object.entries(providers)) {
    if (!SPEECH_PROVIDERS.includes(id) || assertSpeechProvider(provider).id !== id)
      throw new Error('invalid_speech_router');
    known.set(id, provider);
  }
  const fallback = validateSpeechProfile(defaultProfile);
  if (!known.has(fallback.provider)) throw new Error('speech_default_unavailable');
  const voices = sessionVoices ?? [fallback.voice];
  if (!Array.isArray(voices) || !voices.length || voices.length > 32 ||
      voices.some(v => !VOICE.test(v)) || new Set(voices).size !== voices.length ||
      !voices.includes(fallback.voice))
    throw new Error('invalid_session_voice_pool');
  if (assignments && typeof assignments.find !== 'function')
    throw new Error('invalid_voice_assignment_registry');
  if (resolveVerifiedCharacter !== null && typeof resolveVerifiedCharacter !== 'function')
    throw new Error('untrusted_character_binding');

  return Object.freeze({
    id: 'speech.router',
    capabilities: Object.freeze({
      cancellation: true, streaming: true, outputFormat: PCM_FORMAT
    }),
    async *streamPcm({ text, identity, signal }) {
      if (!identity || !UUID.test(identity.hostRunId) ||
          !UUID.test(identity.actorIncarnationId) ||
          !UUID.test(identity.turnId) || typeof text !== 'string' ||
          !text.trim() || text.length > 2048 || control.test(text))
        throw new Error('invalid_speech_request');
      if (signal?.aborted) throw new Error('speech_cancelled');

      let profile = fallback;
      // A real native character binding is a future integration dependency.
      // Never infer persistent assignment from the Ped/actor handle or name.
      if (assignments && resolveVerifiedCharacter) {
        const ref = resolveVerifiedCharacter(identity);
        if (ref) {
          if (ref.worldProfileId !== assignments.worldProfileId ||
              !UUID.test(ref.characterId) ||
              ref.hostRunId !== identity.hostRunId ||
              ref.actorIncarnationId !== identity.actorIncarnationId ||
              ref.turnId !== identity.turnId)
            throw new Error('untrusted_character_binding');
          profile = assignments.find(ref.characterId) ?? fallback;
        }
      }
      if (profile === fallback)
        profile = { ...fallback, voice: sessionVoice(identity, voices) };
      const selected = known.get(profile.provider);
      if (!selected) throw new Error('assigned_speech_provider_unavailable');
      yield* selected.streamPcm({
        text, voice: profile.voice, instructions: profile.instructions,
        identity, signal
      });
    }
  });
}
