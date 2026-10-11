#!/usr/bin/env python3
"""Loopback-only Faster Qwen3-TTS service for LSA.

Voice IDs and reference files are declared by the user in a local JSON registry,
not by the model or an incoming HTTP request. Supports Base voice clone,
CustomVoice built-in speakers, and VoiceDesign prompts. One GPU model is resident
at a time; changing a model family is a costly, serialized operation.
"""
import argparse
import asyncio
import gc
import json
import logging
from pathlib import Path
import queue
import re
import threading
import time
import uuid

import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

LOGGER = logging.getLogger("lsa.qwen")
MODEL_IDS = {
    "clone": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "custom": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "design": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
}
VOICE_ID = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
SPEAKER_ID = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
app = FastAPI(title="LSA Faster Qwen3-TTS")
voices = {}
device = "cuda"
active_model = None
active_family = None
gpu_lock = threading.Lock()
profile_enabled = False
profile_cuda_sync = False


def cuda_memory_mib():
    """A snapshot, not total GPU usage (other processes are excluded)."""
    if device != "cuda" or not torch.cuda.is_available():
        return None
    return round(torch.cuda.memory_allocated() / (1024 * 1024), 1)


class SpeechRequest(BaseModel):
    model: str = "qwen3-tts"
    input: str = Field(min_length=1, max_length=3000)
    voice: str = Field(min_length=1, max_length=32)
    response_format: str = "pcm"
    instructions: str = Field(default="", max_length=1024)


