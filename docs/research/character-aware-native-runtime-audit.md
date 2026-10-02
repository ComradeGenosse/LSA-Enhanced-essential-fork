# Los Santos Alive Essential Hotfix #3 Native Character Context Audit

Updated: 2026-10-02

Repository: ComradeGenosse/LSA-Enhanced-essential-fork  
Feature branch: feat/character-aware-npc-voices  
PR: #1  
Audited PR head: 292ac6e3fb8cf771b2cba18c79a89eaf685ebdcc  
Pinned/uploaded LosSantosAlive.dll SHA-256: 9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653  
DLL size: 2,407,424 bytes

## Scope and evidence standard

This report updates the original investigation using the actual pinned Essential Hotfix #3 DLL, the stock bundled server code, and the current OpenAI/Luna companion implementation.

Evidence labels:

- **PROVEN** — directly established from the DLL/IL, decoded binary strings, server source, branch source, or an executable/static test.
- **STRONGLY SUPPORTED** — multiple pieces of evidence agree, but one runtime detail remains outside the available binary/source evidence.
- **INFERRED** — reasonable interpretation that is not directly established.
- **UNKNOWN** — evidence is still insufficient.

No conclusion below treats JavaScript field naming as proof of native semantics. No GTA runtime was launched during this audit.

---

# 1. Executive findings

The central uncertainty behind the character-aware voice work is substantially resolved.

1. **ActorContext.Gender and ActorContext.AgeRange are real native-produced fields.** ActorContextProvider.Populate in LosSantosAlive.dll writes both fields before integration enrichment.

2. **PedId is the RAGE entity pool handle rendered as text.** ActorContextProvider.Populate executes Rage.Entity.get_Handle, converts the Rage.PoolHandle to string, and stores that string in ActorContext.PedId.

3. **PedModel is the source used by the native demographic classifiers.** The IL stores PedModel and then calls obfuscated helpers with the model-name value to populate Gender and AgeRange.

4. **The exact native AgeRange output vocabulary recovered from the DLL is:**
   - young
   - middle-aged
   - old
   - unknown

   No numeric age, numeric range, "adult", "older adult", "senior", or "elderly" value was found as a native AgeRange output in the decoded classifier strings.

5. **The exact native Gender vocabulary recovered from the DLL is:**
   - male
   - female
   - unknown

6. **The demographic classifiers are model-name classifiers, not random per-NPC age generators.** The Populate path passes the model-name value into the hidden helpers. The decoded classifier string table also contains model-specific constants including PLAYER_ZERO, PLAYER_ONE, PLAYER_TWO, and MP_M_SHOPKEEP_01. The complete hidden condition table is not yet fully reconstructed, so the exact model-to-band mapping remains partially unresolved.

7. **The shipped integrations examined do not overwrite the core Gender/AgeRange fields.** Native integration enrichment occurs after the core fields are assigned. Policing Redefined, LSPDFR, callout, and related data are carried through IntegrationBlocks/server integration structures. The public IIntegration.EnrichActor surface receives the mutable ActorContext, so a third-party integration technically could overwrite core fields, but that is not what the shipped integration paths traced here do.

8. **Policing Redefined exposes richer demographic identity information than core AgeRange.** The stock server recognizes PR identity fields including gender, modelAge, and birthday. Those values remain integration data; they are not automatically promoted into ActorContext.Gender/AgeRange.

9. **Stock Essential/Gemini voice assignment is gender-based, not age-based.** Stock voice selection uses male/female pools. AgeRange, archetype, and persona do not participate in stock voice selection. Unknown gender falls through to the male pool.

10. **Stock voice persistence is pedId-oriented.** The stock server retains voiceName in actor session state keyed by pedId and reuses a valid stored voice across session creation/replacement. This is a semantic difference from the OpenAI implementation, which intentionally keys deterministic selection to pedId + sessionNonce.

11. **Core gender/age are available before voice assignment on the supported player text, player mic, and special-turn flows that were traced.** Optional external integration material can be delayed or absent; the native core demographic fields are computed synchronously when ActorContext is populated.

12. **A real defect exists in the current OpenAI character-aware age parser.** Native Essential emits ageRange = "old", but actorVoiceTraits.mjs does not recognize "old". Those NPCs therefore become ageBand = "unknown" in the OpenAI voice resolver.

   Severity: **Medium** for the character-aware voice feature. It does not crash or corrupt sessions, but it silently discards a real native demographic signal for every NPC classified as old.

   Minimal fix: map native "old" to the configured older/senior taxonomy used by the OpenAI voice system. The least disruptive current mapping is "older", because the existing resolver taxonomy is young/adult/mature/older/senior and native Essential provides no finer split inside "old".

13. No evidence supports replacing pedId + sessionNonce today with another universal native durable identity key. The native API exposes useful memory/state services, but no audited field provides a globally durable NPC GUID suitable for all pedestrians.

---

# 2. Evidence table

