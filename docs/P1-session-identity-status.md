# P1 — SESSION_IDENTITY V1

Updated October 2, 2026. Baseline: `main` at `0edf170`, with merged P0.

**Status: implemented and verified offline; physical GTA acceptance pending.** Persistence defaults off. This change has not been deployed, connected to GTA, or exercised against a running game. P0 and E6 retain their separate physical acceptance gates.

## Implemented scope

V1 recognizes only the explicit authored owner `comrade.authored`. Its canonical alias is the structured tuple `(worldProfileId, sourceNamespace, sourceKey)`. A freshly verified owner registration resolves to a companion-generated UUID `CharacterId`. Model, name, birthday, gender, location, P/V aliases, interaction IDs, scene templates, PR/Nexus data, and raw ped handles grant no durable identity.

The layers are separate:

1. `SessionIdentityIntegration` and `ExplicitCharacterSource` own a bounded registration roster and mint `NativeIdentityClaim` evidence.
2. The companion checks the actor block against a fresh challenge response from that owner's live ledger.
3. `CharacterRegistry` resolves or creates the durable alias/UUID record.
4. `RuntimeBindings` associates that record with the exact `(pedId, sessionNonce)` in RAM.
5. An immutable `TurnCharacterSnapshot` annotates the already captured P0 turn.

Every native effect still uses Essential's original `(pedId, sessionNonce, turnId, generationId)`. Character IDs are never action/audio addresses, connection keys, or a route to the newest incarnation. A returning character gets a new native session, connection, and empty bounded `DialogueHistory`. Delayed work from the old tuple cannot follow it.

## Native owner and proof channel

The optional .NET 4.8.1 addon implements the pinned public `IIntegration` contract. An authored plugin explicitly installs it and calls `Register`, `Retire`, and `TryResolveCurrent` on its game fiber. `AuthoredTestOwner.RegisterAlex` registers an already owned ped; it does not spawn, task, delete, or control one. See [addon build and owner API](../native/session-identity/README.md).

Each registration mints a fresh incarnation UUID and claim revision. The addon validates existence/death and the captured full handle, and clears its roster/epoch on restart or regressed game time. Ped control release and action callbacks do not destroy character identity. Duplicate live aliases invalidate both native registrations until the owner explicitly retires and registers them again.

`EnrichActor` performs only a bounded roster lookup and serialization into `sessionIdentity`. It performs no disk, pipe, database, or network I/O. The pipe worker cannot touch peds or create claims: it queues questions for the integration's `Update` callback. That callback validates at most 64 registrations and answers at most 16 questions per update.

The factual Windows pipe is `LSA.SessionIdentity.v1` by default. Its protected ACL allows only the current Windows user's SID. The client correlates a UUID challenge, ped, adapter epoch, incarnation, claim revision, and strictly newer observation sequence. It accepts only versioned hello/proof/revoke/heartbeat frames. Frames are limited to 4 KiB; native question/output queues are capped at 64. No frame can carry sessions, actions, PCM, or gameplay commands.

Trust comes from the configured local authored owner and its ledger, not the JSON namespace. This assumes the installed addon and other processes running as the same Windows user are trusted; the channel is not an isolation boundary against a malicious process with that user's rights. The matching protected pipe and optional contract are required for persistence. Merely copying a block into actor JSON does not authenticate it.

Only game-fiber updates renew the 250 ms heartbeat. A 1.5 second lease, pipe disconnect, or exact revoke invalidates matching identity anchors and closes their exact sessions through the existing Essential cancellation/interrupt/close path. Old epochs and old incarnation/revision facts cannot revoke newer bindings. Unregistered ambient sessions continue normally.

## Turn and binding safety