def load_voices(filename):
    registry_path = Path(filename).resolve()
    raw = json.loads(registry_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw or len(raw) > 32:
        raise ValueError("voices must be a nonempty map with at most 32 IDs")
    result = {}
    for name, value in raw.items():
        if not isinstance(name, str) or not VOICE_ID.fullmatch(name) or not isinstance(value, dict):
            raise ValueError("Invalid voice ID or descriptor")
        mode = value.get("mode")
        if mode not in MODEL_IDS:
            raise ValueError(f"Invalid voice mode: {name}")
        allowed = {
            "clone": {"mode", "ref_audio", "ref_text", "language", "chunk_size", "instruct"},
            "custom": {"mode", "speaker", "language", "chunk_size", "instruct"},
            "design": {"mode", "instruct", "language", "chunk_size"},
        }[mode]
        if set(value) - allowed:
            raise ValueError(f"Unsupported fields for {name}")
        item = dict(value)
        item["language"] = item.get("language", "English")
        if not isinstance(item["language"], str) or not 1 <= len(item["language"]) <= 64:
            raise ValueError(f"Invalid language for {name}")
        item["chunk_size"] = item.get("chunk_size", 8)
        if type(item["chunk_size"]) is not int or not 4 <= item["chunk_size"] <= 32:
            raise ValueError(f"Invalid chunk_size for {name}")
        if mode == "clone":
            ref = item.get("ref_audio")
            if not isinstance(ref, str) or not ref:
                raise ValueError(f"Missing clone reference for {name}")
            path = (registry_path.parent / ref).resolve()
            if not path.is_file() or path.suffix.lower() not in (".wav", ".flac", ".mp3") or path.stat().st_size > 20 * 1024 * 1024:
                raise ValueError(f"Invalid clone reference for {name}")
            item["ref_audio"] = str(path)
            if not isinstance(item.get("ref_text", ""), str) or len(item.get("ref_text", "")) > 4000:
                raise ValueError(f"Invalid reference transcript for {name}")
        if mode == "custom" and (not isinstance(item.get("speaker"), str) or not SPEAKER_ID.fullmatch(item["speaker"])):
            raise ValueError(f"Invalid speaker for {name}")
        if mode == "design" and (not isinstance(item.get("instruct"), str) or not 1 <= len(item["instruct"]) <= 1024):
            raise ValueError(f"Invalid design instruction for {name}")
        if "instruct" in item and (not isinstance(item["instruct"], str) or len(item["instruct"]) > 1024):
            raise ValueError(f"Invalid instruction for {name}")
        result[name] = item
    return result


def get_model(family):
    global active_model, active_family
    if family == active_family and active_model is not None:
        return active_model
    # No simultaneous large model residency. GPU calls are serialized by gpu_lock.
    active_model = None
    active_family = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    from faster_qwen3_tts import FasterQwen3TTS
    model_load_started = time.perf_counter()
    model = FasterQwen3TTS.from_pretrained(
        MODEL_IDS[family], device=device, dtype=torch.bfloat16 if device == "cuda" else torch.float32
    )
    if model.sample_rate != 24000:
        raise RuntimeError("LSA requires 24kHz output; never reinterpret or forward a different sample rate")
    model_load_ms = (time.perf_counter() - model_load_started) * 1000
    warmup_started = time.perf_counter()
    model.warmup(prefill_len=100)
    warmup_ms = (time.perf_counter() - warmup_started) * 1000
    if profile_enabled:
        gpu_name = torch.cuda.get_device_name(torch.cuda.current_device()) if device == "cuda" and torch.cuda.is_available() else "cpu"
        LOGGER.info("tts_model_init family=%s device=%s gpu=%s torch=%s load_ms=%.1f warmup_ms=%.1f "
                    "cuda_graph_status=unverified",
                    family, device, gpu_name.replace(" ", "_"), torch.__version__, model_load_ms, warmup_ms)
    active_model, active_family = model, family
    LOGGER.info("Ready: %s at 24000 Hz", family)
    return model


def generate(model, voice, text, instructions):
    mode = voice["mode"]
    common = {"text": text, "language": voice["language"], "chunk_size": voice["chunk_size"]}
    if mode == "clone":
        # The 1.7B Base model accepts instruct; prompts are opt-in per LSA acting.
        return model.generate_voice_clone_streaming(
            **common, ref_audio=voice["ref_audio"], ref_text=voice.get("ref_text", ""),
            instruct=instructions or voice.get("instruct") or None,
        )
    if mode == "custom":
        return model.generate_custom_voice_streaming(
            **common, speaker=voice["speaker"],
            instruct=instructions or voice.get("instruct") or None,
        )
    return model.generate_voice_design_streaming(
        **common, instruct=voice["instruct"],  # Stable voice identity is not guaranteed here.
    )


@app.get("/health")
def health():
    return {"status": "ok", "active_model_family": active_family,
            "voice_count": len(voices), "sample_rate": 24000,
            "device": device, "profiling": profile_enabled, "cuda_sync": profile_cuda_sync}


@app.post("/v1/audio/speech")
async def speech(payload: SpeechRequest, request: Request):
    if payload.model != "qwen3-tts" or payload.response_format != "pcm":
        raise HTTPException(400, "Only qwen3-tts raw PCM is accepted")
    voice = voices.get(payload.voice)
    if voice is None:
        raise HTTPException(400, "Unknown registered voice")
    if not payload.input.strip():
        raise HTTPException(400, "Empty dialogue")
    # Each request is coupled to one voice descriptor; no caller-supplied paths.
    messages = queue.Queue(maxsize=8)
    ended = threading.Event()
    done = object()
    request_id = "rid_" + uuid.uuid4().hex[:16]
    started = time.perf_counter()
    LOGGER.info("tts_request id=%s mode=%s text_chars=%d", request_id, voice["mode"], len(payload.input))

    def produce():
        model_ready_ms = 0.0
        model_switched = False
        generator_next_ms = 0.0
        max_next_ms = 0.0
        convert_ms = 0.0
        first_generator_yield_ms = None
        memory_before_mib = None
        memory_after_mib = None
        samples = 0
        chunks = 0
        lock_wait_ms = 0.0
        blocked_ms = 0.0
        max_gap_ms = 0.0
        first_pcm_ms = None
        last_pcm_at = None
        outcome = "finished"
        try:
            lock_started = time.perf_counter()
            with gpu_lock:
                lock_wait_ms = (time.perf_counter() - lock_started) * 1000
                model_switched = voice["mode"] != active_family
                model_start = time.perf_counter()
                model = get_model(voice["mode"])
                model_ready_ms = (time.perf_counter() - model_start) * 1000
                if profile_enabled:
                    memory_before_mib = cuda_memory_mib()
                stream = iter(generate(model, voice, payload.input, payload.instructions))
                while not ended.is_set():
                    # Synchronization is intentionally OFF by default: it can
                    # serialize CUDA work and alter the latency under study.
                    if profile_cuda_sync and device == "cuda" and torch.cuda.is_available():
                        torch.cuda.synchronize()
                    next_started = time.perf_counter()
                    try:
                        chunk, sr, _ = next(stream)
                        if profile_cuda_sync and device == "cuda" and torch.cuda.is_available():
                            torch.cuda.synchronize()
                    except StopIteration:
                        break
                    next_elapsed_ms = (time.perf_counter() - next_started) * 1000
                    generator_next_ms += next_elapsed_ms
                    max_next_ms = max(max_next_ms, next_elapsed_ms)
                    if first_generator_yield_ms is None:
                        first_generator_yield_ms = (time.perf_counter() - started) * 1000
                    if sr != 24000:
                        raise RuntimeError("Unexpected sample rate")
                    convert_started = time.perf_counter()
                    pcm = np.asarray(chunk, dtype=np.float32).reshape(-1)
                    raw = (np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes()
                    convert_ms += (time.perf_counter() - convert_started) * 1000
                    now = time.perf_counter()
                    if last_pcm_at is not None:
                        gap_ms = (now - last_pcm_at) * 1000
                        max_gap_ms = max(max_gap_ms, gap_ms)
                        if gap_ms > 350 and chunks < 20:
                            LOGGER.warning("tts_chunk_gap id=%s gap_ms=%.1f chunk=%d",
                                           request_id, gap_ms, chunks + 1)
                    elif first_pcm_ms is None:
                        first_pcm_ms = (now - started) * 1000
                    last_pcm_at = now
                    samples += pcm.size
                    chunks += 1
                    queue_started = time.perf_counter()
                    while not ended.is_set():
                        try:
                            messages.put(raw, timeout=0.1)
                            break
                        except queue.Full:
                            pass
                    blocked_ms += (time.perf_counter() - queue_started) * 1000
        except Exception:
            outcome = "failed"
            LOGGER.exception("Qwen generation failed id=%s", request_id)
            while not ended.is_set():
                try:
                    messages.put(RuntimeError("Qwen generation failed"), timeout=0.1)
                    break
                except queue.Full:
                    pass
        finally:
            if profile_enabled:
                try:
                    memory_after_mib = cuda_memory_mib()
                except Exception:
                    # Profiling must never cause an otherwise successful TTS failure.
                    memory_after_mib = None
                LOGGER.info(
                    "tts_profile id=%s outcome=%s mode=%s device=%s chunk_size=%d "
                    "cuda_sync=%s switched=%s model_ready_ms=%.1f generator_next_ms=%.1f "
                    "generator_next_max_ms=%.1f first_generator_yield_ms=%s convert_ms=%.1f "
                    "queue_wait_ms=%.1f audio_ms=%.1f chunks=%d "
                    "torch_mem_before_mib=%s torch_mem_after_mib=%s",
                    request_id, outcome, voice["mode"], device, voice["chunk_size"],
                    profile_cuda_sync, model_switched, model_ready_ms, generator_next_ms,
                    max_next_ms, round(first_generator_yield_ms, 1) if first_generator_yield_ms is not None else None,
                    convert_ms, blocked_ms, samples / 24.0, chunks, memory_before_mib, memory_after_mib
                )
            if ended.is_set() and outcome == "finished":
                outcome = "cancelled"
            LOGGER.info(
                "tts_summary id=%s outcome=%s mode=%s wall_ms=%.1f lock_wait_ms=%.1f "
                "first_pcm_ms=%s chunks=%d audio_ms=%.1f max_chunk_gap_ms=%.1f "
                "queue_wait_ms=%.1f",
                request_id, outcome, voice["mode"], (time.perf_counter() - started) * 1000,
                lock_wait_ms, round(first_pcm_ms, 1) if first_pcm_ms is not None else None,
                chunks, samples / 24.0, max_gap_ms, blocked_ms
            )
            while not ended.is_set():
                try:
                    messages.put(done, timeout=0.1)
                    break
                except queue.Full:
                    pass

    async def audio():
        worker = threading.Thread(target=produce, daemon=True)
        worker.start()
        try:
            loop = asyncio.get_running_loop()
            while True:
                item = await loop.run_in_executor(None, messages.get)
                if item is done:
                    break
                if isinstance(item, Exception):
                    raise item
                if await request.is_disconnected():
                    break
                yield item
        finally:
            ended.set()

    return StreamingResponse(audio(), media_type="audio/pcm",
                             headers={"x-lsa-sample-rate": "24000", "cache-control": "no-store",
                                      "x-lsa-request-id": request_id})


def main():
    global voices, device, profile_enabled, profile_cuda_sync
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voices", required=True, help="Local voice registry JSON")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    parser.add_argument("--profile", action="store_true",
                        help="Log per-request inference, conversion, warmup, queue and PyTorch memory timings")
    parser.add_argument("--profile-cuda-sync", action="store_true",
                        help="EXPERIMENTAL: synchronize every model chunk to attribute GPU work; changes latency")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    voices = load_voices(args.voices)
    device = args.device
    profile_enabled = args.profile or args.profile_cuda_sync
    profile_cuda_sync = args.profile_cuda_sync
    if profile_cuda_sync and device != "cuda":
        parser.error("--profile-cuda-sync requires --device cuda")
    LOGGER.info("Qwen profile enabled=%s cuda_sync=%s (GPU synchronization changes timing)",
                profile_enabled, profile_cuda_sync)
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
