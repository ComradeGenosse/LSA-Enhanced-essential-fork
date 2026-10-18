# EA4 + ElevenLabs emotional acting — deployment completion roadmap

Date: 2026-10-11. Source PR: #68, reviewed application-code head `efd434026460b6ee140f2f4814b80815c60a5208`. M1 provenance: PR #52 (`1ca219fd8b95ba2dbf2d1f8031d40fe93308a404`). EA0–EA4 source PRs: #62/#64/#65/#63/#66. PR #60 is an open draft foundation; PR #54 upstream ElevenLabs transport is also open. None of these are assumed merged or GTA-verified.

## Goal and status

Ship a controlled, opt-in ElevenLabs emotional acting feature for Essential without inventing a native witness, player protagonist, save lineage or playback success. EA4 is **wired** on PR #68, but **inactive by design** if M1 confirmed SQLite timeline and verified native protagonist authority are absent. It is incorrect to report live emotional continuity solely because the adapter and tests exist. Baseline `off` and `shadow` may not alter canonical output/provider text; `experimental` modifies only the ElevenLabs speech copy and never history, memory, model input, native commands or stock authorization.

Previous exact-head PR #68 `f6aece4d...` complete Node/native/ABI run #38181229377 succeeded. Subsequent EA4 head needs independent green runs. CI is not GTA evidence.

## Frozen cross-agent contract

1. Native protagonist authority, trusted runtime adapter API:
   - `readVerified()` returns a deeply frozen current record or `null`.
   - `isCurrent(record)` independently checks that *same* native-authenticated stream, host run, world epoch, live player source, continuous revision, signal freshness and replacement/ABA boundaries. A matching JSON object, mutable record, stale cached value or LLM actor metadata is not authentication.
   - Record: `{version:1,source:'native_player_model',protagonist:'franklin'|'michael'|'trevor',hostRunId:<UUID>,worldEpoch:<positive int>,revision:<positive safe int>}`. Protagonist may be `unknown` at sensor input, but must return `null` rather than inventing a known record. Native revision changes on every actual switch, including Franklin→Michael→Franklin, and on any proof revocation. Source must be sampled by trusted native integration on the game fiber and transported only through a source-qualified ordered native channel. Never mint/guess a protagonist or reuse a stale cached record.
   - Native wire payload must preserve producer host/epoch and revision; confirm a bounded freshness/lease strategy and handle disconnect, reconnect, rollover and stream replacement. Avoid extra unauthenticated IPC or renaming an existing native message.
2. M1 timeline authority on the *real* P2 promoted-character storage instance:
   - `store.activeTimelineId` is the genuinely selected approved M1 UUID.
   - `store.timelineWritable === true` and `store.timelineSourceStatus === 'verified'` only while M1 has an explicitly player-confirmed save selection and a current authenticated native source; changes/disconnects revoke before any EA4 operation.
   - Import M1 logic from PR #52, preserving existing JSON profile backups, safe import, SQLite schema and work in other memory PRs. No duplicate fake writable shim, no random timeline UUID, no writing permanent emotion to SQLite.
3. EA4 consumption:
   - `createMoodRuntime({getRuntime,protagonistAuthority})` is the only adapter for the existing `MoodStore`.
   - `readMood({identity,turn})` is soft style only, no evidenceRef; native P1/PS2 owner, Essential turn, save and protagonist rechecked before every use. Current verified danger and current dialogue always outrank old mood.
   - `onSpeechCompleted({identity,turn,delivery,receipt})` is eligible only AFTER accepted native `playback_ended` and `history.acceptPlaybackResult`. Interrupted/cancelled/partial/superseded/disconnected never commit. Multiple early-stream segments must not produce an incorrect final mood or carry it to a different actor.
   - `retireTurn({identity,turn,completed})`: completion preserves one soft next-turn hint; failure clears any consumed hint. Native host/epoch, protagonist, save, owner, bridge and connection changes clear affected state; no stale ABA resurrection. Maximum 128 in-memory entries, ~22-second TTL, no disk.
   - `ephemeral_mood` is a validated soft EA0 source and MUST NOT be re-committed as fresh emotion; cannot create PS2 observations or permanently change personality.