- Native tuple validation precedes identity preparation. Typed, microphone, and special-event paths retain the complete frozen P0 actor/listener/world/reference snapshot.
- Preparation consumes the original provider-work deadline and is additionally capped at `prepareTimeoutMs` (400 ms default, configurable 25–1000 ms). It never resets that deadline.
- Native currency, abort state, owner lease, and exact anchor are checked after proof and storage awaits and before binding/profile publication. A late disk operation may finish its valid durable write, but cannot publish into a superseding turn or session.
- Bindings have fresh server-run UUIDs, binding UUIDs, and monotonic revisions. A reverse index exists only to reject two active sessions for one character; it never routes native work. Retirement compares exact binding ID/revision, or exact epoch/incarnation/claim revision.
- Known contradictory alias/incarnation evidence retires the affected exact session and clears its history. Conflicts never merge or steal a binding. Missing or unavailable persistence falls back to the existing ephemeral session path.
- `sessionIdentity` is reserved during stock normalization, so a payload cannot flatten fields into ped identity, role, or action capabilities. The private P0 snapshot keeps the evidence, while model context omits this reserved block. This is a narrow identity-field filter, not a perception/knowledge projector.

## Durable format and recovery

`identity/characters.v1.json` is the default local store, relative to the companion working directory. Use a dedicated file and stable UUID world profile per authored world; use an absolute path when the launch directory is uncertain. One companion process owns a store file. V1 does not provide a cross-process database lock.

The bounded version-1 root contains `schemaVersion`, `worldProfileId`, `registryRevision`, and at most 1,000 character records (1 MiB total). Each record contains its UUID, record revision, UTC creation/update timestamps, one explicit alias with source contract version, and an optional actual voice assignment. Alias keys use JSON tuple encoding, so delimiter-like source keys cannot collide.

The voice assignment stores `assignmentVersion`, opaque `profileId`, provider, actual voice, and a pool/configuration fingerprint. The store contains no ped, session, turn, generation, incarnation, epoch, live claim revision, binding, connection, history, or native authorization data. These are never reloaded from disk.

Creation and writes are serialized. A write validates the complete new snapshot, creates a unique file with exclusive creation, flushes it, flushes a backup of the prior primary, then replaces the primary with Windows replace-existing rename. Transient Windows sharing failures get bounded retries; the primary is never unlinked first. `.bak` holds the prior committed snapshot. A valid backup is recovered only if the primary is absent. A present corrupt, conflicting, unsupported, oversized, or invalid primary is preserved and disables persistence for that process. No auto-merge, format migration, corrupt-file overwrite, or handle migration occurs. Failed writes publish no new runtime binding.

This provides tested atomic replacement and missing-primary recovery, not a guarantee against every disk/controller power-loss condition. Repair and migration are explicit future administrative work. Store failures do not stop ordinary ephemeral dialogue.

## Voice and flags

```json
{
  "persistentIdentity": {
    "enabled": false,
    "mode": "shadow",
    "worldProfileId": "",
    "storePath": "identity/characters.v1.json",
    "pipeName": "LSA.SessionIdentity.v1",
    "prepareTimeoutMs": 400
  }
}
```

- **Disabled:** no identity service, owner channel, or store is opened. Existing E2 session selection, E1–E6 lifecycle, and provider behavior remain in effect. The reserved normalization key remains inert.
- **Shadow:** an explicit configured world UUID and fresh owner proof can create registry records/bindings and metadata; new records have no character-owned voice. Existing session voices remain unchanged.
- **Voices:** at the first safe provider generation in a fresh session, select and persist the actual validated voice or load its prior assignment. Returning characters keep that choice even when the pool is reordered or removes it, provided the configured TTS model still supports it. An incompatible stored choice remains intact and the session falls back to its E2 voice, with a bounded diagnostic.

After a session's first provider preparation, its voice policy is fixed. Late identity discovery may annotate a later turn but cannot switch that session's voice or create a new assignment until a new safe session. Every generation and every E6 segment/retry uses one frozen speech profile. Native `pedId` never changes to affect selection. Gemini is not given an identity service or a shared connection/history.

