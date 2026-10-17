# Memory K — independent M7 Luna cloud-curation runtime activation

Reconciles PR #200 (M7 runtime curation) and PR #208 (W07 native idle diagnostics) onto current `main` (Memory K #138 is already merged there). Draft; not for automatic merge. **Offline source simulation only: nothing here was validated in GTA, against the native pipe, or against the paid OpenAI API.**

## What this does

Connects the **existing, unmodified** M7 pieces — `lunaCurationBridge.mjs`, `idleCurationScheduler.mjs`, `lunaCurator.mjs`, the consent contract in `m7Consent.mjs` and the P2 SQLite queue/ledger — to the real Essential runtime behind `memory.cloudCuration: "on"`. It adds no scheduler, database, queue or memory engine. The new `m7RuntimeCuration.mjs` only decides *when* the scheduler's one bounded `checkpoint()` may run and supplies the ports the handoffs (`PRODUCTION-W07.md`) required.

| Concern | Wiring |
|---|---|
| Startup | `bootstrap.mjs` builds it after P2 is ready, only when `memory.cloudCuration` is `on`; one unref'd 60 s timer (+10 s startup kick); owned by the runtime scope |
| Recovery | first writable tick settles crash-era `reserved` budget rows at their ceiling (never a refund); expired leases are re-claimable; scheduler reconciles again on its first checkpoint |
| Shutdown / pause | disposal and the learned-memory pause call the scheduler's synchronous `cancel()` (aborts the in-flight `fetch`), then stop it; pause also latches the fenced store |
| Capability | `memory.cloudCuration` is now `conditional` (was `absent`); `memoryKM7Activation()` is off by default and an explicit key does **not** disable legacy foreground memory (same rule as M6) |

## Eligibility gates (all required before any cloud request)

1. `memory.cloudCuration: "on"` (restart required).
2. Supported Luna configuration: provider `openai`, model exactly `gpt-6-luna`, an OpenAI credential, and `memoryK.cloudCuration.pricing` that passes `validateM7ProductionPricing` (official standard tier, official URL, ≥ the reviewed upper-bound rates, verified ≤ 30 days ago). Otherwise the state is `blocked` with a reason code.
3. **Persisted explicit consent** in P2 (`memory_m7_consent`): revisioned, per world, with daily/monthly/per-batch USD caps. Granted or withdrawn only through the privileged inspector (`inspector_control` → `cloud_consent`); a config flag, API key or capability toggle is never consent. Re-read from P2 on every tick and at every awaited boundary inside the scheduler.
4. A confirmed, writable timeline.
5. A **fresh joined idle proof** (`verified_native_idle_v1`, minted by `m7IdleProofSource`), re-checked after every await. See *W07 idle proof* below.
6. No foreground memory activity in the last 30 s.

```json
"memoryK": {
  "capabilities": { "memory.cloudCuration": "on" },
  "cloudCuration": { "pricing": {
    "model": "gpt-6-luna", "source": "operator_verified",
    "verifiedAtUtc": "2026-10-12T00:00:00.000Z",
    "officialPricingUrl": "https://developers.openai.com/api/docs/pricing",
    "pricingTier": "standard",
    "inputUsdPerMillionTokens": 0.20, "outputUsdPerMillionTokens": 0.75 } } }
```

## Independence

* Needs only P2 SQLite. No M2/M3 intake, M4 recall, H1 history, M8 interpretation, or active M6 pass. The tests run with M6, `memory.recall`, `memory.journalContext` and `memory.interpretation` all explicitly off and still curate previously queued jobs.
* M6, when independently on **and** M7 is on, now appends durable jobs to the existing P2 queue (`cloudQueue`); with M7 off M6 behaves exactly as in J-B (queue forbidden). M6 never contacts the cloud.

## Interruption, staleness and privacy

* Cancel triggers: native producer invalidation, a turn starting (`bindM2Turn` / `prepareLiveTurnMemory`), a changed host run/world epoch or world boundary, learned-memory pause, any consent change, shutdown.
* Claim, budget reserve and completion carry the approval id/revision **into their SQLite transaction** (`expectedConsent`): a withdrawal or newer revision that committed first makes the late operation fail, so a stale result cannot commit. Source forgetting/correction is rechecked in the same transaction (unchanged), and forgotten sources are dead-lettered before upload.
* One NPC per request (unchanged), bound to the NPC in the native proof. Diagnostics are content-free: counters and reason codes, never memory text, ids or credentials.
* Retry/backoff (including provider `Retry-After`), dead letters, idempotent job ids and conservative accounting are the existing engine's. A transport that started is charged at the full reserved ceiling even when cancelled, failed or timed out; a lower amount is settled only from reported token usage and the pinned prices.
* Withdrawal is never gated on timeline/host state. Withdrawn or never-granted consent produces zero network requests.

