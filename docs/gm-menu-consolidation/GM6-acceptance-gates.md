# GM6 — F11 gameplay menu verification and release decision

**Scope:** Essential-based LSA, phases GM0–GM6, cumulative tip of the stacked GM6 branch. GM7 standalone cutover is separate and remains blocked on the independent RPH/native host acceptance. No standalone source is merged into Essential `main`.

**Release classification (2026-10-18): IMPLEMENTATION CANDIDATE / GTA ACCEPTANCE NOT YET SIGNED OFF.** Offline compiler, command, view-model, ACT engine, native capability/policy and contract tests must pass on the **exact deployable revision**. A GitHub workflow or HTTP ACK cannot provide real GTA world or audible dialogue evidence. The human game-session cases below remain required; do not substitute a synthetic/mock result.

## Reproducible automated gates

1. `node tools/native-sdk/compileProductionNative.mjs` on Windows, against SDK and RNUI artifacts pinned in the repository.
2. `dotnet run --project native/enhanced/input-tests/InputTests.csproj --configuration Release` on Windows: target fencing, confirmations, menu states, explicit outcomes, ACT slots, Director queue ACK and failure cleanup.
3. `dotnet run --project native/activities/tests/ActivityTests.csproj --configuration Release` on Windows: native owner/step/arrival adapter contracts.
4. `node --test --test-concurrency=1 lsa-essential-e1-candidate/tests/gameplay-menu-readiness.test.mjs lsa-essential-e1-candidate/tests/gameplay-menu-parity-source.test.mjs lsa-essential-e1-candidate/tests/commands-contract.test.mjs lsa-essential-e1-candidate/tests/p2-editor.test.mjs lsa-essential-e1-candidate/tests/activities-act2.test.mjs lsa-essential-e1-candidate/tests/activities-act3.test.mjs lsa-essential-e1-candidate/tests/activities-act6.test.mjs lsa-essential-e1-candidate/tests/director-social-scenes.test.mjs`.
5. `.github/workflows/gameplay-menu.yml` executes these scoped gates on both native Windows and Node Linux. Separate suite-wide failures (especially existing Memory K NO-GO scenarios) must be reported, never silently waived or attributed to gameplay menu without tracing them.

## Mandatory physical acceptance matrix (actual GTA V Enhanced)

| Case | Steps / evidence required | Current status |
| --- | --- | --- |
| F11 and controller parity | Open F11; traverse Main → Current NPC → My Characters → Activities & Navigation → Director & Social → Gameplay Controls → Diagnostics → Settings; Back works; F7 and talk gestures not intercepted | **GTA unverified** |
| Summon named absent character | F11 → My Characters → Nathan JustNate → Summon; verify actor spawn, profile name and in-world owner binding with screenshot/native P2 log | **GTA unverified** |
| Follow and wait | Select exactly Nathan, issue Follow then Wait; verify actual physical behavior, owner safety, F11 result stages | **GTA unverified** |
| Dismiss, release and banish | Dismiss adopted ambient ped and prove it remains in world; separately banish an addon-spawned ped and prove only that actor leaves and profile is retained | **GTA unverified** |
| ACT3 passenger entry and exit | As Nathan, use F11 passenger entry and exit; confirm seat, task and position, no accidental driver-seat assignment | **GTA unverified** |
| ACT6 drive to waypoint | Create map waypoint; verify Nathan owns driver seat; use F11 Drive to Waypoint; log actual native dispatch, travel movement, world-strong arrival/failure reason, no phantom success | **GTA unverified; current real gameplay has reported failed navigation** |
| ACT6 walk / airport | Test both supported waypoint walking and allowlisted airport drive when respective capability is explicitly on. Verify road/terrain preflight, cancellation, error feedback | **GTA unverified** |
| Activity status/progress/stop | Inspect progress, pause, resume, cancel; confirm no stale task or stale busy state, including cutscene and supersession | **GTA unverified** |
| Director social | Trigger Start conversation in F11; prove queued true, native admission accepted/refused (with matching result timestamp), later speech played **or** rejected/interrupted separately. Confirm no fake 'spoken' status | **GTA unverified** |
| Stale selection / incarnation | Open an action on Nathan then select another NPC or respawn Nathan; confirm target_changed or disabled action, no retarget to another body | **GTA unverified** |
| Original interfaces unchanged | Browser `127.0.0.1:37921` summon/Director, voice, controller gestures, console commands and F7 operate with same native safety gates | **GTA unverified** |

### Evidence capture requirements

Record tested repository commit SHA, deployed DLL SHA-256, game/RPH/Essential versions, enabled ACT capabilities, log timestamp window and actor encounter/ownership IDs. Gather the current session's `RagePluginHook.log`, P2/ACT native logs and companion diagnostics. Avoid logging full private spoken conversations or Memory K content; coded action IDs, reasons and actor tokens suffice.

For each command, record distinct stages: **unavailable → queued → accepted → running → physically completed / failed / cancelled** when evidence exists. A successfully delivered companion HTTP response is *not* physical completion. For Director, a native admitted request is *not* verified Luna/ElevenLabs audio played. A missing observation is **unverified**, not a synthetic pass.

### Phase-by-phase handoff

* **GM0:** audited; source-backed inventory in `GM0-action-inventory.md`.
* **GM1:** dispatcher source-level frozen encounter/owner checks and typed outcome trace; character-incarnation detail still enforced downstream by native ownership token. Must regression-test stale actor cases in GTA.
* **GM2:** native RNUI hierarchy, settings/browser-first separation, current quick-page preservation.
* **GM3:** lifecycle controls, explicit adopted-vs-created semantics, verified character name fallback via native owner alias, safe same-actor activity access.
* **GM4:** ACT2–ACT6 closed menu templates and fail-closed native registry/hello/probe gates. ACT6 GTA failure evidence is a release blocker for claiming navigation works, not a reason to fabricate a green check.
* **GM5:** Director manual endpoint and new-result admission polling with queue acknowledgement; speech delivery remains separate.
* **GM6:** scoped automation and this acceptance plan. **Release as GTA-verified is blocked until the above world tests are completed successfully on the exact build.**

**Rollback:** Maintain the prior packaged Essential LSA binary + matching companion configuration for easy restoration. Disable new menu exposure or revert GM feature commits if regressions emerge; do not merge GM7 standalone implementation as an ad hoc workaround.
