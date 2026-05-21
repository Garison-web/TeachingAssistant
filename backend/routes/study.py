"""
routes/study.py — Flashcard & Quiz generation
───────────────────────────────────────────────
Endpoints (prefixed /api/study in main.py):

  POST /flashcards/{lecture_id}   Generate Q&A flashcards from transcript
  POST /quiz/{lecture_id}         Generate multiple-choice quiz questions
"""

import asyncio
import json
import os
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import Transcript, get_db
from services.rag_service import _get_llm_client, _get_llm_model

router = APIRouter()


# ── Prompts ───────────────────────────────────────────────────────────────────

NOTES_PROMPT = """You are an expert educator and note-taker. Given the lecture transcript below, generate comprehensive, well-structured study notes in Markdown format.

Use exactly this structure (no extra text before or after):

# Lecture Notes

## Key Concepts
- **Term**: One-line definition for each key term

## Main Topics
### [Topic Name]
A short paragraph explaining each major topic covered.

## Important Definitions
- **Term**: Full clear definition

## Summary
A 2-3 paragraph overview of the entire lecture.

## Key Takeaways
- Most important point 1
- Most important point 2
(5-7 bullet points total)

Rules:
- Bold all important terms using **term**
- Be comprehensive but concise
- Write in clear, student-friendly language
- Return ONLY the markdown, absolutely no preamble or postamble"""

FLASHCARD_PROMPT = """You are an expert educator. Given the lecture transcript below, generate exactly 8 high-quality flashcards that test understanding of the key concepts.

Return ONLY a valid JSON array with no extra text, no markdown fences. Format:
[
  {"front": "Question or concept", "back": "Clear, concise answer"},
  ...
]

Rules:
- Make questions specific and testable
- Answers should be 1-3 sentences
- Cover different topics from the lecture
- Use simple language"""

QUIZ_PROMPT = """You are an expert educator. Given the lecture transcript below, generate exactly 5 multiple-choice quiz questions.

Return ONLY a valid JSON array with no extra text, no markdown fences. Format:
[
  {
    "question": "Question text?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct": 0,
    "explanation": "Brief explanation of why this is correct"
  },
  ...
]

Rules:
- correct is the 0-based index of the correct option
- All 4 options must be plausible
- Cover different sections of the lecture
- One clearly correct answer per question"""


# ── LLM helper ────────────────────────────────────────────────────────────────

def _call_llm_sync(system: str, user: str, max_tokens: int = 2000) -> str:
    response = _get_llm_client().chat.completions.create(
        model=_get_llm_model(),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=max_tokens,
        temperature=0.4,
    )
    return response.choices[0].message.content or ""


def _extract_json(raw: str) -> list:
    """Extract JSON array from LLM output even if wrapped in markdown."""
    raw = raw.strip()
    # Strip ```json ... ``` fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
    return json.loads(raw.strip())


async def _get_transcript_text(lecture_id: str, db: AsyncSession) -> str:
    row = (
        await db.execute(select(Transcript).where(Transcript.lecture_id == lecture_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No transcript found for lecture {lecture_id}. Make sure the lecture status is 'ready'.",
        )
    words = row.full_text.split()
    return " ".join(words[:5000])


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class Flashcard(BaseModel):
    front: str
    back: str

class FlashcardResponse(BaseModel):
    lecture_id: str
    cards: list[Flashcard]

class QuizOption(BaseModel):
    question: str
    options: list[str]
    correct: int
    explanation: str

class QuizResponse(BaseModel):
    lecture_id: str
    questions: list[QuizOption]

class NotesResponse(BaseModel):
    lecture_id: str
    markdown: str


# ── POST /flashcards/{lecture_id} ─────────────────────────────────────────────

@router.post(
    "/flashcards/{lecture_id}",
    response_model=FlashcardResponse,
    summary="Generate flashcards from a lecture transcript",
)
async def generate_flashcards(
    lecture_id: str,
    db: AsyncSession = Depends(get_db),
) -> FlashcardResponse:
    transcript_text = await _get_transcript_text(lecture_id, db)

    loop = asyncio.get_event_loop()
    try:
        raw = await loop.run_in_executor(
            None, _call_llm_sync, FLASHCARD_PROMPT, transcript_text, 2000
        )
        cards_data = _extract_json(raw)
        cards = [Flashcard(**c) for c in cards_data]
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"LLM returned invalid JSON for flashcards: {exc}",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Flashcard generation failed: {exc}",
        )

    return FlashcardResponse(lecture_id=lecture_id, cards=cards)


# ── POST /quiz/{lecture_id} ───────────────────────────────────────────────────

@router.post(
    "/quiz/{lecture_id}",
    response_model=QuizResponse,
    summary="Generate a multiple-choice quiz from a lecture transcript",
)
async def generate_quiz(
    lecture_id: str,
    db: AsyncSession = Depends(get_db),
) -> QuizResponse:
    transcript_text = await _get_transcript_text(lecture_id, db)

    loop = asyncio.get_event_loop()
    try:
        raw = await loop.run_in_executor(
            None, _call_llm_sync, QUIZ_PROMPT, transcript_text, 2000
        )
        questions_data = _extract_json(raw)
        questions = [QuizOption(**q) for q in questions_data]
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"LLM returned invalid JSON for quiz: {exc}",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Quiz generation failed: {exc}",
        )

    return QuizResponse(lecture_id=lecture_id, questions=questions)


# ── POST /notes/{lecture_id} ──────────────────────────────────────────────────

@router.post(
    "/notes/{lecture_id}",
    response_model=NotesResponse,
    summary="Generate structured markdown study notes from a lecture transcript",
)
async def generate_notes(
    lecture_id: str,
    db: AsyncSession = Depends(get_db),
) -> NotesResponse:
    transcript_text = await _get_transcript_text(lecture_id, db)

    loop = asyncio.get_event_loop()
    try:
        markdown = await loop.run_in_executor(
            None, _call_llm_sync, NOTES_PROMPT, transcript_text, 3000
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Notes generation failed: {exc}",
        )

    return NotesResponse(lecture_id=lecture_id, markdown=markdown.strip())
