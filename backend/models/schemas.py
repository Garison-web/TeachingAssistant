"""
models/schemas.py — Pydantic request / response schemas
─────────────────────────────────────────────────────────
All API contracts live here.  Organised into sections:

  1. Upload schemas   — file upload requests and processing status
  2. Chat schemas     — Q&A request / response / session
  3. History schemas  — list, item, save-toggle
  4. Shared types     — SourceCitation, Pagination, ErrorDetail
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ══════════════════════════════════════════════════════════════════════════════
# 1. SHARED TYPES
# ══════════════════════════════════════════════════════════════════════════════

class ProcessingStatus(str, Enum):
    QUEUED       = "queued"
    TRANSCRIBING = "transcribing"
    CHUNKING     = "chunking"
    EMBEDDING    = "embedding"
    DONE         = "done"
    ERROR        = "error"


class SourceCitation(BaseModel):
    """A chunk of lecture transcript cited in an answer."""
    chunk_id   : str
    start_time : float = Field(..., description="Seconds from start of lecture")
    end_time   : float
    text       : str   = Field(..., description="Short excerpt (≤ 200 chars)")


class Pagination(BaseModel):
    total  : int
    limit  : int
    offset : int


class ErrorDetail(BaseModel):
    code    : str
    message : str
    detail  : Any | None = None


# ══════════════════════════════════════════════════════════════════════════════
# 2. UPLOAD SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class LectureBase(BaseModel):
    """Shared fields for lecture records."""
    title      : str = Field(..., min_length=1, max_length=255)
    course_id  : str | None = None
    description: str | None = None


class LectureCreate(LectureBase):
    """Body sent when creating a lecture record before uploading the file."""
    # File itself is sent as multipart form data, not in the JSON body
    pass


class LectureOut(LectureBase):
    """Lecture record returned to the client."""
    id          : str
    filename    : str
    file_size   : int    = Field(..., description="File size in bytes")
    duration    : float  = Field(..., description="Audio duration in seconds")
    status      : ProcessingStatus
    created_at  : datetime
    updated_at  : datetime

    class Config:
        from_attributes = True


class UploadJobStatus(BaseModel):
    """Polling response for background processing progress."""
    job_id      : str
    lecture_id  : str
    status      : ProcessingStatus
    progress_pct: int    = Field(0, ge=0, le=100)
    message     : str    = ""
    error       : str | None = None


# ══════════════════════════════════════════════════════════════════════════════
# 3. CHAT SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    """Body sent by the app when the student asks a question."""
    question   : str = Field(..., min_length=1, max_length=1000)
    lecture_id : str
    session_id : str | None = None
    top_k      : int = Field(5, ge=1, le=20)
    stream     : bool = False


class ChatResponse(BaseModel):
    """Single Q&A response returned to the client."""
    answer     : str
    session_id : str
    sources    : list[SourceCitation] = []
    created_at : datetime


class SessionCreate(BaseModel):
    lecture_id : str


class SessionOut(BaseModel):
    id         : str
    lecture_id : str
    created_at : datetime

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    """A single message within a session (user or assistant)."""
    id         : str
    session_id : str
    role       : str   = Field(..., pattern="^(user|assistant)$")
    text       : str
    sources    : list[SourceCitation] = []
    created_at : datetime

    class Config:
        from_attributes = True


# ══════════════════════════════════════════════════════════════════════════════
# 4. HISTORY SCHEMAS
# ══════════════════════════════════════════════════════════════════════════════

class HistoryItemOut(BaseModel):
    """A Q&A pair as returned from the history list."""
    id         : str
    question   : str
    answer     : str
    course     : str | None = None
    lecture    : str | None = None
    lecture_id : str
    session_id : str
    saved      : bool
    sources    : list[SourceCitation] = []
    created_at : datetime

    class Config:
        from_attributes = True


class HistoryListResponse(BaseModel):
    items      : list[HistoryItemOut]
    pagination : Pagination


class SaveToggleResponse(BaseModel):
    id    : str
    saved : bool