An unavailable/mismatched optional native contract disables only P1 during bootstrap. The mandatory E1 core contract still fails the whole candidate build on mismatch. The addon also checks the actual loaded Essential assembly at initialization.

## Telemetry

The strict allowlist adds `identity_resolved`, `identity_binding_created`, `identity_binding_retired`, `identity_conflict`, `identity_evidence_stale`, `identity_store_unavailable`, and `persistent_voice_loaded`. Data is limited to bounded kinds/reasons/outcomes/revisions and the existing opaque speech-profile ID. Native tuple correlation follows the existing telemetry rules. No owner source key, claim JSON, raw integration payload, names/DOB, PR records, prompt, dialogue, or audio is logged. Sink failure cannot influence authority.

## Architectural inputs and differences

The [design review](plans/SESSION_IDENTITY-design-review.md), merged [P0 status](P0-turn-context-status.md), and Astra investigation at `research/session-identity-memory-architecture-20261002` were read before implementation. This implementation follows the newer investigation's explicit owner-ledger requirement rather than treating mutable namespace JSON as authenticated proof.

The investigation phases persistent voice into P2; the implementation request explicitly requires the bounded voice assignment in P1. Only the actual voice choice is included here. No conversation/event memory, relationships, personality, commitments, goals, salience, perception system, autonomous/NPC-to-NPC coordinator, new actions, PR/Nexus identity, or save-timeline memory is implemented.

The pinned Essential assembly targets .NET 4.8.1, so the addon uses `net481` rather than a presumed older framework. Current P0 already fixes the context/listener/target races described in historical research. Those historical files remain unchanged; current evidence is recorded here.

## Offline verification and build pins

Final checks on Windows with Node `v24.19.0` and .NET SDK `10.0.301`:

- `node tools/runTests.mjs`: **242 passed, 0 failed, 0 cancelled, 0 skipped** (187-test merged P0 baseline, 55 added identity tests). The suite includes all prior P0/E1–E6 tests, stock typed/microphone/special-event controllers, native-tuple fencing, real normalization, playback-gated history, E6 segmented retries, disabled parity, store failures/recovery, freshness/revocation, owner lease expiry, persistent voice recreation, and incompatible stored-voice fallback.
- `node tools/buildCandidate.mjs`: succeeded with **48** expected one-match source-pinned hooks; status `candidate-built-offline-p1-gta-pending`. Mandatory and optional contracts passed.
- Native evidence-store executable: **16 assertions passed**. Native factual pipe executable: **9 assertions passed** against the actual production store/channel sources. Neither loads game assemblies or contacts the configured runtime pipe.
- Optional `net481` addon and native factual pipe test compiled with **0 warnings, 0 errors** using pinned compile-only references.
- `git diff --check`: clean. No GTA deployment/runtime or live provider smoke was performed.

| Built output | SHA-256 |
| --- | --- |
| Patched server launcher | `701167fab3adb69e03ddf9e472906f57a00dcd2efc6211881e8c7c9b98c8fa53` |
| Companion source tree | `ebc500f6687b9a4c822ea11c73ff8f333ad8f3e5558a400665854d5e2f4d1857` |
| Companion release payload | `c4b1b5c5805b6e834749ef206a63a29c6dacf0a0c471c0b4d2d13e830a6d6dc1` |
| Optional identity addon | `4d1ea1937c9705d5491effa34d9b1d75f7fb2b3267986f43b2cb3b97b1fa676e` |

