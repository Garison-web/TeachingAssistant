FROM python:3.11-slim

# ffmpeg is required by openai-whisper for audio decoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Upgrade pip and install setuptools into the global environment
RUN pip install --upgrade pip setuptools wheel

# Install CPU-only torch first — keeps the image ~800 MB smaller than the CUDA build
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# openai-whisper uses a legacy setup.py that needs pkg_resources (setuptools).
# Install it first with --no-build-isolation so it uses the global setuptools.
RUN pip install --no-cache-dir --no-build-isolation openai-whisper==20231117

# Install the rest of the dependencies.
# We exclude openai-whisper from this install so pip's backtracking resolver
# never tries to rebuild it (which would fail without --no-build-isolation).
# Increment CACHEBUST to force Docker to re-run this layer on the next build.
ARG CACHEBUST=2
COPY backend/requirements.txt .
RUN grep -v 'openai-whisper' requirements.txt > /tmp/requirements_rest.txt && \
    pip install --no-cache-dir -r /tmp/requirements_rest.txt

# Pre-download the Whisper base model (~140 MB) at build time so the
# first upload request doesn't stall waiting for the download.
RUN python -c "import whisper; whisper.load_model('base')"

# Copy backend source
COPY backend/ .

EXPOSE 8000

# Railway injects $PORT at runtime; fall back to 8000 for local docker runs
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
