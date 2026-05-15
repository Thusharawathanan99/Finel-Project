# ΓöÇΓöÇ Stage 1: Download and cache model weights ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
# Using a full Python image just for pip + heavy model download
FROM python:3.11-slim-bookworm AS model-downloader

WORKDIR /model-cache

# Install only what's needed to pull the model
RUN pip install --no-cache-dir huggingface_hub

# Pre-download Donut base model to a cache folder
# (Replace with your fine-tuned model ID if uploaded to HuggingFace Hub)
RUN python -c "\
from huggingface_hub import snapshot_download; \
snapshot_download(repo_id='naver-clova-ix/donut-base', cache_dir='/model-cache')"

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

# Copy model weights from downloader stage (avoids re-downloading)
COPY --from=model-downloader /model-cache /root/.cache/huggingface

# Copy application code
COPY donut_server.py ./

# Copy local fine-tuned model if present (adjust path as needed)
# COPY ../best_model ./best_model

# Non-root user
RUN useradd -m donut && chown -R donut:donut /app /root/.cache/huggingface
USER donut

EXPOSE 8000

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

CMD ["uvicorn", "donut_server:app", "--host", "0.0.0.0", "--port", "8000"]
