# Memory K — historical gate reconciliation for PRs #97, #110 and #113

**2026-10-13 · Documentation-only traceability audit · NOT a production acceptance report**

## Scope and provenance

Reviewed against Memory K umbrella [PR #138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138), pinned HEAD `5dc781203da64ad48109b7c9b60794bbc4a8a0e2`. The original 12 artifacts from [#97](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/97), [#110](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/110) and [#113](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/113) are preserved **byte-for-byte** under `docs/plans/promoted-npc-memory/archive/pr-{97,110,113}-202610{11,12}/` (see individual READMEs and source blob hashes), committed as `5dc7812`.

Historical files include plans, manifests, validators, workflows and a read-only .NET Core IL research instrument. Relocating archived workflows under `docs/` intentionally makes them **inactive**. Moving the research .NET project and validator scripts also changes their working paths; these archived copies are retrievable provenance, not live build/test steps.

**Acceptance authorities for new engineering:** `docs/research/DECISIONS.md` (D-021, D-022, D-023), `docs/plans/promoted-npc-memory/approved-decisions.md`, original `architecture-study-20261011.md`, the living `MEMORY-K-PRODUCTION-IMPLEMENTATION-PLAN-20261012.md`, independent `MEMORY-K-INDEPENDENT-AUDIT-20261012.md`, and required exact-head evidence. Historical PR #97 or #113 **cannot silently override explicitly settled decisions**.

## Critical architecture reconciliations

1. **Accepted player input — original Core versus runtime commit.** #97 A01 and #113 A01a originally demanded a final post-acceptance event in the pinned native/original Essential Core or its original backend. The original Core IL audit in #110 showed only submission methods, not that accepted event. **D-022 explicitly supersedes #97's escalated acceptance invariant:** for the **OpenAI** runtime the accepted bytes are committed by `runSequentialTurn.mjs`'s `DialogueHistory.commitPlayerInput` after source-currency checks; `openaiRuntimeAcceptedInput.mjs` privately issues/validates the one-shot accepted-line receipt using original session/turn facts and actor ledger. A separate authenticated D02 current-owner/player proof and commit-time P2 fences are still required. Earlier submit, mic stop, transcript fragments or inferred successful provider output never suffice. **The pinned stock Gemini path remains denial-only**; do not mislabel a backend/runtime receipt as an original-native acceptance attestation. The remaining real D02/P2/source tests stay hard gates.
2. **Witness attribution — mandatory separate source-time ledger versus observation-time join.** #97 A02/G03 demanded a distinct native source-time owner ledger as a mandatory prerequisite. **D-023** authorizes the synchronous, verified PS2 accepted-observation join with native/current owner context, source `hostRunId`/`worldEpoch`, incarnation and encounter. A separate native source-time ledger is optional corroboration, not automatically required. Certified negative coverage, pre-promotion proofs and no-fabrication tests **are not waived**.
3. **Shared human identity.** #113 A01d is governed by **D-021**: one human across Franklin, Michael, Trevor and freemode avatars; avatar remains immutable provenance and NPC/world/timeline boundaries stay strong. Its original identity goal remains tracked and adversarial tests remain necessary.
4. **Source versus release status.** The exact #138 files include an OpenAI commit-decision acceptance implementation, while older `closure-handoffs/PRODUCTION-K-FINAL-SOURCE-CLOSURE.md` still describes an earlier denial-only original backend probe and an inert binder. That handoff is a dated receipt, **not an assertion about the current OpenAI path**. Re-run integrated production tests on the exact new HEAD before declaring acceptance; the stock Gemini denial remains true. Do not infer production readiness from D-022 being settled.
5. **Research and validators are retained, not silently abandoned.** #110's read-only `CoreC01Audit.csproj`/`Program.cs` and callgraph evidence remain archived for revisiting stock Core/Gemini, but **a native post-acceptance callback is no longer a prerequisite for the separately decided OpenAI D-022 path**. #97/#113 archived gate validators remain as historical snapshots; their specific old status flags are not current pass/fail receipts.

## Original #97 A00–A11 gate crosswalk

The following are **tracking mappings, not passing gates**. Old gate IDs remain searchable here and within the exact archived manifest.

| Historic gate | Required result | Current owning decision/workstream / source of truth | 2026-10-13 review disposition |
|---|---|---|---|
| A00 / W00 | Exact pinned source and ABI inventory | WS-1 native/packaging gate; WS-R audit; living plan §3–§4 | Still must be verified on final HEAD |
| A01 / W01 | Accepted player bytes plus real owner/player | D-022 OpenAI commit decision; WS-5a and WS-5c D02; D-021 scope | **Core-only issuance superseded**; native/P2 join remains required |
| A02 / W02 | Witnessing, negatives, prepromotion | D-023; WS-5b and WS-5c; K-03d/e, K-13, K-21 | Source-time ledger mandate superseded; source-backed coverage still open |
| A03 / W03 | Exact accepted player and audibly committed NPC speech | WS-5a; K-03c and DV-6; source-bound runner/PCM receipts | Positive runner/native proof still required |
| A04 / W04 | Commands, clarifications, privacy | WS-4a and WS-10; K-05–K-07, K-12; held #104 | Adversarial durable verification still required |
| A05 / W05 | One current, bounded PS4 M4+M8 frame | WS-6a, WS-7b; K-02, K-18 | Original runner integration still required |
| A06 / W06 | Replay cursor, atomic P2 proposals/queue, durable restart | WS-7a/WS-4a; held #100; W09 source replay tests | Full transaction and recovery acceptance still required |
| A07 / W07 | Native idle, consented Luna, durable cost budget | WS-7a; decision O-1 and held #99 | Consent/budget/security and recovery tests remain |
| A08 / W08 | Authenticated M9, PS2 and original PS6 Director | WS-7c with WS-5b; K-18 | Original callback/admission/priority source evidence still required |
| A09 / W09 | Exact Node24 2 OS, real net481 native, pinned package | WS-1 plus final WS-9; K-01/K-08/K-22; native SDK B-4 | Final exact-head native/package acceptance **not shown** |
| A10 / W09 | Original S01–S10 runner and persistent P2, unforgeable receipts | WS-9, K-19; `tools/memory-sim/closure-acceptance-replay.mjs` | **0/10 proven here; NO-GO** |
| A11 / W10 | Independent source/offline/physical decision | Living plan §6/§9; WS-R; external controlled-GTA authorization | **NO-GO**, no physical receipts |

## Original #113 A01a–A11 revised gate crosswalk

| Historic gate | Owner / requirement | Current reconciliation |
|---|---|---|
| A01a (D01) | Original backend final typed/STT receipt | For OpenAI, **D-022** explicitly substitutes source-owned runtime `commitPlayerInput` decision; earlier stock-native/stock-Gemini source requirement no longer mandatory. Verify the actual original registry/actor ledger and complete STT bytes; stock Gemini stays disabled. |
| A01b (D02) | Authenticated current native controlled player and promoted owner | **Still required**, WS-5a/WS-5c and K-21. Native owner recovery/lease tests (#141/#142) are separate, unmerged repair work. |
| A01c (D03) | Correctly scoped dual-origin/accepted-line to atomic P2 readback | **Still required**, WS-5a/K-03 and transactional/negative tests. A model-side/text-only assertion cannot pass. |
| A01d (D03) | Same human across avatars with NPC isolation | **Still required**, D-021 with WS-4a/WS-6a/WS-7a, cross-avatar tests; not a reason to collapse native source attribution. |
| A09a (D05) | Original AST/package and main net481 build with actual reference provenance | **Still required**, WS-1 and native SDK external gate. Policy harness success does not pass it. |
| A09b (D05) | Node24 Win/Linux and M9 genuine native policy/source | **Still required**, WS-1, WS-7c and WS-9. |
| A10 (D04) | All S01–S10 anti-forgery original-runner+P2 scenarios | **Still required**, WS-9. Fixture-only/source-simulation does not pass. |
| A11 (D07) | SHA-pinned final evidence and separately authorized controlled GTA | **Still required**, living plan §6/§9; NO-GO. |

**D06** (test-authority, rollback/privacy and cross-avatar adversarial work) is tracked under WS-4a, WS-4b, WS-5a–c and WS-9, as well as K-05–K-08, K-14 and K-19. **D07** is the final integration/release assessment, not a license to deploy.

## Administrative PR disposition and open engineering work

At the verified heads:
- **#97:** historical W00–W10 plan and machine-readable contract preserved (4 exact blobs). **Safe to close administratively as archived/superseded**, provided closure comment cites D-022/D-023 and this gate crosswalk, rather than pretending A01 was proven.
- **#110:** research-only pinned Core IL audit preserved (4 exact blobs). **Safe to close administratively as completed historical investigation**, with the explicit result **no original native post-acceptance callback proved**; preserved for later stock Core work.
- **#113:** proposed D01–D07 dual-source closeout preserved (4 exact blobs). **Safe to close administratively as historical proposal**, because current requirements, D-022 changes and blocked gate work are mapped above. No acceptance pass claimed.

**None of the three PRs has been merged or closed by this reconciliation.** They may be closed without deleting their source branches or changing product code. Keep real implementation/recovery and negative-acceptance repair branches (#99/#100/#104/#117/#130 and #139–#143) open for independent review, unless their work is separately verified on a new exact HEAD.

**Final verdict on this review:** administrative archival is safe; **Memory K is still NO-GO for a main merge, paid provider activation or GTA deployment** based on available verification. No Node/Windows/native/GTA acceptance tests were run for this document.
