# CodeLens AI in one container: the FastAPI backend serves the built
# React frontend on one port ($PORT, default 7860). Deployed on Render's
# free plan (render.yaml); runs anywhere Docker runs.
#
#   docker build -t codelens-ai .
#   docker run -p 7860:7860 -e GROQ_API_KEYS=gsk_a,gsk_b codelens-ai
#
# Semgrep needs more memory than small free plans give; add it with
#   docker build --build-arg WITH_SEMGREP=true -t codelens-ai .

# --- Frontend build -----------------------------------------------------------
FROM node:20-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- Gitleaks (optional analyzer, official release binary) --------------------
FROM debian:bookworm-slim AS gitleaks
ARG GITLEAKS_VERSION=8.21.2
ADD https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz /tmp/gitleaks.tar.gz
RUN tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks && chmod +x /usr/local/bin/gitleaks

# --- Runtime --------------------------------------------------------------------
FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=gitleaks /usr/local/bin/gitleaks /usr/local/bin/gitleaks

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /home/user/app

ARG WITH_SEMGREP=false
COPY --chown=user requirements.txt requirements-analyzers.txt ./
RUN pip install --user -r requirements.txt     && if [ "$WITH_SEMGREP" = "true" ]; then pip install --user -r requirements-analyzers.txt; fi

COPY --chown=user agents ./agents
COPY --chown=user backend ./backend
COPY --chown=user prompts ./prompts
COPY --chown=user utils ./utils
COPY --chown=user pyproject.toml ./
COPY --from=frontend --chown=user /src/frontend/dist ./frontend/dist

# Repositories live inside the container: they are lost when it restarts.
ENV CODELENS_STATIC_DIR=/home/user/app/frontend/dist \
    CODELENS_UPLOAD_DIR=/home/user/app/uploads

EXPOSE 7860
# Hosts such as Render choose the port through $PORT.
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
