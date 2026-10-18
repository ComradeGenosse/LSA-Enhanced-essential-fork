# Memory K — dual-source C-01 acceptance and W09 production acceptance closeout

**Status: IMPLEMENTATION PLAN ONLY · NO-GO for controlled GTA**  
Prepared 2026-10-12. Based on PR #94 integrated baseline `0201731973a1c02a8852271897e2c8df420396b9`, T1 PR #103 `daa8759389cc79b155769c3338697b9332f8840e`, pinned native-Core audit PR #110 `7431a310f8878233807110d649891d2aaab3df01`, T9 PR #111 `00aaa4e3a9a16dc7ac9a97a90155d047e7775baa`, and base production plan PR #97 `d6bd5f3f36881513c17e1add1a6fcf1c96944e01`. The independent implementation base stays the latest verified final integration head, never the planning branch or main.

This ADDENDUM is the proposed **explicit revision** to PR #97's A01 contract. It does not claim that a missing original-native post-accepted typed/STT C-01 callback suddenly exists. It proposes a *dual-origin acceptance* contract using **original backend accepted input + independently authenticated current native P2 ownership and player identity**, with a single atomic P2 SQLite commit guard. **Do not enable anything before the revised contract passes review and exact-head tests.**

## 1. Evidence and review of T9 (PR #111)

| Verification, exact T9 SHA | Observed evidence | Actual status |
| --- | --- | --- |
| Source-simulation test, Windows Node 24 | [Run 38244785137](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38244785137), P2 source simulation | PASS |
| Source-simulation test, Linux Node 24 | Same workflow, other matrix job | PASS |
| Pinned original Essential AST 70-hook build | W09 pinned Windows receipt `w09-pinned-package-receipt.json`, bundle/DLL SHA, staged E1 runtime and six source hashes | PASS |
| Native compiled production source | W09 pinned receipt: requires original production `PromotedCharacters.csproj` build; `RphReferencePath` compile-only SDK DLL not supplied | BLOCKED |
| C01 / M3 / M7 / M9 production producer inventory | `closure-native-producers.v1.json` has four *intentionally empty* source lists | BLOCKED, not 4 passing producers |
| Native M9 isolated harness | W09 pinned receipt `native-policy:native-M9` | FAIL; first failing source/log must be analyzed, cannot assume SDK is sole issue |
| Exact original-runner M0 S01–S10 | W09 A10 jobs list ten missing `memory-k-original-Sxx.test.mjs` files | BLOCKED ALL TEN |
| Physical GTA | Never run or authorized | NOT RUN |

Source simulation uses genuine P2 SQLite (`205` player dialogue lines, `2,501` fixture-certified journal events, two NPCs, four avatar keys, replay/restart/privacy). **Its 'native' observer inputs are fabricated solely inside the test, and do not attest real original Core provenance.** T9's deliberate hard red gate is correct. T9 delivered real infrastructure and a candid partial handoff, **not A09/A10 acceptance**. Existing T9 source tests do not invoke the original `runSequentialTurn` end to end.

### Code review findings that must be closed