| Question | Finding | Evidence | Confidence |
|---|---|---|---|
| Is ActorContext.Gender native? | Yes. ActorContextProvider.Populate writes ActorContext.Gender. | LosSantosAlive.Context.Providers.ActorContextProvider::Populate, token 0x60012b8, stfld ActorContext::Gender. | PROVEN |
| Is ActorContext.AgeRange native? | Yes. ActorContextProvider.Populate writes ActorContext.AgeRange. | Same method, stfld ActorContext::AgeRange. | PROVEN |
| What feeds the demographic helpers? | The model-name value stored as PedModel is passed into hidden classifier helpers. | Populate IL shows PedModel assignment followed by helper calls using the same local model value for Gender and AgeRange. | PROVEN |
| Native Gender vocabulary | male, female, unknown. | Hidden string table decoded directly from the pinned DLL. | PROVEN |
| Native AgeRange vocabulary | young, middle-aged, old, unknown. | Hidden string table decoded directly from the pinned DLL. | PROVEN |
| Does native AgeRange emit numeric ranges? | No numeric output was found in the recovered classifier vocabulary. | Direct decoded classifier strings. | STRONGLY SUPPORTED |
| Is age random per actor? | No random input is present in the observed Populate call; model name is the classifier input. | Populate IL and decoded classifier constants. | STRONGLY SUPPORTED |
| Is gender random? | No; it is derived from the model-name classifier path. | Populate IL. | STRONGLY SUPPORTED |
| What is PedId? | Rage.Entity.Handle / Rage.PoolHandle converted with ToString(). | Populate IL offsets around 229-250. | PROVEN |
| Is PedId a durable GUID? | No durable GUID is assigned to ActorContext.PedId. | Direct IL. | PROVEN |
| Can handles be reused after entity destruction? | RAGE/GTA entity handles are expected to be recyclable, but the exact installed runtime behavior was not executable in this audit. | Handle-based identity plus absence of RAGEPluginHook runtime binary/probe. | STRONGLY SUPPORTED |
| Does integration enrichment happen before or after core demographics? | After core population. | Populate ends with IntegrationManager::EnrichActor after Gender, AgeRange, archetype, and descriptions are populated. | PROVEN |
| Do shipped integrations overwrite core gender/age? | No overwrite was found in the shipped PR/LSPDFR/callout integration paths examined; richer data is kept in integration blocks. | DLL integration path + stock server integration normalizers. | STRONGLY SUPPORTED |
| Could a third-party IIntegration overwrite them? | Technically yes, because EnrichActor receives mutable ActorContext. | Public IIntegration/IntegrationManager API shape. | PROVEN |
| Does PR expose richer identity age data? | Yes: birthday and modelAge are normalized by the stock server, along with identity.gender. | upstream/server.bundle.mjs hO normalization. | PROVEN |
| Does stock Gemini use AgeRange for voice choice? | No. | Stock pv/GK voice selection only tests gender and voiceName membership. | PROVEN |
| Does stock Gemini use archetype/persona for voice choice? | No evidence of either in voice selector. | Stock pv/GK functions. | PROVEN |
| What does stock do with unknown gender? | It falls through to the male voice pool. | pv/GK selection expression. | PROVEN |
| Is stock voice retained? | Yes, voiceName is stored in actorSessionStates keyed by pedId and reused if still valid. | Pv/oa/Ed/GK/WP in server.bundle.mjs. | PROVEN |
| Does stock voice survive Gemini session replacement? | Normally yes, because actorSessionStates voiceName is independent of the current transport session nonce. | Ed/GK/WP server flow. | PROVEN |
| Are core demographics present before player text generation? | Yes on the traced native/server path; playerText contains hydrated speaker context before session generation. | native BuildContextJson path + server ib/oa/Zi sequence. | PROVEN |
| Are core demographics present before player mic generation? | Yes once micHydration arrives; server refuses to start the model session before context hydration. | server wd() waits for hydrated context before Zi()/realtime input. | PROVEN |
| Can mic enrichment time out? | Yes. Native conversation hydration has a hard emergency timeout for optional enrichment. | ConversationHydrationCoordinator binary trace; 10,000 ms timeout established in the native path. | PROVEN |
| Does special-event speech hydrate the actor first? | Yes. It requests actor hydration, waits up to 12 s, and rejects if speaker hydration fails. | server kb()/M4()/fN(), Nb = 12e3. | PROVEN |
| Is normal stock NPC-to-NPC orchestration active in this backend? | No; the stock tb handler is stubbed to return null. | server.bundle.mjs. | PROVEN |
| Does OpenAI cache the voice profile for a connection? | Yes. #voiceProfile is assigned once on the first beginTurn and then retained. | src/openai/openaiConnection.mjs. | PROVEN |
| Does OpenAI parse every native AgeRange value? | No. "old" is missing. | native vocabulary vs src/voice/actorVoiceTraits.mjs. | PROVEN |
| Does OpenAI parse every native Gender value? | Yes: male/female/unknown all resolve correctly. | native vocabulary vs normalizeGender(). | PROVEN |
| Is pedId + sessionNonce safe for current session-level stability? | Yes for the stated contract: one profile per native/server session identity. | voice resolver identity design + OpenAIConnection sessionIdentity validation. | PROVEN |
| Is it durable across replacement sessions? | No guarantee; a new sessionNonce can choose a new deterministic voice. | sessionNonce is part of the resolver seed/identity contract. | PROVEN |
| Is that currently a defect? | Not under the documented session-level stability contract; it differs from stock behavior. | Current feature design + stock comparison. | PROVEN |
| Is there a better universal native durable key already exposed? | None was established. | ActorContext/NpcState/memory API audit. | STRONGLY SUPPORTED |

