"""
database/db.py — Async SQLAlchemy + SQLite
───────────────────────────────────────────
Tables:
  lectures      — one row per uploaded file
  transcripts   — one row per processed lecture (full text + language)
  segments      — one row per Whisper segment (with timestamps)
  chunks        — groups of N segments used as RAG retrieval units
  chat_sessions — one row per chat conversation tied to a lecture
  messages      — individual turns (user / assistant) within a session
  history       — one Q&A pair per student question

Lecture status flow:
  uploaded → transcribing → transcribed → chunking → embedding → ready | error
"""

import os
from datetime import datetime
from typing import AsyncGenerator
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# ── Config ─────────────────────────────────────────────────────────────────

DB_PATH      = os.getenv("DB_PATH", "./teaching_assistant.db")
DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

engine           = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


# ── Base ───────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


# ══════════════════════════════════════════════════════════════════════════════
# ORM Models
# ══════════════════════════════════════════════════════════════════════════════

class Lecture(Base):
    """One row per uploaded video/audio file."""
    __tablename__ = "lectures"

    id         : Mapped[str]            = mapped_column(String,  primary_key=True, default=lambda: str(uuid4()))
    title      : Mapped[str]            = mapped_column(String,  nullable=False)
    filename   : Mapped[str]            = mapped_column(String,  nullable=False)
    file_path  : Mapped[str]            = mapped_column(String,  nullable=False)
    file_size  : Mapped[int]            = mapped_column(Integer, default=0)
    duration   : Mapped[float]          = mapped_column(Float,   default=0.0)
    status     : Mapped[str]            = mapped_column(String,  default="uploaded")
    # uploaded → transcribing → chunking → embedding → done | error
    course_id  : Mapped[str | None]     = mapped_column(String,  nullable=True)
    created_at : Mapped[datetime]       = mapped_column(DateTime, default=datetime.utcnow)
    updated_at : Mapped[datetime]       = mapped_column(DateTime, default=datetime.utcnow,
                                                        onupdate=datetime.utcnow)


class Transcript(Base):
    """Full transcript text for a lecture (one-to-one with Lecture)."""
    __tablename__ = "transcripts"

    id         : Mapped[str]      = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    lecture_id : Mapped[str]      = mapped_column(String, nullable=False, index=True)
    full_text  : Mapped[str]      = mapped_column(Text,   nullable=False)
    language   : Mapped[str]      = mapped_column(String, default="en")
    created_at : Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Segment(Base):
    """One Whisper segment (phrase) with start/end timestamps."""
    __tablename__ = "segments"

    id            : Mapped[str]   = mapped_column(String,  primary_key=True, default=lambda: str(uuid4()))
    transcript_id : Mapped[str]   = mapped_column(String,  nullable=False, index=True)
    lecture_id    : Mapped[str]   = mapped_column(String,  nullable=False, index=True)
    segment_index : Mapped[int]   = mapped_column(Integer, nullable=False)
    start_time    : Mapped[float] = mapped_column(Float,   nullable=False)
    end_time      : Mapped[float] = mapped_column(Float,   nullable=False)
    text          : Mapped[str]   = mapped_column(Text,    nullable=False)


class Chunk(Base):
    """
    A group of consecutive Whisper segments combined into a single retrieval unit.
    Created by chunking_service.  Embedded and stored in ChromaDB by embedding_service.
    """
    __tablename__ = "chunks"

    id          : Mapped[str]   = mapped_column(String,  primary_key=True, default=lambda: str(uuid4()))
    lecture_id  : Mapped[str]   = mapped_column(String,  nullable=False, index=True)
    chunk_index : Mapped[int]   = mapped_column(Integer, nullable=False)
    text        : Mapped[str]   = mapped_column(Text,    nullable=False)
    start_time  : Mapped[float] = mapped_column(Float,   nullable=False)
    end_time    : Mapped[float] = mapped_column(Float,   nullable=False)
    created_at  : Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChatSession(Base):
    """One chat conversation tied to a lecture."""
    __tablename__ = "chat_sessions"

    id         : Mapped[str]      = mapped_column(String,  primary_key=True, default=lambda: str(uuid4()))
    lecture_id : Mapped[str]      = mapped_column(String,  nullable=False, index=True)
    title      : Mapped[str]      = mapped_column(String,  default="New Chat")
    created_at : Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at : Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow,
                                                  onupdate=datetime.utcnow)


class Message(Base):
    """One turn (user or assistant) inside a ChatSession."""
    __tablename__ = "messages"

    id         : Mapped[str]           = mapped_column(String,  primary_key=True, default=lambda: str(uuid4()))
    session_id : Mapped[str]           = mapped_column(String,  nullable=False, index=True)
    role       : Mapped[str]           = mapped_column(String,  nullable=False)        # "user" | "assistant"
    content    : Mapped[str]           = mapped_column(Text,    nullable=False)
    sources    : Mapped[str | None]    = mapped_column(Text,    nullable=True)         # JSON string
    created_at : Mapped[datetime]      = mapped_column(DateTime, default=datetime.utcnow)


class HistoryItem(Base):
    """One Q&A pair saved from a chat session (populated in phase 2)."""
    __tablename__ = "history"

    id           : Mapped[str]          = mapped_column(String,  primary_key=True, default=lambda: str(uuid4()))
    question     : Mapped[str]          = mapped_column(Text,    nullable=False)
    answer       : Mapped[str]          = mapped_column(Text,    nullable=False)
    lecture_id   : Mapped[str]          = mapped_column(String,  nullable=False, index=True)
    session_id   : Mapped[str]          = mapped_column(String,  nullable=False, index=True)
    sources_json : Mapped[str]          = mapped_column(Text,    default="[]")
    saved        : Mapped[bool]         = mapped_column(Boolean, default=False)
    created_at   : Mapped[datetime]     = mapped_column(DateTime, default=datetime.utcnow)


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════

async def init_db() -> None:
    """Create all tables if they do not exist yet. Called from lifespan."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[db] SQLite tables ready")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — yields an async session, commits or rolls back."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
