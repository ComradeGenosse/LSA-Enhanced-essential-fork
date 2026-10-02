# P2 — PROMOTED_CHARACTERS / CHARACTER_PROFILE

Updated October 2, 2026. Based on `main` at `2849df1`, containing merged P1 PR #5.

Implemented; offline verification complete. **No deployment or physical GTA validation has been performed.** Default off. P0, P1 and E6 retain their separate physical acceptance gates.

## Player flow and setup

P2 extends the OpenAI companion and an explicitly loaded RAGE owner plugin. Essential continues to own native dialogue sessions, task scheduling, action validation, tagged playback, interruption and completion. Stock Gemini keeps its current behavior.

1. Build the companion normally. Build the optional native package using [the addon instructions](../native/promoted-characters/README.md). Builds write to isolated `dist` paths and never install into GTA.
2. For a separately authorized controlled deployment, put both optional DLLs beside the Essential plugin dependencies and explicitly load `LSA.PromotedCharacters.dll` through RAGE. Copy its example JSON to `LSA.PromotedCharacters.json`, enable it, and set an explicit stable lowercase UUID-v4 `worldProfileId` matching companion P1 configuration. Keep the same world UUID for this character/save timeline; do not derive it from a game clock or filename.
3. Enable companion `promotedCharacters.enabled`, and enable `persistentIdentity` with `mode: "voices"`. The two pipe names must match the native config; native `editorPort` must match companion `promotedCharacters.editorPort` (37921 by default). The P1 registry and P2 profile store must use different paths. One companion process owns each file.
4. The companion prints a local editor URL, normally `http://127.0.0.1:37921`. Open it on the same computer. Select/converse with the desired NPC using Essential, then click **Promote current NPC**. There is no nearest-ped fallback or automatic promotion.
5. Select a character in the editor to inspect and rename it, edit biography/personality/traits/relationship/notes/availability, create/edit/remove memories, and explicitly select memories for dialogue. Changes require the current profile revision.
6. **Summon** recreates an absent character near the player in a supported outdoor/on-foot state. Use **Follow** or **Wait** for the existing Essential behaviors. **Dismiss** releases the current incarnation and keeps its profile. **Despawn** deletes only a ped created by this addon; it refuses deletion of an adopted ambient ped. **Unpromote and delete profile** requires typing the exact CharacterId; it retires the current ownership association before erasing the profile/memories. P1's create-once canonical identity record remains intact.

The native owner must be available for destructive unpromotion, so an unknown live association cannot silently remain registered. Profile/personality/memory edits remain usable while GTA is offline. A port conflict disables the editor alone and leaves dialogue usable.

The addon registers these inputs through the existing RAGE console. They call the same player-only management service as the editor, with one outstanding request and no ped work on the HTTP worker:

| Console command | Player operation |
| --- | --- |
| `LSACharacters` | Print the editor URL |
| `LSAPromote` | Explicitly promote Essential's current selected NPC |
| `LSAFollowPromoted`, `LSAWaitPromoted`, `LSADismissPromoted` | Capture and control the current already-promoted NPC; never promote implicitly |
| `LSASummonCharacter <CharacterId>` | Recreate the saved character selected by its exact ID from the editor |
| `LSADespawnCharacter <CharacterId>` | Explicitly despawn that character's addon-created incarnation; refuse adopted peds |

Native operations require Essential's game Update to run within the short request deadline. If switching to a browser pauses GTA, use the console inputs for live controls and close the console promptly so updates can continue. The editor supports live controls while the game is ticking and remains usable for profile/memory editing while the game is paused or offline. Console registration, focus and pause behavior remain physical acceptance items.

## Ambient encounter identity

The first meaningful OpenAI interaction assigns a bounded `SessionCharacterProfile`: application-owned personal name, known core gender/age band, small archetype/role facts, an initially empty personality description, and the actual current voice profile. Names prefer distinct active given names and avoid persistent given names while alternatives exist; full assigned names always exclude loaded persistent names/nicknames and active names. Manual persistent renames never change CharacterId or merge people.

The optional native integration supplies a RAM-only encounter UUID for the retained current ped lifetime. It validates existence/death and the retained entity address, and prunes at most 256 encounters on Essential's Update loop. The companion retains at most 256 encounter profiles, prunes only native-confirmed retired encounters, and preserves their name/voice across native dialogue session replacement. Without the addon it falls back to the exact native dialogue session and clears that fallback on session close. Ambient encounters never become durable merely because they spoke.

Actor hydration alone does not generate a name. Application grounding supplies the resolved personal name and explicitly prohibits unnamed/unassigned/generated-identity meta responses. Generated names are narrative facts only, never identity proof. Name-space exhaustion disables optional naming for that encounter instead of evicting another active person's name.

## Promotion and identity

```text
explicit player operation
  → capture Essential's current selected/conversation ped
  → short-lived, exact native capture ticket and encounter UUID
  → register stable authored alias promoted.<random UUID> via P1 Owner.Register
  → fresh challenge-correlated proof from P1's existing factual pipe
  → P1 CharacterRegistry resolves/creates CharacterId and actual compatible voice
  → recheck exact owner token/encounter after asynchronous proof
  → durably commit independent P2 profile keyed by that CharacterId
```

