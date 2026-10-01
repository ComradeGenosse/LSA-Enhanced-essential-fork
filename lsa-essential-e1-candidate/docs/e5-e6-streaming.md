# E5/E6 structured streaming and early TTS

E5 adds an opt-in Responses SSE adapter for one strict JSON decision envelope:

```json
{"mode":"dialogue_only","segments":[{"text":"..."}],"command":""}
```

`mode` is first by schema order. The decoder never parses the growing response as JSON. It scans the bounded response for a closed segment object, parses that complete object with duplicate-key rejection, validates its exact shape/text/length, freezes it, and only then makes it available. The terminal response must be `response.completed`, its completed assistant text must equal the received deltas, the whole JSON object must parse strictly, and the reconstructed `{dialogue, command}` must pass the existing Essential decision and stock action validators. Refusal, missing terminal, oversized/malformed data, duplicate keys, or a late command in `dialogue_only` fails the turn.

E6 uses the same model response and native identity. Only an initial `dialogue_only` mode can feed early TTS. A single consumer synthesizes segments in order; there is no speculative PCM queue or concurrent TTS. Action-bearing (`buffered_action`) responses remain behind the complete decision and stock validation barrier. The final `output_transcript` is emitted once after the completed response and validation. Aggregate PCM is capped at 6 MiB by default, before native authorization/forwarding. The native authorization is requested once on first PCM, the matching Essential acceptance is awaited before PCM is forwarded, and exactly one `generation_complete` and one `turn_complete` close the aggregate stream. Assistant history commits only after matching successful `PlaybackEnded`.

The complete JSON envelope is intentionally retained for terminal reconciliation. The complete-segment decoder is based on the previously exercised Phase 10B design, whose consumer tests held the model terminal event until after TTS had started. The reported Phase 10B GTA run (13 turns, 11 with audio/acknowledgements; largest observed PCM gap about 2.98 seconds) is useful evidence that Essential's logical audio stream can remain open across segment gaps. It does not verify this E1.1 code path or the current configured Luna endpoint. The current native DLL is unchanged.

Both switches default off in the checked-in `e1.config.example.json`:

```json
"structuredStreamingEnabled": true,
"earlyTtsEnabled": true
```

Structured streaming alone keeps E5 behind the ordinary final-decision/TTS barrier. Early TTS requires structured streaming and is only honored for `dialogue_only`. The live GTA test config currently enables both flags; the repository example stays off. Change no native configuration or DLL. The repository's `tests/streaming-decision.test.mjs` and `tests/openai-transport.test.mjs` cover framing, early PCM, serial segment order, one transcript/end handoff, cancellation during a segment, aggregate PCM rejection, buffered actions, and terminal failure behavior.

The gated smoke passed against the current live install's configured `gpt-6-luna`: the first locally validated dialogue-only segment arrived at about 1.05 s, before `response.completed` at about 1.19 s. The first attempt revealed that the provider emits `response.output_text.done`; the adapter now validates that event against accumulated deltas. The smoke reports lengths/timing only and does not print the generated dialogue.

To repeat the exact configured Responses model check without connecting to GTA, run:

```powershell
$env:LSA_E5_LIVE_API_SMOKE = '1'
node tools/streamingApiSmoke.mjs
```

That explicit gate makes one billable request and prints only mode, segment lengths/timing, terminal timing, and whether the command was empty; it does not print the API key, prompt, or generated dialogue. The live install now has both flags enabled for a controlled GTA test; the checked-in example remains default-off. In-game validation should confirm first NPC audio precedes model completion, segments remain ordered with one logical stream, late refusal/failure interrupts that exact generation, and assistant history commits only after native playback completion.