---

# 3. AgeRange specification

## 3.1 Source

ActorContextProvider.Populate is the native producer.

Relevant type:

- LosSantosAlive.Context.Providers.ActorContextProvider
- Populate(ActorContext actor, Rage.Ped ped)
- metadata token: 0x60012b8

The decoded IL establishes this sequence:

1. Read Rage entity handle and store ActorContext.PedId.
2. Resolve/store the ped model name in ActorContext.PedModel.
3. Call hidden model classifiers.
4. Store ActorContext.Gender.
5. Store ActorContext.AgeRange.
6. Populate archetype and description fields.
7. Call IntegrationManager.EnrichActor(ped, actor).

Representative IL facts:

- Rage.Entity::get_Handle
- Rage.PoolHandle -> System.Object::ToString
- stfld ActorContext::PedId
- stfld ActorContext::PedModel
- hidden helper -> stfld ActorContext::Gender
- hidden helper -> stfld ActorContext::AgeRange
- IntegrationManager::EnrichActor at the end of Populate

At offsets around 752-759 the method loads the model local, calls an obfuscated helper, and writes AgeRange.

Therefore AgeRange is **not** a numeric age read from GTA and is **not** assigned by the JavaScript layer.

## 3.2 Exact native vocabulary

Direct string-table recovery from the pinned DLL established the complete observed output vocabulary:

- young
- middle-aged
- old
- unknown

This is materially narrower than the defensive vocabulary supported by the OpenAI parser.

No evidence was found that this build emits:

- Young Adult
- Adult
- Mature
- Older Adult
- Senior
- Elderly
- 18-25 style ranges
- numeric ages

Those remain useful defensive parser inputs for future/integration data, but they are not established as native Essential AgeRange outputs in this build.

## 3.3 Classifier inputs and known constants

The native call site passes the ped model name into the hidden age classifier.

The recovered obfuscated string table includes model-specific constants including:

- PLAYER_ZERO
- PLAYER_ONE
- PLAYER_TWO
- MP_M_SHOPKEEP_01

It also includes discriminator-like one-character values used inside the hidden classifier.

The full condition tree has not yet been reconstructed well enough to publish a complete model-name -> AgeRange table without guessing. That remaining task belongs in the follow-up investigation.

## 3.4 Determinism and lifetime

**PROVEN:** Populate supplies the model-name value as the classifier input.

**STRONGLY SUPPORTED:** For an unchanged ped model, AgeRange is deterministic across repeated hydration. No random source was identified on the call path.

**STRONGLY SUPPORTED:** AgeRange should remain stable for the life of an ordinary ped whose model does not change.

AgeRange can differ on a later hydration if:

- the entity behind a recycled PedId is a different ped/model,
- a third-party integration explicitly mutates the mutable ActorContext after native classification,
- a future build changes the classifier.

No shipped path was found that periodically rerolls AgeRange.

## 3.5 Unknown/unclassifiable models

The native classifier has an explicit "unknown" output. That is the correct native fallback when the classifier cannot establish a known category.

The exact set of custom/unusual model names that fall into unknown remains unresolved because the complete classifier branch table is still obfuscated.

## 3.6 Availability at hydration points

### Player text

Core ActorContext population occurs before the server begins the player text model turn. Gender and AgeRange therefore exist as strings by the time the hydrated speaker context is consumed; either may legitimately equal "unknown".

### Player mic

The server does not call its session-generation path until micHydration has supplied actor context. Optional integration enrichment can be delayed and the native mic coordinator has a hard emergency timeout, but core model-derived demographics are synchronous when ActorContext is populated.

### Special events

The special-turn controller explicitly requests actor hydration. It waits up to 12 seconds and rejects the turn if speaker hydration fails. A successful actor hydration response supplies the actor context used to open/reuse the session.

### Normal NPC-to-NPC orchestration

The shipped stock server handler is stubbed. There is no active stock orchestration path to prove beyond the message/hydration infrastructure in this candidate.

---

# 4. Gender specification

## 4.1 Source

Gender is populated in the same ActorContextProvider.Populate method and is derived from the ped model-name classification path.

## 4.2 Exact vocabulary

The recovered native vocabulary is:

- male
- female
- unknown

No additional native Gender output was recovered.

The OpenAI normalizeGender() implementation currently accepts the native values correctly and additionally accepts defensive aliases such as man/woman/m/f.

## 4.3 Stability

As with AgeRange:

- input is the ped model name,
- no random assignment is present at the observed call site,
- repeated hydration of the same unchanged model is strongly expected to return the same value.

Custom/unusual models can produce unknown.

## 4.4 Integration behavior

Native core gender is assigned before IntegrationManager.EnrichActor.

The shipped integrations examined place addon-specific identity/appearance information into IntegrationBlocks rather than replacing ActorContext.Gender.

However, IIntegration.EnrichActor receives the mutable ActorContext object, so the extension contract itself does not enforce immutability. A third-party integration could change Gender or AgeRange if it chose to.

---

# 5. Hydration lifecycle

The concrete high-level flow is:

RAGE Ped
  -> native context builder/provider stack
  -> ActorContextProvider.Populate
  -> other context providers / state providers
  -> IntegrationManager.EnrichActor
  -> ContextSnapshot
  -> ContextJsonSerializer
  -> native/server message
  -> stock server normalization
  -> per-ped session state
  -> Gemini or OpenAI transport/session
  -> OpenAIConnection.beginTurn
  -> one-time voice profile resolution for that connection

Relevant native types include:

- LosSantosAlive.Context.ActorContext
- LosSantosAlive.Context.ContextSnapshot
- LosSantosAlive.Context.ContextJsonSerializer
- LosSantosAlive.Context.GeminiContextBuilder
- LosSantosAlive.Context.ActorHydrationCoordinator
- LosSantosAlive.Context.ConversationHydrationCoordinator
- LosSantosAlive.Context.Providers.ActorContextProvider
- LosSantosAlive.Integrations.IntegrationManager

## 5.1 What "hydrated" means

For this build, "hydrated" should not be interpreted as "every conceivable external integration has perfect data".

It means the native side has produced a current actor/context snapshot and serialized it for the server. Core native fields are populated synchronously. Integration data can be best-effort, cached, unavailable, or constrained by a timeout.

Therefore:

- a hydrated actor can validly contain Gender = unknown or AgeRange = unknown;
- a successful hydration is not proof that an external provider has richer demographic information;
- PR enrichment can be absent even though core ActorContext is usable.

## 5.2 Text lifecycle

The server player-text handler normalizes the supplied speaker/target context, builds/gets the per-ped session, allocates generation identity, and submits the turn.

The OpenAI transport receives the same hydrated actor context used by the stock session path.

## 5.3 Mic lifecycle

The mic path is deliberately gated:

1. micStart creates the turn and starts buffering microphone input.
2. Context hydration arrives separately.
3. The server normalizes the hydrated actor.
4. The server ensures/opens the session.
5. Generation identity is attached.
6. Realtime input is started and buffered PCM is flushed.

The server itself has a 12-second context wait around its mic machinery; the native ConversationHydrationCoordinator also contains a 10-second emergency timeout associated with optional enrichment. These are separate layers and should not be conflated.

## 5.4 Special event lifecycle

Stock server:

- kb() receives specialGeminiTurn.
- M4() requests speaker hydration through fN().
- fN() sends actorHydrationRequest and waits up to 12 seconds.
- M4() can separately hydrate the listener if the first response did not include the requested listener.
- The special turn is rejected if speaker actorContext cannot be hydrated.
- Only then is the turn/session created.

This is the strongest hydration guarantee among the server-side special-turn paths examined.

## 5.5 Can context get richer later?

Core gender/age are recalculated on later native hydration, but the OpenAI voice profile is intentionally frozen after the first beginTurn on an OpenAIConnection.

OpenAIConnection.refreshContext() updates the stored actor snapshot but does not clear or recompute #voiceProfile.

That is safe for the current core demographic path because core gender/age are already present before the first supported turn. It means later integration-only enrichment will not alter that connection's already selected voice.

---

# 6. Identity / lifetime behavior

## 6.1 PedId definition

Direct IL proves:

ActorContext.PedId = ped.Handle.ToString()

The handle type is Rage.PoolHandle.

This is a runtime entity identity, not a durable logical-character GUID.

## 6.2 Stability

**PROVEN:** all server/session lookup behavior receives the string PedId derived from the native handle.

**STRONGLY SUPPORTED:** the value remains stable while the same live RAGE entity retains that handle.

**UNKNOWN from static evidence alone:** the exact Enhanced/RAGEPluginHook handle reuse timing after deletion/unload.

The practical consequence is important: PedId must not be treated as permanent identity across arbitrary despawn/reload cycles.

## 6.3 Native stores

The DLL exposes native state/memory facilities such as:

- LosSantosAlive.NPC.NpcState
- LosSantosAlive.NPC.NpcStateStore
- LosSantosAlive.NPC.Memory.PedContinuityMemory
- LosSantosAlive.NPC.Memory.PedContinuityMemoryService

PedContinuityMemoryService lookup evidence also uses the entity handle converted to string as the dictionary key. That is useful continuity state, but it is not evidence of a separate durable global NPC identifier.

## 6.4 Durable identity candidates

No audited universal field is a drop-in replacement for PedId.

Rejected as universal durable keys:

