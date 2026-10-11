# Ten-prompt OpenAI vs Faster Qwen3-TTS benchmark

**PR #39 only.** Runs entirely outside GTA; does not deploy, edit the installed game or update persistent characters.

## What gets compared

**A — TTS-only:** Ten identical NPC dialogue replies sent independently to the existing OpenAI speech provider and to the production local Qwen speech provider. This directly compares first usable PCM, total generation time, speech duration, PCM chunk count, inter-chunk arrival gaps and real-time factor. Each response is saved as a playable 24 kHz WAV. Providers alternate order across the ten pairs.

**B — Full LSA conversation:** Ten identical player prompts per provider, processed using the **actual patched LSA stock controller**, the same GPT-6 Luna configuration and the production TTS providers. The OpenAI path preserves **structured streaming + early TTS**, while Qwen uses the **currently supported buffered path**. Luna is contacted separately for each run, so text and Luna latency may differ. This tests realistic architecture, **not** pure TTS speed. It also records model request start, last observed model response byte, first TTS request and PCM delivery.

Both phases save CSV, JSON, Markdown summary, per-prompt WAVs and median/p90/win counts. No live transcript text or credentials appear in reports. The native GTA acknowledgments are simulated, so this does not prove spatial audio or physical playback.

## Windows preparation

1. Check out PR #39 and use the **already installed Faster Qwen3-TTS venv**. No new packages needed.
2. Keep a local ignored voice registry at lsa-essential-e1-candidate/tools/qwen/voices.json. Set up an existing clone/CustomVoice/VoiceDesign voice ID as documented in FASTER-QWEN3-TTS-INTEGRATION.md. The chosen voice must match the CLI option.
3. Keep the existing checkout-local private e1.config.json and .env in the normal configuration locations. They are only read, never changed. Set qwenTts.baseUrl to http://127.0.0.1:8000/v1; retain your existing OpenAI TTS model/voice and Luna credentials.
4. In lsa-essential-e1-candidate start the server with the already installed venv:

    & 'C:\Users\Chris.COMRADE\Documents\Codex\faster-qwen3-tts\.venv\Scripts\python.exe' tools/qwen/lsa_qwen_server.py --voices tools/qwen/voices.json --port 8000 --device cuda

5. Confirm http://127.0.0.1:8000/health is responding. In another terminal in lsa-essential-e1-candidate run the benchmark.

## Commands

Usage: no network calls:

    node tools/qwen/compare_tts_benchmark.mjs --help

**First run A only:** 20 measured TTS requests (10 to each), plus one OpenAI and one Qwen warmup:

    node tools/qwen/compare_tts_benchmark.mjs --mode tts --openai-voice ash --qwen-voice nathan --allow-billing

**Then optionally B:** 20 live Luna requests plus 10 or more TTS requests and two warmups:

    node tools/qwen/compare_tts_benchmark.mjs --mode conversation --openai-voice ash --qwen-voice nathan --allow-billing

The mode can also be both. **All live calls are billable and require the explicit --allow-billing flag.** No live calls execute in CI. A fixed ten-pair cap prevents surprise large batches. No npm install is required; Node can launch the CLI directly.

One OpenAI and one Qwen warmup happen before measured cases. This excludes Qwen cold loading/warmup from warm timing, but preserves that cost as a separate report figure. Alternating provider order reduces drift. Other GPU use, requests to external services, model load/unload and internet variability still affect results.

Default output is untracked under lsa-essential-e1-candidate/outputs/qwen-benchmark/<timestamp>/:

- report.md: human-readable comparisons, pairs, medians, p90 and first-PCM wins.
- results.csv and results.json: numeric records for all attempted requests, including failures.
- tts/openai and tts/qwen WAVs; conversation/openai and conversation/qwen WAVs.

Use --out with a local output directory if desired. Never check in recordings, private configs, credentials or generated reports.

## Offline verification

    node --check tools/qwen/compare_tts_benchmark.mjs
    node --test tests/qwen-benchmark.test.mjs

Tests mock network responses only; they exercise the real provider modules and patched controller with real PCM parsing but no external API, installed GTA, GPU or real payments.

## Interpretation

Stage A answers which engine starts speaking faster **once the exact dialogue text is known**. Negative Qwen-minus-OpenAI paired first-PCM median indicates Qwen is faster.

Stage B answers which current LSA architecture reaches first PCM faster for **the same player requests**. OpenAI starts synthesizing validated segments before the complete Luna response; Qwen waits for the buffered result. This distinction matters: Stage B outcomes cannot be attributed only to the TTS providers. If Stage A favors Qwen and Stage B favors OpenAI, consider a separately tested early-segment Qwen integration. It is not implemented by this benchmark.
