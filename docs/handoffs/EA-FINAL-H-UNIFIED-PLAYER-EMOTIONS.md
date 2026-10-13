# EA Final Fix H — unified human player, native evidence, and emotional continuity

**Repository:** `ComradeGenosse/LSA-Enhanced-essential-fork`  
**Exactly pinned source:** PR #96, commit `b1a9b01b72c406706bb640daacbe30a56efd6d4e`  
**Feature branch:** `feature/ea-final-h-unified-player-emotions-20261011`  
**DRAFT integration target:** `integration/elevenlabs-emotional-acting-final-20261011`; not `main`.  
**Implementation head before this handoff:** `96f760fd7d642270821e904b9ecf79b43190a092`.

## Source files actually changed

- `lsa-essential-e1-candidate/src/voice/emotion/moodStore.mjs` — removes story-avatar model from the ephemeral NPC mood lineage/key. Known-model validation remains. Character ID, current P1 owner binding/revision/incarnation, native session and current verified save/host/world remain mandatory.
- `lsa-essential-e1-candidate/src/voice/emotion/moodRuntime.mjs` — authenticated model changes no longer flush mood by themselves. Temporarily missing native model proof suspends source-dependent use, without refreshing/committing mood or fabricating a valid proof; true save/host/world/owner invalidation retains fail-closed clearing. A WeakMap pins the **actual native proof object** when each turn first reads mood; a delayed completion from an old protagonist revision cannot re-enter after Franklin → Michael → Franklin ABA. `isCurrent()` still verifies the current original native record and owner/timeline at action time.
- `native/intelligence/IntelligenceChannel.cs`, `native/intelligence/IntelligenceIntegration.cs` — adds same-pipe, exact-version receiver negotiation. Native samples only with an explicit native opt-in, a duplex Director/C-13 pipe and accepted `protagonist_capability` for the exact stream, host, epoch and connection. Connection/world change revokes gate, then requires fresh negotiation; older receivers cannot activate producer.
- `native/promoted-characters/RuntimeEntry.cs`, `native/promoted-characters/LSA.PromotedCharacters.example.json` — native config `intelligence.protagonistEvidence` defaults `off`, with exact opt-in value `negotiated_v1`. The separate constructor argument **remains default false**. The existing Director shadow/experimental mode is necessary for a duplex pipe.
- `lsa-essential-e1-candidate/src/perception/intelligenceClient.mjs` — advertises exact v1 support only after authenticated/ordered C-13 native hello, and again on admitted world-epoch advance. It sends one bounded, newline-delimited declaration on the **existing** SID-ACL pipe, not a new IPC channel.
- `lsa-essential-e1-candidate/tests/emotional-mood-continuity.test.mjs`, `tests/ea4-runtime-integration.test.mjs`, `tests/ea7-emotional-continuity-completion.test.mjs`, and new `tests/ea-final-h-unified-player.test.mjs` — cross-avatar, single follow-up, ABA, source suspension, native capability and pure NPC scene parity cases.

Source-change commits in order: `42b0d1fe`, `aa3807de`, `e69b4f42`, `50b5ef3a`, `78e2dc3f`, `f81830e8`, `2654efba`, `9f820c85`, `9f1d4e62`, `f70786b9`, `198d9fe5`, `e793e708`, `96f760fd`. Changes are on H's own branch; the source SHA above is before this handoff file.

## Single-player identity and emotion policy

Franklin, Michael, and Trevor are three avatar models **for one continuous human player**, never independent Luna-facing relationship/personality subjects. Model and strictly increasing native revision are **only authentication/anti-ABA source facts**. Mood keys include promoted NPC ownership and verified save/world/host, not the model. Short-term mood is still in-memory only, default 22 seconds (bounded 15–30 seconds), 128 max entries, one eligible follow-up, same-follow-up idempotence, actual ElevenLabs-applied tag and accepted native playback+history receipts; current witness-qualified danger and current dialogue outrank carry. Retired NPC owners, true save/timeline changes and host epochs revoke prior state. An avatar switch is **not** a save change.