- PedModel/model hash — many pedestrians share a model.
- PedId/handle — runtime-scoped and potentially recyclable.
- archetype — categorical, not unique.
- PR fullName/birthday — integration-specific, may be unavailable, and is not a native universal identity contract.
- NpcState key — handle-oriented.

Recommendation: keep the current session-level identity contract for this feature and handle durable identity in the separate SESSION_IDENTITY phase.

---

# 7. Stock Essential/Gemini voice system

## 7.1 Voice pools

For the live model family that includes 3.1, the stock bundle defines:

Male:
- Puck
- Charon
- Fenrir
- Orus
- Enceladus
- Iapetus
- Umbriel
- Algieba
- Algenib
- Rasalgethi
- Alnilam
- Schedar
- Achird
- Zubenelgenubi
- Sadachbia
- Sadaltager

Female:
- Zephyr
- Kore
- Leda
- Aoede
- Callirrhoe
- Autonoe
- Despina
- Erinome
- Laomedeia
- Achernar
- Gacrux
- Pulcherrima
- Vindemiatrix
- Sulafat

The 2.5 fallback pools are narrower:

Male: Charon, Puck, Fenrir, Orus  
Female: Aoede, Leda, Kore, Zephyr

## 7.2 Selection algorithm

The stock selector:

1. Normalizes actor gender to lowercase.
2. Reuses an existing voiceName if it belongs to the correct pool.
3. Otherwise picks a random voice from the gender-specific pool.
4. For any gender other than exactly "female" or "male", the fallback pool is the male pool.

The session-opening helper also tries to preserve a valid prior actor-session voice before selecting a replacement.

## 7.3 What stock does not use

No stock voice-selection evidence uses:

- AgeRange
- age
- archetype
- archetype description
- role
- persona
- activity
- emotional state

Stock voice assignment is therefore much simpler than the OpenAI character-aware profile logic.

## 7.4 Persistence and reroll behavior

The stock server retains voiceName in actorSessionStates keyed by pedId.

It can reroll when:

- no stored voice exists for that pedId,
- the stored voice is invalid for the current interpreted gender/pool,
- the process/session state has been reset such that the actor state no longer exists.

A normal Gemini session replacement/recovery can retain the voice because voiceName lives in ped-level actorSessionStates rather than only in the current transport session.

This differs from the OpenAI design.

## 7.5 Unknown gender

Unknown gender is not assigned a neutral combined pool. It falls back to the male pool.

## 7.6 Native voice hint

ActorContext itself does not expose a native voiceName field in the audited DLL metadata. voiceName is server-side session state.

No native voice hint suitable for direct reuse by the OpenAI integration was established.

---

# 8. Integration overrides and hidden demographic sources

## 8.1 Native integration order

ActorContextProvider.Populate establishes core actor fields and then calls:

LosSantosAlive.Integrations.IntegrationManager::EnrichActor

Thus integration enrichment occurs after native demographic classification.

## 8.2 Policing Redefined

The stock server normalizes PR data containing fields including:

identity:
- firstName
- lastName
- fullName
- birthday
- gender
- modelAge

plus license, record, impairment, permits, address, inventory, vehicle, recentVehicle, and policeStatus information.

These richer demographic fields remain under the integration structure.

### Could PR provide a better age estimate?

Potentially yes.

A valid birthday could support a chronological age calculation. modelAge may also carry a more specific provider interpretation than the coarse native AgeRange.

However:

- provider availability is optional;
- values may be absent;
- semantics of modelAge have not yet been fully established from the provider binary/schema;
- PR data is not universal to all NPCs;
- the current feature intentionally uses normalized core demographics.

Therefore no feature change is justified yet.

## 8.3 LSPDFR

The server recognizes LSPDFR integration information including outfit/agency structures and raw gender-like appearance data. This remains integration-specific material and was not found overwriting core ActorContext.Gender.

## 8.4 Callout/NPC AI integration data

The server also normalizes contextual material such as:

- emotionalState
- cooperation
- visibleIntoxication
- personalContext
- scenario
- role
- mood
- details

These are potentially useful for Luna dialogue/acting context but are separate from the current demographic voice assignment.

## 8.5 Third-party integrations

Because EnrichActor receives the mutable ActorContext, a third-party implementation could intentionally replace a core field.

This is an extension capability, not evidence that the shipped integrations do so.

---

# 9. Review of the current OpenAI implementation

Reviewed files:

- src/voice/actorVoiceTraits.mjs
- src/voice/voiceProfile.mjs
- src/voice/voiceResolver.mjs
- src/openai/openaiConnection.mjs
- src/config/e1Config.mjs

## 9.1 Confirmed-correct assumptions

### Gender parsing

normalizeGender() correctly handles all native values:

- male -> male
- female -> female
- unknown -> unknown

The additional aliases are harmless defensive compatibility.

### Session-level profile freezing

OpenAIConnection assigns #voiceProfile once on the first beginTurn and reuses it for all later turns on that connection.

This guarantees stable:

- selected voice
- normalized traits
- TTS speed/profile metadata
- acting instructions derived from that profile

for the connection/session.

