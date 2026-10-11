@echo off
setlocal

if not defined FASTER_QWEN_TTS_HOME set "FASTER_QWEN_TTS_HOME=%USERPROFILE%\Documents\Codex\faster-qwen3-tts"
if not defined HF_HOME set "HF_HOME=%FASTER_QWEN_TTS_HOME%\hf-cache"
if not defined HF_HUB_OFFLINE set "HF_HUB_OFFLINE=1"

set "PYTHONW=%FASTER_QWEN_TTS_HOME%\.venv\Scripts\pythonw.exe"
if not exist "%PYTHONW%" (
  echo Faster Qwen Python environment not found: "%PYTHONW%"
  echo Set FASTER_QWEN_TTS_HOME to the Faster Qwen installation directory.
  pause
  exit /b 1
)

start "Local Qwen3-TTS VoiceDesign" "%PYTHONW%" "%~dp0voice_design_gui.py"
