# ΓöÇΓöÇ Stage 1: Download and cache model weights ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
# Using a full Python image just for pip + heavy model download
FROM python:3.11-slim-bookworm AS model-downloader

WORKDIR /model-cache

# Install only what's needed to pull the model
RUN pip install --no-cache-dir huggingface_hub

# Pre-download Donut fine-tuned model to a cache folder
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download(repo_id='chinmays18/medical-prescription-ocr', cache_dir='/model-cache')"

# ΓöÇΓöÇ Stage 2: Runtime ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
FROM python:3.11-slim-bookworm AS runner

WORKDIR /app

# System libraries needed by OpenCV and PyTorch
RUN (sed -i 's/http:/https:/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true) && \
    (sed -i 's/http:/https:/g' /etc/apt/sources.list 2>/dev/null || true) && \
    apt-get update -o Acquire::ForceIPv4=true && \
    apt-get install -y -o Acquire::ForceIPv4=true --no-install-recommends \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user and cache directory
RUN useradd -m donut && mkdir -p /home/donut/.cache/huggingface

# Copy model weights from downloader stage to donut user cache
COPY --from=model-downloader --chown=donut:donut /model-cache /home/donut/.cache/huggingface

# Copy application code
COPY donut_server.py donut_safety.py ./

RUN chown -R donut:donut /app

USER donut

EXPOSE 8000

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/donut/.cache/huggingface

CMD ["uvicorn", "donut_server:app", "--host", "0.0.0.0", "--port", "8000"]
