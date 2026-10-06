# Remaining native character-context audit — addendum

Baseline: `main` at `612dd99b5a5442dd973f975a71abd91920b8a4fe` (PRs #1 and #2 merged). Investigation date: 2026-10-02. Scope: the [follow-up prompt](remaining-native-context-audit-prompt.md), extending the [primary audit](character-aware-native-runtime-audit.md). Production voice code is unchanged. The merged `old -> older` correction is a baseline sanity check, not a new finding.

Evidence labels describe the stated scope: **PROVEN** is direct binary control flow or an observed offline result; **STRONGLY SUPPORTED** has substantial but incomplete evidence; **INFERRED** is conditional reasoning; **UNKNOWN** lacks the necessary observation or provider implementation. Offline results are never GTA observations.

## 1. Executive delta

- **PROVEN:** The complete age and gender helpers parse fixed underscore components after invariant uppercase, with four exact special cases. They do not validate a Rockstar prefix. The archetype helper independently takes the trimmed fourth component, or one of four special names. Nonconventional custom names return `unknown`; convention-shaped custom names can classify normally.
- **PROVEN:** `NpcStateStore`, continuity memory, interop context, PR state caches, and the inspected CDF cache associate records with a handle/entity key. The newly inspected GUIDs identify interactions or callout instances. No inspected store contains a cross-handle persona reassociation path. **STRONGLY SUPPORTED:** None supplies a better universal durable NPC key. Actual handle reuse remains **UNKNOWN**.
- **PROVEN:** The inspected PR bridge's normal ped identity emits `modelAge` through boxed `PedModelAge.ToString()` and birthday through `DateTime.ToString("MM/dd/yyyy")`. It omits ped `identity.gender`. This narrows baseline fact 10: server schema support does not establish emission by this bridge. Exact `PedModelAge` values and their LSPDFR derivation remain **UNKNOWN**.
- **PROVEN:** Successful actor hydration is best-effort serialization with a true envelope flag. Internal provider catches and the builder's default-snapshot fallback can still lead to `success:true`. PR readiness means a nonblank cached ped-record JSON, not completion of every optional provider or vehicle record.
- **PROVEN:** The pinned actor serializer includes archetype descriptions but omits `pedModel` and `archetype`. The real stock normalizer supplies `unknown` for those omitted strings while retaining descriptions for dialogue.
- **PROVEN:** Six offline probes characterize unknown actors, delayed/omitted PR data, retry stability, and hard replacement on unchanged `main`. A newly proven latent defect precedes voice resolution: the stock integration flattener can promote accepted `identity.gender` into core gender. The inspected bridge does not emit that member, so occurrence in this installation is **UNKNOWN**. A [proposed guard and diff](native-context-proposed-identity-merge-fix.md) are separate investigation artifacts; the feature is untouched.

## 2. AgeRange classifier pseudocode

**PROVEN:** `ActorContextProvider` hidden method `0x060012bb`, called by `Populate` (`0x060012b8`), is equivalent to:

```text
AgeRange(modelName):
    if String.IsNullOrEmpty(modelName): return "unknown"
    s = modelName.ToUpperInvariant()       // no whole-string Trim
    if s == "PLAYER_ZERO": return "middle-aged"
    if s == "PLAYER_ONE":  return "young"
    if s == "PLAYER_TWO":  return "middle-aged"
    if s == "MP_M_SHOPKEEP_01": return "middle-aged"
    parts = s.Split(new char[] { '_' })    // preserves empty components
    if parts.Length < 3: return "unknown"
    if parts[2] == "Y": return "young"
    if parts[2] == "M": return "middle-aged"
    if parts[2] == "O": return "old"
    return "unknown"
```

**PROVEN:** These are whole-component equality tests, not substring, suffix, prefix, hash, numeric-age, or appearance inspection. Components are zero-based. Extra components are irrelevant. The special shopkeeper avoids an otherwise unrecognized `SHOPKEEP` age component. Story cases run before the short-name fallback.

**PROVEN:** Full IL, dispatch arithmetic, switch targets, decoded constants, array bounds and wrapper calls support the pseudocode. The uppercase call is at `IL_01ff`, split at `IL_00a2`; those offsets are execution blocks in flattened flow, not source-order precedence. Wrappers `0x060012cd`, `0x060012d2`, `0x060012d3`, `0x060012d4` call `ToUpperInvariant`, `IsNullOrEmpty`, string equality, and `Split(char[])` respectively. [Complete normalized bodies](native-context-evidence/native-il.txt) preserve the branch targets.

**PROVEN:** In ordinary execution with this pinned constant table, there is no classifier lookup collection, game call, random source, per-ped cache, INI, integration record, current-culture uppercase, or mutable demographic configuration. Its output is deterministic for a given string and .NET invariant-casing semantics. The module's decoded string table is constant-program data, not a model lookup table. Arbitrary reflection/memory mutation is outside this claim.

**PROVEN, offline scope:** A fail-closed IL interpreter executed 2,827 ASCII inputs through the actual extracted age, gender and archetype instruction graphs, comparing them with independently written readable logic. No classifier mismatch occurred. It did not load the DLL, execute its module initializer, or invoke Rage. The finite sample suite does not prove every Unicode casing result; the native specification above retains .NET operations exactly. [Results and instruction coverage](native-context-evidence/classifier-results.json).

## 3. Gender classifier pseudocode

**PROVEN:** Hidden method `0x060012ba` is equivalent to:

```text
Gender(modelName):
    if String.IsNullOrEmpty(modelName): return "unknown"
    s = modelName.ToUpperInvariant()       // no whole-string Trim
    if s in { "PLAYER_ZERO", "PLAYER_ONE", "PLAYER_TWO",
              "MP_M_SHOPKEEP_01" }: return "male"
    parts = s.Split(new char[] { '_' })    // preserves empty components
    if parts.Length < 2: return "unknown"
    if parts[1] == "M": return "male"
    if parts[1] == "F": return "female"
    return "unknown"
```

**PROVEN:** Uppercase is at `IL_00c1`, split at `IL_01c3`; the `F` comparison calls equality at `IL_0088`, `M` at `IL_020e`. The four special strings are compared in their own blocks. No non-model metadata influences this helper. Naming letters need exactly the second component: a component `FEMALE`, an empty component, or a letter elsewhere does not count. Gender and age can independently be known or unknown.

## 4. Custom-model behavior matrix

**PROVEN, string-helper scope:** The following are interpreted classifier outputs, not a list of models successfully spawned or resolved by Rage. Sample rows are recorded in [classifier-results.json](native-context-evidence/classifier-results.json).

| Input model string | Gender | AgeRange | Archetype | Interpretation |
| --- | --- | --- | --- | --- |
| `A_M_Y_BUSINESS_01` | male | young | BUSINESS | Ambient convention |
| `A_F_O_GENSTREET_01` | female | old | GENSTREET | Ambient convention |
| `PLAYER_ZERO` | male | middle-aged | MICHAEL | Exact story special case |
| `PLAYER_ONE` | male | young | FRANKLIN | Exact story special case |
| `PLAYER_TWO` | male | middle-aged | TREVOR | Exact story special case |
| `MP_M_SHOPKEEP_01` | male | middle-aged | SHOPKEEP | Exact special case |
| `MP_M_FREEMODE_01` | male | unknown | 01 | Third component is not an age marker |
| `MP_F_FREEMODE_01` | female | unknown | 01 | Same age fallback |
| `IG_MICHAEL` | unknown | unknown | unknown | Not `PLAYER_ZERO` |
| `U_M_Y_ZOMBIE_01` | male | young | ZOMBIE | Markers, without appearance checks |
| `custom` | unknown | unknown | unknown | No usable components |
| `custom_M_Y` | male | young | unknown | Prefix unrestricted; no fourth component |
| `custom_F_O_person` | female | old | PERSON | Convention-shaped addon string |
| `_F_M_` | female | middle-aged | unknown | Empty prefix accepted; empty archetype rejected |
| `CUSTOM_FEMALE_Y_01` | unknown | young | 01 | Gender component must equal `F` |
| `A__Y_TEST` | unknown | young | TEST | Empty components retained |
| ` A_M_Y_TEST ` | male | young | TEST | Prefix whitespace irrelevant; archetype component trimmed |
| `A_M_Y_` or `A_M_Y` | male | young | unknown | Missing/empty archetype |
| `A_M` | male | unknown | unknown | Short age input |
| `A_F` | female | unknown | unknown | Short age input |
| null, empty, one space, `_`, `__`, `___` | unknown | unknown | unknown | No recognized components |

**PROVEN:** No special addon fallback exists beyond these branches. The helpers themselves do not ask whether a model is valid. **UNKNOWN:** Which empty, unusual, or addon strings the installed Rage model-name resolver can actually produce. Invalid/nonexistent peds leave the actor's defaults through the existing validity gate; an escaped getter/provider exception can instead trigger the builder fallback described in section 9. A simulated null string is not an observed invalid GTA model.

## 5. PedId runtime lifetime/reuse results

**UNKNOWN:** There are no GTA/RAGEPluginHook observation sequences in this investigation. [Timestamped availability check](native-context-evidence/runtime-availability.json) found neither process running; the named game directory also lacked the LSPDFR/PR/CDF provider binaries. The available installed Essential and PR bridge binaries were read statically. Offline source tests and the public SDK cannot establish the game allocator's lifetime/reuse behavior.

| Requested experiment | Actual observations | Confidence |
| --- | --- | --- |
| Live ped while travelling/streaming | Not run | UNKNOWN |
| Stream out/back with underlying entity preserved | Not run; preservation itself needs evidence | UNKNOWN |
| Destruction/recreation of similar-looking NPC | Not run | UNKNOWN |
| Earliest reuse after deletion | No timing samples | UNKNOWN |
| Unrelated new ped reusing a prior full PedId | No paired sequence | UNKNOWN |
| Mission/callout persistence effect | Not run | UNKNOWN |
| LSA reassociation across a changed handle | No path in inspected stores; see section 6 | PROVEN within inspected code |

**PROVEN, preparation only:** [HandleProbe.cs](native-context-tools/HandleProbe.cs) compiles against the public RPH 1.124 SDK using the .NET Framework compiler. It was neither installed nor executed in GTA. The [runbook](native-context-tools/README.md#observational-gta-probe) records commands, allowed columns, and interpretation limits. It retains at most eight managed ped references, samples every 500 ms, rounds position to 25 m, and reads dictionary membership only against the pinned already-loaded Essential assembly. It neither makes peds persistent nor invokes state-creating APIs.

**INFERRED:** If the *full* handle string is reused while an old entry remains, a dictionary indexed only by that string can return the old entry. This conditional possibility is not evidence of slot reuse, generation-bit behavior, reuse frequency, or a live identity collision. No identity redesign is recommended.

## 6. Continuity/durable identity findings

**PROVEN:** The expanded cross-reference scan covers all 651 types and 5,588 method definitions in the pinned Essential, including obfuscated bodies. [Scope index](native-context-evidence/scope-index.json) records core field writes, all direct `System.Guid` calls, named string-ID candidates and the corresponding PR bridge scan. The negative claim excludes external providers, arbitrary reflection and dynamically supplied integrations.

| Candidate | Direct evidence and lifetime boundary | Conclusion / confidence |
| --- | --- | --- |
| `NpcStateStore` | Field `0x040002b4`: `Dictionary<string,NpcState>`. `GetState` `0x06000456` validates ped, computes exact handle string through `0x0600046d`, then finds/creates and updates `.Ped`. Removal `0x06000463/464` removes that key. Released-control cache is separate, with a 5,000 ms cooldown. | No different-handle reassociation in these operations — PROVEN |
| `PedContinuityMemoryService` | Field `0x04000435`: `Dictionary<string,PedContinuityMemory>`. `TryGetMemory` `0x060006bc` and creator `0x060006bd` use exact handle-string lookup. Entry `PedHandle` is field `0x04000431`. Update samples nearby peds at 750 ms, 15 m; cleanup `0x060006bf` expires entries older than 120,000 ms or null. | Recent vehicle/activity memory, not a durable actor identifier — PROVEN |
| `InteropContextStore` | Field `0x0400085f`: dictionary keyed by `Rage.PoolHandle`; scenario/role/emotion/action state stored for that entity. `SetScenarioContext` starts at `0x06000f16`. | No persona lookup/reassociation by model, name or birthday — PROVEN in this store |
| Interaction GUID | Essential `0x060001ba` calls `Guid.NewGuid` at `IL_08d7` and `ToString` at `IL_06c0`; callers include `StartInteraction` `0x060001b4` and `StartFelonyStop` `0x060001b6`. `NpcState.ActiveInteractionId` is an interaction membership field. | Identifies an interaction, not one NPC across recreation — PROVEN |
| Callout GUID / participant hydration | PR bridge `LspdfrCalloutBridgeStore.HandleSetCallout` `0x0600003b` generates `Guid.NewGuid().ToString("N")` for missing callout ID. Accept/end operations change callout instance/version state. `PrCalloutPedHydrator.TryHydrate` `0x060000ae` accepts an existing ped and JSON, then obtains its CDF record. | Callout ID denotes an incident; participant data is applied to a supplied entity. No global NPC reassociation — PROVEN for these paths |
| PR state / record caches | `0x06000c52/53/61/62` use normalized hex handle strings or full `uint` handle value; completed state finds `NpcState` by matching that handle. PR bridge `PrStateTracker` dictionaries are `uint`-keyed. | Different textual handle formatting does not supply a new logical key — PROVEN |
| CDF `PedData` | Public version 1.0.0.6 uses `Dictionary<Rage.Ped,PedData>`; constructor obtains `GetPersonaForPed(holder)` and inserts holder. Getters delegate to that persona. | Stable cached object while retained; no explicit cross-entity identity index — PROVEN for inspected public version |
| Names/birthday, setup/interior IDs, turn/dedupe IDs | String field signatures and call sites distinguish record attributes, scene configuration, interactions, and turn identity. No `System.Guid` field in the pinned Essential; its direct GUID operations are the interaction helper above. A type named `CalloutContextService` is absent from both inspected assemblies; concrete callout store/hydrator paths were examined instead. | No better universal actor key established — STRONGLY SUPPORTED within stated scan scope |

**UNKNOWN:** LSPDFR persona generation/persistence and any identity supplied by unavailable external runtime components. **INFERRED:** Name plus birthday could help correlate an integration-specific persona only if a provider later proves uniqueness, persistence and recreation semantics. This audit proves none of those properties. Writable names/birthday and incident-level GUIDs are unsuitable evidence for a universal key.

## 7. PR modelAge/birthday specification

**PROVEN:** The inspected installed PR bridge is SHA-256 `712f9491c0693d496ea82b1e4cefaa03c0575408a2fefa8d9e295bb516e5ad3e`. Its references request CDF `1.0.0.6`, LSPDFR `0.4.9572.22921`, PR `1.0.0.5`. These references do not prove those assemblies were loaded. [Bridge provenance](native-context-evidence/prbridge-provenance.json) and [normalized IL](native-context-evidence/prbridge-il.txt).

| Field/path | Exact boundary specification | Confidence |
| --- | --- | --- |
| Normal ped `identity.modelAge` | Identity builder `0x060000d0`, `IL_00e2`: `PedData.get_ModelAge`; `IL_00e7`: box `LSPD_First_Response.Engine.Scripting.Entities.PedModelAge`; helper `0x0600010c` calls `Object.ToString()` and returns empty on null/caught failure. JSON string; not a serialized numeric chronological age. | PROVEN |
| Meaning of modelAge | CDF getter `0x0600005c` delegates to `Persona.ModelAge`; source describes it as model age. The exact external type definition, enum members, model mapping and relation to chronology are absent. Boxing alone does not prove an enum's labels. | Appearance/model classification: STRONGLY SUPPORTED; exact categories/derivation: UNKNOWN |
| Normal ped `identity.birthday` | `0x060000d0`, `IL_00ae`: `PedData.get_Birthday`. CDF `0x06000050` returns persona `DateTime Birthday`. Bridge wraps the value for formatter `0x06000109`, which uses `ToString("MM/dd/yyyy")` and returns empty for absent value/caught failure. | PROVEN |
| Birthday formatting | Month/day/year custom pattern, no invariant-culture provider. `/` is .NET's culture-specific date-separator placeholder; the active calendar can also affect formatted year. Thus a literal ASCII `MM/DD/YYYY` wire guarantee would be too strong. | PROVEN from call signature and .NET formatting semantics |
| Ped `identity.gender` | Normal identity builder `0x060000d0` emits names, birthday, modelAge; officer identity `0x060000d3` emits names/birthday. Neither emits gender; officer path also omits modelAge. Vehicle-owner helper `0x060000f2` reading `Gender` is a different record path. Stock `hO` nevertheless accepts/fills an `identity.gender` string. | PROVEN; correction to blanket field-emission claim |
| Provider gender vs core | CDF gender getter/setter delegate to persona; bridge callout hydrator `0x060000af` can set persona gender from supplied `female`/`male` text. Core helper instead reads model markers. No equality enforcement connects them. | Divergence possible: STRONGLY SUPPORTED; actual disagreeing pair: UNKNOWN |

The date-separator interpretation follows [Microsoft's custom-format specification](https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings), not an assumed local locale.

**PROVEN, public provider scope:** The [published CDF 1.0.0.6 package](https://www.nuget.org/packages/CommonDataFramework/1.0.0.6) contains a binary with SHA-256 `d0a81554ff66ea344a6e778f8c7faa6292201a45854ea89b83ced5b6814c24fc`. Its getters/constructors confirm the provider delegation. The matching-version [PedData source at commit `2bc4da2`](https://github.com/Policing-Redefined/CommonDataFramework/blob/2bc4da26bd2f88fec422b89dbe3a9dedbcde1e13/CommonDataFramework/Modules/PedDatabase/PedData.cs) agrees. This package was inspected, not installed or executed; it is not evidence of the current game's loaded provider version. [CDF IL](native-context-evidence/cdf-il.txt).

**PROVEN:** `PedDataController.GetPedData` (`0x0600006a`) returns the cached object before checking existence; otherwise it creates a record only for an existing human ped. `Prune` (`0x0600006c`) marks an invalid entry on one pass and removes it on a later invalid pass. Pruning is checked on lookup after the 900,000 ms interval, not guaranteed every 15 minutes. Clear/unload removes the cache. These details match the [pinned controller source](https://github.com/Policing-Redefined/CommonDataFramework/blob/2bc4da26bd2f88fec422b89dbe3a9dedbcde1e13/CommonDataFramework/Modules/PedDatabase/PedDataController.cs).

**STRONGLY SUPPORTED:** Repeated requests for the same retained record preserve its underlying persona reference; the bridge does not generate a new birthday on each extraction. **UNKNOWN:** Whether values remain unchanged under PR/LSPDFR/external mutation, survive entity recreation or reload, or are persisted outside this cache. Persona birthday and gender are writable, so cache retention does not prove immutability.

**PROVEN, additional mutation path:** Callout hydration `0x060000af` reads JSON `age` with fallback 30 and unconditionally writes a birthday computed by `0x060000b6`: `DateTime.Now.AddYears(-clamp(age,16,100)).AddMonths(-3).Date`. It can write supplied names and gender as well. This is a concrete source of changed record values, not a passive birthday getter. It was not executed. Ambient persona's original birthday generation remains **UNKNOWN** inside unavailable LSPDFR.

**PROVEN:** PR record requests can be pending at the initial successful native hydration, with later completion retained in the cache. If PR is unavailable, `IntegrationManager` skips it; if it is available but uncached past the native wait, enrichment can emit a pending record. Empty/failed completion does not prove a complete identity. Section 9 details the gates.

**INFERRED, recommendation:** These fields should not supplement voice matching in this task. Birthday's origin, persistence and calendar assumptions are incomplete, modelAge lacks a proven mapping, and provider demographics can be authored independently of the model. A future optional adapter would need explicit provenance and supported categories, with assignment timing fixed before connection creation. No adapter or birthday-to-age conversion is implemented here.

## 8. Archetype specification

**PROVEN:** Hidden classifier `0x060012bc` is equivalent to:

```text
Archetype(modelName):
    if String.IsNullOrWhiteSpace(modelName): return "unknown"
    s = modelName.ToUpperInvariant()
    if s == "PLAYER_ZERO": return "MICHAEL"
    if s == "PLAYER_ONE":  return "FRANKLIN"
    if s == "PLAYER_TWO":  return "TREVOR"
    if s == "MP_M_SHOPKEEP_01": return "SHOPKEEP"
    parts = s.Split(new char[] { '_' })
    if parts.Length >= 4 and not String.IsNullOrWhiteSpace(parts[3]):
        return parts[3].Trim()
    return "unknown"
```

**PROVEN:** The fourth component alone determines the ordinary archetype; it need not describe a human role. Freemode `01` is consequently a valid classifier output. There is no random selection. For unchanged model text and fixed invariant-casing behavior it is deterministic. A changed model can change it on the next full population; that possibility is not an observed model swap.

**PROVEN:** `LoadArchetypesIni` `0x060012b5` clears three case-insensitive dictionaries and reads `Plugins\LosSantosAlive\archetypes.ini` below application base directory. Trimmed sections become uppercase keys. Blank/comment (`;`/`#`) lines are ignored; first `=` separates trimmed key/value. `Description`, `PerceivedDescription`, `VisualDescription` populate independent dictionaries; duplicate keys overwrite earlier values. Missing file leaves empty dictionaries; a caught load error can leave partial contents. None changes the classifier string. Self/perceived helpers `0x060012bd/be` return their respective entry or empty string. Visual-description lookup `0x060012b6/b7` supplies appearance text separately.

| Layer | Effect / precedence | Confidence |
| --- | --- | --- |
| Model-name classifier | Sets native `Archetype` | PROVEN |
| INI descriptions | Look up classifier key; empty if missing; do not override key | PROVEN |
| Visual description | Independent lookup for appearance/perception contexts, not classifier input | PROVEN |
| Role/callout state | `0x060012b9` obtains role name/context through NPC role state; separate fields | PROVEN |
| Shipped native integration enrichment | Runs after population; direct-write scan finds no additional core archetype writer beyond constructor/population | PROVEN for inspected bodies |
| Pinned native wire | `ContextJsonSerializer` actor method `0x06001178` sends both descriptions, role fields and integrations; omits literal `Archetype` and `PedModel` fields | PROVEN |
| Stock server `ia -> EO` | Missing strings default to `unknown`; generic integration merge can replace matching nonblocked fields; LSPDFR detected outfit's `naturalized.selfLine`/`perceivedLine` then override corresponding persona descriptions, and `rankOrPosition` overrides role name | PROVEN |

**PROVEN:** INI reload through `GeminiContextBuilder.LoadArchetypesIni` (`0x0600118c`) has a caller in `GeminiVoicePlugin` `0x060010b2`. Only an actual reload establishes a changed dictionary; editing the file alone does not establish live reload. Already captured server context needs a later refresh to see changed descriptions.

**PROVEN:** Stock dialogue builder `mT` selects self text from `sM(self)` (detected outfit self line), then `personaDescription`, then `archetypeDescription`, then `Unknown`. Other-actor text uses `aM(other)` (perceived outfit line), then `perceivedPersona`, then `archetypePerceivedDescription`, then `Unknown`. It deliberately emits `Persona` for self and `Perceived Persona` for the other actor. The fields can expose different facts. Their content is not demographic input to the voice resolver. The independently proven upstream merge defect is addressed separately. [Stock boundary functions](native-context-evidence/stock-boundaries.txt).

## 9. Hydration completion semantics

**PROVEN:** Actor coordinator `HandleRequest` `0x06001121` drops a missing request ID, reports missing/not-found ped, deduplicates the request ID and bounds its queue at 32 (overflow rejects the oldest). `Update` `0x06001122` rejects a ped that became invalid, drains available PR completions, and sends when PR is unavailable, a ped record is cached, or the uncached wait reaches 10,000 ms. This gate does not wait for all registered integrations.

**PROVEN:** Send helper `0x06001123`, `IL_0011`, builds `BuildContextJson("actorHydrationResponse", ped, null)`, then passes literal true to envelope helper `0x06001127`. It does not inspect `ActorContext.Exists`, demographic values, integration completeness or provider diagnostics. Only an exception escaping the build/send path enters its `contextBuildFailed` failure response. Envelope insertion adds metadata after the first `{`; blank input produces a minimal response with the supplied success flag; nonblank input with no `{` is returned unchanged. This is not a structured completeness validator.

**PROVEN:** The synchronous actor builder `0x06001190` constructs defaults, checks validity, then calls Actor, Activity, HeldItem, Weapon, Vehicle, World, Radio, NearbyPeople, Reflex and Continuity providers. Its performance scopes use `finally`; they are not individual exception recovery. An exception escaping a provider reaches `BuildInteractionContextJson` `0x0600118e`'s outer catch (`try [IL_0010,IL_032b)`, catch `[IL_032b,IL_0436)`). That catch creates a fresh snapshot with default speaker/target actors and attempts fallback serialization. If that succeeds, actor send still supplies `success:true` even though populated identity was discarded. A subsequent server identity gate may reject that actor; the success flag alone does not prove eligibility for voice assignment.

**PROVEN:** Some providers catch internally instead. `WeaponContextProvider.Populate` `0x06001342` catches `System.Exception` at `IL_00d9`; its handler sets unarmed/empty weapon fallbacks and returns. Other successfully assigned actor fields can survive. `IntegrationManager.EnrichActor` `0x06000c0f` catches each available integration's exception (`IL_0134` catch), logs and continues. It passes the mutable actor object and does not roll back partial writes or require a block to be present. Thus one optional integration failure can coexist with a successful snapshot. Third-party mutable integrations remain outside the inspected direct-write claim.

**PROVEN:** `ActorContext` constructor `0x0600111e` initializes:

| Default family | Values before provider work |
| --- | --- |
| Existence and flags | `Exists=false`, armed/reflex/indoors false; escalation 0 |
| Core identity/classification | `PedId`, `PedModel`, `Gender`, `AgeRange`, `Archetype`: `unknown` |
| Location names | Street/crossing/zone: `unknown` |
| Descriptions/context | Empty label, archetype/self/perceived description, role, activity/context and most weapon/vehicle/radio/nearby/location strings |
| Equipped weapon | `unarmed` |
| Collections | Empty weapon/integration lists and nearby-reference dictionaries |

Providers can calculate or leave those values. `ContextJsonSerializer.Build` `0x06001176` supplies default actors for missing speaker/target and serializes without field-completion validation. The actor serializer does not transmit every native field; in particular it omits the model/archetype strings identified above. Server-normalizer defaults are an additional boundary, not native measurements.

**PROVEN:** Conversation coordinator `BeginMicTurn` `0x06001155`, `MarkMicReleased` `0x06001156`, and `Update` `0x06001157` manage pending mic hydration, ped validity, PR prewarming/cache readiness and the 10-second emergency path. Send helper `0x06001159` builds `micStop`, rewrites to `micHydration`, sends and marks local readiness. `0x0600115a` sends raw mic stop/reset on its fallback path. Mic hydration has no actor `success` envelope; it shares the same best-effort context builder. Existing supported ordering before voice assignment remains the baseline; it is not a guarantee that optional fields are complete.

**PROVEN:** PR `HasCachedPedRecord` `0x06000c52` validates ped, normalizes full handle value as hex and tests whether record-cache JSON exists and is nonblank. It does not inspect all identity members or vehicle completeness. `GetCachedOrFetchPedRecordJson` `0x06000c65` queues a miss and can return:

```json
{"detected":true,"source":"Policing Redefined Bridge","recordStatus":"pending","record":{"detected":false,"pending":true},"vehicle":{"detected":false}}
```

**PROVEN:** The vehicle cache path is independent. `DrainCompletedAsyncRecords` `0x06000c53` fills record caches after worker completion. `ApplyCompletedPrState` `0x06000c61` updates handle-keyed PR state and any matching `NpcState`. On its first state insertion it returns without comparing previous state (`226508870` dispatches to return case 8); a later changed existing state can enqueue textual general-context updates through `0x06000c38`. First completion is not proof of an immediate pushed full actor refresh. An already-sent JSON snapshot cannot be edited by this cache write.

**PROVEN:** `GeminiContextBuilder` text-update helper `0x06001196` builds weather/place/zone/vehicle/weapon/radio/general deltas; it does not call the demographic classifiers. A later *full* snapshot repopulates core model-derived fields, which could differ after model change or fall back after failure. For an unchanged model, PR arrival alone cannot change native gender/age in these inspected paths. Server `ia/EO/Ev` can still promote integration fields before/at a refresh, as the counterexample proves. On an existing OpenAI connection the profile remains frozen even if actor context refreshes.

**INFERRED:** A PR completion drained before the readiness check can be present in the first snapshot; a completion drained after the timeout snapshot can only affect subsequent cache reads/context work. This ordering follows the queue/drain control flow. Actual worker/game/server timings and any live disagreement are **UNKNOWN**. The offline held-response test deliberately orders refresh after `beginTurn`; it does not measure GTA's scheduling race.

## 10. OpenAI runtime-edge verification

**PROVEN, baseline sanity:** Before edge probes, unchanged `main` passed the native-vocabulary regression within 168 passing tests, and candidate build passed with 25 AST edits and build hash `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`. `AgeRange="old"` mapped to `ageBand="older"`. No contradictory parser evidence appeared.

**PROVEN, offline scope:** [openai-edges.mjs](native-context-tools/openai-edges.mjs) uses the real stock normalizer and session creation/reuse/close/bind helpers, current runtime/resolver/OpenAIConnection and HTTP retry logic. Provider HTTP and native playback acknowledgements are synthetic; unrelated prompt construction, Gemini voice choice, diagnostics and retired-turn sweeping are doubles. All turns settle before replacement. No API request, real PR delay, audio playback or GTA action occurred. The configured four-voice matrix and all logs are in [openai-edges.json](native-context-evidence/openai-edges.json).

| Probe | Observed offline result | Confidence |
| --- | --- | --- |
| A: classifier-unknown custom actor; bridge-shaped identity without gender | PedId `17`, nonce 1: `vp_0dc5c45f41c5b134b88d`, onyx, unknown gender/ageBand. Two completed turns; one connection assignment; all TTS uses onyx. Synthetic names/birthday/modelAge do not change profile vs core-only resolution. | PROVEN for this fixture |
| A: accepted schema with nonempty private gender | Native/input `gender=unknown`; real `ia/EO/Ev` produces `female` from PR `identity.gender`. Assigned shimmer; direct core-only resolution selects onyx. Same identity-derived profileId does not detect the changed demographics. | PROVEN latent boundary defect; installed occurrence UNKNOWN |
| B: PR pending, then ready during held reasoning | PedId `18`, nonce 1: core at begin is female/old; profile `vp_eede2604db2941d0bed0`, shimmer, female/older. First assignment occurs with pending PR; real `qK` refreshes the reused connection after begin; second turn and all TTS retain shimmer, one assignment. | PROVEN for ordered offline refresh |
| B: PR omitted | Same female/old actor completes; female/older shimmer profile; one assignment. Native timeout behavior established statically, not simulated as a live game timer. | PROVEN offline; GTA delay UNKNOWN |
| C: real stock `forceNew` | PedId `17`, nonce 1 -> 3; old onyx / `vp_0dc5c45f41c5b134b88d`; new ash / `vp_83c92d8e4e0cade346fd`; old connection closes with `force_new_session`; stale old ACK rejected. | PROVEN for this replacement path |
| C: old-session retry and default pool | One synthetic HTTP 503 followed by PCM on old connection: onyx -> onyx. Default singleton configuration: nonce 1 -> 3 changes profileId (`vp_faa43a7c684e7a463ce9` -> `vp_99ad4555795df69d0644`) but voice remains nova. | PROVEN offline |

**PROVEN:** `Ei` close advances the stored nonce and `WP` new-session creation advances it again, explaining 1 -> 3. Replacement permits another deterministic choice; it does not guarantee a changed voice. The multi-voice example is characterization, not a defect. Same-session retries do not create a new assignment.

**PROVEN:** The new boundary defect is outside `actorVoiceTraits`: `hO` accepts `identity.gender`, `EO` visits nested identity, and `Ev` writes nonempty keys already present on the actor unless `_O` excludes them. `_O` excludes identity *as a container* but not its visited `gender` member. The inspected bridge-shaped record is safe in probe A, so a universal claim that all accepted private identity is ignored is contradicted without claiming an emitted real-world record. The VM-only proposed OpenAI guard preserves the original core gender in the same fixture. See the separate [proposal](native-context-proposed-identity-merge-fix.md).

## 11. Evidence table

| Question | Finding | Evidence | Confidence |
| --- | --- | --- | --- |
| Complete age tree? | Four exact cases; third underscore component Y/M/O; unknown otherwise | Essential `0x060012bb`, wrappers, interpreted instruction graph | PROVEN |
| Complete gender tree? | Four male cases; second component M/F; unknown otherwise | Essential `0x060012ba` | PROVEN |
| Custom model behavior? | Prefix unrestricted; fields independently classify; 2,827 inputs agree | Classifier result JSON, complete IL | PROVEN for input strings |
| Locale/config/random influence? | Invariant uppercase and constant comparisons; no external classifier input | Helper/wrapper call graphs | PROVEN in normal pinned execution |
| Handle lifetime/reuse/persistence? | No game observations | Environment inventory; compiled unexecuted probe | UNKNOWN |
| Native reassociation? | Inspected stores use exact entity/handle keys; GUIDs are interaction/callout IDs | Store methods, fields, full-scope references, bridge callout paths | PROVEN within inspected stores |
| Better universal key? | None established | 651-type scan plus bridge/CDF paths; external scope excluded | STRONGLY SUPPORTED negative finding |
| modelAge wire type? | JSON string from boxed external `PedModelAge.ToString()` | Bridge `0x060000d0`, CDF `0x0600005c` | PROVEN |
| modelAge interpretation? | Model/appearance interpretation supported | Public CDF source and typed persona delegation | STRONGLY SUPPORTED |
| Exact modelAge categories/derivation? | External definition and model mapping inaccessible | Missing LSPDFR implementation | UNKNOWN |
| Birthday source/format? | Persona DateTime; culture-sensitive custom format; writable callout-age path | Bridge `0x06000109`, CDF getter/ctor, hydrator `0x060000af/b6` | PROVEN |
| Identity persistence across recreation? | Cache retains an object, no proven durable persona behavior | CDF cache/prune/unload; absent LSPDFR internals | UNKNOWN |
| PR gender reaches this ped identity? | Inspected bridge omits it; server supports it | Bridge normal/officer identity builders vs stock hO | PROVEN scoped correction |
| Archetype derivation/precedence? | Fourth component or exact case; independent INI descriptions; wire omissions/server outfit overrides | Essential `0x060012bc/b5/bd/be`, serializer `0x06001178`, stock ia/EO/mT | PROVEN |
| What does hydration success certify? | Send reached with true flag after best-effort builder; defaults/pending possible | Coordinator `0x06001122/23/27`, builder EH, integration EH | PROVEN |
| Later core changes? | Native text deltas don't recompute demographics; full snapshots can; JS flattening can overwrite fields | `0x06001196`, `0x06001190`, stock EO/Ev; offline fixture | PROVEN within these paths |
| Unknown/slow/replacement OpenAI behavior? | Frozen profile under turns/refresh/retry; new nonce may change voice | Six offline real-code probes | PROVEN offline; live behavior UNKNOWN |
| Private identity isolation for every accepted schema? | Counterexample: nonempty identity.gender changes selected voice before assignment | Real ia -> Zi -> Xn -> OpenAIConnection probe | PROVEN latent defect |

## 12. Remaining UNKNOWNs

1. **UNKNOWN:** All requested actual PedId lifetime/reuse sequences, earliest reuse timing, full-handle generation behavior, streaming-preservation evidence, and mission/callout persistence effect. The observational probe is ready and compile-tested; no synthetic log substitutes for these measurements.
2. **UNKNOWN:** Exact LSPDFR `PedModelAge` definition/labels/model mapping, initial ambient birthday generation, and persona persistence/reassociation across entity recreation or reload. The matching-version public CDF binary/source closes the intermediate getters/cache layer only. PR/LSPDFR implementations were absent from the inspected game/plugin locations; this is not a whole-machine absence claim.
3. **UNKNOWN:** Actual native resolver outputs for unavailable addon/invalid model cases, actual provider exception frequency, PR response delays and game/server timing interleavings. Their code branches are reconstructed; occurrence needs observation.
4. **UNKNOWN:** Whether any real producer in this installation emits nonempty ped `identity.gender` (or other colliding demographic fields) accepted by the stock schema. The inspected bridge does not. The accepted-input defect and VM guard behavior are proven independently of that occurrence.
5. **UNKNOWN:** Runtime compatibility of the compiled RPH SDK probe with this Enhanced installation until manually loaded. No claim of successful in-game plugin load, real API verification, acoustic quality, or installed-provider validation is made.

All feasible static/offline work for the available pinned binaries, matching public provider layer and unchanged implementation is completed. These unresolved items are explicitly bounded to inaccessible runtime/provider behavior; they do not justify changing the documented session identity contract or using private PR data for voices.

## 13. Evidence appendix

### Provenance and reproducibility

| Input | Pin / scope |
| --- | --- |
| Essential | `lsa-essential-e1-candidate/upstream/LosSantosAlive.dll`, 2,407,424 bytes; SHA-256 `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |
| Stock bundle | SHA-256 `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2`; current-main build hooks used for offline probes |
| Installed PR bridge | 294,400 bytes; SHA-256 `712f9491c0693d496ea82b1e4cefaa03c0575408a2fefa8d9e295bb516e5ad3e` |
| Public CDF | NuGet 1.0.0.6, `lib/net48/CommonDataFramework.dll`; SHA-256 `d0a81554ff66ea344a6e778f8c7faa6292201a45854ea89b83ced5b6814c24fc`; source commit `2bc4da26bd2f88fec422b89dbe3a9dedbcde1e13` |
| Tools | .NET SDK 10.0.301 metadata reader, Python 3.10 IL interpreter/decoder, Node stock harness/AST reader, ILSpy 11.1.0.9782 as navigation assistance, Framework csc/public RPH 1.124 SDK for probe compile |

**PROVEN:** The PE reader uses `System.Reflection.Metadata`/`PEReader`, not `Assembly.Load`. It extracts method/field tokens, signatures, exception regions and branch/switch destinations. Python reconstructs the constant table using the module's pinned seed/XOR feedback and LZMA data, then runs only whitelisted classifier instructions and string wrappers. Unknown calls/opcodes fail closed. ILSpy's readable decompilation assisted navigation; conclusions and pseudocode rest on pinned IL, not its ambiguous decompiler locals. Normalized output preserves complete selected method bodies; the cross-reference index scans all extracted bodies. No game binaries/SDK/package DLLs are added by this PR.

### Short normalized IL anchors

The full target reconstruction is in the linked IL files; these excerpts show decisive operations, not the entire decision tree.

```text
Essential 0x060012cd (uppercase wrapper):
  IL_0000: ldarg.0
  IL_0001: callvirt System.String::ToUpperInvariant
  IL_0006: ret
Essential 0x060012d4 (split wrapper):
  IL_0000: ldarg.0
  IL_0001: ldarg.1
  IL_0002: callvirt System.String::Split
  IL_0007: ret
PR bridge 0x060000d0:
  IL_00ae: callvirt PedData::get_Birthday
  IL_00e2: callvirt PedData::get_ModelAge
  IL_00e7: box LSPD_First_Response.Engine.Scripting.Entities.PedModelAge
PR bridge 0x06000109:
  IL_0020: call <string decoder> decoded="MM/dd/yyyy"
  IL_0025: call System.DateTime::ToString
Essential 0x06001123:
  IL_0011: call GeminiContextBuilder::BuildContextJson
  ... literal true passed to 0x06001127; no actor-field validity test ...
```

Assembly-local tokens must always be paired with the binary hash. In particular, PR bridge `0x060000af` is the persona mutation helper; it is not an Essential method with that token.

### Artifacts, probe logs and validation

- [native-il.txt](native-context-evidence/native-il.txt): classifiers/wrappers, INI, defaults, stores, hydration/serialization, relevant PR native/cache and exception paths.
- [prbridge-il.txt](native-context-evidence/prbridge-il.txt): identity extractors/formatters, callout identity/mutation paths and state caches.
- [cdf-il.txt](native-context-evidence/cdf-il.txt): published provider getters/setters, constructors, cache/prune/unload.
- [scope-index.json](native-context-evidence/scope-index.json): full Essential cross references and bridge identity candidate scope.
- [stock-boundaries.txt](native-context-evidence/stock-boundaries.txt): exact normalizer/merge/dialogue/session function source from main's candidate build.
- [classifier-results.json](native-context-evidence/classifier-results.json), [openai-edges.json](native-context-evidence/openai-edges.json): actual offline probe results, with explicit scope. There is no in-game CSV.
- [offline-validation.txt](native-context-evidence/offline-validation.txt): commands, baseline results, compiler checks and execution limits. [Tools/runbook](native-context-tools/README.md) explains reproduction without loading the native assembly.

The baseline builder's inherited status label contains `live-api-verified`; this investigation ran only the offline build and tests. That label is not evidence of a fresh live API or GTA run.