## Diagnostics

`runtime.services.memoryCloudCurationDiagnostics()` (also in `memoryKRuntimeDiagnostics()` and the inspector): `state` ∈ `stopped | paused | starting | awaiting_consent | blocked | idle | processing`, a `reason`, `running`, consent state/revision, budget limits and spend, queue counters (pending/leased/completed/dead-letter/due), curated count, last checkpoint, last error code, and whether a native idle source is registered.

## Tests

`lsa-essential-e1-candidate/tests/memory-m7-runtime-curation.test.mjs` (13 tests; real `createRuntimeForBundle`, real SQLite, fake fetch, fake authenticated native source, controllable clock) plus three additions to `lsa-shared-brain/tests/memory-m7-completion.test.mjs` for persisted consent and the atomic fence. Registered in `tools/memory-k-verification/registrations/k-m7-runtime-curation.json`; CI in `.github/workflows/memory-k-m7-runtime-curation.yml`. Two existing assertions changed because M7 is no longer `absent` and M6+M7 now reports `queueing`.

## W07 idle proof (what makes `verified_native_idle_v1` real)

`m7IdleProofSource.mjs` is the only producer of the proof. It never accepts one; a proof object is authentic only if this module minted it and its streak is still unbroken (`verifyAuthenticatedSource`). It joins two independent sources and mints nothing unless both agree continuously:

* **Native** (#208): the authenticated C-13 `memory_m7_idle_diagnostic` stream, one exact owned NPC + the local player, 21 C-06 negatives (owner mode, mic, conversation, text, controls, script, reflex, queued playback). Still `nativeVerified:false` on the wire; the four global turn fields are hard-false there.
* **Backend**: the ORIGINAL Essential turn stores via `OriginalEssentialTurnTimeline` (mic, active/buffered capture, player/conversation context, session opens, live turns, output owners, recoveries). The four fields `playerTurnSourceCurrent`, `playerTurnIdle`, `essentialTurnKnown`, `essentialTurnIdle` are derived only from this read-only sample.

Rules: three or more native samples spanning at least 1.6 s with the same stream, host run, world epoch, observer, incarnation and encounter; the backend timeline revision unchanged over the whole streak (every stock turn entrypoint advances it and also notifies the source synchronously); the game clock advancing with real time; no Director backend lease or reserved speech; the observer mapped to a P2 character by the authenticated native owner ledger (not M3); P2 host context equal to the native host. Any native negative, gap over 2.5 s, identity or host change, backend activity, world boundary or retired source drops the streak and aborts in-flight cloud work immediately; a watchdog does the same if native samples stop while a request is in flight. PS3 tickets/receipts, silence, timers, UI flags and caller-supplied `nativeVerified` never contribute.

`anchors`/`observer_index` re-sends no longer retire the native sample (native re-sends the index every second); the source re-verifies the exact observer on every sample instead.

Wiring: `bootstrap.mjs` registers the source (`runtime.m7IdleSource`) only when `memory.cloudCuration` is `on`. It does not depend on M3, M4, H1, M6 or M8. Diagnostics expose a content-free `idleProof` reason code.

**Not yet proven in GTA:** that the pinned game actually produces quiet 1 Hz native samples while idle, that the backend stores and revision behave as modelled under real STT/typed/Director traffic, and the 2.5 s/1.6 s thresholds. Until a controlled GTA run confirms these, treat live M7 as unvalidated: it still requires `memory.cloudCuration: "on"`, persisted explicit consent and verified Luna pricing, so nothing bills by default.

## Not validated (needs GTA / real services)

Native diagnostic cadence, backend revision behaviour and the joined idle proof under real traffic; real OpenAI Luna calls, pricing and invoice reconciliation; consent UX in the live inspector; save/load epoch transitions; multi-NPC soak; latency impact on live turns.
