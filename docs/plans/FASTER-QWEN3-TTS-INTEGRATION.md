# Faster Qwen3-TTS: implementation, setup, and acceptance

**Base:** Radio v2 PR #32, commit ee0cfe55a8a8d7d029cde870224ba14df4bbab56, already synchronized with main at that checkpoint. New PR targets the radio branch; no radio or native DLL changes.

## Implemented in this PR

- Independent file setting `speechProvider`: default `openai` or `faster-qwen3-tts`. OpenAI reasoning, transcription, and credentials remain unchanged.
- Dedicated Qwen streaming adapter: loopback-only HTTP, no API keys, fixed 24-kHz signed 16-bit mono PCM, aborts, deadlines, awaited native chunk delivery, strict local voice registry, fail-closed output checks and no automatic cloud fallback.
- Local Python service supports Faster Qwen3-TTS **Base voice cloning**, **CustomVoice built-in speakers** and **VoiceDesign prompts** using their actual separate upstream streaming methods. One GPU model family at a time; family switches incur unload/load/warmup latency and can stutter GTA.
- Separate Qwen speech voice list/demographics; no fake nova, shimmer, ash or onyx aliases. Persisted OpenAI v1 and Qwen v2 voice references coexist. Switching TTS providers maps existing characters to stable compatible voices without rewriting identity, memory, or their original authored reference.
- Focused Node regression tests. The radio code/PS4/PS6/native speaker authorization and playback lifecycles are unchanged.

## Windows setup

1. Install Faster Qwen3-TTS in a compatible CUDA/PyTorch Python environment following https://github.com/andimarafioti/faster-qwen3-tts . Model dependencies and GPU support must be confirmed on the target Windows computer.
2. Copy `lsa-essential-e1-candidate/tools/qwen/voices.example.json` to untracked `voices.json` in that folder. Put an authorized reference at `tools/qwen/voices/nathan.wav`; replace the sample reference transcript with the actual words spoken. All voice paths are resolved relative to the JSON file.
3. In the `lsa-essential-e1-candidate` directory start:
   `python tools/qwen/lsa_qwen_server.py --voices tools/qwen/voices.json --port 8000 --device cuda`
4. Visit http://127.0.0.1:8000/health and confirm status ok. The actual model loads and warms on first generation; health does not mean every model is resident.
5. Back up and edit your existing private `e1.config.json`. Add the following keys while preserving the rest, including `provider`, radio, PS4/PS6, reasoning model, OpenAI STT, and all API credentials:

```json
{
  "speechProvider": "faster-qwen3-tts",
  "qwenTts": {
    "baseUrl": "http://127.0.0.1:8000/v1",
    "speechVoices": ["nathan"],
    "speechVoiceProfiles": { "nathan": { "genders": ["any"], "ageBands": ["any"] } }
  }
}
```

6. Restart the LSA companion and test typed conversation with Nathan, then microphone and Director speech. The `speechVoices` entries must exactly match voice IDs in the server registry. Add more for different character voice pools.
7. Roll back by changing only `speechProvider` to `openai` and restarting. Do not remove the existing OpenAI API key. The original OpenAI voice pool and model return.

**Privacy:** `e1.config.json`, `voices.json`, personal recordings and `.env` must stay local. The local server binds to 127.0.0.1 only and does not receive OpenAI API credentials. The sample voice config does not work until its audio file exists.

## Voice modes and limitations

| Mode | Model family | Registry parameters | Runtime behavior |
| --- | --- | --- | --- |
| clone | 1.7B Base | `ref_audio`, `ref_text`, `language`, optional `instruct`, `chunk_size` | Consistent reference-based authored character voice |
| custom | 1.7B CustomVoice | `speaker`, `language`, optional `instruct`, `chunk_size` | Uses native Qwen speaker, not OpenAI aliases |
| design | 1.7B VoiceDesign | `instruct`, `language`, `chunk_size` | Instruction-created timbre can vary between utterances; create a reference sample and clone it for durable identity |