- `tools/memory-sim/closure-acceptance-replay.mjs` checks scenario test-source presence using substring mentions of `runSequentialTurn` and `sqliteProfileStore.mjs`, then accepts stdout `@@MEMORY_K_W09_RECEIPT@@{...}` with self-reported counts and hashes. A dishonest or accidentally mock-only test can emit those fields without invoking original runtime. Replace this with harness-owned instrumented receipts from a verified original runner/P2 adapter, cross-checked with durable rows, authenticated source capability fixtures and process receipts; keep per-scenario output hard-failing.
- Source-only runs intentionally avoid all S01–S10. Never allow a source-simulation green check to masquerade as A10.
- `lsa-shared-brain/tests/memory-k-integrated-replay.test.mjs` explicitly asserts M6 P2 adapter **is absent**. This test needs an intentional replacement *when T6's source-correct cursor merges*: positive `readM6Checkpoint/readM6JournalPage/ackM6Checkpoint` and atomic proposal/queue hash/CAS, plus explicit negative tests for legacy/broken/missing methods. Don't just invert the assertion.
- `verify-pinned-production.mjs` invokes the real production native `dotnet build` without the required `RphReferencePath`. Add a **reviewed, hash-pinned compile-only** SDK from the established supported dependency source or classify the gate as BLOCKED when unavailable. No stubs, fabricated RPH DLL, game-folder dependency, disabled project target or silent skip to attain green.
- Native M9 harness needs isolated failure diagnosis and a real fix before claiming A09.
- `closure-native-producers.v1.json` can be completed only after K actually compiles reviewed real source into the **production** C# project. An isolated test project or a file with a source-themed filename does not establish source authority.
- `verify-pinned-production.mjs` checks exact historical AST manifest fields and patch count 70. When real accepted-input integration adds a reviewed pinned AST patch, **update its pinned baseline and independent build evidence**; do not retain a false literal 70 or accept unpinned output.
- One person across Franklin/Michael/Trevor/unknown avatars: preserve `avatarKey` as evidence and gameplay context, but for user long-term memory the *human player identity remains one stable key*, not separate memory universes. Implement and test this at source scope/P2 storage/recall; avoid changing source audit trail. Different NPCs still have independent knowledge and witnessing.

## 2. Revised A01: precise trust/authority semantics

The original pinned Core audit scanned 5,588 managed methods and 67,258 IL calls. Identified native `TextInputService.StartTextInputMode -> InputController.SendTextPrompt -> GeminiBridgeClient.SendJson` and mic stop -> legacy bridge submission paths. Those historical names are **original-Core compatibility**, not a request to select Gemini. None proves *final* accepted ordinary player input. The pinned C# `TryDirectorOriginalTurnBinding` is PS6 stock-only and **must not be reused**.

**Change the A01 contract explicitly from an unimplemented 'original native accepted callback' to two jointly required but honestly distinct proofs:**

1. **OriginalBackendAcceptedInputV1**: emitted *only at* the source-pinned original backend's true final typed/STT acceptance after final text, original immutable `{pedId,turnId,generationId,sessionNonce}` allocation, source/cancel/generation checks, not from UI `input_transcript` or an arbitrary JS caller. The original backend owns this event and may attest acceptance; **do not label this receipt native**. It has a distinct monotonic source revision, backend run/turn epoch, textBytes SHA-256 and source mode. Observe the original lifecycle by a deterministic pinned Essential AST hook or an existing proven original server callback, not by constructing a second inference path. The E1 host must verify the hook executed on the original accepted source.
2. **NativeCurrentPlayerAndOwnerV1**: positive-only P2 owner and controlled-player evidence from K's already authenticated native `memory_authority` receipt (`hostRunId`, `worldEpoch`, `adapterEpoch`, `streamId`, `sequence`, `observerCaptureRef`, `incarnationId`, `encounterId`, `ownerAlias`, `playerCaptureRef`, `avatarKey`, native tick and wall/monotonic receipt time). Never infer identity from a name, nearby NPC, ped handle alone, translated model text or old screenshot. Unknown avatar does not mean a different *human*; require current native controlled player identity and an unambiguous owner even when avatar is unknown.
3. **JoinedAcceptedPlayerTurnV1**: formed only by a K-owned, private, synchronous source arbiter receiving the first two *separately authenticated* receipts. Immutable matching turn tuple+actor source, owner profile mapping, native world/epoch, P2 timeline, current generation, character and end-to-end actor scope are required. Backend acceptance **does not become** `nativeVerified`; expose separate `backendAccepted=true`, `nativeOwnerVerified=true` and `joinedCurrent=true`. A matched acceptance/owner pair is not proof that native originated the backend acceptance; use accurate provenance.
4. **Atomic P2 write fence**: while under the existing **single P2 serialized SQLite writer**, recheck actual acceptance source revision/turn lifetime and current native+P2 scope and commit one exact UTF-8 accepted user dialogue row. Only a *durably read-back* committed receipt can trigger M5 commands or downstream M4. If asynchronous native authority lapses during DB write, reject and do not emit 'saved'. If the user already speaks over it, original normal dialogue continues; never invent memory.
5. **Revocation**: retire bound turns on source update, newer generation, session reset, mic STT correction/retraction, native disconnection, player avatar switch, P2 owner/encounter change, protagonist captureRef switch, scene/save rollback, timeline freeze or deadline. No superseded/disconnected turn may reauthorize on reconnection. Source count caps prevent unbounded token caches.

