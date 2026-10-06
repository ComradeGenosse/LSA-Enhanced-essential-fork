# Radio track perception R5 — bounded model context projection

Status: **implemented on `feature/radio-track-perception-r5-context-projection`; build/test/GTA acceptance pending**.  
Base: `feature/radio-track-perception-r4-ps3-salience@6d166c07bf550094503d48f23e5e2486d28562d8`.

R5 is the first Luna-visible radio layer. It consumes only R3 observer-scoped knowledge that R4 can classify as context-candidate. It does not add memory, initiative, autonomous speech, or music-preference inference.

## Implemented behavior

- Direct player turns are checked by a narrow deterministic radio/music selector after typed input or STT is finalized.
- Incidental mentions such as owning a radio or generic music discussion do not automatically request the current radio fact.
- R5 selects only the single live perception anchor marked as the current conversation NPC.
- That NPC must have a current supported `radio_heard` observation. Other passengers' observations are never substituted.
- R4 is re-evaluated with explicit `requestedEnvironmentChannels: ['radio']`; projection requires `context: candidate`, `response: none`, and `memory: none`.
- At most one compact fact is appended to the frozen turn context.
- Known track form: `Audible environment: the vehicle radio is playing "TITLE" by ARTIST on STATION.`
- Unknown track form names a safe display station when available; otherwise it says only that the vehicle radio is playing and the track is unidentified.
- Internal station keys, track hashes, capture refs, witness reasons, and catalog mechanics are never rendered.
- The projection block explicitly tells Luna not to infer preference, recognition, or memory from the fact.
- Context is selected once before the model request. A track change during provider await cannot mutate the in-flight turn; the next turn may select the newer observation.
- If the existing context budget cannot fit the bounded radio block, radio is omitted rather than displacing higher-priority context.
- Successful model delivery records a PS4-context acknowledgement. A later direct question may still request the same current track; unrelated turns remain omitted.

## Boundaries preserved

- no autonomous dialogue/initiative;
- no memory staging or write;
- no preference/recognition claim;
- no global radio knowledge;
- no projection for a non-hearing NPC;
- no raw audio/lyrics;
- no provider/network lookup for metadata;
- no projection on internal/special-event turns.

## Tests added/updated

Coverage now includes:

- direct radio/song questions versus incidental mentions;
- current-conversation observer selection;
- no cross-passenger knowledge leakage;
- known and unknown track rendering;
- no internal station/hash/captureRef leakage;
- direct repeated questions remaining answerable after context delivery;
- model request contains exactly the selected radio block on a relevant turn;
- unrelated turn on the same connection contains no radio block;
- existing PS3 safety ranking remains unchanged.

These tests have **not been executed in this GitHub-only implementation pass**. No GitHub Actions run is attached to this branch. The full Node regression/candidate build and GTA acceptance matrix are still required.

## GTA acceptance before merge

1. Player and promoted passenger share a vehicle and R3 has a supported current `radio_heard`.
2. Ask the passenger “what song is this?” and confirm the Luna request receives one compact current-radio fact.
3. Ask an unrelated question and confirm no radio fact is projected.
4. Ask a nearby/outside NPC the same song question and confirm no song metadata is projected.
5. Change track while a turn is in flight; confirm that turn keeps the old frozen fact and the next relevant turn sees the new one.
6. Turn radio off / exit vehicle; confirm later relevant turns receive no stale radio fact.
7. Verify unknown catalog entries remain explicitly unidentified.

R5 completes the planned radio perception path through model-visible context. Future spontaneous music comments/preferences belong to the general initiative/personality/memory systems, not this milestone.
