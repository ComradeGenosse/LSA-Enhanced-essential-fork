# S4 — Focused Qwen latency profiling (PR #39)

**Status:** Instrumentation and offline regression implemented. GPU bottleneck and RTX 5090 performance are **not yet experimentally verified**; run this on the user's machine. **No GTA deployment changes, no TTS behavior changes, no new AI model, no cloud/API cost.**

## Why profile before tuning?

October 11 GTA logs show Qwen voice-clone chunk gaps around 1.1–1.25 s, approximately 1.8–1.9 s to first PCM and synthesis duration exceeding the audio duration (for example 7.68 s of audio in 14.65 s wall time). Queue and GPU lock waits were negligible. Adaptive buffering reduced underrun risk but delayed first playable audio. These numbers alone do **not** prove which CUDA kernels, GPU contention, or host conversion costs are responsible.

## Install and run

1. Pull the **existing PR #39 head** on your test machine. Keep the same Faster Qwen3-TTS environment, `tools/qwen/voices.json`, voice reference, model family and Qwen base URL. Use your RTX 5090 as the active CUDA device.
2. Restart the Qwen Python server using the existing installation command, adding **`--profile`**. Example from `lsa-essential-e1-candidate`:

   ```powershell
   & '<path-to-your-qwen-venv>\Scripts\python.exe' tools/qwen/lsa_qwen_server.py --voices tools/qwen/voices.json --port 8000 --device cuda --profile
   ```

   Confirm `http://127.0.0.1:8000/health` reports `"profiling": true`, `"device": "cuda"`. The profile logs in the existing sidecar console/server.log have IDs that match companion logs.
3. With **GTA fully closed**, run (from `lsa-essential-e1-candidate`):

   ```powershell
   node tools/qwen/profile_qwen_latency.mjs --scenario gta-closed --voice nathan --runs 3
   ```

4. **Leave Qwen running without changing the voice or model.** Launch GTA and leave it idle in the world, then:

   ```powershell
   node tools/qwen/profile_qwen_latency.mjs --scenario gta-idle --voice nathan --runs 3
   ```

5. **Same GTA graphical settings, under typical gameplay GPU load.** Run it again while GTA is actively rendering/busy (e.g. while driving or a representative scene), preferably avoiding loading screens:

   ```powershell
   node tools/qwen/profile_qwen_latency.mjs --scenario gta-gameplay --voice nathan --runs 3
   ```

6. Collect `outputs/qwen-profile/{gta-closed,gta-idle,gta-gameplay}/results.json` and `report.md` plus **the matching Qwen sidecar server.log and LSA telemetry from a short in-GTA talk test**. Run identical lines under your normal configured adaptive buffering for the in-GTA comparison. The CLI does **not** turn on GTA or perform an in-game conversation; it calls the local synthesizer directly.

Optional flags: `--gpu-index 0` (physical NVIDIA index shown by nvidia-smi; may differ from CUDA device indices), `--gpu-sample-ms 500` (250–2000), `--no-gpu` (no nvidia-smi), `--base-url http://127.0.0.1:8000/v1`, `--out <local-folder>`. Run `node tools/qwen/profile_qwen_latency.mjs --help` for usage. The same three fixed short, medium and long fixture texts are used each time; one Qwen short-line warmup is excluded from recorded measurements. The tool does not load credentials, OpenAI/Luna, microphone, or game files. No waveform or text transcripts are written.

## New metrics and interpretation

| Layer | Source | Key signals | What it rules in/out |
|---|---|---|---|
| GPU/model initialization | sidecar `tts_model_init` | model family, torch/CUDA device/GPU name, cold model load, model warmup | wrong device, repeated cold model swaps, startup penalty |
| Per-request model inference | sidecar `tts_profile` | model-ready time; total/max `next(generator)` wall time; first generator yield; PCM conversion; queue wait; memory allocated | model generator vs CPU PCM conversion vs backpressure |
| Generated PCM and gaps | sidecar `tts_summary` | first PCM, audio milliseconds, chunks, max gap, total wall | audio produced vs wall time / per-chunk stalls |
| Device-wide GPU contention | `results.json` nvidia-smi samples | utilization, GPU memory used/total, clocks, temperature, power | closed vs idle vs gameplay GPU pressure (other GPU processes included) |
| HTTP transport | profile `results.json` | response headers, first PCM read, full body, reads, RTF | local HTTP stream/host scheduling vs synthesis |
| Companion buffering | LSA `qwen_tts_timing_summary` | **headersLatencyMs, firstReadLatencyMs, firstForwardLatencyMs, bufferedBeforeForwardMs, readCompletionLatencyMs, deliveryCompletionLatencyMs** | distinguishes fast first chunk from deliberate buffering and slow native forwarding |
| Physical playback | normal LSA/native telemetry | playback start/ended receipts | validates what GTA actually audibly plays; not equivalent to first PCM handed to native |

**Important constraints:** PyTorch CUDA runs asynchronously, so `next(generator)` wall time without synchronization is **not** precise GPU kernel execution time; numpy conversion may force synchronization. Device-wide `nvidia-smi` is not Qwen-exclusive. PyTorch allocated VRAM is not total driver/device VRAM. This instrumentation **does not claim CUDA graphs are active**: model initialization logs `cuda_graph_status=unverified` until upstream-runtime validation. Default `--profile` avoids forced CUDA synchronization to preserve realistic timing.

Only after ordinary measurements, optionally perform a **separate intrusive run** by restarting the server with `--profile-cuda-sync`, then `--scenario cuda-sync`. The flag forces GPU synchronization around each generator yield and **changes throughput/latency**; do not compare it as a normal production baseline. Do not enable for ordinary GTA play.

### Decision tree for S4 optimization

- **Closed case already slow, high generator time, low conversion/queue wait:** inspect Faster Qwen kernel/runtime version, true CUDA graph capture/replay, attention backend, token/chunk size and any unintended CPU execution. Optimize inference before further playback buffer changes.
- **Sharp slowdown only GTA idle/gameplay:** investigate GPU contention, memory pressure, power/clock changes, scheduling and graphics workload. Re-run at matching scenes and settings before claiming causality.
- **Generator fast, conversion time large:** target numpy/tensor device-to-host transfer and PCM conversion, not LSA buffering.
- **Sidecar first chunk fast, but companion first forward late:** adaptive or full-utterance prebuffer rules dominate latency; retune only after generator can replenish playback.
- **Companion forwards early but GTA speaks late:** inspect native authorization/playback queue, not Qwen synthesis.

### Acceptance for profiling step

- New tool runs with **no OpenAI requests, no GPU requirement in CI, no game modifications**.
- Linux and Windows offline unit tests validate loopback protection, deterministic aggregation, PCM parsing, error reporting and help.
- Profile logs report request IDs and no dialogue text/audio/keys. **Never commit local results**; the existing outputs/ ignore applies.
- No claim of meeting the desired <3 s playable speech or >1x real-time synthesis until actual machine runs confirm it.