**Security limitation:** A backend acceptance event + independent native current-state snapshot are not identical to a *native attestation of the acceptance event*. Record that distinction, get explicit A01 contract review, and require contemporaneous identity/epoch/source correlation; if correlation cannot actually be demonstrated from the pinned inputs, A01 remains BLOCKED and M2 never writes.

### Example *shape* only — never fabricate these as test success

```json
{
  "kind": "JoinedAcceptedPlayerTurnV1",
  "backend": {
    "kind": "original_backend_accepted_player_input_v1",
    "identity": {"pedId":"...", "turnId":"...", "generationId":7, "sessionNonce":2},
    "sourceMode":"stt",
    "sourceRevision":"...",
    "finalUtf8Sha256":"...",
    "acceptedAtMonotonicMs":12345
  },
  "native": {
    "kind":"authenticated_native_owner_player_v1",
    "hostRunId":"...", "worldEpoch":1, "streamId":"...",
    "observerCaptureRef":"...", "incarnationId":"...",
    "encounterId":"...", "ownerAlias":"promoted....",
    "playerCaptureRef":"...", "avatarKey":"franklin",
    "sampledGameTick":12000
  },
  "playerIdentityKey":"one_human_player",
  "joinedCurrent":true
}
```

The above is a proposed data contract, **not a proven receipt**. Lock exact schema and byte/time bounds after inspecting real pinned source; persist provenance reference IDs rather than accepting a standalone boolean.

## 3. Implementation workstreams (new D01–D07)

### D01 — Original accepted backend input source (server specialist, prerequisite)

**Read first:** original pinned `lsa-essential-e1-candidate/upstream/server.bundle.mjs`, `patches/essential-hooks.json`, `src/openai/runSequentialTurn.mjs` at lines around hydration/STT/`history.commitPlayerInput`, original `src/openai/openaiTransport.mjs`, original session/generation allocator and PR #110 IL audit.

**Code owner:** a focused new **backend source agent**; K retains the existing shared runner / glue, original AST patch coordinator and published package. Specialist delivers a non-overlapping new `src/memory/originalBackendAcceptedInput.mjs` source admission policy/fixture harness with a narrowly scoped proposed original Core entrypoint patch/handoff for K.

Implementation:
- Precisely identify *accepted* typed input and **final accepted STT** after provider transcript is finalized and accepted by original backend. Transport submit/mic release, E1 `input_transcript`, RAM `commitPlayerInput` and model request alone are insufficient.
- Observe on original source event loop with immutable tuple and source revision, then hand to K via a private single-owner function that ordinary app/UI/model callers cannot invoke. No public `setAccepted` callback. Integrate with existing original alloc/retire/retry lifecycle; preserve original conversation behavior and no extra LLM requests.
- Assert UTF-8 SHA exact original accepted bytes, raw whitespace/profanity/Unicode and single latest STT correction. Accept once; cancel on newer generation before P2 commit. No rekey based on avatar identity.
- Tests: typed/STT accepted, rejected/empty input, delayed STT, reissued STT, stale history, nonnative owner, pause/timeout, retry and cancellation. Contract and test source from pinned AST; no fictitious backend capability.
- **Exit D01:** source-verified original post-acceptance hook with exact turn identity and native Core compatibility, not a test-generated receipt.

### D02 — Independent native owner/player corroboration (native specialist / T1 continuation)

