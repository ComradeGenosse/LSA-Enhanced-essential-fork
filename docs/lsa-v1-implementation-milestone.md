# Playable LSA v1.0 implementation milestone

Updated October 9, 2026. User-authorized scope revision for the active implementation branch `feature/unified-intelligence-implementation-20261008`. This boundary replaces the earlier objective to implement every master-plan phase. Existing completed work is retained. The master plan remains the technical specification; phase numbers and C-01–C-15 are unchanged.

## October 11, 2026 — merged experimental checkpoint (supersedes checkpoint-60 status)

[PR #23](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/23) merged this **bounded Phase 6 + baseline PS4 + Phase 13a implementation** to `main` on October 10 as an *experimental playable baseline*, not a completed v1.0 release. One real player-requested PS4→Luna gunfire knowledge exchange was confirmed in GTA with speech/playback, but the full 81-requirement audit and all Phase 6/GTA scenarios were not closed. Subsequent [#27–#30](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/30), [#31](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/31) and [#33](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/33) merged observer/ack/Director ticket, native playback lifecycle, grounded event text and post-playback grant-consumption fixes. Those merges require a fresh matching-binary GTA acceptance pass; do not infer final contextual spontaneous speech from one prior trace.

[#34](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/34) added an opt-in **12 attempts/minute testing** preset, independently enforced in companion and native, with normal behavior retaining **4 attempts/minute**. See [activation and default-off requirements](ps6-testing-chatter-preset.md). This does not waive owner, player-priority, entitlement or playback gates.

**Next work is evidence-led validation of the merged code** (exact installed DLL + companion, PS4 repeated qualified witness knowledge, Phase 6 receipts, Director contextual native start/end and original grant acknowledgment), not a fresh implementation of the already merged Phase 13a scaffolding. Conditional gaze remains optional. [Radio #32](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/32) and [ballistics #35](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/35) remain unmerged drafts; other master-plan phases are deferred.

The October 9 text below records the **original implementation specification and checkpoint-60 evidence**. Its earlier phrases such as “not implemented” describe that checkpoint only. The [roadmap](ROADMAP.md) is authoritative for current source/merge/deployment/acceptance status.

## Active objective and stopping boundary

Finish Phase 6 (C-05 receipts, qualified ACT SELF facts and truthful C-06 ownership), close baseline PS4 automated acceptance against PR #21, then implement Phase 13a bounded observer-grounded spontaneous speech through Essential's existing turn/playback pipeline. Complete matching builds and automated regression, map every included requirement to evidence, document unresolved external GTA acceptance gates, and stop. Add Phase 10a only if evidence establishes that Essential's existing speaking/engagement gaze is insufficient and the supplemental mechanism is safe. An unperformed probe does not establish insufficiency.

Implementation completion and playable release acceptance are separate. External GTA gates may remain documented at the implementation stopping boundary; the milestone must not be called GTA-accepted, installed or enabled without those receipts. No new deployment/configuration activation is authorized by this scope revision. Active controls remain off until their existing capability-specific gates pass.

## Execution order and current evidence

| Order | Included work | Current state / closure requirement |
| --- | --- | --- |
| 1 | Phase 6 C-05/C-06 and ACT self-knowledge | **Merged experimentally in #23.** Historical checkpoints 51–60 laid groundwork; external native callback/physical owner-admission and full GTA gates still need case-specific evidence. |
| 2 | Baseline PS4 acceptance, phases 1–5 | **Merged experimental PS4 in #23.** One source-qualified gunfire→Luna spoken GTA exchange confirmed; #27/#28/#30 address observed continuity/ack/hydration faults. T01–T81 and G0–G8 must still be individually tracked without inferring universal acceptance. |
| 3 | Phase 13a / MP13a | **Merged guarded Director/PS6 speech baseline via #23**, followed by #29–#31 and #33 fixes. Native playback start/completion was observed before the last fixes, but post-fix contextual speech and original entitlement consumption still need exact-payload GTA confirmation. No PS5 dependency. |
| Conditional | Phase 10a / MP10a | First verify the pinned Essential playback/look behavior and document the on-foot GTA probe. If existing behavior supplies adequate gaze, retain it and add no CGE loop. If insufficiency is established, implement only the existing finite head/eye playback supplement with exact-key ownership/yield gates. An unknown result leaves supplementation deferred. |
| Stop | Milestone closeout | Fresh automated validation and build evidence, requirement-to-test mapping, rollback/default-off instructions and external GTA checklist. Stop implementation here; do not advance to another master phase. |

The **remaining baseline PS4 acceptance work** remains an immediate priority. Phase 6 physical owner/receipt gates and exact payload verification still precede full Phase 13a acceptance or broader activation; the source implementation itself is already merged experimentally. Offline implementation can proceed with physical gates explicitly open, but it cannot silently turn them into passed capability receipts.

## Phase 13a implementation requirements

Use one deterministic selection function inside the bounded Director shell; reuse observer-qualified PS2 observations and their original paired PS3 `response:eligible` decisions. Start with explicitly owned, current supported speakers and a supported player listener. Existing P2 v1 canon/manual memory remains available through PS4. No promotion, actor substitution, global event scan, new store, direct provider invocation or automatic durable write.

Preserve **normal-mode defaults**: one global in-flight PS6 turn and one scene speech reservation; four attempted starts per minute including failures; routine/urgent speaker cooldowns 20/5 seconds; eight-second scene gap; one response per incident/observer plus one supported material escalation. An independent opt-in experimental 12/minute preset was subsequently merged in #34 and must not be confused with these normal limits. Immediate-warning/routine candidate TTLs are 2/10 seconds; pre-admission tickets are bounded at 32 with two-second expiry. Selection cannot reset these bounds, upgrade a grant, renew stale evidence or redirect failed work to another NPC.

Extend the existing PS pipe with separately versioned closed request/response frames and owner-fiber dispatch. Native admission must validate current C-02/C-13 speaker/listener, owner incarnation/proof revision, truthful C-06 safety/ownership and player-turn/policy version. Consume a ticket UUID once; use `ps:<ticketUUID>` dedupe. Submit through the existing Essential scheduler with zero delay, no interruption, cancel-on-player, skip-if-busy and `FaceListener=false`. Map admission to the actual full Essential turn/generation tuple; do not invent it or recover identity from the latest target.

Revalidate original evidence, entitlement, expiry, identity and safety before admission, after asynchronous hydration/preparation and before publication. Provider decisions for this source must contain no DO command or activity proposal. Enforce rejection in actual strict/segment validators and pinned dispatch before side effects, preserving other stock special events and E1–E6 behavior. No physical proposal, P2 control, reflex or whole-body facing is in v1.0.

Only matching successful complete native playback acknowledges `ps6_ticket:delivered`. Reservation, reasoning success, partial audio and PS4 context delivery cannot consume the response grant. Player takeover, cancellation, missing/late playback, actor retirement or host reset cancel exact work, release reservations and back off. Failed speech cannot append assistant history or revive old warnings. PS4 and PS5 acknowledgements remain independent.

Required automated coverage remains U50–U54/U65–U68/U73–U76 and applicable U37/U39/U40: alternative local selector fakes through the same shell; bounds/failure pressure; stale/reused body and transport epochs; original freeze through proof awaits; player takeover at each boundary; one-shot tickets and exact tuple mapping; all provider output paths rejecting effects; exact full-playback consumption; zero automatic memory writes and no PS5 import dependency; shadow has zero turn submissions/model calls/native effects. Native and companion validators must agree.

## External GTA acceptance gates

| Gate | Required controlled evidence | Release consequence |
| --- | --- | --- |
| Baseline MP1–MP5 / PR21 G7 | Relevant PR21 GTA01–GTA19 baseline cases and master A01–A12/A25/A26: real actor-qualified knowledge in intercepted Luna requests and useful spoken exchanges; typed/mic/stream/early-TTS and requested-turn lifecycle preserved; scope/reset/history-pressure and shadow guarantees. Extension-only cases remain explicitly deferred. | Baseline PS4 active acceptance for the exact tested payload only. |
| Phase 6 MP6 / applicable G8 | A13–A15; applicable Q1/F1/K1/R1/FR1 and ACT1 Q2/PT1/X1/M1. Ordinary and owned publication→before/executed callback association, failed/ambiguous/overlapping/late callbacks, interrupted history, residual follow/wait/sit ownership, body recreation/reset and qualified SELF facts. | Accept only individually proven contributors/capabilities. Handler acceptance never certifies arrival/completion. |
| Phase 13a MP13a | A33/A34/A39/A40 with Profile v1 and PS5/hearing/radio/CGE off: one relevant short spontaneous comment while quiet; no invented hearing/cause/recognition; urgent expiry, failed provider, busy/reflex/foreign owner and player takeover veto; rate/scene bounds; exact full-playback entitlement consumption and no physical command/memory write. | Enable speech-only initiative only after the native intake/ownership/full-playback gates pass for the tested payload. |
| Conditional gaze | Observe stock Essential gaze during actual on-foot playback, movement, active Essential look and reflex/combat. If a supplement is justified, MP10a/A23/A24/A41/A42 must prove exact-key lifetime, finite expiry, old terminal isolation and Essential yield without C-01. | Adequate stock behavior requires no new implementation. Unknown/unsafe supplement stays off. No player-listening/vehicle gaze permission. |

Capture source commit, exact payload hash, mode/config, game session, scenario outcome and bounded evidence hash using the existing acceptance-record process. Do not create a successful validation receipt from an offline test or configuration probe list. Keep installed/enabled/physically accepted states distinct from branch implementation/build status.

## Deferred scope

Defer Phase 7 radio, Phase 8 C-01 capture, Phase 9 proximity/NPC hearing, Phase 10b listening/advanced gaze, Phase 11 P2 migration/timelines/PS5 automatic memory, Phase 12 ACT3/4/5, Phase 13b memory-informed autonomy, Phase 14 social routing/DI/commitments and Phase 15 PS8/ACT6/general E7 expansion. Preserve their plans and existing code. No d1, local model, inference infrastructure, new model-specific phase or replacement architecture.

Standalone C-09 F11 diagnostics presentation is deferred from the checkpoint-60 next-work queue. Existing C-09 runtime gates/read model remain intact; add only diagnostics strictly necessary to validate the included milestone. A broad diagnostics UI is not a prerequisite for spontaneous speech.

## Validation baseline and next concrete work

At checkpoint 60 (`66ad4f7`), the complete isolated normal-Node offline suite passed 644 assertions across 63 files; the matching companion build passed with 54 stock seams. Recent native suites: ACT 263, RuntimeEntry 154 and P2 lifecycle 118 assertions; Windows C-05 interoperability reports 49 checks. These are prior evidence, not fresh milestone completion. The aggregate-process Node crash remains an open tooling limitation; retain normal-Node isolated regression and report it accurately.

At the historical checkpoint-60 baseline, the next work was remaining Phase 6 ordering/ownership validation and the PS4 audit before wiring Phase 13a. **As of October 11, Phase 13a code is already merged experimentally; the current next step is acceptance/reconciliation of that implementation.** Preserve the original PR #21 plan unchanged. Record each milestone checkpoint in `unified-intelligence-implementation-status.md`; stop once the included implementation/build/automated obligations are satisfied and external GTA gates are documented.

Checkpoint 62 closes the additional synthetic cross-process world-reset/held-callback and overflow-before-drain fixtures: 66 pipe checks, 263 native ACT assertions and full isolated offline regression 644/63 passed. Production ActivityCommands already refreshes hello/flushes on world reset; the test helper was aligned to that sequence. Actual Essential callback/body-resolution and physical owner admission remain external gates. Next: native C-06 owner/admission and baseline PS4 requirement audit, then Phase 13a.

Baseline PS4 audit now has an [81-requirement/nine-gate register](ps4-v1-acceptance-audit.md). Candidate links are not acceptance proof; compound oracle review and external physical gates remain explicit. Checkpoint 64 adds actual overlapping ordinary-actor request isolation and raises complete normal-Node offline regression to 645 assertions across 63 files.