The Base, CustomVoice and VoiceDesign variants have different weights. They cannot all be served as features of one Base model; our sidecar selects the appropriate upstream method/model. The wrapped engine uses exactly one model family in VRAM at a time. `ttsSpeed` is effectively fixed at 1 for Qwen (no fabricated speed control). `actingEnabled` can provide bounded style instructions to Base/CustomVoice, but voice consistency requires listening tests. VoiceDesign uses its fixed registry instruction. For lowest latency during gameplay keep frequently used NPC voices in the same family.

## Remaining acceptance and phased upgrades

**A — now implemented, GTA pending:** test new provider against the existing radio-deployed companion; verify server health, first PCM, correct voice for Nathan, response cancellation under player takeover, exact-generation native authorization and final PlaybackEnded receipt, no stale history or audio, hot reuse, failure behavior and return to OpenAI. Do not treat offline evidence as physical GTA acceptance.

**B — later (not implemented):** proper character voice studio for recording/importing references, generation and A/B preview, save/cancel, explicit per-character voice updates, VoiceDesign-to-Base-clone promotion and local asset revision tracking. No dropdown needed for current file-toggle milestone.

**C — later (not implemented):** benchmark RTX 5090 VRAM and GTA frame pacing, model load/warmup, GPU contention, prompt/conditioning cache, different NPC families, language/expressiveness fidelity, streaming gaps and optional prewarming policy. Only then choose default production model.

**GTA gate:** the exact installed companion and DLL hash, radio and PS4 baseline still need separate verification. Do not merge PR #32 merely because this provider PR is ready; avoid any GTA deployment or modifying private config until authorized.

## Offline Luna-to-Qwen conversation smoke (no GTA required)

This PR includes a **runnable, end-to-end local turn test** that uses the real
patched LSA stock controller, validates a Luna-format dialogue decision, calls
the production Faster Qwen speech provider, streams 24-kHz PCM through the
real LSA authorization and history gates, and simulates matching native
`npcAudioTurnAccepted` / `npcPlaybackEnded` receipts. The generated voice is
saved as a WAV so you can hear it outside GTA. This is **not** a native DLL
execution or real GTA audio-rendering test.

With the Faster Qwen service running, and a private `e1.config.json` configured
with your registered Qwen voice(s), run from `lsa-essential-e1-candidate`:

```powershell
npm run smoke:qwen -- --voice nathan --reply "Hey, it's Nathan. How do I sound?"
```

- This sends **no OpenAI request** by default. It simulates Luna returning the
  exact `{ dialogue, command: "" }` shape used in the non-streaming pipeline.
  It sends a **real HTTP request** to your local Qwen service and saves
  `outputs/qwen-smoke/nathan.wav`.
- To exercise an **actual Luna API decision** immediately followed by local
  Qwen TTS, run:
  ```powershell
  npm run smoke:qwen -- --voice nathan --live-luna --prompt "Nathan, say a quick hello."
  ```
  This mode **uses your OpenAI reasoning API key and incurs API usage**. The key
  is read from the existing private `.env` or environment variables, never
  transmitted to the local Qwen service. The validated Luna dialogue (not
  model-generated arbitrary instructions) is forwarded as Qwen's text input.
- Choose a unique `--out` path to retain multiple WAV comparisons. `--voice`
  must be an ID from the configured `qwenTts.speechVoices` list and local
  `voices.json`. The test does not edit those files, your character store,
  game settings, radio installation or GTA directory.
- This deliberately exercises the **buffered single-response** path. The
  existing early segmented streaming path has separate tests and still needs
  physical GTA acceptance. Simulated native acknowledgment demonstrates
  in-process sequencing, **not** actual native playback quality or the real
  Essential DLL.
- Check `status: completed`, `pcmBytes > 0`, the selected voice, and the
  saved WAV. If local Qwen is not running or returns invalid audio, the test
  fails without writing a pretend successful WAV.

CI tests use deterministic fake HTTP Responses and run without GPU, OpenAI
credits or GTA. They exercise both simulated and opt-in Luna routes, ensure
Qwen never receives the OpenAI key, verify the PCM/WAV format and playback
history contract, and check fail-closed cases.
