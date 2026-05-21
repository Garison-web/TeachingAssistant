"""
routes/upload.py — File upload, transcription, and processing endpoints
─────────────────────────────────────────────────────────────────────────
Full pipeline (call in order):
  1. POST /api/upload/             → save file to disk       status: uploaded
  2. POST /api/upload/transcribe   → Whisper transcription   status: transcribed
  3. POST /api/upload/process      → chunk + embed           status: ready

Other endpoints:
  GET  /api/upload/lectures           → list all lectures
  GET  /api/upload/lectures/{id}      → single lecture detail
"""

import os
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import Chunk, Lecture, Segment, Transcript, get_db
from services.chunking_service import chunk_segments
from services.embedding_service import create_embeddings
from services.whisper_service import ALL_SUPPORTED, transcribe_audio

router = APIRouter()

# ── Config ─────────────────────────────────────────────────────────────────
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024   # 2 GB


# ══════════════════════════════════════════════════════════════════════════════
# Response schemas (inline — simple enough not to warrant schemas.py)
# ══════════════════════════════════════════════════════════════════════════════

class UploadResponse(BaseModel):
    file_id   : str
    filename  : str
    file_size : int
    status    : str
    message   : str


class SegmentOut(BaseModel):
    index      : int
    start_time : float
    end_time   : float
    text       : str


class TranscribeRequest(BaseModel):
    file_id    : str
    model_size : str = "base"   # tiny | base | small | medium | large


class TranscribeResponse(BaseModel):
    file_id      : str
    lecture_id   : str
    status       : str
    language     : str
    duration     : float
    segment_count: int
    transcript   : str
    segments     : list[SegmentOut]


class ProcessRequest(BaseModel):
    lecture_id : str
    chunk_size : int = 5    # segments per chunk (default 5)
    batch_size : int = 50   # embedding batch size


class ProcessResponse(BaseModel):
    lecture_id      : str
    status          : str
    chunk_count     : int
    collection_name : str
    message         : str


