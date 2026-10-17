# EA-H Independent Completion Audit — One Human Player Across Three Avatars

Date: 2026-10-12. Source/CI audit for branch-local H behavior only; **not GTA deployment approval**.

## Exact provenance and isolation

- Original delivered specialist PR [#107](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/107), `feature/ea-final-h-unified-player-emotions-20261011`, observed head `5d83aada2c3811ea1e5bd23ad3729b2860d8afb2`.
- Separate repair PR [#109](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/109) targets that H feature branch, never G, PR #96 or main.
- Protected EA base PR #96 SHA `b1a9b01b72c406706bb640daacbe30a56efd6d4e`.
- Pre-report repair source commits: `b4f0b17a672376798f7e311ecb8783ae37e6bd21`, `4738c1cc5da72013ed3d409a34bec04b8314b764`, `657a40ecbb44b95fde2036267cd56e041316a03b`. This report adds docs only.

## Interrogated runtime path

Production native opt-in `intelligence.protagonistEvidence:'negotiated_v1'` in RuntimeEntry -> IntelligenceIntegration constructor (default disabled) -> existing SID-ACL duplex IntelligenceChannel -> authenticated and current `protagonist_capability` receiver declaration for exact host/epoch/stream -> native owner-fiber GTA model read -> ordered `protagonist_model` -> IntelligenceClient admitted native frame -> ProtagonistAuthority live 1500-ms source lease -> existing Essential live read-only facade -> EA4 mood runtime and native/history-accepted speech receipt.

The current model (Franklin/Michael/Trevor) is only source evidence; not a distinct NPC relationship identity. No new IPC channel or forced-on native constructor.

## Confirmed unfinished work repaired

1. **FAIL -> PASS, syntax corruption:** Original H `moodRuntime.mjs` and `moodStore.mjs` had raw literal backslash-n tokens between JavaScript statements/comments, breaking module parsing. Converted only the invalid raw sequences to real line breaks; did not alter escaped newline strings in IPC tests.
2. **FAIL -> PASS, misleading lineage:** Despite H's intention, `moodRuntime.mjs` still computed `[timeline,host,world,protagonist,revision]` and flushed mood across model changes. Corrected to `[timeline,host,world]`, preserving native revision separately as ephemeral proof.
3. **FAIL -> PASS, temporary native uncertainty:** `current()` cleared the mood when the native record was absent or no longer current, contrary to the authored temporary-unknown case. When independently validated timeline/host/NPC ownership remain valid, these cases now **suspend** acting without extending TTL or authorizing playback. Malformed proof, genuine owner/timeline/world changes still reject/clear. A per-turn WeakMap pins the original immutable native proof and defeats stale Franklin->Michael->Franklin ABA completion.
4. **NOT TESTED -> PASS, independent CI:** Added `.github/workflows/ea-h-unified-player.yml` to execute actual H/EA4/EA5/EA7/EA8/F tests on Node24 Windows and Ubuntu. Extended the existing EA9 workflow so repair-branch push and H feature-targeted PRs can be inspected.

## Executed tests and evidence

Source SHA `657a40ecbb44b95fde2036267cd56e041316a03b`, [focused run 38243646054](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38243646054):

- **Windows Node24: PASS, 81/81 tests**.
- **Ubuntu Node24: PASS, 81/81 tests**.
- Includes all model transitions, short soft mood carry, source suspension/revalidation, ABA/stale old-turn rejection, NPC owner isolation, TTL and one-follow-up, authenticated C-13 companion capability mock pipe, EA-F actual ElevenLabs provider fake-socket receipts and off/shadow regressions.
- [EA0–EA9 full/native run 38243646031](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38243646031): **production pinned native / ABI / ACT / PS / C-05 / EA5 job PASS**; Node22 legacy JSON Ubuntu + Windows jobs PASS. Node24 full EA9 matrix FAILED on unrelated EA9 isolated-deployment/rollback test: Linux `release_root_required`; Windows `target_alias_or_symlink_forbidden`, plus Windows rollout assertions. These failures remain uncorrected and cannot count as a full offline acceptance pass.
- No actual GTA sensor capture, installed artifact seal/rollback, native audible listener measurement or paid ElevenLabs A/B was performed.

## Acceptance inventory

| Area | Outcome | Notes |
| --- | --- | --- |
| Three story models, one ephemeral NPC relationship/emotion subject | PASS (source + focused tests) | MoodStore key excludes model; current record still validated |
| Valid cross-avatar mood carry, TTL, one follow-up | PASS (offline) | EA4/EA7/H and mood store |
| Unknown/native loss suspends safely | PASS (offline) | EA4 regression passed after second repair |
| Stale old-turn/ABA proof and playback rejected | PASS (offline) | Immutable native proof WeakMap + tests |
| Invalid save/host/NPC owner blocks acting | PASS (offline) | Existing source/owner fences retained |
| Real native opt-in, receiver compatibility gate | PASS (source + Windows compiled binary and companion fixture) | Physical GTA handshake NOT RUN |
| Node24 targeted suites on both platforms | PASS | 81/81 per OS |
| Node22 JSON + pinned C# native job | PASS | EA9 run above |
| Entire EA9 offline matrix | FAIL (upstream deployment harness) | Isolated-deploy path errors separate from H |
| Durable memory across avatars in v4 SQL | **BLOCKED (G/Memory K cross-system contract)** | H deliberately never edited P2 SQL, see G audit |
| Physical GTA gameplay/latency/billing | NOT TESTED | Separate explicit acceptance |

## Cross-branch and follow-up

Agent G and Memory K still use model-qualified `protagonist_key` for some durable replay/recall and permanent-memory access. H's success does NOT prove Franklin-created permanent memory can be recalled while controlling Michael. Do not call the user's entire one-human memory requirement complete until Final Integration Agent I reconciles a canonical player-subject contract safely.

Final Integration Agent I must combine the reviewed G/H source without changing native source authenticity, fix EA9 isolated-deploy tests, run the exact combined-head matrix, verify source-verified P2 timeline with H model proof, seal/rollback an isolated game artifact, then perform physical GTA + optional approved vendor audio acceptance.

**H branch-local emotional/native verification readiness: YES for draft G+H integration.**
**Full unified permanent-memory readiness: NO (external G/Memory K integration).**
**Experimental/production GTA readiness: NO.**

No edits to G/PR #96/main, no installed GTA saves or database changes, no paid calls.