### Retry and segmented TTS stability

Because speechProfile is copied into the launched turn snapshot and reused by the downstream speech path, ordinary retries and segmented/E6 speech within the same connection do not independently reroll the profile.

### Identity seed

Using pedId + sessionNonce is appropriate for the feature's stated **session-level** stability guarantee. It avoids relying on PedId alone as durable identity.

## 9.2 Confirmed defect: native "old" is not parsed

Current parseAgeRange() handles:

- elderly/senior/geriatric -> senior
- olderadult/older -> older
- middleaged/mature -> mature
- young -> young
- adult -> adult

It does **not** handle the exact native value:

- old

Result:

native ActorContext.AgeRange = "old"
  -> parseAgeRange("old")
  -> ageBand = "unknown"
  -> character-aware voice matching loses age information

### Severity

**Medium**

Reason: all native old-classified NPCs silently lose a real supported demographic trait. The feature still functions, but matching quality is incorrect.

### Minimal fix

Add exact/word-safe support for "old".

Recommended current mapping:

old -> older

Why "older" rather than "senior":

- Essential exposes only the coarse category "old".
- There is no evidence that every native "old" model represents a 75+ senior.
- Mapping to "older" preserves the signal without inventing a more specific chronological claim.

Illustrative minimal change:

    if (/(olderadult|older|old)/.test(collapsed)) return frozenAge({ ageBand: 'older' });

A more exact implementation should avoid accidental substring semantics and may prefer an explicit native-label check before defensive fuzzy parsing.

### Required test

Add at minimum:

    assert.equal(parseAgeRange('old').ageBand, 'older');

Also add a native-vocabulary regression test covering:

- young
- middle-aged
- old
- unknown

## 9.3 Can the resolver freeze before native demographics are complete?

For the supported flows traced here:

- player text: core demographics are already in hydrated actor context;
- player mic: model session starts only after micHydration;
- special event: actor hydration is requested before session generation.

Therefore **core native demographics should not normally freeze as unknown merely because PR or another optional integration is late**.

Remaining caveat:

OpenAIConnection caches the first profile permanently for that connection. If a future/new path calls beginTurn with a genuinely incomplete actor object and enriches core demographics later, the profile would remain based on the first snapshot. No current traced production path requires changing that behavior.

## 9.4 Integration demographic changes after assignment

Shipped integrations examined do not replace core demographics.

If a third-party integration changes core Gender/AgeRange before serialization, the resulting hydrated actor will naturally carry those changed fields into OpenAI.

If actor data becomes richer only after #voiceProfile has been assigned on the connection, refreshContext() does not re-resolve the profile.

That is a known consequence of the stable-session design, not currently a demonstrated bug.

## 9.5 Session recovery and voice changes

Stock Gemini and OpenAI have different persistence scopes.

Stock:
- voiceName is primarily retained by pedId-level actor session state.

OpenAI:
- deterministic voice selection uses pedId + sessionNonce.
- a new sessionNonce is a new deterministic assignment domain.

Therefore a hard session replacement/rebuild that allocates a new nonce **can** produce a different OpenAI voice for the same still-live ped.

This is not a defect under the current "stable for the native session" requirement, but it is an intentional difference from stock and should be considered in the future SESSION_IDENTITY phase.

Exact-speech recovery and ordinary retries that stay on the same connection/profile do not reroll.

## 9.6 Better key right now?

No universal better native key was established.

Do not replace pedId + sessionNonce with:

- model name,
- archetype,
- PR name/birthday,
- NpcState key,
- handle alone for long-term identity.

## 9.7 Path consistency

Player text, player mic, and special-event OpenAI generation all ultimately use the same OpenAIConnection voice-profile mechanism once a session/connection exists.

The main differences are upstream hydration timing, not voice-profile logic.

Normal stock NPC-to-NPC orchestration is currently stubbed, so there is no active stock path to compare for that feature.

## 9.8 Tests that should change based on native evidence

Add direct regression coverage for the **actual** native vocabulary.

Recommended cases:

- normalizeGender('male') -> male
- normalizeGender('female') -> female
- normalizeGender('unknown') -> unknown
- parseAgeRange('young') -> young
- parseAgeRange('middle-aged') -> mature
- parseAgeRange('old') -> older
- parseAgeRange('unknown') -> unknown

Keep the broader defensive parser tests; they remain useful compatibility coverage.

---

# 10. Other character-context facts established

ActorContext carries substantially more than demographics.

