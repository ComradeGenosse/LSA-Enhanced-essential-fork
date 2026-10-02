# Follow-up prompt: close the remaining native character-context unknowns

Repository:
https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork

Feature branch:
feat/character-aware-npc-voices

PR:
https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/1

Primary audit report:
docs/research/character-aware-native-runtime-audit.md

Pinned Essential DLL SHA-256:
9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653

## Goal

Close **only the remaining unknowns** from the completed native character-context audit.

Do not restart the original investigation from zero. Do not spend time reproving facts already established below unless new evidence contradicts them.

This is a focused reverse-engineering/runtime-validation task. Preserve the current implementation unless a newly proven defect is found.

---

# Facts already established — treat these as baseline

The prior audit directly established:

1. ActorContext.Gender and ActorContext.AgeRange are populated natively in LosSantosAlive.Context.Providers.ActorContextProvider.Populate.

2. ActorContextProvider.Populate metadata token is 0x60012b8.

3. PedId is:
   Rage.Entity.Handle -> Rage.PoolHandle -> ToString()
   and is stored as ActorContext.PedId.

4. PedModel is resolved natively and is the input used by the hidden demographic classifier path.

5. Exact native Gender vocabulary in this pinned DLL:
   - male
   - female
   - unknown

6. Exact native AgeRange vocabulary in this pinned DLL:
   - young
   - middle-aged
   - old
   - unknown

7. Native demographic assignment is not a JavaScript invention and is not a numeric-age GTA native path.

8. Native integration enrichment occurs after the core demographic fields are assigned:
   ActorContextProvider.Populate -> IntegrationManager.EnrichActor.

9. Shipped integrations examined keep richer addon-specific material in IntegrationBlocks rather than overwriting core Gender/AgeRange.

10. Policing Redefined information reaching the stock server includes fields such as:
    - identity.gender
    - identity.modelAge
    - identity.birthday

11. Stock Essential/Gemini voice selection:
    - uses gender,
    - does not use AgeRange,
    - does not use archetype/persona,
    - falls back to the male pool for unknown gender,
    - retains voiceName in pedId-oriented actor session state.

12. OpenAIConnection resolves its voice profile once per connection/native session and retains it for turns/retries/segmented TTS on that connection.

13. The current OpenAI parser has one proven native-vocabulary defect:
    native AgeRange "old" is not recognized and currently becomes ageBand "unknown".

14. pedId + sessionNonce is appropriate for the current documented session-level stability contract.

15. No universal durable native NPC GUID has yet been established.

16. Player text, player mic after micHydration, and special-event speaker hydration all provide core actor context before voice assignment on the traced supported paths.

17. Special turns request actor hydration and use a 12-second server timeout.

18. The native mic hydration path has a 10-second emergency timeout associated with optional integration enrichment.

19. The currently shipped normal NPC-to-NPC orchestration handler in the stock server is stubbed.

Do not report any of the above as a new finding unless you find evidence that changes it.

---

# Remaining questions to solve

## PART 1 — Fully reconstruct the AgeRange classifier

We know the exact output vocabulary. We still do **not** have the complete decision tree.

Recover the hidden native helper called by ActorContextProvider.Populate to assign AgeRange.

Determine as exactly as possible:

1. Every condition/branch used by the classifier.
2. Every exact model name, substring, prefix, suffix, marker, or character test involved.
3. The complete mapping from model-name patterns to:
   - young
   - middle-aged
   - old
   - unknown
4. How these known constants participate:
   - PLAYER_ZERO
   - PLAYER_ONE
   - PLAYER_TWO
   - MP_M_SHOPKEEP_01
5. Whether model naming conventions such as age/gender letters are parsed.
6. Whether any lookup array/dictionary/table is involved.
7. Whether any static state, cache, locale, config, or external data can alter the result.
8. Whether the helper is truly pure/deterministic for a given model string.

Do not stop at the decoded string vocabulary. Reconstruct control flow.

If the assembly is control-flow obfuscated, use:

- metadata tokens,
- branch target reconstruction,
- stack simulation,
- data-flow analysis,
- constant propagation,
- string-decoder output,
- ILSpy/dnSpy/ICSharpCode.Decompiler where useful,
- a custom IL normalizer if necessary.

