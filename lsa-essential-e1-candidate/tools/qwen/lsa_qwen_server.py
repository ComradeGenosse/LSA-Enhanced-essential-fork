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
    model = FasterQwen3TTS.from_pretrained(
        MODEL_IDS[family], device=device, dtype=torch.bfloat16 if device == "cuda" else torch.float32
    )
    if model.sample_rate != 24000:
        raise RuntimeError("LSA requires 24kHz output; never reinterpret or forward a different sample rate")
    model.warmup(prefill_len=100)
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
            "voice_count": len(voices), "sample_rate": 24000}


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

    def produce():
        try:
            with gpu_lock:
                model = get_model(voice["mode"])
                for chunk, sr, _ in generate(model, voice, payload.input, payload.instructions):
                    if ended.is_set():
                        break
                    if sr != 24000:
                        raise RuntimeError("Unexpected sample rate")
                    pcm = np.asarray(chunk, dtype=np.float32).reshape(-1)
                    raw = (np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes()
                    while not ended.is_set():
                        try:
                            messages.put(raw, timeout=0.1)
                            break
                        except queue.Full:
                            pass
        except Exception:
            LOGGER.exception("Qwen generation failed")
            try: messages.put_nowait(RuntimeError("Qwen generation failed"))
            except queue.Full: pass
        finally:
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
                             headers={"x-lsa-sample-rate": "24000", "cache-control": "no-store"})


def main():
    global voices, device
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voices", required=True, help="Local voice registry JSON")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    voices = load_voices(args.voices)
    device = args.device
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