4. TTS: allowlisted provider tags only, experimental-only, bounded by 3,000 characters; canonical dialogue untouched. Values unsupported by the active verified ElevenLabs model must fall back gracefully with explicit fixture/telemetry coverage rather than invented vendor syntax or false claims of audible acting. Provider work/cost requires explicit authorization.

## Parallel agents and file ownership

**Agent A / EA5: Native protagonist proof.** Own `native/intelligence/*` targeted producer/test files; new `lsa-essential-e1-candidate/src/perception/protagonistAuthority.mjs` and `protagonistProtocol.mjs` plus uniquely named EA5 tests and `docs/handoffs/EA5.md`. Deliver producer and standalone adapter; document exact wire frame and subscribe integration seam. Do **not** change `intelligenceClient.mjs`, `bootstrap.mjs`, `essentialGlue.mjs`, `runSequentialTurn.mjs`, `moodRuntime.mjs`, TTS files or config. Review native player-sampling thread, actor/model proof, gameplay/cutscene uncertainty, stream ordering, host revision, bounded lease and ABI.
 
**Agent B / EA6: M1 timeline authority integration.** Own necessary new `src/characters/*` timeline/SQLite integration modules and `lsa-shared-brain/*` source-compatible imports plus EA6 tests and `docs/handoffs/EA6.md`. Read PR #52 and actual PR #68 `CharacterService`, P2 store and M1 bootstrap contract; implement safe staging/migration and the **real** store properties. Do not edit shared `bootstrap.mjs`, `essentialGlue.mjs`, `moodRuntime.mjs`, `intelligenceClient.mjs`, native producer files, or existing memory phase PRs. Declare precisely what integrator must wire for authenticated source and timeline selection; fail disabled until opt-in/approval.

**Agent C / EA7: EA4 correctness and mood semantics.** Own `src/voice/emotion/moodStore.mjs`, `moodRuntime.mjs`, `sceneDelivery.mjs`, `resolveSpeechDelivery.mjs`, `deliveryContract.mjs` and separate EA7 tests/`docs/handoffs/EA7.md`. Work against frozen A/B interfaces and fixtures while dependencies are absent. Audit rejected/missing owner proofs, protagonist ABA, mixed source epochs, native completion, last audible segment selection, double callbacks, reset/clear, timing and cross-actor reuse. Fix real code defects; do not widen proof gates or author native/SQLite/bootstrap/provider code.

**Agent D / EA8: ElevenLabs expressive coverage and safety.** Own `src/voice/emotion/elevenTags.mjs`, `src/providers/elevenlabs/speechProvider.mjs`, its standalone EA8 tests/`docs/handoffs/EA8.md`; work from published/verified ElevenLabs model-specific v4 tag support, no guessed syntax. Cover fearful/concerned current safe fallback, injection, Unicode/budget, silent-to-audible mismatch, off/shadow byte-exact parity, cancellation, early and buffered PCM, no extra billable model calls. Never initiate paid benchmark without explicit approval. Do not edit selector/contracts/glue/config/Luna/native files; specify proposed enum changes to integrator.

**Agent E / EA9: Release, CI and GTA test harness.** Own `.github/workflows/ea-integration.yml`, new uniquely named offline/contract acceptance files, packaging/rollback/test-instructions docs, and `docs/handoffs/EA9.md`. Run or queue exact-head offline Node Windows+Linux, isolated Python, Windows native C#/ABI/PS/ACT and packaging tests. Prepare reproducible GTA shadow→experimental evidence checklist (tag/untagged, per-NPC source ownership, 22-second continuity, Franklin/Michael/Trevor switch, reload/save fork, interruption, cost and latency); tests do NOT invent GTA/ElevenLabs receipts. Do not modify shared runtime, EA4 source, native producer or SQLite logic.