Selection changes, expired tickets, foreign script ownership, competing authored registrations and contradictory evidence fail closed. Retrying an already owned character uses its same alias and returns its existing profile. Similar models, appearances, locations, names and voice choices cannot merge characters. Failed profile commits release only the newly acquired association; a small canonical P1 orphan can remain, because P2 never deletes or rewrites P1 aliases. An explicit retry can start a new promotion; no fuzzy reconciliation is attempted.

P2 adds a narrow fresh-owner record resolution method to P1 for player-owned registration before a dialogue turn exists. It creates no turn, session nonce, runtime binding, history, action address or audio route. Subsequent conversation still passes the existing P1 prepare/bind/recheck path.

All **dialogue/model effects** retain Essential's exact `pedId + sessionNonce + turnId + generationId`. CharacterId selects durable data only. Explicit player native controls use a separately captured, current owner incarnation token; a queued command cannot address a replacement incarnation. The factual P1 pipe still refuses all gameplay commands. The separate optional P2 control pipe cannot allocate dialogue sessions or publish audio/model actions.

## Durable formats, bounds and recovery

| Store | Format | Contents and limits |
| --- | --- | --- |
| P1 `identity/characters.v1.json` | Unchanged strict schema v1 | Authored alias/UUID/revision/timestamps/actual voice only; 1,000 records / 1 MiB |
| P2 `characters/profiles.v1.json` | Independent schema v1, world UUID, store revision, per-profile version/revision | 500 profiles / 8 MiB; CharacterId, name/nicknames, known demographics, model hash, supported appearance, biography, personality, relationship, player notes, voice reference, availability, promotion alias/source/time, UTC timestamps and memories |

Names are capped at 80 characters; biography/personality at 1,200; notes at 2,400; traits at 12 × 80. Appearance contains at most 12 component and 8 prop entries with strictly bounded slot/drawable/texture/palette integers. Static slots without writable variations are omitted; their appearance remains part of the model. Current native tuples, connection/history data, pipe/HTTP secrets, epochs, capture tickets, ownership tokens, encounter IDs and spawned status are never serialized into a profile. The editor derives current spawned/suspended status from the live owner roster. Durable availability/dead/retired flags are explicitly player-editable, not an automatic death/history inference system.

Each memory has a durable UUID, summary text (1,200 characters), category, UTC creation/edit timestamps, optional bounded game-time/location context, importance 0–100, source, up to eight related CharacterIds, editable/player-created markers and an explicit `selectedForContext` flag. P2 exposes manual CRUD. It performs no automatic extraction or ranking. Future event writers can use the validated structure without changing identity.

Writes are serialized, validated before commit, flushed to unique temporary files and replace the primary without unlinking it. The prior primary becomes a flushed backup. A valid backup can recover a **missing** primary; corrupt/unsupported primaries are preserved and optional persistence fails closed. Unsupported versions require an explicitly registered pure migration; none is guessed. Invalid edits do not disable an otherwise healthy store. I/O failure prevents publication of unwritten state. This is not a blanket power-loss guarantee.

## Recreation, voice and bounded grounding

```text
CharacterId → validated profile → safe player spawn location
  → supported model/component/prop recreation
  → same authored alias registered through P1, fresh owner incarnation
  → fresh P1 proof resolves the same CharacterId
  → Essential allocates a fresh ped/session, connection and empty history
  → same profile and compatible canonical voice
```

Existing owned incarnations make summon idempotent; they are never teleported. A new registration receiving an unexpected CharacterId fails and releases only the new association. Dismissal/death does not delete character data. Companion restart reuses only durable data and requires fresh native proof. Owner/game restart requires fresh registration; old ped handles or appearances are never used to reclaim people.

Promotion preserves the current application's actual voice; it does not switch the live generation. Clean subsequent sessions reuse the compatible P1 assignment. P1's existing incompatible-model fallback remains in force and never silently overwrites the canonical assignment. Per-turn acting may receive a small personality description/trait set while every segment and retry retains the same immutable generation speech profile.

The model gets an allowlisted, immutable narrative projection under 4 KiB: resolved name/demographics, bounded personality/biography/relationship and at most three manually selected memories (240 characters each). P1 claims, owner aliases, epochs, CharacterId, native encounter tokens, editor secrets, runtime associations, private notes and arbitrary stored fields are omitted from both model actor/listener data and the stock prompt builder. Raw private P0/identity snapshots remain private and unchanged for lifecycle validation. Narrative/memory text grants no action authority.

## Native safety and evidence boundary

See [focused pinned native evidence](P2-native-evidence.md). Follow/wait call existing public `NpcActions` methods for the captured owned ped, with player focus and existing vehicle entry/exit flags. Essential retains its behavior scheduler. P2 never calls a separate TASK loop, adds weapons, enables accomplice combat initiative, or teleports an existing ped. Native reflex/self-preservation remains Essential's behavior.

