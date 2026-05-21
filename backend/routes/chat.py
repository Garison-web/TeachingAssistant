"""
routes/chat.py — Chat / Q&A endpoints
───────────────────────────────────────
Endpoints (all prefixed with /api/chat in main.py):

  POST   /session                       Create a new chat session
  POST   /message                       Ask a question (RAG pipeline)
  GET    /session/{session_id}          Get all messages in a session
  GET    /lectures/{lecture_id}/sessions List all sessions for a lecture
  POST   /summary/{lecture_id}          Generate a lecture summary
"""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import ChatSession, Message, get_db
from services.rag_service import get_answer, summarise_lecture

router = APIRouter()


# ══════════════════════════════════════════════════════════════════════════════
# Pydantic schemas
# ══════════════════════════════════════════════════════════════════════════════

class CreateSessionRequest(BaseModel):
    lecture_id : str
    title      : str = Field(default="New Chat", max_length=255)


class CreateSessionResponse(BaseModel):
    session_id : str
    lecture_id : str
    title      : str
    created_at : str


class MessageRequest(BaseModel):
    session_id : str
    lecture_id : str
    question   : str = Field(..., min_length=1, max_length=2000)
    top_k      : int = Field(default=5, ge=1, le=20)


class SourceOut(BaseModel):
    chunk_id         : str | None
    start_time       : float | None
    end_time         : float | None
    text             : str
    similarity_score : float | None


class MessageResponse(BaseModel):
    message_id : str
    session_id : str
    answer     : str
    sources    : list[SourceOut]


class MessageOut(BaseModel):
    id         : str
    role       : str
    content    : str
    sources    : list[dict]
    created_at : str


class SessionDetailResponse(BaseModel):
    session_id : str
    lecture_id : str
    title      : str
    created_at : str
    messages   : list[MessageOut]


class SessionSummary(BaseModel):
    session_id     : str
    lecture_id     : str
    title          : str
    created_at     : str
    updated_at     : str
    message_count  : int = 0
    last_message   : str | None = None


class SummaryResponse(BaseModel):
    lecture_id : str
    summary    : str


# ══════════════════════════════════════════════════════════════════════════════
# POST /session — create a new chat session
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/session",
    response_model = CreateSessionResponse,
    status_code    = status.HTTP_201_CREATED,
    summary        = "Create a new chat session for a lecture",
)
async def create_session(
    body : CreateSessionRequest,
    db   : AsyncSession = Depends(get_db),
) -> CreateSessionResponse:
    """
    Creates a blank ChatSession row tied to `lecture_id`.
    Returns the new session's ID so the client can start sending messages.
    """
    session = ChatSession(
        id         = str(uuid.uuid4()),
        lecture_id = body.lecture_id,
        title      = body.title,
    )
    db.add(session)
    await db.flush()

    return CreateSessionResponse(
        session_id = session.id,
        lecture_id = session.lecture_id,
        title      = session.title,
        created_at = session.created_at.isoformat(),
    )


# ══════════════════════════════════════════════════════════════════════════════
# POST /message — run RAG pipeline and return answer
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/message",
    response_model = MessageResponse,
    summary        = "Ask a question — runs the full RAG pipeline",
)
async def ask_question(
    body : MessageRequest,
    db   : AsyncSession = Depends(get_db),
) -> MessageResponse:
    """
    Full RAG flow:
      1. Embed the question (sentence-transformers)
      2. Retrieve top-k chunks from ChromaDB
      3. Build a context prompt
      4. Call Claude (Anthropic) for the answer
      5. Persist both turns (user + assistant) to SQLite
      6. Return the answer + source citations
    """
    # Verify session exists
    session_row = (
        await db.execute(
            select(ChatSession).where(ChatSession.id == body.session_id)
        )
    ).scalar_one_or_none()

    if not session_row:
        raise HTTPException(
            status_code = status.HTTP_404_NOT_FOUND,
            detail      = f"Session '{body.session_id}' not found.",
        )

    # Run RAG pipeline
    try:
        result = await get_answer(
            lecture_id = body.lecture_id,
            question   = body.question,
            session_id = body.session_id,
            db         = db,
            top_k      = body.top_k,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code = status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail      = str(exc),
        )
    except Exception as exc:
        raise HTTPException(
            status_code = status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail      = f"RAG pipeline error: {exc}",
        )

    return MessageResponse(
        message_id = result["message_id"],
        session_id = result["session_id"],
        answer     = result["answer"],
        sources    = [SourceOut(**s) for s in result["sources"]],
    )


