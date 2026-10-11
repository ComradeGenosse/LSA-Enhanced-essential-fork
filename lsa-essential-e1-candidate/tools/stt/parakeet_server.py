#!/usr/bin/env python3
"""Local-only Moondream Photon Parakeet Ultra STT for LSA push-to-talk."""
import argparse
import io
import json
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = "moondream/parakeet-ultra"
RATE = 16000
MAX_PCM = 30 * RATE * 2


def make_wav(pcm):
    memory = io.BytesIO()
    with wave.open(memory, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(RATE)
        writer.writeframes(pcm)
    return memory.getvalue()


def make_handler(speech, inference_lock):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            # Neither audio nor transcripts nor request metadata are logged.
            pass

        def send_json(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                return self.send_json(200, {"status": "ready", "model": MODEL})
            return self.send_json(404, {"error": "not_found"})

        def do_POST(self):
            if self.path != "/v1/audio/transcriptions":
                return self.send_json(404, {"error": "not_found"})
            media = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if media != "application/octet-stream":
                return self.send_json(415, {"error": "unsupported_media"})
            if self.headers.get("X-LSA-Sample-Rate") != str(RATE):
                return self.send_json(400, {"error": "unsupported_sample_rate"})
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                return self.send_json(411, {"error": "content_length_required"})
            if length <= 0 or length % 2 or length > MAX_PCM:
                return self.send_json(413, {"error": "invalid_audio_length"})
            if not inference_lock.acquire(blocking=False):
                return self.send_json(503, {"error": "inference_busy"})
            try:
                pcm = self.rfile.read(length)
                if len(pcm) != length:
                    return self.send_json(400, {"error": "incomplete_audio"})
                result = speech.transcribe(audio=make_wav(pcm), timestamps="none")
                transcript = result.get("text") if isinstance(result, dict) else None
                if not isinstance(transcript, str) or not transcript.strip() or len(transcript) > 8000:
                    return self.send_json(503, {"error": "invalid_transcript"})
                return self.send_json(200, {"text": transcript.strip()})
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as error:
                print("[STT] inference failed:", type(error).__name__, flush=True)
                try:
                    self.send_json(503, {"error": "inference_failed"})
                except (BrokenPipeError, ConnectionResetError):
                    pass
            finally:
                inference_lock.release()

    return Handler


def main():
    parser = argparse.ArgumentParser(description="LSA Parakeet Ultra local STT service")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")

    import moondream as md

    # Load model once at startup. First inference may still initialize CUDA kernels.
    print("[STT] loading", MODEL, flush=True)
    with md.photon(MODEL) as speech:
        gate = threading.Semaphore(1)
        server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(speech, gate))
        server.daemon_threads = True
        try:
            print("[STT] ready on 127.0.0.1:" + str(args.port), flush=True)
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()


if __name__ == "__main__":
    main()