| Field family | Native/source evidence | Lifetime | Luna visibility today | Confidence |
|---|---|---|---|---|
| Archetype | ActorContextProvider + archetype configuration/helpers | generally model/context based | serialized in actor context | STRONGLY SUPPORTED |
| ArchetypeDescription | derived from archetype helper | stable while archetype stable | serialized | PROVEN field/path; exact generation rules partly unresolved |
| ArchetypePerceivedDescription | separate perceived-description helper | stable while archetype stable | serialized | PROVEN field/path |
| Activity | ActivityContextProvider | volatile/live | serialized | PROVEN |
| RoleName/RoleContext | ActorContext fields, enriched/contextual | context dependent | serialized | PROVEN fields; exact precedence partly unresolved |
| Weapon state | WeaponContextProvider / actor state | volatile/live | serialized | PROVEN |
| Vehicle state | VehicleContextProvider | volatile/live | serialized | PROVEN |
| Recent vehicle | native state/context | stateful across immediate activity | serialized | STRONGLY SUPPORTED |
| Reflex state | NpcState reflex fields/providers | stateful until cleared/replaced | serialized | PROVEN |
| Street/zone/interior/location | world/context providers | volatile/live | serialized | PROVEN |
| Available activities | activity/location providers | volatile | serialized | PROVEN |
| Radio context | RadioContextProvider | live/contextual | serialized | PROVEN |
| Nearby people/references | NearbyPersonContextProvider + perception snapshot | very volatile | serialized | PROVEN |
| IntegrationBlocks | IntegrationManager/IIntegration | best-effort per hydration | serialized and server-normalized | PROVEN |
| Emotional/cooperation state | integration/callout structures | integration-specific | available when integration block is present | PROVEN server support |
| Native continuity memory | PedContinuityMemoryService | stateful but handle-keyed | direct exposure to Luna not fully established | STRONGLY SUPPORTED existence; UNKNOWN full prompt exposure |

The most important architectural distinction is between:

- **core actor facts**: model, gender, age range, archetype, activity, current physical/world state;
- **perceived descriptions**: information intended to describe how another actor appears;
- **integration/private record facts**: PR/LSPDFR/callout information that may be richer and not universally available;
- **native state/memory**: behavior/reflex/continuity state that can outlive one immediate context build but is not a durable logical-person identity.

---

# 11. Unknowns remaining

The following parts of the original investigation are **not fully closed**.

1. **Complete AgeRange classifier decision tree.**  
   We know the source input and exact output vocabulary, but not every model-name test/branch and therefore cannot yet publish a complete model -> ageRange table.

2. **Complete Gender classifier decision tree.**  
   We know the exact output vocabulary and model-name source, but the full custom/unusual-model classification rules remain obfuscated.

3. **Exact model handling for unusual/custom addon peds.**  
   Static evidence proves an unknown fallback exists but not the precise boundary between classified and unknown custom names.

4. **Exact Rage.PoolHandle reuse behavior in the installed Enhanced runtime.**  
   The DLL proves PedId is the handle string. Proving when/how quickly handles recycle after despawn requires RAGE/GTA runtime observation.

5. **Unload/reload identity continuity for a logically "same" NPC.**  
   No universal durable native GUID was found; an in-game probe is still needed to measure actual handle behavior across streaming/despawn/recreation.

6. **Full archetype classifier/INI precedence.**  
   The field and provider path are known, but the complete hidden rule tree was not deobfuscated as deeply as age/gender.

7. **Every possible asynchronous integration timing edge.**  
   PR timeout behavior was established, but a complete matrix of all third-party/custom integration behavior cannot be proven from shipped code alone.

8. **Provider semantics of PR modelAge.**  
   The field exists and reaches the server, but its exact unit/category semantics and reliability relative to birthday/native AgeRange remain unproven.

9. **Whether PR birthday/modelAge should ever supersede native AgeRange for voice.**  
   This is deliberately not changed without better provider-semantic evidence.

10. **Physical in-game verification of the character-aware voice assignment.**  
    Offline tests prove deterministic logic, not that a real classified "old" ped currently receives the intended voice after the parser fix.

11. **Long-lived voice continuity across hard OpenAI session replacement.**  
    Static code says a new nonce may select a new voice; an in-game recovery probe would verify the observable behavior and whether users notice it.

12. **Normal NPC-to-NPC behavior in a future backend where orchestration is enabled.**  
    The currently shipped handler is stubbed, so there is no active path to validate now.

These are the only material open areas identified from the original requested scope. The central native demographic questions are no longer unknown.

---

# 12. Recommended in-game probes

Only run these for facts that static analysis cannot close.

## Probe A — handle lifetime/reuse

Log on spawn/hydration/despawn/reappearance:

- timestamp
- reason/event
- PedId
- PedModel
- Gender
- AgeRange
- archetype
- entity existence/death state
- sessionNonce if a server session exists

Goal:

- determine whether a streamed/despawned logical actor returns with the same handle;
- determine whether a distinct actor later receives a prior PedId.

## Probe B — classifier sample matrix

For naturally encountered and custom addon peds, log:

- PedId
- exact PedModel
- Gender
- AgeRange
- archetype

Goal:

- validate the recovered vocabulary;
- collect examples around unknown/custom models;
- assist reconstruction of hidden classifier branches without logging dialogue/persona content.

## Probe C — PR enrichment timing

Log timestamps for:

- native context build start
- PR enrichment requested/available/timed out
- ActorContext core Gender/AgeRange
- PR identity.gender/modelAge/birthday presence
- micHydration sent
- OpenAI beginTurn/profile assigned

Goal:

- prove exactly which enrichment is present before first profile assignment under fast/slow/unavailable PR conditions.

## Probe D — hard recovery voice continuity

Log only:

- PedId
- sessionNonce
- profileId
- selected voice
- recovery reason
- replacement-session timestamp

Goal:

- verify that same-session retries retain a voice;
- verify whether hard session rebuilds visibly change a voice, as static code permits.

No dialogue text or private record contents are required for these probes.

---

# 13. Evidence appendix

## 13.1 Binary identity

Audited DLL:

- file: LosSantosAlive.dll / uploaded LosSantosAlive(2).dll
- size: 2,407,424 bytes
- SHA-256: 9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653
- format: PE32+ x86-64 Mono/.NET assembly

This matches the pinned repository artifact used by the candidate.

## 13.2 Key native types

- LosSantosAlive.Context.ActorContext
- LosSantosAlive.Context.ContextSnapshot
- LosSantosAlive.Context.ContextJsonSerializer
- LosSantosAlive.Context.GeminiContextBuilder
- LosSantosAlive.Context.ActorHydrationCoordinator
- LosSantosAlive.Context.ConversationHydrationCoordinator
- LosSantosAlive.Context.Providers.ActorContextProvider
- LosSantosAlive.Context.Providers.ActivityContextProvider
- LosSantosAlive.Context.Providers.NearbyPersonContextProvider
- LosSantosAlive.Context.Providers.RadioContextProvider
- LosSantosAlive.Integrations.IntegrationManager
- LosSantosAlive.Integrations.IIntegration
- LosSantosAlive.NPC.NpcState
- LosSantosAlive.NPC.NpcStateStore
- LosSantosAlive.NPC.Memory.PedContinuityMemoryService

## 13.3 Key method token

ActorContextProvider.Populate:

- token: 0x60012b8

Selected IL facts:

- offsets 229-250: read Rage.Entity.Handle, convert PoolHandle to string, write ActorContext.PedId.
- offsets around 642-644: store the resolved model value to ActorContext.PedModel.
- offsets around 696-703: call hidden model helper, write ActorContext.Gender.
- offsets around 752-759: call hidden model helper, write ActorContext.AgeRange.
- offsets 834-841: call IntegrationManager.EnrichActor and return.

ContextJsonSerializer.Build:

- token: 0x6001176

The serializer has a private actor serializer helper at token 0x600117b that includes IntegrationBlocks processing.

## 13.4 Decoded native demographic strings

Recovered directly from the pinned binary's obfuscated string machinery:

Gender outputs:
- male
- female
- unknown

AgeRange outputs:
- young
- middle-aged
- old
- unknown

Model constants observed in the same recovered classifier-string set include:
- PLAYER_ZERO
- PLAYER_ONE
- PLAYER_TWO
- MP_M_SHOPKEEP_01

The complete control-flow association between every constant and every output still requires the focused follow-up deobfuscation task.

## 13.5 Key stock server functions

upstream/server.bundle.mjs:

- pv(actor): stock gender-aware voice pool selection.
- GK(sessionState, actor): validates/reuses an existing voice against gender pool before reroll.
- Pv(pedId) / Ed(pedId): actor session state keyed by pedId.
- oa(context): normalizes incoming actor context and stores/reuses voiceName.
- WP(...): opens stock live session and retains voiceName.
- fN(pedId, timeout): actorHydrationRequest/Response requester.
- kb(...): special turn controller.
- M4(...): special speaker/listener hydration.
- ib(...): player text turn handling.
- lb()/wd()/ub(): player mic start/hydrate/stop lifecycle.

## 13.6 Key OpenAI files

- lsa-essential-e1-candidate/src/voice/actorVoiceTraits.mjs
- lsa-essential-e1-candidate/src/voice/voiceProfile.mjs
- lsa-essential-e1-candidate/src/voice/voiceResolver.mjs
- lsa-essential-e1-candidate/src/openai/openaiConnection.mjs
- lsa-essential-e1-candidate/src/config/e1Config.mjs

## 13.7 Tools/techniques used

- SHA-256 verification of the uploaded binary.
- PE/.NET assembly inspection.
- metadata/type/method extraction.
- decoded IL operand inspection.
- direct analysis of ActorContextProvider.Populate.
- recovery/decompression of the assembly's hidden string table.
- targeted classifier string decoding.
- stock bundled JavaScript source tracing.
- current feature-branch source comparison.
- existing offline validation evidence: 164 tests passed and pinned candidate build succeeded before this audit.

No DLL modification and no arbitrary GTA/game behavior execution was performed.

---

# 14. Recommended action

Make exactly one feature correction based on this audit:

1. Update parseAgeRange() so the exact native value "old" maps to the OpenAI "older" age band.
2. Add a native-vocabulary regression test for young / middle-aged / old / unknown.
3. Leave all other character-aware voice behavior unchanged until the follow-up investigation closes the remaining classifier/runtime identity questions.

Do **not** redesign the voice system, replace session identity, or promote PR birthday/modelAge into the voice resolver based on the current evidence.