# ══════════════════════════════════════════════════════════════════════════════
# GET /session/{session_id} — fetch full message history
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/session/{session_id}",
    response_model = SessionDetailResponse,
    summary        = "Get all messages in a session",
)
async def get_session(
    session_id : str,
    db         : AsyncSession = Depends(get_db),
) -> SessionDetailResponse:
    """Returns the session metadata and every message, ordered by created_at."""
    session_row = (
        await db.execute(
            select(ChatSession).where(ChatSession.id == session_id)
        )
    ).scalar_one_or_none()

    if not session_row:
        raise HTTPException(
            status_code = status.HTTP_404_NOT_FOUND,
            detail      = f"Session '{session_id}' not found.",
        )

    message_rows = (
        await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .order_by(Message.created_at.asc())
        )
    ).scalars().all()

    messages = [
        MessageOut(
            id         = m.id,
            role       = m.role,
            content    = m.content,
            sources    = json.loads(m.sources) if m.sources else [],
            created_at = m.created_at.isoformat(),
        )
        for m in message_rows
    ]

    return SessionDetailResponse(
        session_id = session_row.id,
        lecture_id = session_row.lecture_id,
        title      = session_row.title,
        created_at = session_row.created_at.isoformat(),
        messages   = messages,
    )


# ══════════════════════════════════════════════════════════════════════════════
# GET /lectures/{lecture_id}/sessions — list all sessions for a lecture
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/lectures/{lecture_id}/sessions",
    response_model = list[SessionSummary],
    summary        = "List all chat sessions for a lecture",
)
async def list_sessions(
    lecture_id : str,
    db         : AsyncSession = Depends(get_db),
) -> list[SessionSummary]:
    """Returns all ChatSession rows for the given lecture, newest first."""
    rows = (
        await db.execute(
            select(ChatSession)
            .where(ChatSession.lecture_id == lecture_id)
            .order_by(ChatSession.updated_at.desc())
        )
    ).scalars().all()

    result = []
    for r in rows:
        msg_count = (
            await db.execute(
                select(func.count(Message.id)).where(Message.session_id == r.id)
            )
        ).scalar() or 0

        last_msg = (
            await db.execute(
                select(Message)
                .where(Message.session_id == r.id)
                .order_by(Message.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        result.append(
            SessionSummary(
                session_id    = r.id,
                lecture_id    = r.lecture_id,
                title         = r.title,
                created_at    = r.created_at.isoformat(),
                updated_at    = r.updated_at.isoformat(),
                message_count = msg_count,
                last_message  = last_msg.content[:80] if last_msg else None,
            )
        )
    return result


# ══════════════════════════════════════════════════════════════════════════════
# POST /summary/{lecture_id} — generate a lecture summary via Claude
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/summary/{lecture_id}",
    response_model = SummaryResponse,
    summary        = "Generate a structured summary of a lecture",
)
async def get_summary(
    lecture_id : str,
    db         : AsyncSession = Depends(get_db),
) -> SummaryResponse:
    """
    Sends the full lecture transcript to Claude and returns a structured
    markdown summary with headings and bullet points.
    Requires the lecture to have been transcribed first.
    """
    try:
        summary = await summarise_lecture(lecture_id=lecture_id, db=db)
    except ValueError as exc:
        raise HTTPException(
            status_code = status.HTTP_404_NOT_FOUND,
            detail      = str(exc),
        )
    except Exception as exc:
        raise HTTPException(
            status_code = status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail      = f"Summary generation failed: {exc}",
        )

    return SummaryResponse(lecture_id=lecture_id, summary=summary)