**Read first:** T1 PR #103, PR #110, `native/promoted-characters/MemoryOwnerAuthority.cs`, `native/intelligence/IntelligenceIntegration.cs`, `lsa-essential-e1-candidate/src/memory/nativeMemoryAuthority.mjs` and `src/perception/intelligenceClient.mjs`.

- Keep existing positive-only authenticated `memory_authority` roster source and original Core hash. Do **not** enable T1's proposed fictional v2 native `memory_c01_accepted` event at this pin.
- Provide a private source-authenticated read-through API for current native owner and controlled player, including stable native incarnation/capture IDs and independent current host/epoch, stream/sequence and short sample lifetime; explicitly refuse arbitrary JS mock `nativeVerified` input.
- Relate the backend turn's exact original actor association to the native original Core ped/owner proof; mere matching string `pedId` is not strong enough if recycled. If source lifetime cannot be established, fail.
- Keep unknown avatar as one human player's avatar metadata (not anonymous third-party speaker); require positive controlled-player provenance for identity.
- Add native net481 compiled source registration via K, separate .NET8 policy and Node24 strict pipe tests. Native source proof may be current-state only; do not claim source-time acceptance.
- **Exit D02:** valid native owner/player snapshot and epoch retirement, no forged native accepted-event status.

### D03 — K-owned dual-source arbiter + P2 atomic writer

**K owns** `src/bootstrap.mjs`, `src/integration/essentialGlue.mjs`, `src/openai/runSequentialTurn.mjs`, `src/perception/intelligenceClient.mjs`, `src/perception/contracts.mjs`, original pinned AST build patch, native global registration and `lsa-shared-brain/src/memory/integrationPorts.mjs`.

- New private joiner (`src/memory/dualSourceAcceptedTurn.mjs`), keyed by immutable original turn/generation/session and independently authenticated native owner/p2 profile, **not** source-mode boolean. Reject missing/stale/ambiguous correlation; exact actor, native epoch, ownerAlias and writable timeline must match.
- Define time-of-check to time-of-use: every awaited boundary and the final single-P2-writer transaction must reconfirm the same turn identity, native source/epoch, P2 current timeline, source bytes and one-human player key. Stale/late proof cannot be reused across generations.
- T3 M2: replace legacy `createM2TurnCapture` usage in actual runner with `createM2EssentialCapture` and its actual accepted-input adapter; commit post-acceptance exact player bytes before any Luna request. Preserve existing strict native completed NPC-audio requirements. Record one-sided failure diagnostics explicitly.
- T4 M5: gate commands strictly after durable accepted player P2 receipt/readback; no false 'remembered/forgotten' confirmation and no command mutation outside the single writer. M4/M8 builds the **same one** PS4 frame after command route, with source/deletion rechecks before send/retries.
- Save a stable *one human player* identity for long-term conversations through Franklin/Michael/Trevor/unknown while retaining `protagonistAvatar`/`playerCaptureRef` per-row audit/scene context. Do not partition permanent player memories by protagonist; keep **per-NPC** memory visibility and witness isolation. Audit all P2 query predicates and exports for avatar partitioning; if current schema partitions by avatar, provide a versioned reversible migration with rollback and backward read compatibility.
- **Exit D03:** actual original-runner accepted player turn -> native independently verified owner -> atomic source-fenced SQLite accepted line; missing either source yields zero memory mutation.

### D04 — Original runner scenarios and anti-forgery receipts (T9 follow-up)

**Source:** PR #111 `tools/memory-sim/closure-acceptance-replay.mjs`, `lsa-shared-brain/tests/memory-k-integrated-replay.test.mjs`, and original `tools/memory-sim/scenarios.v0.json`. Scope: test and verifier files only; leave K shared runtime untouched.

