"""
services/embedding_service.py — Embed chunks into ChromaDB
────────────────────────────────────────────────────────────
Model   : sentence-transformers/all-MiniLM-L6-v2  (384-dim, ~22 MB, free, local)
Storage : ChromaDB PersistentClient at ./chroma_db

One ChromaDB collection per lecture:  "lecture_{lecture_id}"
  document  = chunk.text
  embedding = 384-float vector from all-MiniLM-L6-v2
  metadata  = { chunk_id, lecture_id, chunk_index, start_time, end_time }
  id        = chunk.id  (UUID string)

Why per-lecture collections?
  Querying with `where={"lecture_id": ...}` inside a single large collection
  works, but per-lecture collections keep query scope naturally isolated,
  make re-indexing a single lecture cheap (just delete + recreate), and
  avoid metadata-filter overhead on large corpora.

Public interface:
  async def create_embeddings(
      lecture_id : str,
      chunks     : list[Chunk],      # ORM objects (attributes already loaded)
      batch_size : int = 50,
  ) -> tuple[int, str]               # (total_chunks_stored, collection_name)
"""

import asyncio
import os
from dataclasses import dataclass

import chromadb
from sentence_transformers import SentenceTransformer

# ── Config ──────────────────────────────────────────────────────────────────

CHROMA_DB_PATH  = os.getenv("CHROMA_DB_PATH", "./chroma_db")
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

# ── Module-level model cache (loaded once per process) ──────────────────────

_model_cache: dict[str, SentenceTransformer] = {}


# ══════════════════════════════════════════════════════════════════════════════
# Internal data class — avoids SQLAlchemy detached-instance issues in threads
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class _ChunkData:
    """Plain data extracted from Chunk ORM objects before entering the thread pool."""
    id          : str
    text        : str
    start_time  : float
    end_time    : float
    chunk_index : int


# ══════════════════════════════════════════════════════════════════════════════
# Synchronous core — runs inside run_in_executor
# ══════════════════════════════════════════════════════════════════════════════

def _get_model(model_name: str = EMBEDDING_MODEL) -> SentenceTransformer:
    """Load model on first call, return cached instance on subsequent calls."""
    if model_name not in _model_cache:
        print(f"⏳  [Embedding] Loading '{model_name}' model (first call — may take a moment)…")
        _model_cache[model_name] = SentenceTransformer(model_name)
        dim = _model_cache[model_name].get_embedding_dimension()
        print(f"✅  [Embedding] Model ready — {dim}-dim vectors")
    return _model_cache[model_name]


def _embed_sync(
    lecture_id  : str,
    chunk_data  : list[_ChunkData],
    batch_size  : int,
) -> tuple[int, str]:
    """
    Synchronous embedding + ChromaDB upsert.
    Called via run_in_executor so it never blocks the event loop.
    """

    collection_name = f"lecture_{lecture_id}"
    total           = len(chunk_data)

    print(f"\n🔢  [Embedding] Starting — {total} chunks → collection '{collection_name}'")

    # ── 1. Load embedding model ──────────────────────────────────────────────
    model = _get_model()

    # ── 2. Init ChromaDB persistent client ───────────────────────────────────
    os.makedirs(CHROMA_DB_PATH, exist_ok=True)
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)

    # ── 3. Drop and recreate collection (safe re-processing) ─────────────────
    try:
        client.delete_collection(collection_name)
        print(f"🗑️   [Embedding] Deleted existing collection '{collection_name}' (re-indexing)")
    except Exception:
        pass   # collection didn't exist yet — that's fine

    collection = client.create_collection(
        name     = collection_name,
        metadata = {"hnsw:space": "cosine"},   # cosine similarity for semantic search
    )

    # ── 4. Embed and upsert in batches ───────────────────────────────────────
    stored = 0

    for batch_start in range(0, total, batch_size):
        batch       = chunk_data[batch_start : batch_start + batch_size]
        batch_texts = [c.text for c in batch]

        # Encode returns numpy array — convert to list[list[float]] for ChromaDB
        embeddings: list[list[float]] = model.encode(
            batch_texts,
            show_progress_bar = False,
            convert_to_numpy  = True,
        ).tolist()

        collection.add(
            ids        = [c.id for c in batch],
            embeddings = embeddings,
            documents  = batch_texts,
            metadatas  = [
                {
                    "lecture_id"  : lecture_id,
                    "chunk_id"    : c.id,
                    "chunk_index" : c.chunk_index,
                    "start_time"  : c.start_time,
                    "end_time"    : c.end_time,
                }
                for c in batch
            ],
        )

        stored += len(batch)
        print(f"🔢  [Embedding] {stored}/{total} chunks embedded and stored")

    print(
        f"✅  [Embedding] Done — {stored} vectors in '{collection_name}' "
        f"(path: {CHROMA_DB_PATH})"
    )
    return stored, collection_name


# ══════════════════════════════════════════════════════════════════════════════
# Public async interface
# ══════════════════════════════════════════════════════════════════════════════

async def create_embeddings(
    lecture_id : str,
    chunks     : list,          # list[Chunk] ORM objects
    batch_size : int = 50,
) -> tuple[int, str]:
    """
    Async wrapper around the synchronous embedding pipeline.

    Extracts all needed data from ORM Chunk objects (before entering the
    thread pool — SQLAlchemy objects are not thread-safe) then delegates
    to _embed_sync via run_in_executor so the event loop stays unblocked.

    Args:
        lecture_id : UUID of the parent lecture.
        chunks     : List of Chunk ORM objects (must have id, text, start_time,
                     end_time, chunk_index populated).
        batch_size : Chunks per encode() call.  50 is a safe default for CPU.

    Returns:
        (total_stored, collection_name)

    Raises:
        RuntimeError : If ChromaDB or sentence-transformers encounter an error.
    """

    if not chunks:
        print(f"⚠️   [Embedding] No chunks to embed for lecture {lecture_id}")
        return 0, f"lecture_{lecture_id}"

    # Extract plain data NOW (in async context) before handing to thread pool
    chunk_data = [
        _ChunkData(
            id          = c.id,
            text        = c.text,
            start_time  = c.start_time,
            end_time    = c.end_time,
            chunk_index = c.chunk_index,
        )
        for c in chunks
    ]

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,           # default thread-pool executor
        _embed_sync,
        lecture_id,
        chunk_data,
        batch_size,
    )


# ══════════════════════════════════════════════════════════════════════════════
# Query helper (used by rag_service in phase 2)
# ══════════════════════════════════════════════════════════════════════════════

def query_collection(
    lecture_id       : str,
    query_embedding  : list[float],
    top_k            : int = 5,
) -> list[dict]:
    """
    Synchronous nearest-neighbour search against a lecture's collection.
    Returns list of dicts: { text, chunk_id, start_time, end_time, distance }
    Call from an async route via run_in_executor.
    """
    collection_name = f"lecture_{lecture_id}"

    client     = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    collection = client.get_collection(collection_name)

    results = collection.query(
        query_embeddings = [query_embedding],
        n_results        = top_k,
        include          = ["documents", "metadatas", "distances"],
    )

    output = []
    for doc, meta, dist in zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
    ):
        output.append({
            "text"       : doc,
            "chunk_id"   : meta.get("chunk_id"),
            "start_time" : meta.get("start_time"),
            "end_time"   : meta.get("end_time"),
            "distance"   : round(dist, 4),
        })

    return output
