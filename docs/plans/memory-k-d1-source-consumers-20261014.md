# D1 companion authenticated source and optional consumers

Integration base: `505e9d0a827d3e633297cefc07b7ab2f3b1033b4` (#138, B/A/O/C/E1 merged).
Architectural reference: #158 at `6ad20554c11ed7cd868964f93cbffc2eb37f69d9`.

`IntelligenceClient` remains the only authenticated native transport. Its existing
`ShadowRuntime` owns the minimal host/stream/world/sequence, anchors, owner index,
retirement and source-freshness state. PS2 stores/correlator/transcripts and PS3
salience are now optional allocations. Off consumers receive no signals, create
no semantic history, run no refresh, and have no accepted-observation tap.
The entire v1 frame schema, stream and frame/producer sequence, source capability,
reference kinds and TTL are checked before the semantic gate. No wire fields were
added and no native source authority was introduced.

Keep `intelligence.mode: "shadow"` to operate the source. Example companion config:

```json
{"intelligence":{"mode":"shadow"},"memoryK":{"capabilities":{
  "ps1.producers":"off","ps2.observations":"off","ps3.salience":"off"
}}}
```

PS1 here is a request, not remote control of a legacy native peer. D2 supplies
native startup gates. D1 must still strictly validate any optional signal a legacy
peer sends. PS2 may be requested `on` or `shadow` with a compatible PS1 request;
PS3 may then be requested independently. PS3 on/PS2 off is blocked by B's existing
graph; it does not silently start PS2. Missing explicit sibling requests default
off. With no modular requests, the legacy PS2/PS3 behavior is preserved. Existing
storage-only requests now also leave semantic consumers uninitialized.

C's scope continues to own one source client, D02 subscription, timeline/host
subscriptions and process shutdown hook per runtime. Consumers shut down before
source, and source before storage. A failed close remains retryable. Restart uses
the existing disposal/recomposition protocol; switches are startup-only here.
`memoryKRuntimeDiagnostics()` reports source waiting/current/disconnected/stopped
and actual optional allocations rather than claiming operation from configuration.
D02 operation uses the existing private authority status, never a transport flag.
No F/G capture switch, privacy E2, M4 preparation or PS4 final-send code is added.

Source-boundary repair: an accepted next-world C-13 frame revokes D02 leases and
history without blacklisting the continuing native stream. Faults, disconnects,
replay and invalid world frames still retire it. Duplicate current-world receipts
do not revoke valid leases. Native already continues that stream after a
successful world control send. Private authority subscriber frames are immutable;
duplicate authority callbacks cannot acquire a second subscription.

Focused evidence: `memory-k-source-consumers.test.mjs` uses the production private
socket intake and D02 port; source-only owner/player verification, independent
PS2/PS3 requests, blocked combinations, legacy peer refusal, malformed/stale/
duplicate/out-of-order/replayed/expired frames, retirement, world/host changes,
reconnect, instance restart and disposal. Existing test assertions are unchanged.
The new suite is registered with A/O discovery and runs in Windows/Linux CI.
Validation receipts and exact final head are supplied in the draft PR.

Limitations: source requires its existing pinned build contract and native peer;
D02 requires negotiated current-owner/player v1, fresh post-bind samples, current
P2 profile and writable confirmed timeline. Older peers remain usable for their
existing perception contract but cannot provide unnegotiated D02. On/shadow here
controls local processing only; native producers and downstream effects retain
their own independent gates. F/G/E2 and M9 families remain separate. GTA/package/
soak and original S01–S10 acceptance are not certified by these offline tests.

Shared-file coordination: this PR owns narrow bootstrap source construction,
composition diagnostics, source intake and the null-safe PS4 *input capture* seam.
It does not edit the original dialogue runner, M4 recall preparation, PS4 final
send, WS6 benchmarks or WS6 harnesses. Integrate D1 into #138 before reconciling D2;
do not push to #138 or merge automatically.
