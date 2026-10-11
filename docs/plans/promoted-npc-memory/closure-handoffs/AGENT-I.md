# Agent I — M8 personality, relationships and running jokes closure handoff

**Date:** 2026-10-11  
**Exact source base:** PR #75, `8443a8adec9433626902b46b81bd3e58fc382fb2`  
**Branch:** `feature/memory-close-i-m8-personality-jokes-20261011`  
**Target base:** `integration/memory-completion-h-review-20261011`  
**Exact tested source-and-test implementation SHA (before this handoff-only commit):** `b5c614afe07287aa71fbb32d0c922012664350c5`.  
**Final PR head SHA:** read the immutable `head.sha` displayed by this branch's PR, because a Git commit cannot embed its own final hash in a file it contains. Source and test blob hashes: `be5d188fa856b39a923e2a536c876c31ef2c3468`, `4e63ad8f5b3e07b95512312eea262b6d9142fb5f`.

**Status:** Working standalone interpretation/evaluator and read adapter; **NOT wired to P2/PS4/PS6, NOT deployment-ready**. No main merge, GTA installation, actual native receipt, cloud payment, daemon or local AI model.

## Owned changes

- `lsa-shared-brain/src/memory/m8Interpretation.mjs`: conservative typed interpretation, immutable fact projection, separately labeled opinions, relationship deltas, repeated-source running-joke motifs, archive decay, opt-in proposed cue selector, completed-delivery use ledger evolution, serialized P2 read-port adapter.
- `lsa-shared-brain/tests/memory-m8-closure.test.mjs`: 13 local offline Node tests with positive and adversarial source fixtures.
- This `closure-handoffs/AGENT-I.md`. No edits to the SQL layer, native owner, PS4 renderer, shared bootstrap, integration ports, central config or original editor.

## Exported API (K)

All from `lsa-shared-brain/src/memory/m8Interpretation.mjs`:

1. `evaluateM8({scope,personality,sources,memories,appraisals,suppressedIds,correctedIds,nowUtc,maxBytes})` — synchronous **pure fixture/evaluation** API; no SQL or authority lookup. Bounds: 128 source envelopes, 64 committed memory links, 32 appraisals; 512–8192 UTF-8 byte output, default 4096. This API trusts receipt booleans only because its caller must be trusted P2 code, never direct network/player JSON. Do **not** expose as an untrusted producer.
2. `createM8ReadAdapter({readCommittedSources,readCommittedMemories,readSuppressedIds,readCorrectedIds,readCurationAppraisals,currentScope})`. `await adapter.project({scope,authority,personality,nowUtc,maxBytes})` revalidates verified native run/epoch/observer/owner and writable timeline at start and **after every await**; returns `null` when stale. `authority.nativeVerified===true` and matching `hostRunId,worldEpoch,incarnationId,encounterId,observerCaptureRef` from current P2/native source are required. **K must recheck immediately before PS4 send and retry** as this adapter does not reserve a turn.
3. `selectM8JokeCue({projection,scope,jokeState,cue,nowUtc,optIn,playerActive,combatActive,secondsSincePlayerTurn,lastGlobalCallbackAtUtc,actorIdle})` — returns **only** `m8_joke_candidate` with `requiresDirectorAuthorization:true`. It never grants PS6 speech. Requires opt-in, trusted cue, idle, noncombat, no active player, >=30 seconds since player turn, global 10-minute and per-joke 60-minute cooldown; blocks five uses in two hours and repeated negative reaction.
4. `recordM8JokeUse(previous,{jokeId,completed,sourceVerified,atUtc,reaction})` — deterministic state proposal only; K must call on a native **completed playback** and persist it with P2 CAS, never on a request/proposed turn. Negative reactions require source proof; `unknown` is allowed.

## Mock fixture / P2 source API

`scope`: exact `{characterId,worldProfileId,timelineId,protagonistKey}`; each UUID v4, `protagonistKey` one of `franklin|michael|trevor|unknown`.

`readCommittedSources(scope)` returns an array `[{record,committed:true,sourceVerified:true,sidecarVerified:true}]`. `record` is an actual M2 v1 `dialogue_line` (typed/STT **accepted** or NPC **completed with native playback receipt**) or M3 v1 `journal_event` (**witnessed** PS2 promoted observer with verified per-record native owner proof and persisted source sidecar). `sidecarVerified:true` is mandatory for events and must result from a separate authenticated P2 lookup. Source filtering by `normalizedEvidence` further rejects uncommitted NPC speech, unsupported claims and wrong protagonist; v1 events are **unknown protagonist only**, not guessed Franklin/Michael/Trevor. The booleans cannot themselves establish native authority.

`readCommittedMemories(scope)` returns `[{memoryId,...scope,committed:true,sourceVerified:true,evidenceRecordIds:[...]}]` for committed M5/M6 sources; every frozen source ID must be a currently live, owned, qualified source. Never rederive facts from memory summary text. `readSuppressedIds(scope)` returns the **transitive M5 deletion/tombstone closure**, including suppressed derived memories. `readCorrectedIds(scope)` returns superseded sources (not merely changed display strings). In-process `readCurationAppraisals(scope)` wraps existing M7 P2 `readCurationAppraisals`: one original proposal ID, same immutable source IDs, `epistemicStatus:'character_opinion'`, `verifiedWorldFact:false`, category and notability in range. M8 **does not render free-form Luna `opinion`** because a structurally valid model take can still invent a location/person or inject directives; it only records provenance and keeps deterministic factual bytes. Cloud-OFF works identically.

