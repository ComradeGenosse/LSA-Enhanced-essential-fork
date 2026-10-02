# Character-aware NPC voices

The OpenAI speech path can assign one stable voice profile per native NPC session using the demographic fields already supplied by Los Santos Alive Essential.

## Runtime contract

When `voiceAssignment` is `character-aware-session`, the first bound turn passes the hydrated actor context to the voice resolver. The resolver reads only:

- `gender`
- `ageRange`

It does not consume persona text, player dialogue, integration JSON, role context, or other free-form actor data when building TTS instructions.

The normalized age bands are:

- `young`: under 30
- `adult`: 30–44
- `mature`: 45–59
- `older`: 60–74
- `senior`: 75+

Common textual values such as `Young Adult`, `Middle-Aged`, `Older Adult`, and `Elderly` are also accepted. Unknown or malformed demographic values remain `unknown`; the resolver does not invent them.

## Selection behavior

Character-aware assignment is deterministic.

1. Known actor gender is treated as the strongest compatibility constraint.
2. Exact age-band matches are preferred.
3. Adjacent age bands can be used when the configured pool does not contain an exact age match.
4. Ties are resolved with the native `pedId + sessionNonce` identity hash.
5. The resulting profile is frozen for the native session, including all E6 speech segments and provider retries.

A later turn changing the hydrated demographic fields does not change an already assigned session voice.

This is still session identity, not durable character identity. The future `SESSION_IDENTITY` phase can reuse the same matcher with a persistent character key.

## Configuration

Example:

~~~json
{
  "ttsModel": "gpt-4o-mini-tts",
  "speechVoices": ["nova", "shimmer", "ash", "onyx"],
  "voiceAssignment": "character-aware-session",
  "speechVoiceProfiles": {
    "nova": {
      "genders": ["female"],
      "ageBands": ["young", "adult"]
    },
    "shimmer": {
      "genders": ["female"],
      "ageBands": ["mature", "older", "senior"]
    },
    "ash": {
      "genders": ["male"],
      "ageBands": ["young", "adult"]
    },
    "onyx": {
      "genders": ["male"],
      "ageBands": ["mature", "older", "senior"]
    }
  },
  "actingEnabled": true
}
~~~

The profile labels are project configuration, not authoritative metadata supplied by OpenAI. They should be calibrated by listening to the configured voices in the actual game mix.

Character-aware mode fails closed when:

- `speechVoiceProfiles` is missing;
- a configured speech voice has no profile;
- a profile references a voice outside `speechVoices`;
- the TTS model does not support the configured voice;
- the configured pool has no male/any coverage or no female/any coverage;
- `any` is combined with specific values in the same gender or age list.

## Acting instructions

When `actingEnabled` is true and the configured TTS model supports instructions, the runtime adds bounded trusted templates such as mature/older cadence and masculine/feminine presentation.

Raw actor/persona text is never copied into speech instructions.

When `voiceAssignment` is `deterministic-session`, the original v1 voice hash and generic acting-instruction behavior are retained for rollback compatibility.

## Telemetry

`voice_profile_assigned` records only normalized voice metadata:

- profile ID
- provider/model/voice
- speed
- assignment version
- selection mode
- normalized gender
- normalized age band
- match reason

Prompts, dialogue, persona text, integration data, and raw actor records remain excluded.

## Validation

GitHub-hosted offline validation completed successfully on October 2, 2026:

- **164 tests passed, 0 failed**;
- the pinned candidate build completed successfully with **25 source-pinned patches**;
- built launcher SHA-256: `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`;
- validation run: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/36948145647.

This validation is offline. It does not replace the remaining physical GTA audition/calibration gate for how the configured voices sound in the actual game mix.
