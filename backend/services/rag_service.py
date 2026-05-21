"""
services/rag_service.py — Retrieval-Augmented Generation pipeline
───────────────────────────────────────────────────────────────────
Flow for a student question:
  1. embed_question()   — encode the question text → 384-float vector
  2. retrieve_chunks()  — nearest-neighbour search in ChromaDB
  3. build_prompt()     — format context + question into a structured prompt
  4. get_answer()       — call OpenAI, persist messages to SQLite

LLM        : gpt-4o-mini  (OpenAI — configured via OPENAI_MODEL env var)
Embeddings : all-MiniLM-L6-v2  (local, sentence-transformers)

Public interface
────────────────
  async def get_answer(
      lecture_id : str,
      question   : str,
      session_id : str,
      db         : AsyncSession,
      top_k      : int = 5,
  ) -> dict          # { answer, sources, session_id, message_id }

  async def summarise_lecture(
      lecture_id : str,
      db         : AsyncSession,
  ) -> str           # plain-text summary
"""

import asyncio
import json
import os
from datetime import datetime
from uuid import uuid4

from openai import OpenAI

_openai_client: OpenAI | None = None

def _get_llm_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(
            api_key=os.getenv("GROQ_API_KEY"),
            base_url="https://api.groq.com/openai/v1",
        )
    return _openai_client

def _get_llm_model() -> str:
    return os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import ChatSession, Chunk, Message, Segment, Transcript
from services.embedding_service import _get_model, query_collection

# ── System prompts ───────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a helpful AI teaching assistant. The student has asked a question about a lecture. You are given the most relevant excerpts from that lecture's transcript below.

Rules:
- Use the provided transcript excerpts as your primary source of information.
- If the question is broad or vague (e.g. "what was covered?", "important parts", "summarise"), give a helpful overview based on what IS in the excerpts.
- Only say "I couldn't find that specific topic in the provided lecture excerpts." if the topic is genuinely absent from all excerpts — never say this when excerpts are present and relevant.
- When citing content, include the timestamp in parentheses, e.g. (at 2m 15s).
- Be concise but complete. Use bullet points for lists.
- Do not fabricate information, but do make the most of what the excerpts contain."""

SUMMARY_SYSTEM_PROMPT = """You are an AI teaching assistant. Summarise the following lecture transcript.

Rules:
- Write a structured summary with clear headings.
- Highlight the main topics and key points.
- Keep it under 500 words.
- Use bullet points for sub-points under each heading."""


# ══════════════════════════════════════════════════════════════════════════════
# Embedding helper (synchronous — runs in executor)
# ══════════════════════════════════════════════════════════════════════════════

def _embed_question_sync(question: str) -> list[float]:
    """Encode a single question string → list[float] using the cached model."""
    model = _get_model()
    return model.encode(question, convert_to_numpy=True).tolist()


async def embed_question(question: str) -> list[float]:
    """Async wrapper: encode question in a thread so the event loop stays free."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _embed_question_sync, question)


# ══════════════════════════════════════════════════════════════════════════════
# Chunk retrieval
# ══════════════════════════════════════════════════════════════════════════════

async def retrieve_chunks(
    lecture_id : str,
    question   : str,
    top_k      : int = 5,
) -> list[dict]:
    """
    Embed the question, query ChromaDB, return top-k results.

    Each result dict: { text, chunk_id, start_time, end_time,
                        distance, similarity_score }
    """
    query_vec = await embed_question(question)

    loop = asyncio.get_event_loop()
    raw_results: list[dict] = await loop.run_in_executor(
        None,
        query_collection,
        lecture_id,
        query_vec,
        top_k,
    )

    # Convert cosine distance (0 = identical, 2 = opposite) → similarity (0–1)
    for r in raw_results:
        r["similarity_score"] = round(1.0 - r["distance"] / 2.0, 4)

    return raw_results


# ══════════════════════════════════════════════════════════════════════════════
# Prompt builder
# ══════════════════════════════════════════════════════════════════════════════

def _fmt_time(seconds: float) -> str:
    """Format seconds as  Xm Ys  for display in citations."""
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}m {s:02d}s"


def build_prompt(question: str, chunks: list[dict]) -> str:
    """
    Assemble the user-facing message that is sent to the LLM.

    Format:
      [Excerpt 1 — 0m 00s to 0m 45s]
      <text>

      [Excerpt 2 — ...]
      ...

      Student question: <question>
    """
    context_blocks = []
    for i, chunk in enumerate(chunks, start=1):
        start = _fmt_time(chunk.get("start_time", 0))
        end   = _fmt_time(chunk.get("end_time",   0))
        context_blocks.append(
            f"[Excerpt {i} — {start} to {end}]\n{chunk['text'].strip()}"
        )

    context = "\n\n".join(context_blocks)
    return f"{context}\n\n---\nStudent question: {question}"


# ══════════════════════════════════════════════════════════════════════════════
# OpenAI call helper (synchronous — runs in executor)
# ══════════════════════════════════════════════════════════════════════════════

