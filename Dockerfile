FROM python:3.11-slim

# ffmpeg is required by openai-whisper for audio decoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Install CPU-only torch first — keeps the image ~800 MB smaller than the CUDA build
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

# Install the rest of the Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the Whisper base model (~140 MB) at build time so the
# first upload request doesn't stall waiting for the download.
RUN python -c "import whisper; whisper.load_model('base')"

# Copy backend source
COPY backend/ .

EXPOSE 8000

# Railway injects $PORT at runtime; fall back to 8000 for local docker runs
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
