# Character-aware NPC voices

The OpenAI speech path can assign one stable voice profile per native NPC session using demographic fields already supplied by Los Santos Alive Essential.

## Runtime contract

When `voiceAssignment` is `character-aware-session`, the first bound turn passes the hydrated actor context to the voice resolver. The resolver reads only:

- `gender`
- `ageRange`

It does not consume persona text, player dialogue, integration JSON, role context, or other free-form actor data when building TTS instructions.

### Native Essential demographic contract

The Hotfix #3 DLL was audited directly. `ActorContextProvider.Populate` writes `Gender` and `AgeRange` from the ped-model classification path before `IntegrationManager.EnrichActor` runs.

The exact native `Gender` vocabulary established for the pinned DLL is:

- `male`
- `female`
- `unknown`

The exact native `AgeRange` vocabulary established for the pinned DLL is:

- `young`
- `middle-aged`
- `old`
- `unknown`

Character-aware mode maps those native age labels to its configured matching bands as follows:

| Essential `AgeRange` | Voice age band |
| --- | --- |
| `young` | `young` |
| `middle-aged` | `mature` |
| `old` | `older` |
| `unknown` | `unknown` |

`old` intentionally maps to the coarse `older` band rather than `senior`. Essential does not expose enough chronological precision in that label to justify assuming 75+.

The resolver also keeps defensive support for numeric ranges and broader textual values in case future integrations or builds supply them. The normalized configured age bands remain:

- `young`: under 30
- `adult`: 30–44
- `mature`: 45–59
- `older`: 60–74
- `senior`: 75+

Unknown or malformed demographic values remain `unknown`; the resolver does not invent them.

## Hydration and integration behavior

The audited supported turn paths provide the native core actor context before OpenAI voice assignment:

- player text arrives with hydrated speaker context;
- player mic does not start model generation until `micHydration` supplies actor context;
- special events explicitly request actor hydration before opening/using the model session.

Optional external integration enrichment is a separate concern. The native core gender/age classifier is synchronous, while integrations can be unavailable, delayed, or time out.

Policing Redefined can expose richer fields such as `identity.gender`, `identity.modelAge`, and `identity.birthday`, and LSPDFR/callout structures can expose additional identity or appearance material. Character-aware voice assignment intentionally **does not** use those fields today because:

- they are not universal to all NPCs;
- their provider semantics and persistence are not yet fully established;
- the current feature contract is based on the native core fields;
- free-form/private integration records should not silently influence TTS selection.

A later investigation may justify an explicit opt-in enrichment layer, but that is not part of the current resolver.

## Selection behavior

Character-aware assignment is deterministic.

1. Known actor gender is treated as the strongest compatibility constraint.
2. Exact age-band matches are preferred.
3. Adjacent age bands can be used when the configured pool does not contain an exact age match.
4. Ties are resolved with the native `pedId + sessionNonce` identity hash.
5. The resulting profile is frozen for the native session, including all E6 speech segments and provider retries.

A later turn changing the hydrated demographic fields does not change an already assigned session voice.

This is deliberately **session identity**, not durable character identity. The native `PedId` audited in Hotfix #3 is `Rage.Entity.Handle` / `Rage.PoolHandle` rendered as a string; no stronger universal durable NPC GUID was established.

A hard replacement that creates a new `sessionNonce` can therefore select a different OpenAI voice for the same still-live ped. Ordinary retries and turns that remain on the same connection/profile do not reroll. This differs from stock Gemini, which retains `voiceName` in ped-oriented server state, and is currently an intentional consequence of the session-level contract rather than a hidden durability guarantee.

The future `SESSION_IDENTITY` phase can reuse the same matcher if a genuinely durable character key is established.

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

## Evidence and validation

The native investigation is recorded in:

- `docs/research/character-aware-native-runtime-audit.md`
- `docs/research/remaining-native-context-audit-prompt.md`

The first character-aware implementation passed GitHub-hosted offline validation on October 2, 2026:

- **164 tests passed, 0 failed**;
- the pinned candidate build completed successfully with **25 source-pinned patches**;
- built launcher SHA-256: `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`;
- validation run: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/36948145647.

The subsequent native audit proved one parser regression in that validated build: Essential's exact `AgeRange = "old"` value was being discarded as `unknown`. The follow-up native-contract patch maps it to `older` and adds regression coverage for all exact native gender and age-range values.

Offline validation does not replace the remaining physical GTA audition/calibration gate for how configured voices sound in the actual game mix.