def _call_openai(messages: list[dict], max_tokens: int = 1024) -> str:
    """Call Groq chat completions synchronously (called via run_in_executor)."""
    response = _get_llm_client().chat.completions.create(
        model=_get_llm_model(),
        messages=messages,
        max_tokens=max_tokens,
        temperature=0.3,
    )
    return response.choices[0].message.content or ""


# ══════════════════════════════════════════════════════════════════════════════
# Main RAG entry point
# ══════════════════════════════════════════════════════════════════════════════

async def get_answer(
    lecture_id : str,
    question   : str,
    session_id : str,
    db         : AsyncSession,
    top_k      : int = 5,
) -> dict:
    """
    Full RAG pipeline:
      1. Retrieve relevant chunks from ChromaDB.
      2. Build prompt with context excerpts.
      3. Call OpenAI with system prompt + conversation history + new question.
      4. Persist both the user message and the assistant reply to SQLite.
      5. Return { answer, sources, session_id, message_id }.

    Raises:
      ValueError  — if the lecture has not been processed (no ChromaDB collection).
      RuntimeError — on OpenAI API errors.
    """

    print(f"\n💬  [RAG] question='{question[:60]}…'  lecture={lecture_id}")

    # ── 1. Retrieve context chunks ───────────────────────────────────────────
    try:
        chunks = await retrieve_chunks(lecture_id, question, top_k=top_k)
    except Exception as exc:
        raise ValueError(
            f"Could not retrieve chunks for lecture {lecture_id}. "
            "Make sure the lecture has been processed (status=ready). "
            f"Detail: {exc}"
        ) from exc

    print(f"🔍  [RAG] Retrieved {len(chunks)} chunk(s)")
    for i, c in enumerate(chunks):
        print(f"    chunk[{i}] start={c.get('start_time')} end={c.get('end_time')} score={c.get('similarity_score')} text={c.get('text','')[:80]!r}")

    # ── 2. Build the context + question message ──────────────────────────────
    user_message = build_prompt(question, chunks)
    print(f"📄  [RAG] Prompt sent to LLM (first 400 chars):\n{user_message[:400]}")

    # ── 3. Fetch recent conversation history (last 10 exchanges = 20 msgs) ───
    history_rows = (
        await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .order_by(Message.created_at.asc())
            .limit(20)
        )
    ).scalars().all()

    # Build OpenAI messages: system → history → new user message with context
    messages_payload: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for row in history_rows:
        messages_payload.append({"role": row.role, "content": row.content})
    messages_payload.append({"role": "user", "content": user_message})

    # ── 4. Call OpenAI ───────────────────────────────────────────────────────
    loop = asyncio.get_event_loop()
    answer_text = await loop.run_in_executor(
        None, _call_openai, messages_payload, 1024
    )
    print(f"✅  [RAG] Answer received ({len(answer_text)} chars)")

    # ── 5. Build sources list ────────────────────────────────────────────────
    sources = [
        {
            "chunk_id"        : c.get("chunk_id"),
            "start_time"      : c.get("start_time"),
            "end_time"        : c.get("end_time"),
            "text"            : c["text"][:200],
            "similarity_score": c.get("similarity_score"),
        }
        for c in chunks
    ]
    sources_json = json.dumps(sources)

    # ── 6. Persist user message ──────────────────────────────────────────────
    user_msg = Message(
        id         = str(uuid4()),
        session_id = session_id,
        role       = "user",
        content    = question,
        sources    = None,
    )
    db.add(user_msg)

    # ── 7. Persist assistant message ─────────────────────────────────────────
    assistant_msg = Message(
        id         = str(uuid4()),
        session_id = session_id,
        role       = "assistant",
        content    = answer_text,
        sources    = sources_json,
    )
    db.add(assistant_msg)
    await db.flush()

    # ── 8. Update session timestamp ──────────────────────────────────────────
    session_row = (
        await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    ).scalar_one_or_none()

    if session_row:
        session_row.updated_at = datetime.utcnow()

    return {
        "answer"     : answer_text,
        "sources"    : sources,
        "session_id" : session_id,
        "message_id" : assistant_msg.id,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Lecture summariser
# ══════════════════════════════════════════════════════════════════════════════

async def summarise_lecture(
    lecture_id : str,
    db         : AsyncSession,
) -> str:
    """
    Generate a structured summary of a lecture from its full transcript text.

    Returns the summary string.
    Raises ValueError if no transcript exists for lecture_id.
    """

    transcript_row = (
        await db.execute(
            select(Transcript).where(Transcript.lecture_id == lecture_id)
        )
    ).scalar_one_or_none()

    if not transcript_row:
        raise ValueError(f"No transcript found for lecture {lecture_id}")

    full_text = transcript_row.full_text

    # Truncate to ~6000 words to stay within token budget
    words     = full_text.split()
    truncated = " ".join(words[:6000])
    if len(words) > 6000:
        truncated += "\n\n[Transcript truncated for summary — original is longer]"

    print(f"\n📝  [RAG] Summarising lecture {lecture_id} ({len(words)} words)")

    loop = asyncio.get_event_loop()
    summary = await loop.run_in_executor(
        None,
        _call_openai,
        [
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user",   "content": truncated},
        ],
        800,
    )
    print(f"✅  [RAG] Summary ready ({len(summary)} chars)")
    return summary
