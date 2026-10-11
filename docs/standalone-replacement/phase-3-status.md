# Phase 3 — independent native-authoritative typed conversation

**Status:** implementation substantially extended on `feature/standalone-phase3-typed-turn`, stacked on [Phase 2 PR #42](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/42). **Not deployed in GTA; physical actor authority remains disabled** until verified. The final standalone architecture does not depend on Essential or its Node bundle.

## Implemented in independent source

1. **Native text and target selection** — `LSAStandaloneAsk "Your message"` is a separate RAGE console command. Callback only enqueues bounded player text; the approved game fiber independently selects the nearest living pedestrian **ahead** within 4 meters, verifies Ped identity and mission safety, then issues a turn. The native resolver still uses `allowExperimentalAdoption=false`; **no NPC can be admitted in GTA until the real decorator/ABA lifetime gate is accepted**. The command returns a clear refusal rather than attempting unsafe NPC takeover. This is not yet UX4 menu/controller selection.
2. **Actor-scoped conversation identity** — native `NativeTurnRegistry` mints `ConversationId` and increasing `TurnOrdinal` per physical actor incarnation, while each turn gets new lease/generation/session nonce. A new native player turn may explicitly *discard* an older **unplayed** staged reply; that does not mark it played. Actor death/replacement and transport/world reset retire the session. No persistent CharacterId can control a GTA handle.
3. **Secure native↔Node admission** — `turn.next` carries source-time player text and native conversation identity. Node must confirm the exact turn, actor incarnation, lease, generation and source before making a model request. `turn.reply` is owner-fiber validated and only returns `staged_not_played`; wrong-identity, duplicate and late replies cannot become game effects or committed history.
4. **Production Node service enabled by explicit opt-in** — `service.mjs` launches independently and can run health-only without provider credentials. To enable the typed poller, set `LSA_STANDALONE_TYPED_MODE=enabled`, `OPENAI_API_KEY` and `LSA_STANDALONE_MODEL` in the **local runtime environment**. No credentials are committed or logged. One provider request runs at a time. Each native transport change aborts in-flight model activity and clears per-transport session/history. No automatic physical replay.
5. **Live provider adapter** — an independently authored OpenAI Responses API adapter uses finite request/output bounds, a 20-second deadline, `store: false`, and fail-closed parsing. Native-sourced conversation continuity supplies up to six previous **player utterances only** to the provider. **Unplayed assistant replies are never inserted as if heard, nor written as durable character memories**.
6. **Staged history** — strictly bounded volatile `PendingDialogue` holds unplayed response candidates, supersedes older unplayed candidates in the same native session and has intentionally **no history commit operation** until Phase 4 exact native playback receipts.

## Verified offline

- .NET Framework production core and published RAGE SDK host compilation, including independent RAGE console command bindings.
- Simulated physical ABA (same handle and address, new lifetime tag), native exact lease validation and actor-scoped ordinal reuse/retirement, invalid/superseded/duplicate reply tests.
- Node provider parsing, user-only conversation continuity, disconnect while model waits, no-effect staging, bounded polling, no secrets in status and fresh-session reconnect.
- Real separate net481 process ↔ independent Node fixture provider ↔ exact native staged reply. **The fixture is not GTA or a paid/live model request.**

Test receipts must refer to the actual final branch commit/workflow run; successful intermediate commits do not imply final approval.


## Phase 3 continuation — lifecycle and input hardening

- **Native cancellation fixed:** a Node rejection before `turn.confirm` can now retire its exact native conversation lease immediately. The cancel path validates turn ID, actor incarnation, lease and generation, and still rejects wrong-identity/replayed requests. Native focused tests verify that a new turn may reacquire the actor immediately and an old offer cannot later be confirmed.
- **Independent on-screen text adapter:** `LSAStandaloneCompose` requests GTA's 256-character native keyboard. Only the game-fiber owner may invoke keyboard natives or receive typed results; all text goes through the same bounded console-text/actor checks. A cancelled keyboard cannot issue a turn. Late queued text expires after 2 seconds to avoid target drift, and input admission is closed on startup failure, shutdown or reload.
- **Two-process provider verification:** the Windows integration suite launches a genuine `net481` host with a native-issued typed offer, then runs the independent Node pipeline with a deterministic fixture **and independently** with the production `createResponsesProvider` code making a real HTTP POST to a local mock endpoint. The latter confirms `store:false`, exact source-time input, a single provider call, response decoding and a `staged_not_played` acknowledgment without touching the actual OpenAI API.
- **Acceptance boundary remains unchanged:** passing compilation and local HTTP tests do not prove that the on-screen keyboard, GTA entity adoption, decorated lifetime cookies or plugin lifecycle work inside GTA. No real NPC actions, TTS, PCM, history commitment or Essential cutover is enabled.

## Remaining gates and limitations

- **Physical GTA acceptance (blocking game activation):** confirm the installed Enhanced RPH API, plugin load/unload/fiber sequencing and DECOR registration/cookie behavior under deletion/handle+address reuse. There is no proven universal game entity destruction hook. The explicit `false` lifetime gate must remain until real tests pass.
- **Real player UX:** both `LSAStandaloneAsk "text"` (RPH console) and `LSAStandaloneCompose` (GTA on-screen keyboard) are independently compiled. They refuse NPC admission while the physical lifetime gate is closed. No live in-game keyboard, menu or controller targeting was tested; the full UX4 picker belongs to Phase 6.
- **Actual provider/live dialogue:** offline uses a deterministic fixture and a real loopback HTTP server exercised through the production Responses adapter, plus the independent .NET Framework native host. No live OpenAI service call, game target, playback or lip sync was exercised.
- **History/continuity boundary:** session IDs and prior *player text* are retained for modeling within an active transport. Since Phase 4 native audible success has not occurred, the system cannot claim completed NPC turns or durable multi-turn assistant history.
- **Later phases:** Phase 4 implements real PCM/audio, source receipts and history commit; Phase 5 performs the first end-to-end GTA vertical slice; Phase 6 adds PTT and UX4 targeting. Gameplay parity with Essential is not yet achieved.

**Disposition:** ready for further isolated Phase 3 offline integration; NO-GO for replacing Essential in the installed game today. No original files are modified, merged or deployed.
