"""
services/whisper_service.py — Audio transcription via OpenAI Whisper
──────────────────────────────────────────────────────────────────────
Flow:
  1. If the file is MP4/MOV/MKV → extract audio to a temp MP3 via ffmpeg
  2. Load (or reuse) the cached Whisper model
  3. Run model.transcribe() in a thread-pool executor (non-blocking)
  4. Return TranscriptResult (full text + per-segment timestamps)

Requirements:
  • openai-whisper   (pip install openai-whisper)
  • ffmpeg           (must be on system PATH)
      Windows : winget install ffmpeg  OR  choco install ffmpeg
      macOS   : brew install ffmpeg
      Linux   : sudo apt install ffmpeg
"""

import asyncio
import glob
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field

# ── Model cache (loaded once, reused for every request) ────────────────────
_model_cache: dict = {}

# ── Supported formats ───────────────────────────────────────────────────────
VIDEO_FORMATS = {".mp4", ".mov", ".mkv", ".avi"}
AUDIO_FORMATS = {".mp3", ".wav", ".m4a", ".ogg", ".flac"}
ALL_SUPPORTED  = VIDEO_FORMATS | AUDIO_FORMATS

# ── Locate ffmpeg (checks PATH first, then WinGet/common install locations) ─
def _find_ffmpeg() -> str:
    """Return the ffmpeg executable path, or 'ffmpeg' to rely on PATH."""
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    candidates = glob.glob(
        r"C:\Users\*\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin\ffmpeg.exe"
    ) + [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return "ffmpeg"  # fall back; will raise a clear error if missing

FFMPEG_BIN = _find_ffmpeg()
print(f"[whisper] ffmpeg resolved to: {FFMPEG_BIN}")


# ══════════════════════════════════════════════════════════════════════════════
# Data classes returned to the caller
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class TranscriptSegment:
    index      : int
    start_time : float   # seconds
    end_time   : float   # seconds
    text       : str


@dataclass
class TranscriptResult:
    full_text : str
    language  : str
    duration  : float                          # total audio length in seconds
    segments  : list[TranscriptSegment] = field(default_factory=list)


# ══════════════════════════════════════════════════════════════════════════════
# Internal helpers (synchronous — run inside thread-pool)
# ══════════════════════════════════════════════════════════════════════════════

def _load_model(model_size: str = "base"):
    """Load Whisper model, caching it so subsequent calls are instant."""
    if model_size not in _model_cache:
        print(f"⏳  [Whisper] Loading '{model_size}' model (first call — may take a moment)…")
        import whisper
        _model_cache[model_size] = whisper.load_model(model_size)
        print(f"✅  [Whisper] '{model_size}' model ready")
    return _model_cache[model_size]


def _convert_to_audio(file_path: str) -> tuple[str, bool]:
    """
    If file_path is a video, extract audio to a temp MP3 using ffmpeg.
    Returns (audio_path, was_converted).
    Raises RuntimeError if ffmpeg fails or is not installed.
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext not in VIDEO_FORMATS:
        return file_path, False   # already audio — nothing to do

    print(f"🎬  [Whisper] Detected video file. Extracting audio via ffmpeg…")

    tmp_fd, tmp_mp3 = tempfile.mkstemp(suffix=".mp3")
    os.close(tmp_fd)

    cmd = [
        FFMPEG_BIN,
        "-i", file_path,          # input
        "-vn",                    # no video stream
        "-acodec", "libmp3lame",  # MP3 codec
        "-q:a", "2",              # quality 0-9, lower = better
        "-y",                     # overwrite output without asking
        tmp_mp3,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        os.unlink(tmp_mp3)
        raise RuntimeError(
            f"ffmpeg audio extraction failed (exit {result.returncode}).\n"
            f"stderr: {result.stderr[-500:]}"   # last 500 chars of stderr
        )

    size_mb = os.path.getsize(tmp_mp3) / (1024 * 1024)
    print(f"✅  [Whisper] Audio extracted → {tmp_mp3} ({size_mb:.1f} MB)")
    return tmp_mp3, True


def _run_whisper(file_path: str, model_size: str) -> dict:
    """
    Synchronous Whisper call — intended to run inside run_in_executor.
    Returns the raw dict from model.transcribe().
    """
    model = _load_model(model_size)
    print(f"🎙️   [Whisper] Transcribing '{os.path.basename(file_path)}'…")
    result = model.transcribe(
        file_path,
        verbose=False,          # suppress per-segment stdout noise
        fp16=False,             # fp16 requires a CUDA GPU; keep False for CPU
    )
    print(f"✅  [Whisper] Transcription complete — {len(result['segments'])} segments detected")
    return result


# ══════════════════════════════════════════════════════════════════════════════
# Public async interface
# ══════════════════════════════════════════════════════════════════════════════

async def transcribe_audio(
    file_path  : str,
    model_size : str = "base",
) -> TranscriptResult:
    """
    Async entry point for the transcription pipeline.

    Steps:
      1. Validate file extension
      2. Convert video → audio (if necessary) in a thread pool
      3. Run Whisper transcription in a thread pool (non-blocking)
      4. Parse segments and compute total duration
      5. Clean up any temp audio file created in step 2

    Args:
        file_path  : Absolute path to the uploaded file.
        model_size : Whisper model variant (tiny/base/small/medium/large).

    Returns:
        TranscriptResult with full_text, language, duration, segments.

    Raises:
        FileNotFoundError  : file_path does not exist
        ValueError         : unsupported file format
        RuntimeError       : ffmpeg failure or Whisper internal error
    """

    # ── 1. Validate ─────────────────────────────────────────────────────────
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    ext = os.path.splitext(file_path)[1].lower()
    if ext not in ALL_SUPPORTED:
        raise ValueError(
            f"Unsupported file format '{ext}'. "
            f"Supported: {', '.join(sorted(ALL_SUPPORTED))}"
        )

    loop        = asyncio.get_event_loop()
    temp_audio  = None

    try:
        # ── 2. Convert video → audio (if needed) ────────────────────────────
        audio_path, was_converted = await loop.run_in_executor(
            None, _convert_to_audio, file_path
        )
        if was_converted:
            temp_audio = audio_path   # remember so we can delete it later

        # ── 3. Transcribe ────────────────────────────────────────────────────
        raw = await loop.run_in_executor(
            None, _run_whisper, audio_path, model_size
        )

        # ── 4. Parse result ──────────────────────────────────────────────────
        segments: list[TranscriptSegment] = []
        for i, seg in enumerate(raw.get("segments", [])):
            segments.append(TranscriptSegment(
                index      = i,
                start_time = round(float(seg["start"]), 2),
                end_time   = round(float(seg["end"]),   2),
                text       = seg["text"].strip(),
            ))

        duration = (
            segments[-1].end_time if segments
            else 0.0
        )

        print(
            f"📝  [Whisper] Result — language: {raw.get('language', 'unknown')} | "
            f"duration: {duration:.1f}s | chars: {len(raw.get('text', ''))}"
        )

        return TranscriptResult(
            full_text = raw.get("text", "").strip(),
            language  = raw.get("language", "unknown"),
            duration  = duration,
            segments  = segments,
        )

    finally:
        # ── 5. Clean up temp audio file ──────────────────────────────────────
        if temp_audio and os.path.exists(temp_audio):
            os.unlink(temp_audio)
            print(f"🗑️   [Whisper] Temp audio file removed")