class LectureOut(BaseModel):
    id         : str
    title      : str
    filename   : str
    file_size  : int
    duration   : float
    status     : str
    created_at : datetime

    class Config:
        from_attributes = True


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/upload/
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "",
    response_model=UploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a lecture file (video or audio)",
)
async def upload_lecture(
    file      : UploadFile = File(..., description="MP4, MOV, MKV, MP3, WAV, M4A"),
    title     : str        = Form(..., description="Human-readable lecture title"),
    course_id : str | None = Form(None, description="Optional course identifier"),
    db        : AsyncSession = Depends(get_db),
):
    """
    Saves the uploaded file to disk and registers it in the database.
    Returns a `file_id` (= `lecture_id`) used in subsequent calls.
    """

    print(f"\n📥  [Upload] Receiving '{file.filename}' — content_type: {file.content_type}")

    # ── 1. Validate extension ─────────────────────────────────────────────
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided.")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALL_SUPPORTED:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file format '{ext}'. "
                f"Accepted: {', '.join(sorted(ALL_SUPPORTED))}"
            ),
        )

    # ── 2. Ensure uploads directory exists ───────────────────────────────
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # ── 3. Generate unique file_id and save to disk ──────────────────────
    file_id   = str(uuid.uuid4())
    safe_name = f"{file_id}{ext}"            # e.g. "550e8400-...{.mp4}"
    save_path = os.path.join(UPLOAD_DIR, safe_name)

    print(f"💾  [Upload] Saving to '{save_path}'…")

    chunk_size  = 1024 * 1024   # 1 MB chunks
    total_bytes = 0

    try:
        with open(save_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_FILE_SIZE_BYTES:
                    f.close()
                    os.unlink(save_path)
                    raise HTTPException(status_code=413, detail="File exceeds 2 GB limit.")
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        if os.path.exists(save_path):
            os.unlink(save_path)
        raise HTTPException(status_code=500, detail=f"Failed to save file: {exc}")

    size_mb = total_bytes / (1024 * 1024)
    print(f"✅  [Upload] Saved {size_mb:.1f} MB → file_id: {file_id}")

    # ── 4. Persist to database ───────────────────────────────────────────
    lecture = Lecture(
        id        = file_id,
        title     = title,
        filename  = file.filename,
        file_path = save_path,
        file_size = total_bytes,
        duration  = 0.0,
        status    = "uploaded",
        course_id = course_id,
    )
    db.add(lecture)
    await db.commit()  # must commit before returning so /transcribe can find it immediately

    print(f"🗄️   [Upload] Lecture record created in DB — id: {file_id}")

    return UploadResponse(
        file_id   = file_id,
        filename  = file.filename,
        file_size = total_bytes,
        status    = "uploaded",
        message   = "File uploaded successfully. Call /api/upload/transcribe to process it.",
    )


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/upload/transcribe
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/transcribe",
    response_model=TranscribeResponse,
    summary="Transcribe an uploaded lecture with Whisper",
)
async def transcribe_lecture(
    body : TranscribeRequest,
    db   : AsyncSession = Depends(get_db),
):
    """
    Runs Whisper on the uploaded file identified by `file_id`.
    Saves the full transcript and every segment to SQLite.
    This is a long-running call — expect 30s–5min depending on file length
    and the chosen Whisper model.
    """

    print(f"\n🔄  [Transcribe] Starting for file_id: {body.file_id}")

    # ── 1. Look up lecture in DB ──────────────────────────────────────────
    result  = await db.execute(select(Lecture).where(Lecture.id == body.file_id))
    lecture = result.scalar_one_or_none()

    if lecture is None:
        raise HTTPException(
            status_code=404,
            detail=f"No lecture found with file_id '{body.file_id}'.",
        )

    if not os.path.exists(lecture.file_path):
        raise HTTPException(
            status_code=404,
            detail=f"File on disk not found: '{lecture.file_path}'. Was it deleted?",
        )

    print(f"📂  [Transcribe] Found lecture '{lecture.title}' at '{lecture.file_path}'")

    # ── 2. Mark status as "transcribing" ─────────────────────────────────
    await db.execute(
        update(Lecture)
        .where(Lecture.id == lecture.id)
        .values(status="transcribing", updated_at=datetime.utcnow())
    )
    await db.commit()

    # ── 3. Run Whisper (may take minutes) ────────────────────────────────
    try:
        result_data = await transcribe_audio(
            file_path  = lecture.file_path,
            model_size = body.model_size,
        )
    except FileNotFoundError as exc:
        await _mark_error(db, lecture.id, str(exc))
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        await _mark_error(db, lecture.id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        await _mark_error(db, lecture.id, str(exc))
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")
    except Exception as exc:
        await _mark_error(db, lecture.id, str(exc))
        raise HTTPException(status_code=500, detail=f"Transcription error: {type(exc).__name__}: {exc}")

    # ── 4. Persist Transcript row ─────────────────────────────────────────
    print(f"🗄️   [Transcribe] Saving transcript to DB…")

    transcript_id = str(uuid.uuid4())
    transcript    = Transcript(
        id         = transcript_id,
        lecture_id = lecture.id,
        full_text  = result_data.full_text,
        language   = result_data.language,
    )
    db.add(transcript)

    # ── 5. Persist Segment rows ───────────────────────────────────────────
    segment_rows = [
        Segment(
            transcript_id = transcript_id,
            lecture_id    = lecture.id,
            segment_index = seg.index,
            start_time    = seg.start_time,
            end_time      = seg.end_time,
            text          = seg.text,
        )
        for seg in result_data.segments
    ]
    db.add_all(segment_rows)

    # ── 6. Update Lecture: status → "transcribed" + duration ─────────────
    await db.execute(
        update(Lecture)
        .where(Lecture.id == lecture.id)
        .values(
            status     = "transcribed",     # ready for /process step
            duration   = result_data.duration,
            updated_at = datetime.utcnow(),
        )
    )

    # commit handled by get_db() dependency
    print(
        f"✅  [Transcribe] Done — {len(result_data.segments)} segments, "
        f"{result_data.duration:.1f}s, lang={result_data.language}"
    )
    print(f"➡️   [Transcribe] Next step: POST /api/upload/process with lecture_id={lecture.id}")

    return TranscribeResponse(
        file_id       = body.file_id,
        lecture_id    = lecture.id,
        status        = "transcribed",
        language      = result_data.language,
        duration      = result_data.duration,
        segment_count = len(result_data.segments),
        transcript    = result_data.full_text,
        segments      = [
            SegmentOut(
                index      = s.index,
                start_time = s.start_time,
                end_time   = s.end_time,
                text       = s.text,
            )
            for s in result_data.segments
        ],
    )


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/upload/process
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/process",
    response_model=ProcessResponse,
    summary="Chunk segments and embed into ChromaDB (step 3 of pipeline)",
)
async def process_lecture(
    body : ProcessRequest,
    db   : AsyncSession = Depends(get_db),
):
    """
    Runs the chunking + embedding pipeline on a transcribed lecture.

    Prerequisites:
      - The lecture must exist in SQLite.
      - Its status must be "transcribed" (i.e. /transcribe was called first).

    On success the lecture status becomes "ready" and its chunks are
    queryable in ChromaDB via the RAG service.
    """

    print(f"\n⚙️   [Process] Starting pipeline for lecture_id: {body.lecture_id}")

    # ── 1. Fetch and validate lecture ─────────────────────────────────────────
    res     = await db.execute(select(Lecture).where(Lecture.id == body.lecture_id))
    lecture = res.scalar_one_or_none()

    if lecture is None:
        raise HTTPException(
            status_code=404,
            detail=f"Lecture '{body.lecture_id}' not found.",
        )

    if lecture.status not in ("transcribed", "error"):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Lecture status is '{lecture.status}'. "
                f"Expected 'transcribed'. "
                f"Run POST /api/upload/transcribe first."
            ),
        )

    print(f"📂  [Process] Lecture '{lecture.title}' — status: {lecture.status}")

    # ── 2. Fetch all segments for this lecture ────────────────────────────────
    seg_res  = await db.execute(
        select(Segment)
        .where(Segment.lecture_id == body.lecture_id)
        .order_by(Segment.segment_index)
    )
    segments = list(seg_res.scalars().all())

    if not segments:
        raise HTTPException(
            status_code=422,
            detail="No segments found for this lecture. Was transcription successful?",
        )

    print(f"📊  [Process] Loaded {len(segments)} segments from SQLite")

    # ── 3. Chunk segments ─────────────────────────────────────────────────────
    await db.execute(
        update(Lecture)
        .where(Lecture.id == lecture.id)
        .values(status="chunking", updated_at=datetime.utcnow())
    )
    await db.commit()

    try:
        chunks = await chunk_segments(
            lecture_id = body.lecture_id,
            segments   = segments,
            db         = db,
            chunk_size = body.chunk_size,
        )
        await db.commit()   # persist chunks to SQLite
    except Exception as exc:
        await _mark_error(db, lecture.id, f"Chunking failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Chunking failed: {exc}")

    print(f"✅  [Process] Chunking done — {len(chunks)} chunks committed to SQLite")

    # ── 4. Embed chunks into ChromaDB ─────────────────────────────────────────
    await db.execute(
        update(Lecture)
        .where(Lecture.id == lecture.id)
        .values(status="embedding", updated_at=datetime.utcnow())
    )
    await db.commit()

    try:
        total_stored, collection_name = await create_embeddings(
            lecture_id = body.lecture_id,
            chunks     = chunks,
            batch_size = body.batch_size,
        )
    except Exception as exc:
        await _mark_error(db, lecture.id, f"Embedding failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Embedding failed: {exc}")

    # ── 5. Mark lecture as "ready" ────────────────────────────────────────────
    await db.execute(
        update(Lecture)
        .where(Lecture.id == lecture.id)
        .values(status="ready", updated_at=datetime.utcnow())
    )
    # commit handled by get_db() dependency

    print(
        f"\n🎉  [Process] Lecture '{lecture.title}' is READY\n"
        f"     chunks={total_stored}  collection='{collection_name}'\n"
        f"     Students can now ask questions via POST /api/chat/ask"
    )

    return ProcessResponse(
        lecture_id      = body.lecture_id,
        status          = "ready",
        chunk_count     = total_stored,
        collection_name = collection_name,
        message         = (
            f"Lecture is ready. {total_stored} chunks indexed in '{collection_name}'. "
            f"Use POST /api/chat/ask to query it."
        ),
    )


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/upload/lectures
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/lectures",
    response_model=list[LectureOut],
    summary="List all uploaded lectures",
)
async def list_lectures(db: AsyncSession = Depends(get_db)):
    """Returns all lecture records ordered by most recent first."""
    result   = await db.execute(select(Lecture).order_by(Lecture.created_at.desc()))
    lectures = result.scalars().all()
    print(f"📋  [Lectures] Returning {len(lectures)} records")
    return lectures


# ══════════════════════════════════════════════════════════════════════════════
# GET /api/upload/lectures/{lecture_id}
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/lectures/{lecture_id}",
    response_model=LectureOut,
    summary="Get a single lecture by ID",
)
async def get_lecture(lecture_id: str, db: AsyncSession = Depends(get_db)):
    result  = await db.execute(select(Lecture).where(Lecture.id == lecture_id))
    lecture = result.scalar_one_or_none()
    if lecture is None:
        raise HTTPException(status_code=404, detail=f"Lecture '{lecture_id}' not found.")
    return lecture


# ══════════════════════════════════════════════════════════════════════════════
# Internal helper
# ══════════════════════════════════════════════════════════════════════════════

async def _mark_error(db: AsyncSession, lecture_id: str, message: str) -> None:
    """Set lecture status to 'error' without raising; used in all except blocks."""
    print(f"❌  [Pipeline] Error for lecture {lecture_id}: {message}")
    try:
        await db.execute(
            update(Lecture)
            .where(Lecture.id == lecture_id)
            .values(status="error", updated_at=datetime.utcnow())
        )
        await db.commit()
    except Exception as db_exc:
        print(f"⚠️   [Pipeline] Could not write error status to DB: {db_exc}")
