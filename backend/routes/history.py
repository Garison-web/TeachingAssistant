"""
routes/history.py — Lecture & session management endpoints
────────────────────────────────────────────────────────────
All prefixed /api/history in main.py

  GET    /lectures                   List all lectures with stats
  GET    /lectures/{lecture_id}      Lecture detail
  GET    /stats                      Dashboard counters
  DELETE /sessions/{session_id}      Delete session + its messages
  DELETE /lectures/{lecture_id}      Delete lecture + all related data
"""

import os

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import (
    ChatSession,
    Chunk,
    Lecture,
    Message,
    Segment,
    Transcript,
    get_db,
)

router = APIRouter()


# ══════════════════════════════════════════════════════════════════════════════
# Pydantic schemas
# ══════════════════════════════════════════════════════════════════════════════

class LectureSummary(BaseModel):
    lecture_id    : str
    title         : str
    status        : str
    total_sessions: int
    total_messages: int
    last_activity : str | None
    created_at    : str


class LectureDetail(LectureSummary):
    filename  : str
    file_size : int
    duration  : float


class StatsResponse(BaseModel):
    total_lectures : int
    total_sessions : int
    total_messages : int
    ready_lectures : int


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════

async def _lecture_stats(lecture_id: str, db: AsyncSession) -> dict:
    """Return session_count, message_count, last_activity for a lecture."""
    session_count = (
        await db.execute(
            select(func.count(ChatSession.id)).where(ChatSession.lecture_id == lecture_id)
        )
    ).scalar() or 0

    message_count = (
        await db.execute(
            select(func.count(Message.id))
            .join(ChatSession, Message.session_id == ChatSession.id)
            .where(ChatSession.lecture_id == lecture_id)
        )
    ).scalar() or 0

    last_session = (
        await db.execute(
            select(ChatSession)
            .where(ChatSession.lecture_id == lecture_id)
            .order_by(ChatSession.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    return {
        "total_sessions": session_count,
        "total_messages": message_count,
        "last_activity": last_session.updated_at.isoformat() if last_session else None,
    }


# ══════════════════════════════════════════════════════════════════════════════
# GET /lectures  — list all lectures with stats
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/lectures",
    response_model=list[LectureSummary],
    summary="List all lectures with session & message counts",
)
async def list_lectures(db: AsyncSession = Depends(get_db)) -> list[LectureSummary]:
    lectures = (
        await db.execute(select(Lecture).order_by(Lecture.created_at.desc()))
    ).scalars().all()

    result = []
    for lec in lectures:
        stats = await _lecture_stats(lec.id, db)
        result.append(
            LectureSummary(
                lecture_id     = lec.id,
                title          = lec.title,
                status         = lec.status,
                created_at     = lec.created_at.isoformat(),
                **stats,
            )
        )
    return result


# ══════════════════════════════════════════════════════════════════════════════
# GET /lectures/{lecture_id}  — lecture detail
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/lectures/{lecture_id}",
    response_model=LectureDetail,
    summary="Get a single lecture with full detail",
)
async def get_lecture_detail(
    lecture_id: str,
    db: AsyncSession = Depends(get_db),
) -> LectureDetail:
    lec = (
        await db.execute(select(Lecture).where(Lecture.id == lecture_id))
    ).scalar_one_or_none()

    if not lec:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lecture '{lecture_id}' not found.",
        )

    stats = await _lecture_stats(lec.id, db)
    return LectureDetail(
        lecture_id = lec.id,
        title      = lec.title,
        status     = lec.status,
        filename   = lec.filename,
        file_size  = lec.file_size,
        duration   = lec.duration,
        created_at = lec.created_at.isoformat(),
        **stats,
    )


# ══════════════════════════════════════════════════════════════════════════════
# GET /stats  — dashboard counters
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/stats",
    response_model=StatsResponse,
    summary="Global counts for the dashboard",
)
async def get_stats(db: AsyncSession = Depends(get_db)) -> StatsResponse:
    total_lectures = (await db.execute(select(func.count(Lecture.id)))).scalar() or 0
    total_sessions = (await db.execute(select(func.count(ChatSession.id)))).scalar() or 0
    total_messages = (
        await db.execute(
            select(func.count(Message.id)).where(Message.role == "user")
        )
    ).scalar() or 0
    ready_lectures = (
        await db.execute(
            select(func.count(Lecture.id)).where(Lecture.status == "ready")
        )
    ).scalar() or 0

    return StatsResponse(
        total_lectures=total_lectures,
        total_sessions=total_sessions,
        total_messages=total_messages,
        ready_lectures=ready_lectures,
    )


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /sessions/{session_id}  — delete a session + all its messages
# ══════════════════════════════════════════════════════════════════════════════

@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a chat session and all its messages",
)
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    session = (
        await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    ).scalar_one_or_none()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session '{session_id}' not found.",
        )

    await db.execute(delete(Message).where(Message.session_id == session_id))
    await db.execute(delete(ChatSession).where(ChatSession.id == session_id))


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /lectures/{lecture_id}  — delete lecture + all related data
# ══════════════════════════════════════════════════════════════════════════════

@router.delete(
    "/lectures/{lecture_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a lecture and all related data (sessions, messages, chunks, transcript)",
)
async def delete_lecture(
    lecture_id: str,
    db: AsyncSession = Depends(get_db),
) -> None:
    lecture = (
        await db.execute(select(Lecture).where(Lecture.id == lecture_id))
    ).scalar_one_or_none()

    if not lecture:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Lecture '{lecture_id}' not found.",
        )

    # Delete messages for every session of this lecture
    session_ids = (
        await db.execute(
            select(ChatSession.id).where(ChatSession.lecture_id == lecture_id)
        )
    ).scalars().all()

    for sid in session_ids:
        await db.execute(delete(Message).where(Message.session_id == sid))

    await db.execute(delete(ChatSession).where(ChatSession.lecture_id == lecture_id))
    await db.execute(delete(Chunk).where(Chunk.lecture_id == lecture_id))
    await db.execute(delete(Segment).where(Segment.lecture_id == lecture_id))
    await db.execute(delete(Transcript).where(Transcript.lecture_id == lecture_id))
    # Grab the file path before deleting the row
    file_path = lecture.file_path

    await db.execute(delete(Lecture).where(Lecture.id == lecture_id))

    # Remove ChromaDB collection (best-effort)
    try:
        import chromadb
        client = chromadb.PersistentClient(
            path=os.getenv("CHROMA_DB_PATH", "./chroma_store")
        )
        client.delete_collection(f"lecture_{lecture_id}")
        print(f"[History] Deleted ChromaDB collection lecture_{lecture_id}")
    except Exception:
        pass  # collection may not exist yet — that's fine

    # Delete the uploaded file from disk (best-effort)
    try:
        if file_path and os.path.exists(file_path):
            os.unlink(file_path)
            print(f"[History] Deleted file from disk: {file_path}")
    except Exception:
        pass