- Implement **ten actual** `lsa-essential-e1-candidate/tests/memory-k-original-S01.test.mjs` through `S10` that import and execute the production original runner+P2 source, using separately isolated backend/native evidence fixtures with *actual production adapter functions*; every test must commit and read real P2 SQLite evidence and verify native turn/provenance. No test-only 'true' flags in production.
- Replace arbitrary test `stdout`-owned `@@MEMORY_K_W09_RECEIPT@@` counts with harness-owned telemetry from verified instrumented adapters (runner call, original acceptance hook call, real P2 transaction and readback IDs/row/source hashes, source retirements and provider dispatch count). Key receipts to final checkout source hashes, process invocation, concrete evidence record IDs; assert internal consistency and exact final SHA from independent harness, not self-reported JSON.
- Make a passing test that only imports the runner / prints a forged receipt **fail**, even if it sets `runnerInvocations>0` and `durableSqliteReadbacks>0`.
- Include S01 Unicode/profanity reconnect; S02 mundane PS2 firing recall after 3+ minutes; S03 two NPCs witness only their own facts; S04 M5 ambiguity; S05 Luna offline queue; S06 opinion versus verified fact; S07 save/clock rollback; S08 same-incarnation prepromotion <=120 sec; S09 STT mishearing correction; S10 original PS3/PS6 callback/cooldown/player-priority. Include avatar-switch test with **same human long-term memories** rather than cross-avatar isolation.
- Keep `scenarios.v0.json` flags false while any source producer/integration is missing; permanent scenario receipts must be per exact final head. No test edits to fabricate native capability.
- Update old M6 **missing interface** fixture to positive production checkpoint/ack/queue transaction once T6 is merged, and retain separate negative test for absent/legacy adapter.
- **Exit D04:** repeatable Node24 Linux/Windows exact-head ten-scenario original-runner/P2 evidence logs, no spoofable pass.

### D05 — Original native compile/build/packaging and environment closure (T9 + K)

- K identifies a permissible hash-pinned **compile-only RPH SDK DLL** and separate pinned DamageTracker reference consistent with existing project properties. Use `RphReferencePath`/`DamageReferencePath` explicitly; a game installation, stubs or making compiler warnings nonfatal is NOT equivalent evidence. If not available, leave `A09 BLOCKED: MISSING_EXTERNAL_PINNED_SDK`.
- Native source source inventory must list only demonstrably compiled, source-supported actual C01 corroborator/M3 observation-time/M7 idle/M9 event producer. C01 backend final acceptance is not a native event: inventory wording must be updated under the reviewed dual-source contract to require **backend patch proof AND native owner source**, not a nonexistent native accepted event.
- Fix M9 .NET standalone harness actual failure separately, using logs and source; do not mark source time, curation and Director integrated just because compile passes.
- Pinned AST build hashes and hook count must be checked from reviewed versioned hook manifest. If D01 requires a new hook, update AST patch inventory, pin and build, and the external verifier **together** with explicit trusted inputs; never hardcode an obsolete count to force green.
- Require Windows + Linux Node24, original main net481 C# assembly build, correct source inclusion, independent tests, archive hashes and no GTA installed or cloud called.
- **Exit D05:** A09 succeeds for right reasons on *exact integration head*; production C# project compiled with genuine supported references.

### D06 — Test authority/rollback/privacy and cross-avatar identity review

- Fix or explicitly document every source scope key: `worldProfileId`, `timelineId`, `characterId`, `ownerAlias`, `hostRunId`, `worldEpoch`, `incarnationId`, `encounterId` and one stable human player identity. *Avatar* is source metadata, not permanent-person identity. No cross-character memory leaks.
- Real SQLite accepted dialogue: >=201 lines across four avatars and multiple NPCs; M3 sidecars: >=2,501 authenticated fixture event rows, **distinguishing fixture simulation from live**; crash before acceptance write, commit before M5, ack before cursor, P2 rollback, host switch, source expiry, duplicated dialogue, seven-day trash, recall/retry deletion.
- STT exact correction and source revoked before Luna; no saved acknowledgement before verified durable readback; native completed playback only for NPC spoken lines.
- **Exit D06:** negative failures checked at all entry points, scoped data and same human across avatar changes.

### D07 — Final Agent K integration/decision (last)