Deliver a readable pseudocode implementation of the classifier only when the control flow supports it.

---

## PART 2 — Fully reconstruct the Gender classifier

Do the same for native Gender.

Determine:

1. Complete model-name -> gender decision logic.
2. Exact branch conditions.
3. Why/when unknown is returned.
4. Behavior for unusual/custom addon ped names.
5. Whether PLAYER_ZERO/ONE/TWO and MP_M_SHOPKEEP_01 are special-cased.
6. Whether apparent gender letters in Rockstar model names are relied on.
7. Whether any non-model metadata influences the result.

Produce readable pseudocode only from proven control flow.

---

## PART 3 — Resolve exact custom/unusual model behavior

Using the reconstructed classifiers, identify what happens for:

- ordinary Rockstar ambient models,
- story player models,
- multiplayer/freemode models,
- addon/custom models that follow Rockstar naming conventions,
- addon/custom models that do not follow those conventions,
- empty/null/invalid model names if reachable.

Answer whether such models become:

- a normal classified value,
- unknown,
- a special fallback.

If static reconstruction still leaves ambiguity, build a safe pure/offline invocation harness for the classifier helper if possible.

Do not require GTA if the helper can be called safely outside the game.

---

## PART 4 — PedId / Rage.PoolHandle lifetime and reuse

Static analysis proved PedId is ped.Handle.ToString().

The remaining question is runtime lifetime.

Determine experimentally in GTA/RAGEPluginHook:

1. Does PedId remain constant for a live ped while streaming around the world?
2. Does a ped that streams out and back in retain the same handle if the underlying entity was preserved?
3. If the entity is destroyed and recreated, does the same logical-looking NPC receive a new handle?
4. How quickly can a deleted ped handle be reused?
5. Can a new, unrelated ped receive a previously observed PedId during one game session?
6. Does mission/callout persistence alter handle lifetime?
7. Do any LSA native stores preserve a logical identity across a changed handle?

Use a minimal probe. Log only:

- timestamp
- event/reason
- ped handle/PedId
- PedModel
- existence/dead status
- optional position rounded/coarsened enough to correlate the test
- whether NpcState/PedContinuityMemory entry exists

Do not log dialogue/persona/private integration records.

Report actual observed sequences, not assumptions about RAGE handles.

---

## PART 5 — Native continuity and durable identity candidates

Deepen the audit of:

- NpcStateStore
- PedContinuityMemoryService
- PedContinuityMemory
- any spawn/session/state key helpers
- any GUID/string identity fields that may have been missed
- callout participant identifiers
- integration identities

Answer:

1. Are these stores keyed directly by PedId/handle?
2. Can any store re-associate a recreated ped with an older logical identity?
3. Is there a public or hidden durable identifier not included in ActorContext?
4. Is there any identity that survives entity recreation?
5. Are PR identity records potentially stable enough to serve as an optional integration-specific identity, while remaining unsuitable as the universal identity?

Do not recommend an identity redesign unless a concrete better universal key is actually proven.

---

## PART 6 — Policing Redefined modelAge and birthday semantics

We know these fields reach the stock server. We do not yet know their exact provider meaning.

Trace the native PR bridge and any available provider schema/binary far enough to determine:

1. Exact type and format of identity.modelAge.
2. Whether modelAge is:
   - chronological age,
   - appearance/model age,
   - a category,
   - a string derived from ped model,
   - something else.
3. Exact birthday format.
4. Source of birthday.
5. Whether birthday is generated/persisted per ped, per identity record, or recreated.
6. Whether PR gender can differ from core ActorContext.Gender.
7. Whether PR modelAge/birthday are stable across repeated requests.
8. Whether they can arrive later than the first core ActorContext hydration.
9. What happens when PR is unavailable or times out.

Only after establishing semantics, evaluate whether these fields could safely supplement voice matching.

Do **not** modify the voice feature in this task.

---

## PART 7 — Complete archetype derivation

The prior audit established the archetype fields and provider path but did not fully reconstruct the classifier.

Determine:

1. Exact source of ActorContext.Archetype.
2. Complete precedence between:
   - model-name logic,
   - archetypes INI,
   - visual description,
   - integration enrichment,
   - role/callout state.