True cutscene activity/playback, player switching, the global mission flag, multiplayer sessions, foreign script-owned entities and directed interactions guard player controls. Adopted mission/persistent peds require proven existing Essential exclusive control and must belong to the current native script. During a guarded state, P2 clears only its behavior flags and demotes its optional active state; it does not clear Rockstar tasks, teleport or delete. Identity/profile data remain. The character shows suspended and requires an explicit safe **Follow**/**Wait** command afterward. No speculative automatic mission participation or cutscene reaction is added.

RAGE script ownership is a native script boundary, not a universal per-addon ownership proof. Uncooperative plugins sharing that script can still require coordination; physical validation must establish installed-runtime ownership/callback behavior. Exact entity-address/handle reuse between observations is also a physical lifetime acceptance item, not a newly invented permanent identifier.

Appearance fidelity is limited to the captured model plus standard component/prop variations. Head blend, face features, hair/eye color, tattoos, decoration collections, wounds, inventory/weapons and arbitrary third-party customization are not claimed. A changed game/model variation table may refuse recreation safely. No unsupported freemode/customization reconstruction is invented.

## Privacy and optional failure

Allowlisted events cover encounter/profile creation, name assignment/collision count, promotion start/success/failure, profile load/edit, spawn/dismiss, memory CRUD, unpromotion and safe failure. Ordinary telemetry records no personal names, full profiles, arbitrary memory text, prompts/dialogue/audio or owner proof. Native logs use bounded static failure labels. Both native IPC queues/frames and editor bodies/connections have caps; the game fiber handles at most four player requests per Update. Pipe workers never read or task a ped.

The editor binds only IPv4 loopback, requires exact Host/Origin plus a random per-run token for mutations, rejects non-JSON and oversized bodies, uses no remote assets, disables caching/framing and renders edited text with `textContent`. The trusted boundary remains the installed addon and same-user local processes, as in P1. No model tool exposes promotion or management actions.

## Verification and physical GTA checklist

Offline Node suite: **294 passed, zero failed/cancelled/skipped** (242-test P0/P1/E1–E6 baseline + 52 P2 tests). Includes the real source-pinned stock-controller promote/edit/dismiss/recreate path, fresh session/history, preserved voice, stale PCM/action/completion rejection, projection-failure privacy fallback, separate unchanged P1 schema, profile restart/CRUD/bounds/corruption/I/O failure, optional contract isolation and real loopback editor access/operation tests. Native production policy/admission and actual Windows pipe results are recorded in [verification](../lsa-essential-e1-candidate/docs/p2-verification.md). Native package builds use compile-only pinned references; no game is loaded.

All physical boxes remain unchecked:

- [ ] Explicitly load the matching addons/config; verify Essential calls Update/EnrichActor on the expected game fiber and fresh P1 heartbeats/proofs are available.
- [ ] Verify the documented RAGE console commands, current-target capture and exact-ID summon/despawn with GTA focused; verify pause/focus timeouts safely defer controls.
- [ ] Talk to multiple ambient peds and verify grounded names, demographic voice choice, no duplicate active names where alternatives exist, stable name/voice across native session replacement and cleanup on ped death/despawn.
- [ ] Select one ambient civilian, promote once/twice, and verify one profile, same current voice and no unwanted task replacement. Selection change/expiry and competing authored owner must fail closed.
- [ ] Rename/edit personality/relationship/notes; manually create/edit/select/remove memories. Restart companion/game and verify durable values with fresh proof and empty native dialogue history.
- [ ] Dismiss/recreate with the same CharacterId/model/outfit/compatible voice but fresh ped/session. Verify no delayed old PCM, commands or history reaches the returning ped.
- [ ] Confirm supported clothing/props visually; unsupported/custom model variants fail safely without erasing the profile. Validate safe ground/obstacle behavior of the chosen nearby outdoor spawn point.
- [ ] Follow/wait, player enters/exits vehicles, no free seat, player changes vehicle, ped injury/threat/death. Verify native self-preservation and conservative combat; no new task scheduler or weapon grant.
- [ ] Enter/leave real missions/cutscenes/player switches and third-party scripted ownership. Verify suspension, no teleport/task clearing/deletion of Rockstar peds, preserved data and explicit safe rejoin.
- [ ] Despawn only addon-created peds; adopted ped deletion is refused. Unpromotion requires exact confirmation, releases live ownership and deletes only P2 data.
- [ ] Test optional missing/corrupt stores, unavailable owner/pipe, editor port conflict, native model failure, addon/companion reload and retired/duplicate alias scenarios. Ordinary ambient dialogue and exact stale-work fences must remain usable.
- [ ] Run the independent P0/P1/E6 acceptance lists and a long-session soak; offline pass counts do not close these gates.

## Intentionally later

PERCEPTION: mission/cutscene/event observation and richer sensory context. SALIENCE: automatic memory extraction, relevance/importance ranking, forgetting and current concerns. SCENE_DIRECTOR: autonomous initiative, goals/commitments, coordinated NPC-to-NPC scenes and richer defensive/mission participation. P2 provides their identity/profile/memory foundation and does not implement them prematurely.