| Input | SHA-256 |
| --- | --- |
| Stock server bundle (unchanged) | `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2` |
| Essential DLL (unchanged) | `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |
| Mandatory native metadata (unchanged) | `18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23` |
| Optional identity public-seam metadata | `8eac8860c81feacbb5eab557f5769cac1f76a36f061e1eb3640da7096f08cb63` |
| Compile-only RPH SDK | `5d439745604a5fedbf8fa401520d4f296c1b6800d77e2923ba3bf9772182c7e0` |

The optional metadata is extracted with CLR metadata readers, without executing the DLL, and marked `-text` in `.gitattributes` so Windows checkout conversion cannot change its byte pin. The candidate has 48 one-match source-pinned hooks (P0's 46 plus two reserved identity-context protections); the existing exact-session close bridge additionally exposes the narrow retirement callback. No core DLL/protocol or native state-machine patches are introduced. `patches/essential-hooks.json` accounts for all 48.

## Controlled GTA acceptance checklist — all pending

Run only in a separately authorized controlled GTA session. Record candidate/addon hashes, Essential/RPH versions, world UUID, feature mode, and outcomes. Use a small authored owner plugin that owns the test ped and its registration token. Keep runtime source keys and registry contents out of public logs.

- [ ] With P1 disabled, converse through typed, microphone, and special-event paths; verify existing session voices, native actions, interruption, and playback/history behavior.
- [ ] In shadow mode, register an already owner-created Alex, converse, and confirm persistent metadata with the existing E2 voice. An unregistered identical-looking NPC must remain ephemeral.
- [ ] Start a fresh session in voices mode, register Alex using a stable authored alias, converse, and record the resulting CharacterId/voice locally.
- [ ] Close Alex's exact session, retire the exact registration token, then have the owner delete/recreate Alex with a **new full ped handle and fresh incarnation**. Register the same alias. Confirm the same CharacterId and actual voice, new native session/connection, and empty session history.
- [ ] Delay reasoning/TTS/PCM/action/completion from the old tuple across that recreation. Confirm no old output, action, completion, or history can affect the new ped/session. Repeat with a recycled handle but a new incarnation/nonce.
- [ ] Simultaneously claim Alex's alias on two live owner peds. Confirm conflict, revocation of existing identity-dependent work, no character binding theft, and no durable merge. Explicitly retire/re-register to recover.
- [ ] Deliberately replace a known registration's alias/incarnation during an existing session. Confirm that exact session retires before different characters can share its history.
- [ ] Kill/despawn/retire the registered ped while reasoning and then while TTS/playback is pending. Verify exact interruption, no late native effects across incarnations, and durable alias/voice retention.
- [ ] Pause/stop the authored validation loop or disconnect its fact channel. Verify bounded lease loss retires registered sessions and leaves unrelated ephemeral sessions usable. Old epoch/incarnation/revision revokes must not retire a newly registered incarnation.
- [ ] Restart the companion, addon, and game as appropriate. Confirm runtime bindings/epochs start fresh; registry and voice survive; no binding appears until fresh owner registration/proof. Verify regressed game time invalidates the roster.
- [ ] Confirm directed-interaction end, `PlaybackEnded`, and temporary ped control release do not destroy durable identity; session close still clears only exact-session history/binding.
- [ ] Reorder/change the configured voice pool between clean sessions. Confirm compatible stored assignments survive. Check incompatible model/voice fallback without silently rewriting the canonical assignment, and no same-session late voice switch.
- [ ] In an isolated test store, exercise unavailable/corrupt/unsupported storage and optional-contract absence; ordinary ephemeral dialogue must remain usable. Verify recovery only from a valid backup when the primary is absent.
- [ ] Inspect the actual hydrated block, loaded assembly compatibility, owner fiber/Update cadence, and secret-safe telemetry. Verify the identity namespace cannot change ped identity or native action capabilities.
- [ ] Complete the independent [P0 GTA checklist](P0-turn-context-status.md#gta-acceptance-checklist), including real entity/reference validity between capture and dispatch.
- [ ] Complete the independent [E6 release gate](ROADMAP.md#e6-remaining-release-gate): audible first segment before model completion, ordered multi-segment continuation across gaps, one stream-end/history commit, interruption/late-failure rejection, and buffered action-bearing turns.

Offline success does not validate these GTA/RAGE behaviors. No physical box is checked by this PR.