`currentScope()` must return all scope fields, `timelineWritable:true`, `nativeVerified:true`, and the same run/epoch/owner/observer fields as the original `authority`. An epoch, character, timeline or protagonist change yields `null`. P2 read ports should be served under its own serialized SQLite connection, not a second database/writer.

## Typed E-compatible projection

`{version:1,kind:'m8_typed_projection',...scope,facts,interpretations,jokes,relationship,totalBytes}` where `totalBytes===Buffer.byteLength(JSON.stringify(result),'utf8')`.

- `facts[]`: immutable replay/reference only, `{recordId,sourceKind,mode,content,freshness}` with `mode: exact_quote|observed_fact|reported_claim`. These must **not** become competing factual PS4 claims or a second RecallBundle: E's M4 remains sole factual retrieval authority.
- `interpretations[]`: `{id,kind,epistemicStatus:'character_opinion',verifiedWorldFact:false,about,tone,opinion,confidence,freshness,valence,sourceEvidenceIds,appraisalSource}`. K/E should select a small subset for the existing PS4 SELF/RECALLED budget, always labeled *the character's subjective opinion*; never overwrite canon or source rows.
- `jokes[]`: `{id,motif,epistemicStatus:'character_opinion',verifiedWorldFact:false,opinion,state,confidence,sourceEvidenceIds,freshness,callbackOptInRequired:true}`. Novelty, decay and cooldowns are **admission hints**, not speech entitlements.
- `relationship`: `{epistemicStatus:'character_opinion',verifiedWorldFact:false,dimensions:{trust,affection,familiarity},sourceEvidenceIds,canonRelationshipUnchanged:true}`. Deltas are hints (and bounded); **do not change the user's `relationship.state` or authored personality**.

Personality input must come from user-approved structured profile canon only (humor style/teasing, caution, loyalty, nostalgia, bravado, selected interests). No system derives or approves canon from Luna output.

## Required additive B/K persistence and K-only edits

1. B/K extend the **one P2-owned SQLite file** with a scoped M8 derived-opinion/joke-use ledger (or compatible transactional existing storage), keyed by character/world/timeline/protagonist and evidence IDs. Suggested opaque fields: `interpretation_id,kind,opinion,confidence,source_ids_json,created_at_utc,updated_at_utc`; and `joke_id,motif,source_ids_json,last_used_at_utc,uses_json,negative_reactions,resting,revision`. All rows use P2 serialized transaction, timeline fence and CAS, and are suppressed immediately on M5 correction/trash/purge. Do not create a competing SQLite DB/connection or write canon.
2. B/K provide above committed source, M5 suppression closure, corrected source and M7 appraisal reader ports. They must **revalidate raw native PS2 owner and sidecar** and the actual M2 input/audio receipt; no in-band booleans from user content may spoof `sourceVerified`.
3. K wires the service into the one `knowledgeRenderer.mjs` **after** M4 typed factual recall is admitted, on the same frozen PS4 turn identity, inside existing byte accounting. Revalidate sources and scope at provider send/retry; do not put M8 content in another prompt or promote derived humor to witnessed facts. E can adapt field naming without changing M8 evidence semantics.
4. K optionally connects `selectM8JokeCue` through existing PS6 Director C-06 **native eligibility**. Obtain independently qualified current cue, explicit opt-in, player/mic/typed priority, combat checks and actual cooldown grant. Only then record a successful callback through verified native playback; persist use/reaction state transactionally.
5. Before deployment, test live native owner authority, multiple observers, source deletion race between projection and send, save rollback, editor canon precedence, real GTA physical fountain proof, actual delivery receipt/cue gating, privacy restart, and cross-character soak. **This branch contains none of those integrations.**

## Offline verification evidence

Executed in container with **Node v22.16.0**, no provider/network calls; source and test blobs above match the published implementation:

```sh
cd lsa-shared-brain
node --check src/memory/m8Interpretation.mjs
node --check tests/memory-m8-closure.test.mjs
node --test tests/memory-m8-closure.test.mjs
```

**Result:** 13 tests / 13 passed / 0 failed, local offline fixtures. Includes identical factual events and different takes for three distinct promoted identities; unsupported fountain location remains unknown despite a player utterance; uncommitted/unverified sidecar, reported event and inferred claim refused; tombstone/correction removes joke immediately; protagonist/timeline/world/character fences; Luna injection discarded; OFF no cloud; joke cooldown/player priority; identity swap during await; 128-source and UTF-8 byte caps; archived jokes rest; explicit affinity/embarrassment. Current `tools/memory-sim/scenarios.v0.json` **must not** be marked implemented. Node24/Windows CI, cross-agent real SQLite and native harness were **not** run for this standalone handoff.

## Remaining blockers / honest status

- No live P2 authenticated reader/writer for M8, no installed native source-producer receipt, no E PS4 integration, no real PS6 Director callback path or durable use ledger. All read-port receipts and delivered-use receipts in tests are **mock fixtures**, not GTA acceptance.
- No personally attributed driving/companion presence, Vinewood fountain coordinates or injuries may be inferred from `crash` plus a player line saying `fountain`. Unknown stays unknown; a location fact needs independent source-verified event evidence.
- M7's free-form subjective take is deliberately **not** rendered; safe rich interpretive prose will require a verified semantic grounding contract and E's budgeted controlled rendering. Local deterministic takes are intentionally conservative.
- No PR merge, install, paid Luna request or deployment GO is claimed. Final K acceptance remains **NO-GO** until missing native/P2/PS4/PS6 and cross-agent tests are proven.