3. Exact meaning/source of:
   - ArchetypeDescription
   - ArchetypePerceivedDescription
4. Whether archetype can change during the life of one ped.
5. Whether archetype is deterministic for a model.
6. Whether any random selection exists.
7. Whether self description and perceived description intentionally expose different facts to Luna.

Focus only on cognition/dialogue/voice relevance.

---

## PART 8 — Hydration completion semantics

We know the broad flow. Close the remaining precision questions inside:

- ActorHydrationCoordinator
- ConversationHydrationCoordinator
- GeminiContextBuilder
- ContextJsonSerializer
- IntegrationManager

Determine:

1. What exact conditions cause actorHydrationResponse.success = true?
2. Does success mean all synchronous native providers completed?
3. How are provider exceptions handled?
4. Can one provider fail while the actor snapshot still succeeds?
5. Which fields are defaults versus provider-calculated values?
6. Which integrations can be pending or omitted on a successful response?
7. Can any integration result arrive after the response and alter a currently open actor/session?
8. Does a later contextUpdate ever carry changed core Gender/AgeRange for the same session?
9. Are there race conditions between integration completion and server beginTurn?

Use exact control flow and timing evidence.

---

## PART 9 — Verify OpenAI behavior under the unresolved runtime edges

Do not redesign the implementation. Test the current contract.

### A. Unknown/custom demographic actor

Verify with an actor whose native classifier returns unknown:

- selected voice profile,
- deterministic repeatability within one session,
- no crash,
- no accidental use of private integration identity.

### B. Slow PR enrichment

Artificially delay or disable PR where feasible.

Verify:

- core Gender/AgeRange at first OpenAI beginTurn,
- whether profile assignment happens before/after optional PR data,
- whether later context refresh changes the frozen voice profile.

### C. Hard session replacement

Force a replacement that creates a new sessionNonce.

Log:

- PedId
- old sessionNonce
- new sessionNonce
- old profileId/voice
- new profileId/voice
- recovery reason

Confirm whether a voice change occurs and distinguish:

- same-session retry stability,
- replacement-session behavior.

This is characterization, not automatically a defect.

---

# Required evidence levels

Every conclusion must use one of:

- PROVEN
- STRONGLY SUPPORTED
- INFERRED
- UNKNOWN

Do not upgrade confidence merely because the result seems obvious.

---

# Deliverables

Create an addendum report:

docs/research/character-aware-native-runtime-audit-addendum.md

with these sections:

1. Executive delta
   - only new facts beyond the prior report.

2. AgeRange classifier pseudocode
   - complete if proven;
   - otherwise clearly mark remaining unresolved branches.

3. Gender classifier pseudocode

4. Custom-model behavior matrix

5. PedId runtime lifetime/reuse results

6. Continuity/durable identity findings

7. PR modelAge/birthday specification

8. Archetype specification

9. Hydration completion semantics

10. OpenAI runtime-edge verification

11. Evidence table
   Columns:
   Question | Finding | Evidence | Confidence

12. Remaining UNKNOWNs
   - ideally empty or restricted to genuinely inaccessible provider/runtime internals.

13. Evidence appendix
   - method names
   - tokens
   - decompiled/normalized IL snippets
   - probe logs
   - commands/tools used

---

# Constraints

- Work from the exact pinned DLL SHA above.
- Prefer direct binary/control-flow evidence over documentation.
- Do not re-investigate settled vocabulary unless contradictory evidence appears.
- Do not modify main.
- Do not alter the current voice implementation as part of this investigation.
- Do not convert inference into fact.
- Do not execute arbitrary game behavior.
- Keep in-game probes minimal and observational.
- Do not log dialogue/persona/private record contents unless absolutely required.
- If a pure native helper can be tested offline, prefer that over GTA.
- If code changes become justified by a newly proven defect, provide a proposed diff separately rather than silently changing the feature.

The end state should close the few remaining gaps between:

"We know the native fields and exact output vocabulary"

and:

"We know the full hidden classifier logic, runtime handle lifetime, provider enrichment semantics, and every relevant timing edge well enough that there are no undocumented assumptions left in the character-aware voice system."
