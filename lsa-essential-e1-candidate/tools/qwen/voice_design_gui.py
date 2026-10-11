import os
import sys
import traceback
from pathlib import Path
INSTALL_DIR = Path(os.environ.get(
    "FASTER_QWEN_TTS_HOME",
    Path.home() / "Documents" / "Codex" / "faster-qwen3-tts",
)).expanduser()
os.environ.setdefault("HF_HOME", str(INSTALL_DIR / "hf-cache"))
os.environ.setdefault("HF_HUB_OFFLINE", "1")

OUTPUT_DIR = INSTALL_DIR / "voice-design-output"
MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"
LOG_PATH = OUTPUT_DIR / "voice_design_gui.log"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# pythonw.exe starts GUI programs without console streams. Transformers/tqdm
# and some audio dependencies write progress and warnings to stderr/stdout.
_log_stream = None
if sys.stdout is None or sys.stderr is None:
    _log_stream = open(LOG_PATH, "a", encoding="utf-8", buffering=1)
    if sys.stdout is None:
        sys.stdout = _log_stream
    if sys.stderr is None:
        sys.stderr = _log_stream

import queue
import threading
import time
from datetime import datetime
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import numpy as np
import soundfile as sf
import torch
from huggingface_hub import snapshot_download
from faster_qwen3_tts import FasterQwen3TTS

class VoiceDesignApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Local Qwen3-TTS VoiceDesign")
        self.root.geometry("820x760")
        self.root.minsize(650, 600)
        self.events = queue.Queue()
        self.model = None
        self.busy = False
        self.last_output = None

        outer = ttk.Frame(root, padding=18)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="Create a voice", font=("Segoe UI", 18, "bold")).pack(anchor="w")
        ttk.Label(outer, text="Paste the exact words to speak and describe the voice. The local VoiceDesign model stays loaded while this window is open.", wraplength=760).pack(anchor="w", pady=(4, 14))

        ttk.Label(outer, text="Text to speak", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        text_frame = ttk.Frame(outer)
        text_frame.pack(fill="both", expand=True, pady=(4, 12))
        self.text_box = tk.Text(text_frame, height=9, wrap="word", undo=True, font=("Segoe UI", 11))
        text_scroll = ttk.Scrollbar(text_frame, orient="vertical", command=self.text_box.yview)
        self.text_box.configure(yscrollcommand=text_scroll.set)
        self.text_box.pack(side="left", fill="both", expand=True)
        text_scroll.pack(side="right", fill="y")

        ttk.Label(outer, text="Voice instruction", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        instruction_frame = ttk.Frame(outer)
        instruction_frame.pack(fill="both", expand=True, pady=(4, 12))
        self.instruction_box = tk.Text(instruction_frame, height=11, wrap="word", undo=True, font=("Segoe UI", 11))
        instruction_scroll = ttk.Scrollbar(instruction_frame, orient="vertical", command=self.instruction_box.yview)
        self.instruction_box.configure(yscrollcommand=instruction_scroll.set)
        self.instruction_box.pack(side="left", fill="both", expand=True)
        instruction_scroll.pack(side="right", fill="y")

        controls = ttk.Frame(outer)
        controls.pack(fill="x", pady=(2, 8))
        self.generate_button = ttk.Button(controls, text="Generate WAV…", command=self.choose_output_and_generate)
        self.generate_button.pack(side="left")
        ttk.Button(controls, text="Open output folder", command=self.open_output_folder).pack(side="left", padx=(8, 0))

        self.status_var = tk.StringVar(value="Ready. First generation loads and warms the model.")
        ttk.Label(outer, textvariable=self.status_var, wraplength=760).pack(anchor="w", pady=(8, 2))
        self.output_var = tk.StringVar(value=f"WAVs are saved in: {OUTPUT_DIR}")
        ttk.Label(outer, textvariable=self.output_var, wraplength=760, foreground="#555555").pack(anchor="w")
        ttk.Label(outer, text="Runs locally on the CUDA GPU. Close this window to release the model from VRAM.", wraplength=760, foreground="#555555").pack(anchor="w", pady=(8, 0))

        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.root.after(150, self.poll_events)

    def choose_output_and_generate(self):
        text = self.text_box.get("1.0", "end-1c").strip()
        instruction = self.instruction_box.get("1.0", "end-1c").strip()
        if not text:
            messagebox.showwarning("Text needed", "Paste the words you want spoken.", parent=self.root)
            return
        if not instruction:
            messagebox.showwarning("Voice instruction needed", "Describe the voice you want.", parent=self.root)
            return
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"voice_design_{datetime.now().strftime('%Y%m%d_%H%M%S')}.wav"
        output_path = filedialog.asksaveasfilename(
            parent=self.root,
            title="Save generated speech",
            initialdir=str(OUTPUT_DIR),
            initialfile=filename,
            defaultextension=".wav",
            filetypes=[("WAV audio", "*.wav")],
        )
        if not output_path:
            return
        if not output_path.lower().endswith(".wav"):
            output_path += ".wav"
        self.busy = True
        self.generate_button.configure(state="disabled")
        self.status_var.set("Starting generation…")
        self.events.put(("begin", output_path))
        thread = threading.Thread(target=self.generate, args=(text, instruction, Path(output_path)), daemon=True)
        thread.start()

    def generate(self, text, instruction, output_path):
        try:
            if not torch.cuda.is_available():
                raise RuntimeError("CUDA is unavailable. This app expects the RTX 5090 environment.")
            if self.model is None:
                self.events.put(("status", "Loading cached VoiceDesign model on the GPU…"))
                local_model = snapshot_download(MODEL_ID, local_files_only=True)
                self.model = FasterQwen3TTS.from_pretrained(
                    local_model, device="cuda", dtype=torch.bfloat16
                )
                self.events.put(("status", "Warming up the model (first run only)…"))
                self.model.warmup(prefill_len=100)
            self.events.put(("status", "Generating speech…"))
            chunks = []
            sample_rates = set()
            for audio, sample_rate, _timing in self.model.generate_voice_design_streaming(
                text=text,
                language="English",
                instruct=instruction,
                chunk_size=8,
                max_new_tokens=2048,
            ):
                sample_rates.add(int(sample_rate))
                part = np.asarray(audio, dtype=np.float32).reshape(-1)
                if part.size:
                    chunks.append(part)
                    self.events.put(("progress", len(chunks)))
            if not chunks:
                raise RuntimeError("The model returned no audio chunks.")
            if sample_rates != {24000}:
                raise RuntimeError(f"Expected 24 kHz audio; received sample rate(s) {sorted(sample_rates)}.")
            output_path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(output_path, np.concatenate(chunks), 24000, subtype="PCM_16")
            self.events.put(("complete", str(output_path), len(chunks)))
        except Exception as exc:
            details = traceback.format_exc()
            try:
                print(details, file=sys.stderr)
            except Exception:
                pass
            self.events.put(("error", f"{type(exc).__name__}: {exc}\n\nDetails: {LOG_PATH}"))

    def poll_events(self):
        try:
            while True:
                event = self.events.get_nowait()
                kind = event[0]
                if kind == "begin":
                    self.status_var.set("Preparing…")
                    self.output_var.set(f"Saving to: {event[1]}")
                elif kind == "status":
                    self.status_var.set(event[1])
                elif kind == "progress":
                    self.status_var.set(f"Streaming audio… {event[1]} chunks received")
                elif kind == "complete":
                    self.busy = False
                    self.generate_button.configure(state="normal")
                    self.last_output = event[1]
                    self.status_var.set(f"Done — {event[2]} chunks written.")
                    self.output_var.set(f"Saved WAV: {event[1]}")
                elif kind == "error":
                    self.busy = False
                    self.generate_button.configure(state="normal")
                    self.status_var.set("Generation failed. The model remains available for another attempt if it loaded.")
                    messagebox.showerror("Generation failed", event[1], parent=self.root)
        except queue.Empty:
            pass
        self.root.after(150, self.poll_events)

    def open_output_folder(self):
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(str(OUTPUT_DIR))

    def close(self):
        if self.busy and not messagebox.askyesno("Close app?", "Generation is still running. Close and interrupt it?", parent=self.root):
            return
        self.root.destroy()

if __name__ == "__main__":
    try:
        app_root = tk.Tk()
        VoiceDesignApp(app_root)
        app_root.mainloop()
    except Exception:
        print(traceback.format_exc(), file=sys.stderr)
        raise
