# Parakeet Ultra STT with optional OpenAI fallback

Status: companion implementation and mock-driven tests in source; live Photon/GTA acceptance **not yet performed**. This change is stacked on Qwen TTS PR #39 and does not change native microphone capture, actor identity, Luna, radio perception, or TTS playback.

## Provider settings

Back up and edit private e1.config.json. Preserve existing unrelated settings:

    "transcriptionProvider": "parakeet-ultra",
    "parakeetStt": {
      "baseUrl": "http://127.0.0.1:8001/v1",
      "timeoutMs": 2000,
      "fallback": "openai"
    }

- transcriptionProvider: openai (default, current behavior) or parakeet-ultra.
- fallback: openai (default, sends the same microphone recording to OpenAI if technical local inference fails) or off (strictly local STT; fail the turn instead).
- Speech output remains separately selectable: OpenAI or Faster Qwen3-TTS. Luna remains unchanged.
- Fallback applies to unavailable/busy/5xx local inference, timeout, malformed/empty local transcription. It **does not** apply to invalid source audio, local 4xx protocol mismatch or user cancellation; it cannot detect semantically misheard words.
- A single invocation makes at most one cloud fallback call after a local failure. The existing E1 outer provider-retry policy may separately initiate another bounded attempt.
- OpenAI transcription API credentials must remain available for fallback. Switching back to "transcriptionProvider": "openai" bypasses the local server entirely.

## Installation (Windows RTX 5090)

Use a separate Python 3.10–3.14 virtual environment from Qwen TTS. From lsa-essential-e1-candidate:

    py -3.11 -m venv .venv-stt
    .venv-stt\Scripts\python -m pip install --upgrade "moondream>=2.4.1"
    .venv-stt\Scripts\python tools/stt/parakeet_server.py --port 8001

Moondream Photon downloads model weights on first startup. When the process prints "[STT] ready", GET http://127.0.0.1:8001/health should report "ready". First inference may still compile CUDA kernels and may be slower. Preloading at service start is not a guaranteed warmed inference benchmark.

The Python server binds exclusively to 127.0.0.1. Its POST /v1/audio/transcriptions endpoint accepts raw 16-kHz mono PCM16 bytes, maximum 30 seconds, and sends JSON text. No character/session identifier, API key, WAV file path or transcript is written by the Node adapter. The server does not log audio or recognized text. It serializes GPU inference; concurrent requests return HTTP 503 to enable fallback. Protect the loopback port from other untrusted local processes.

## Validation

- Offline focused: config and endpoint validation, exact PCM transfer, no key/identity forwarding, OpenAI-only route, local success, unavailable/malformed/timeout fallback, opt-out, 4xx and cancellation.
- Local: install Moondream, validate Photon loads moondream/parakeet-ultra on the 5090 and real PCM yields transcription. CI cannot assert local GPU acceptance.
- GTA: measure push-to-talk release -> transcript, transcript -> Luna, and first audible NPC PCM separately (cold/warm p50/p95); compare against OpenAI gpt-transcribe on identical utterances; verify cancellation and character switching, Qwen TTS GPU contention and GTA frame pacing. Tune timeout after measurement.
- **No native streaming partials:** this version only processes completed push-to-talk microphone turns. A true streaming-capture/STT path would be a separate phase and likely require native microphone transport changes.
- Roll back with transcriptionProvider = openai, or stop this sidecar. No Essential DLL changes are required for batch mode.

Moondream model: https://huggingface.co/moondream/parakeet-ultra (CC-BY-4.0; attribute Moondream and NVIDIA).
Photon API: https://docs.moondream.ai/transcription/
