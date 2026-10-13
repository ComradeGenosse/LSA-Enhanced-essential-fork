# K-07 / K-12 implementation evidence (WS-4a, second slice)

Base: PR #140 head `1657f1414796152c9c09f02b4a433abe61b4aee6`. Scope: K-07 and K-12 only.
K-01 packaging, K-21 native authority and ElevenLabs are untouched. No merge, GTA
deployment or overall Memory K readiness is claimed.

## K-07 atomic compound commands

`bindCommands()` again exposes `commitCommandBatch` (the coordinator already called it and
failed closed with `atomic_writer_unavailable`). It is a thin, *stricter* front for the
existing `commitAtomicBatch` single P2 transaction:

- exactly two members; both must be re-derivable from the exact accepted line:
  deterministic command IDs from `(scope, line)` (`stableM5CommandId` + `compoundCommandId`),
  same operation, pin and literal claim/correction text the player said, same source line;
- the existing `commitAtomicBatch` checks stay: accepted line bytes re-read from SQLite,
  current verified host run/epoch, writable timeline, suppression, scope, evidence;
- any failing member rolls the whole turn back (forget, tombstones, suppression receipts and
  trash rows included); replay is idempotent; a partially committed legacy replay stays blocked.

## K-07 durable clarifications

`findPendingClarification({scope,atUtc,excludeLineId})` is bound again. It reads
`m5_clarifications` (so it survives reconnect/restart) scoped to NPC + world + timeline, not
avatar (so a question asked as Franklin is answered as Michael). Eligible rows are
noncompleted, unexpired, checksum-verified, unrevoked, asked by a different, still durably
accepted line, and asked before the reply. The newest wins; `saveClarification` now retires
older open questions for the same NPC/save so a stale pointer can never resolve; equal-age
candidates fail closed. Resolution still requires the coordinator's authority checks and the
verified accepted reply line; forged, altered, predated, NPC-spoken, wrong-scope, expired,
re-delivered or superseded responses have no effect. `getClarification` shares the same
open/expiry/integrity/revocation code.

Adjacent fix found by the tests: `saveClarification` compared a witnessed event's raw
envelope JSON with the candidate projection, so any clarification offering a witnessed event
failed with `m5_clarification_evidence_changed`. Both now use the same projection.

## K-12 witnessed facts versus player claims

`memory_corrections.correction_mode` (`transcript` | `counter_claim`, additive migration) is
persisted. Only a `transcript` correction supersedes its target. Counter-claims are linked
`reported_claim` overlays: "Player counter-claim (reported, unverified; the original record
stands): …". Recall, candidates, replay (P2/M6), M7 curation sources, M8 history and the
M5 `findCandidates` all use the shared `correctionSemantics` rules. Invariant for every mode:
witnessed events and NPC speech can never be superseded by a player correction; a
`transcript` correction aimed at them is rejected (`memory_transcript_target_invalid`).
Legacy NULL-mode rows aimed at witnessed/NPC evidence are read as counter-claims, other legacy
rows keep their historical superseding meaning. Forgetting an event still removes its
counter-claim overlays with it.

## Evidence

- New `memory-k07-k12-adversarial.test.mjs`: 19/19 (Node 22.22 and 24.21).
- W04 file, assertions unchanged: 8/8 (was 6/8).
- K-05/K-06 forgetting: 17/17; M4 25/25; M7 24/24; integrated storage 23/23; unified avatars 5/5;
  M6 stale-ack 1/1; e1 M5 explicit commands 21/21 (Node 24).
- Full `lsa-shared-brain/tests`: 250/251; the one failure is the pre-existing, out-of-scope
  W06 authority-error precedence test (also red on the base).
- e1 memory suites: 308/324, identical 16 known gate/fixture failures as the base.
