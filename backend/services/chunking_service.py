"""
services/chunking_service.py — Group Whisper segments into RAG chunks
───────────────────────────────────────────────────────────────────────
Strategy: fixed sliding window over ordered segments
  • Every N consecutive segments are merged into one Chunk.
  • The chunk text is the joined text of all N segments.
  • start_time comes from the first segment; end_time from the last.
  • The final window may contain fewer than N segments (remainder).

Why N=5 by default?
  Whisper segments are ~5-15 words each.  5 segments ≈ 50-80 words,
  which fits comfortably in a 384-dim embedding context window and
  gives the LLM enough surrounding context to answer a question.

Public interface:
  async def chunk_segments(
      lecture_id : str,
      segments   : list[Segment],    # ORM objects, already sorted by index
      db         : AsyncSession,
      chunk_size : int = 5,
  ) -> list[Chunk]
"""

import uuid

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from database.db import Chunk, Segment


async def chunk_segments(
    lecture_id : str,
    segments   : list[Segment],
    db         : AsyncSession,
    chunk_size : int = 5,
) -> list[Chunk]:
    """
    Groups `segments` into windows of `chunk_size`, saves each window as a
    Chunk row in SQLite, and returns the list of Chunk objects.

    Args:
        lecture_id  : UUID of the parent lecture.
        segments    : All Segment rows for this lecture, in order.
        db          : Active async database session (injected from route).
        chunk_size  : Number of segments per chunk (default 5).

    Returns:
        List of persisted Chunk ORM objects (attributes accessible after flush).

    Notes:
        - Any existing Chunk rows for lecture_id are deleted first so the
          function is safely re-entrant (re-processing a lecture is allowed).
        - db.flush() is called after add_all so the returned objects have
          valid IDs before the caller's commit.
    """

    if not segments:
        print(f"⚠️   [Chunking] No segments found for lecture {lecture_id} — nothing to chunk")
        return []

    # ── 0. Clear any previous chunks for this lecture (idempotent) ──────────
    deleted = await db.execute(delete(Chunk).where(Chunk.lecture_id == lecture_id))
    if deleted.rowcount:
        print(f"🗑️   [Chunking] Removed {deleted.rowcount} stale chunk(s) for re-processing")

    # ── 1. Sort by segment_index (defensive; route should pass sorted list) ─
    sorted_segs = sorted(segments, key=lambda s: s.segment_index)

    total_segs    = len(sorted_segs)
    total_chunks  = (total_segs + chunk_size - 1) // chunk_size   # ceiling division

    print(f"\n✂️   [Chunking] {total_segs} segments → {total_chunks} chunks (window={chunk_size})")

    # ── 2. Slide window and build Chunk objects ──────────────────────────────
    chunks: list[Chunk] = []

    for window_start in range(0, total_segs, chunk_size):
        window     = sorted_segs[window_start : window_start + chunk_size]
        chunk_idx  = window_start // chunk_size

        combined_text = " ".join(seg.text.strip() for seg in window)
        start_time    = window[0].start_time
        end_time      = window[-1].end_time

        chunk = Chunk(
            id          = str(uuid.uuid4()),
            lecture_id  = lecture_id,
            chunk_index = chunk_idx,
            text        = combined_text,
            start_time  = start_time,
            end_time    = end_time,
        )
        chunks.append(chunk)

        print(
            f"✂️   [Chunking] {chunk_idx + 1:>4}/{total_chunks}  "
            f"segs {window[0].segment_index}–{window[-1].segment_index}  "
            f"({start_time:.1f}s – {end_time:.1f}s)  "
            f"{len(combined_text)} chars"
        )

    # ── 3. Bulk-insert and flush so IDs are available to the caller ──────────
    db.add_all(chunks)
    await db.flush()

    print(f"✅  [Chunking] {len(chunks)} chunks saved to SQLite")
    return chunks