**Agent F / FINAL REVIEW & INTEGRATION.** Start **only after A–E have pushed five PRs and `docs/handoffs/EA5.md`–`EA9.md`**. Create fresh integration branch based on verified PR #68 head, import exact commits, own `src/perception/intelligenceClient.mjs`, `src/bootstrap.mjs`, `src/integration/essentialGlue.mjs`, `src/openai/runSequentialTurn.mjs`, shared provider/config/packaging and conflict resolution. Wire native A and timeline B to real runtime C, preserve D safety, run E's full offline acceptance. Prove the exact latest head, document failure modes, open one final draft integration PR, leave all upstream PRs unmerged, no live deployment without GTA/operator receipts.

All agents MUST independently branch from the exact approved common PR #68 planning HEAD before changing code. Feature agent PRs target that branch, not main. Agent changes may require contract fixture seams; do not modify another agent's owned file. Handoffs enumerate changed files, exact SHA, tests actually executed, failures, unresolved cross-agent contract issues and native/audio acceptance dependencies.

## Phased delivery and gates

**P0 / freeze and intake (no feature coding):** verify exact PR #68 planning head, #52 source state, all config modes, native owner proof and current CI, snapshot backups, code-owner matrix and contract above. Gate: one immutable source commit and documented interfaces.

**P1 / parallel A–E:** native proof, M1 timeline authority, EA4 semantics, TTS coverage, acceptance harness in isolation. Gate: five real code PRs, source tests, independent handoffs. "Implemented" does not imply "working together."

**P2 / F integrator:** reconcile native transport registration and source-qualified stream processing, real M1 store initialization/selection and lifecycle fencing, selected voice configuration, early/final/director speech, EA4 actual read/playback/retire callbacks. Gate: no guessed evidence, off mode remains byte-identical, shadow emits diagnostics without changing speech, all focused and full offline tests pass on exact integration HEAD.

**P3 / local GTA controlled shadow:** separate test installation and rollback. Collect immutable source-qualified receipts from native player identity, current promoted NPC, timeline approval, active protagonist transitions, native playback, mood read/write, interruptions. Test Franklin→Michael→Franklin, reload, fresh saves, connection recycle, different promoted NPCs, 15–30-second age expiry, scene-danger outranking prior mood. Any absent proof is a neutral result and explicitly recorded as failure to meet live EA4 acceptance. No unobserved "passed" claims.

**P4 / experimental voice A/B:** only after P3, explicit authorization for billable ElevenLabs calls, one promoted character, subtle intensity and <=2 tagged segments per turn, Luna delivery V0 initially. Compare tagged/untagged same fixtures, naturalness, actual first-audio/native-audible latency, interruptions, credits/cost, unchanged transcript/histories, unsupported emotions. Roll back on error, source mismatch, cost breach, excessive latency, bad speech. Luna V1 and expressive intensity require separate opt-in/review.

**P5 / staged rollout:** only after P4 metrics and receipt-backed signoff; retain feature flag default `off`, optional shadow and manual experimental switch, rollback package, no stock mode regression, final signoff note with explicit remaining work and provenance.

## Release decision matrix

| Release target | Must be true |
|---|---|
| No-op/off | Same provider bytes/canonical records, no new native side effects, exact-head offline regression green |
| Shadow-only GTA smoke | Above + native/ABI CI green + isolated backup + source logs, no audible changes |
| EA4 experimental GTA | A/B/C fully integrated into actual runtime, M1 native-confirmed timeline, authenticated revocable player protagonist, exact native completion receipt, current native ownership, full offline CI and shadow GTA evidence |
| Emotional acting release | Experimental GTA acceptance + verified ElevenLabs model tags/audio behavior, cost/latency/rollback evidence + upstream dependency disposition + reviewed integration PR |

CI alone never satisfies GTA or vendor-audio acceptance.
