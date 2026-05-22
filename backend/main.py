"""
main.py — Application entry point
──────────────────────────────────
Starts the FastAPI server on port 8000 with:
  • CORS enabled for React Native (Expo web + device)
  • Route prefixes:  /api/upload  /api/chat  /api/history
  • Auto-created DB tables on startup
  • Lifespan context for startup / shutdown hooks
"""

import os
import sys
import glob as _glob
from contextlib import asynccontextmanager

# Force UTF-8 for stdout/stderr so emoji in print() doesn't crash on Windows cp1252
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# On Windows, ffmpeg may be installed via winget/choco and not on PATH automatically.
# On Linux/Docker, ffmpeg is installed system-wide via apt and already on PATH.
if sys.platform == "win32":
    _ffmpeg_patterns = [
        r"C:\Users\*\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin",
        r"C:\ProgramData\chocolatey\bin",
        r"C:\ffmpeg\bin",
    ]
    for _pat in _ffmpeg_patterns:
        _matches = _glob.glob(_pat)
        if _matches:
            _ffmpeg_bin = _matches[0]
            if _ffmpeg_bin not in os.environ.get("PATH", ""):
                os.environ["PATH"] = _ffmpeg_bin + os.pathsep + os.environ["PATH"]
            break

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before anything else so all os.getenv() calls pick up the values
load_dotenv()

from database.db import init_db
from routes import upload, chat, history, study


# ── Lifespan (runs once on startup / shutdown) ─────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure uploads directory exists
    upload_dir = os.getenv("UPLOAD_DIR", "./uploads")
    os.makedirs(upload_dir, exist_ok=True)
    print(f"[startup] Upload directory: {os.path.abspath(upload_dir)}")

    # Create SQLite tables if they don't exist
    await init_db()

    # TODO: initialise ChromaDB collection (phase 2)
    # TODO: warm-up embedding model (phase 2)
    yield
    print("[shutdown] Server shutting down")


# ── App instance ───────────────────────────────────────────────────────────

app = FastAPI(
    title="Teaching Assistant API",
    description="RAG-based AI teaching assistant — transcribes lectures and answers student questions.",
    version="0.1.0",
    lifespan=lifespan,
)


# ── CORS ───────────────────────────────────────────────────────────────────
# Allow requests from:
#   • Expo Go / dev builds on any local device (192.168.x.x)
#   • Expo web preview (localhost:19006)
#   • Production domain (update before deploying)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routers ────────────────────────────────────────────────────────────────

app.include_router(upload.router,  prefix="/api/upload",  tags=["Upload"])
app.include_router(chat.router,    prefix="/api/chat",    tags=["Chat"])
app.include_router(history.router, prefix="/api/history", tags=["History"])
app.include_router(study.router,   prefix="/api/study",   tags=["Study"])


# ── Health check ───────────────────────────────────────────────────────────

@app.get("/health", tags=["Health"])
async def health_check():
    """Quick liveness probe — returns 200 when the server is up."""
    return {"status": "ok", "version": app.version}


# ── Dev runner ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",   # bind all interfaces so mobile devices can reach it
        port=8000,
        reload=True,       # hot-reload on file changes (dev only)
        log_level="info",
    )