A valid switch between independently source-verified playable models may keep an eligible short soft tendency until ordinary TTL/turn expiry. While switching, unknown/freshness failures authorize **no** emotional action and **no** new completion. Re-validation must independently establish the same approved timeline, host and owner before a later carry. A turn whose previously read native source object is superseded cannot record or consume its former source authorization after ABA.

No permanent relationship/memory SQLite storage, CharacterService implementation, migration, or native game save was edited. Each promoted NPC still retains distinct traits, perspective and witness-qualified knowledge. Existing `essentialGlue.situationFor` uses the promoted NPC profile/relationship by character ID, without model switching. Any protagonist-partitioned persistent subject, query or relationship mapping remaining in Agent G's areas **must** be reconciled by Agent G/final integrator; this branch cannot assert that SQLite has already been migrated.

## C-13 compatibility contract

An explicitly enabled native host's C-13 duplex `IntelligenceChannel` receives an exact JSON line:

```json
{"version":1,"type":"protagonist_capability","supportedVersion":1,"adapterEpoch":"<authenticated UUID>","streamId":"<authenticated UUID>","hostRunId":"<authenticated UUID>","worldEpoch":1}
```

The native owner-fiber validates all seven fields and exact connection/stream/host/world before enabling `NativeProtagonistSensor`; the incoming declaration is only a **receiver capability**, never evidence of Franklin, Michael or Trevor. The producer still reads native GTA source and sends `protagonist_model` on the original ordered pipe, whose admitted frames exclusively update `protagonistAuthority`. Existing 1,500 ms freshness, monotonic revision, and original C-13 session/sequence checks are retained. Missing negotiation, old output-only receiver, disabled native opt-in, unknown ped/cutscene, disconnect, source change and revoked session **fail disabled**. Production operator must opt in only after deploying matched host and companion binaries; rollback sets `protagonistEvidence:"off"`.

## Executable offline verification (new/current branch)

Run from `lsa-essential-e1-candidate/`:

```sh
node --test tests/ea-final-h-unified-player.test.mjs tests/emotional-mood-continuity.test.mjs tests/ea4-runtime-integration.test.mjs tests/ea7-emotional-continuity-completion.test.mjs
node --test tests/ea5-native-protagonist-authority.test.mjs tests/ea-final-a-native-intake.test.mjs tests/ea-final-c-emotional-delivery.test.mjs tests/ea-final-integration-wiring.test.mjs tests/ea8-elevenlabs-provider-safety.test.mjs
npm test
```

Windows native build and integration/ABI checks must run against this branch's **actual PR head**, including `native/intelligence/integration-tests/IntegrationTests.csproj`, full native promoted-character production build, C-13 transport, and release-package identity. GTA source receipts (Franklin→Michael→Trevor, ABA, unknown/cutscene, invalid/replaced ped, host/session reconnect, save/owner retirement), actual ElevenLabs acting/audio quality, and controlled native playback remain separate gates.

**Verification state when handoff authored:** GitHub source changes are committed; local working container has Node.js but **does not have a checked-out project or dotnet**, so no full Node invocation or native C# compilation was executed here. **Exact pass/fail counts: not verified; do not quote old PR counts as evidence for this head.** Review current PR-head GitHub Actions results and their exact SHA before declaring success. No billable ElevenLabs calls and no actual GTA deployment/tests.

## Remaining dependencies, safety and verdict

1. Agent G must reconcile SQLite v4 + permanent profile/relationship identity without partitioning the human user by avatar, while retaining timeline and NPC-witness separation; H deliberately does not touch G's files.
2. Final integrator must inspect the exact H+G combined source and resolve any shared bootstrap/timeline glue conflicts. Native matched-build packaging, compatibility opt-in, exact-head CI, tests against genuine pinned RPH/Core ABI, and controlled GTA source receipts are mandatory.
3. No native source evidence can itself prove a save-slot; M1 confirmed selected writable timeline remains required. An optional producer being compiled does not prove it ran safely in the physical game.

**Readiness verdict: source implementation submitted for DRAFT review; GTA experimental-ready NO, production-ready NO, main-merge NO.** Missing exact-head test/build and game evidence are explicit blockers. No live saves edited, no deployment, no paid vendor requests.