K independently reviews each merged specialist diff, exact SHA source ownership, native and backend source evidence, authorizes only source-correct single P2 writer and single PS4 frame, then runs W09 suite. Record the evidence in `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`. Compare PR #94, #97, #103, #110, #111 and T2–T8 actual heads. No attempt to integrate #110's read-only audit as a memory producer. **Controlled GTA GO only after revised A01 and existing A02–A10 all demonstrably pass at one final SHA**; separate physical test approval needed. Existing production and main must remain unchanged until that decision.

## 4. Dependencies and ownership

```text
D01 original accepted backend signal -------┐
                                             ├── D03 K dual-source join + single SQLite commit
D02 native owner/player corroboration -------┘     |
                                                  +---- D04 actual S01-S10 original runner replay
D05 pinned build + native prerequisites ----------------|
D03 + T2/T3/T4/T5/T6/T7/T8 + D04 + D05 -----------> D06 adversarial audit
                                                   |
                                                   v
                                              D07 K GO/NO-GO
```

D01, D02, T9's D04 harness scaffolding and D05 SDK investigation may start in parallel. T9's final scenario tests require D03 and T2–T8 and must stay red until connected. **One writer** for `runSequentialTurn.mjs`, `essentialGlue.mjs`, `bootstrap.mjs`, `intelligenceClient.mjs`, original native/AST registration, project manifests and final CI: **K**. Specialist branches never edit K-owned paths; share proposed patch/handoff instead. Do not alter T9 PR #111 directly while another agent owns it; open a separate review/repair branch if needed.

## 5. Acceptance gates (revised contract)

| Gate | Observable proof required |
| --- | --- |
| A01a | Original backend post-acceptance typed/STT source hook emits complete exact identity and final UTF-8 accepted bytes; rejects submission-only evidence |
| A01b | Authenticated native current player+promoted owner proof, exact host/world/stream/epoch, reincarnation/source validity, P2 writable timeline |
| A01c | Joiner refuses any mismatch/replay/expiry/cancellation and P2 stores exactly one committed original user line; readback-before-M5 |
| A01d | One human identity across avatars, source avatar provenance preserved, no NPC cross-witness leakage or old avatar-partition SQL |
| A09a | Pinned original Essential AST build/package, actual main native compiler dependencies and registration, no test-only producer substitute |
| A09b | Exact-head Node24 Linux/Windows, C# native source tests, full production net481 build and M9 harness positive |
| A10 | S01–S10 each executes *real* original runner and P2 end-to-end, independent anti-forgery receipt, no mock-only classification |
| A11 | K audited final source/offline/physical matrix, separately authorized controlled GTA only after all earlier gates |

**Stop:** a missing original backend accepted hook, native speaker-owner ambiguity, actor-recycle uncertainty, insufficient time correlation, missing RPH compile SDK, native M9 failure, missing original S01–S10 runner, source-unauthorized cloud/Director call, or false passing receipt all independently mean **NO-GO**. Audit logs and tests cannot convert unknown into original provenance.

## 6. Immediate implementation PR assignments

1. **Agent C01-BACKEND** (D01): original-server accepted typed/STT source and unit tests. Draft PR to K integration branch. First parent exact verified baseline. Handoff `PRODUCTION-C01-BACKEND.md`, no K shared edits.
2. **Agent C01-NATIVE** (D02): strengthen/prove current native player-owner corroboration and test expired/cross-epoch; reuse T1 head only by explicit reviewed patch. Handoff `PRODUCTION-C01-NATIVE.md`.
3. **Agent T9-REPAIR** (D04, D05) after latest T9 head: add real original-runner scenarios, anti-forgery gate, correct M6 and native compile prerequisite reporting. Do not claim green when D01/D02/D03 or T2–T8 unavailable. Handoff `PRODUCTION-W09-REPAIR.md`.
4. **Agent K** (D03/D06/D07): approve revised A01 architecture, integrate original backend and current native read-through, one-human P2 identity and M2/M5/PS4 ordering, versioned AST patch and full verified CI. Only K decides controlled GTA readiness.

**This document is a plan. No original source callback, runtime joiner, revised schema, production compile or S01–S10 acceptance is implemented by this PR.**
