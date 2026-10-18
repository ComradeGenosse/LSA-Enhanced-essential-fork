# Memory K J-B — M6 deterministic retention runtime activation

Base: #138 head `f54f66332`. Draft targeting `integration/memory-k-production-20261012`, not `main`. Not for automatic merge.

## What this does

Connects the **existing, unmodified** M6 coordinator, P2 replay adapter and replay cursor (proved independently in #183 / J-A) to the real Essential runtime. It adds no memory system, database or scheduler engine. The only new source file, `m6RuntimeRetention.mjs`, decides *when* the coordinator's three existing hooks run.

| Trigger | Hook | Wiring |
|---|---|---|
| Startup / reload recovery | `recover` | first tick after the timeline becomes writable in a run (and after any writable transition) replays every promoted NPC from its durable cursor |
| Scene ending | `onSceneClose` | native session detach of a promoted NPC that committed durable lines; deferred with `setImmediate`, error-isolated |
| Idle | `onIdle` | one unref'd 60 s interval (plus a 5 s startup kick) over NPCs with pending evidence, including independently verified M3 event commits; only when no foreground memory activity for 90 s |

Qualifying conversations are retained by the coordinator's deterministic scoring, with no "remember this" command. Command-driven M5 memories are unchanged.

## Activation and independence

* **Default off.** Only `memoryK.capabilities['memory.deterministic']='on'` constructs M6; an absent/empty map keeps it off. An explicit map containing **only** `memory.deterministic` preserves the existing legacy dialogue, M3/PS, WS6 recall and M5 consumers; adding any other capability key opts into the normal strict independent-capability behavior (unspecified siblings off). Policy alone does not prove operation.
* **M7/Luna stays disabled and independent.** The coordinator runs with `cloudQueueEnabled:false`, its store view throws on `enqueueCurationJob`, and a test asserts zero `memory_curation_jobs` rows. `memory.cloudCuration` remains unavailable.
* **M6 needs no M2/M3 capture capability.** It reads committed durable evidence only, as the policy already declared.

## Foreground safety

* No M6 work on the turn or detach path. Turn start/preparation only stamps a timestamp; durable lines only mark the NPC pending.
* Idle/recovery do nothing within 90 s of foreground activity, re-check before each NPC, yield to the event loop between NPCs, and use small bounded scans (100/page, 400 rows, 4 pages per run; backlog resumes after the durable cursor).
* Passes are serialized; the coordinator's per-scope queue and P2 cursor CAS remain the authority.
* Failure streaks are tracked per promoted NPC; after five failures the failing scope is quarantined until restart, while healthy NPCs continue. Diagnostics report `degraded` and the count of degraded scopes.

## Privacy and restart

Reuses the learned-memory pause fence (the store is the same fenced view as other optional consumers), coordinator suppression/correction checks, and the P2 forgotten-source stub fix from #183. Pause stops all work. Because evidence and cursor live in P2 SQLite, an unprocessed backlog after a crash or restart is simply replayed (idempotent proposals, `inserted:false` on replay). Retained memories are ordinary permanent memories, so existing M4 recall reads them after restart.

## Tests

`lsa-essential-e1-candidate/tests/memory-m6-runtime-retention.test.mjs` (real `createRuntimeForBundle`, real SQLite, controllable clock/timers): default-off and M7 independence; startup recovery without commands, restart without duplicates, M4 recall before and after restart, zero curation jobs; forgotten-before and forgotten-after safeguards plus pause; idle yields to foreground, scene close does not wait for quiet and is off the detach path, dispose clears timers. Registered in `tools/memory-k-verification/registrations/j-b-m6-runtime.json`. One existing assertion in `memory-capability-policy.test.mjs` was updated because M6 is no longer `absent`.

## Not validated (needs GTA)

See the PR description. Offline source simulation only: no GTA, native, soak or latency receipts.

## Minimal M6 activation without losing existing memory

For an existing GTA installation using the legacy combined memory path, add only:

```json
"memoryK": { "capabilities": { "memory.deterministic": "on" } }
```

This retains the inherited legacy foreground consumers, M3 events, PS observations and independent M5 commands. If you already have an explicit capability map with other entries, **keep all those entries** and add `memory.deterministic: on`; omitted siblings remain disabled. An M6-only request never enables M7/cloud curation. Runtime restart required.

The M3 adapter calls the M6 dirtiness marker only after a newly verified SQLite event commit on its asynchronous worker, not from the native PS2 tap. Failed, rejected, stale, duplicate or non-durable events never issue a new wake-up. The next quiet idle pass processes that NPC's durable evidence.
