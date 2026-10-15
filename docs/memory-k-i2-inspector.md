# Memory K I2 — local inspector and runtime controls

I2 extends the existing P2 character editor on the #138 integration branch.
It does not require I1, H1, H2, M6, M7 or M8. No new service, database,
connection, memory writer, account or cloud dependency is introduced.
This is offline implementation evidence, not physical GTA validation.

## Open during GTA testing

1. Use the matching #138 companion/P1/P2/native-source build and existing P2
   setup described in [P2 setup](P2-promoted-characters-status.md). Retain the
   actual world UUID, paths and matching native configuration. Use Node 24.
2. Enable the existing SQLite backend (`promotedCharacters.storageMode:
   "sqlite"`) and add `"memory.inspector": "on"` to the existing
   `memoryK.capabilities` object. Restart the companion. Do not replace an
   existing capability map or change the world UUID merely to open the editor.
3. Open the URL printed as `[P2] Character editor: ...`, normally
   `http://127.0.0.1:37921`. The existing `LSACharacters` RAGE command prints it.
   This PR does not install/deploy anything to GTA automatically.
4. Expand **Playthrough timeline**, choose the correct save lineage and confirm
   it after native source/companion/world restarts. I2 requires current verified
   native source and explicit timeline confirmation for private learned data.
   It never guesses a save or bypasses E2 authorization for offline access.
5. Select a promoted NPC in the existing list. Choose the memory category in
   **Stored learned memory inspector**, then use **Load memories**, page controls
   and **Details and provenance**. Empty categories say there are no stored
   records; unavailable source/storage/scope says unavailable, not empty.
6. **Forget** confirms suppression of the existing source/derived privacy bundle.
   **Correct factual memory** is available for eligible player-sourced reported
   facts. It preserves the original in private history and adds a player-reported
   revision. NPC speech, witnessed-event sources, interpretations, suppressed
   records and superseded facts cannot be rewritten through this control.
7. Select checkboxes on the current page and **Export selected privately** to
   download JSON. Keep this file private. It is an inspection export, not a
   privacy-safe live backup restoration. Existing rollback profile snapshots
   remain explicitly profile-only.
8. **Forgotten / recovery history** exposes the existing seven-day recovery
   tickets. **Request safe P2 restore** runs the original full-bundle validation
   and receipt readback. Purged/expired/inconsistent recovery is unavailable.
   There is no arbitrary backup restore or one-record suppression shortcut.

For an independent inspection-only configuration, retain the existing provider,
identity, source and SQLite settings and use:

```json
"memoryK": {
  "profile": "storage-only",
  "capabilities": { "memory.inspector": "on" },
  "pauseLearned": false
}
```

The storage-only profile continues to disable every learned producer/consumer
and event callback. Its sole new explicit exception is the privileged inspector.
Omitting `memory.inspector` keeps it off. The runtime controls remain reachable
in the editor to enable it for a subsequent restart.

## Runtime settings and pause

Expand **Capability settings and operational states**. Each row distinguishes
the saved requested mode, the running process's request, its effective mode,
actual operational status/reason, dependency requirements and pending restart.
Policy checks are labeled separately from operation receipts. `on` configuration
is never a claim that a source, recorder, reader or worker is operational.

**Save for restart** validates through the existing config normalizer, checks the
file revision, writes a new private temporary file, syncs it and atomically
replaces the same configuration file. It preserves other config fields and does
not serialize resolved environment secrets. An external edit causes a revision
conflict. Supported modes come from the capability catalog; dependencies are
never enabled automatically. The storage-only profile still rejects optional
producer/consumer activation. Shadow/unimplemented requests may remain blocked
or unavailable after restart; their UI setting is not implementation.

An installation still using the implicit legacy bundle receives an explicit
confirmation before its first capability map: unspecified optional capabilities
will become off after restart. No attempt is made to infer/activate legacy
dependencies from an uncertain status.

**Pause Learned Memory** latches a live per-runtime revocation, retires acceptance
and delivery sources, cancels current exact-generation turns/provider requests,
stops M3 intake/coverage and fences optional P2 reads/writes at admission and
inside the original serialized queue. It invalidates prepared model frames,
retries and memory-derived situation contributions. It then waits for the
existing M3 disposer. The pause request is persisted before asynchronous cleanup;
cleanup failures report `blocked_cleanup_failed`, not successful complete pause.
If persistence fails, the current process stays fenced and reports failure;
the requested/effective fields show that disk persistence was not confirmed.

P2 storage, authenticated source transport, editor inspection and mandatory
privacy services remain available. Existing data is preserved. The process
cannot unpause: **Allow learned memory after restart** only saves a request;
the current process stays paused. Explicitly restart the companion and reconfirm
the native source/timeline. Old receipts, queued work and requests cannot be
resumed by toggling this setting.

Ordinary fresh dialogue still works after the interrupted turn. This pause is
not GTA's pause menu and does not delete/forget data. M6/M7/M9 workers/callbacks
are not production-registered at this integration head and are never activated
by I2. Future integrations must use the same optional port/currentness fence;
I2 does not claim to control independently constructed external workers.

## Reused interfaces and shared changes

- Existing `editorServer` exact Host/Origin, random per-run editor token,
  JSON/body limits, loopback binding, no-cache/CSP and safe text rendering.
  Localhost alone is not authorization. The established trusted boundary is
  the same-user installed addon/local processes; I2 adds no account system.
- Existing P2 single writer and `withP2SqliteRead`, `withTimelineSqliteWrite`,
  source-generation/timeline/owner guards. A narrow authority-only fence avoids
  treating an operation's own data revision as a source revocation. An optional
  async-context guard rejects queued learned work without fencing administration.
- Existing `M5SqliteServices` authorized inspection/privacy, durable suppression
  closure/fingerprints, seven-day trash restore and `verifyPrivacy` readback.
  Dedicated I2 modules provide projection/UI/control logic.
- New privileged `inspectPage` and `correctFact` ports live in that same service.
  `fact_revision` uses canonical `memory_corrections` / `memory_commands` rows,
  explicitly identifies an administration receipt and never fabricates a player
  conversation. Conversational mutation ports reject this privileged mode.
  Revision checks bind scope, operation UUID, original content checksum and
  readback. Obsolete fact/evidence bundles are excluded from H2, replay and
  retained-data curation so extraction cannot resurrect the superseded fact.
- Minimal `bootstrap` / `essentialGlue` hooks pass optional ports, expose actual
  pause diagnostics, invalidate original knowledge delivery and use the existing
  exact-turn cancellation/lifecycle. There is no replacement orchestrator.

I1 owns conversational detection/dispatch/spoken acknowledgements. None is
implemented or changed here. Coordination was posted on #138 before publication;
no open I1 PR or active I1 chat was discoverable at implementation start. I1
should preserve the optional store/currentness fence and use the same canonical
privacy records. Neither workstream needs the other's merge.

## Evidence and remaining limits

The `inspector` and `inspector-regression` verification profiles register new I2
checks separately from unchanged editor, D01/D03, H1/H2 and M3 regressions. The
original E2 suite remains unchanged and includes privacy/recovery, replay,
retention, curation, source authentication and original-runner regressions.
The I2 Windows/Linux workflow uses Node 24 and exact PR head, including drafts,
and retains test hashes, TAP logs and receipts. Original S01–S10, native build,
GTA, deployment and soak gates remain separate.

Run from a clean checkout, keeping output outside it:

```text
node tools/memory-k-verification/run.mjs --profile inspector --output <outside-checkout>/i2
node tools/memory-k-verification/run.mjs --profile inspector-regression --output <outside-checkout>/regression
node tools/memory-k-verification/e2-suite.mjs --output <outside-checkout>/privacy
node lsa-essential-e1-candidate/tools/buildCandidate.mjs
```

The browser was exercised against the real editor and original P2 store with
synthetic NPCs, source evidence and provider fixtures. The displayed screenshot
is an offline synthetic demonstration, not an installed-GTA observation.

Records are paginated at 50. Recall eligibility uses the original bounded H2
read window; older/ineligible/unverified rows are labeled unavailable or outside
the window, never declared active. Confidence is shown only when stored;
notability is explicitly not confidence. Raw transcripts remain raw even when
they contain claims. Interpretations remain opinions. Source/timeline loss denies
learned access until fresh authorization, including while paused.

Correction withdraws the linked old evidence bundle from future extraction;
this can conservatively exclude other summaries based on the same player line.
Original bytes remain visible only through privileged inspection. There is no
correction undo, interpretation editing, transcript rewrite, bulk purge,
unlimited export, external worker control or live re-enable in this scope.
Existing safe trash restore does not undo a correction or clear independent
suppression. Same-user local-process trust and private browser downloads retain
the existing local-administration limits. No physical GTA validation is claimed.
