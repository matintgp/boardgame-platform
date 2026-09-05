# syntax=docker/dockerfile:1
# Stockfish 18 (tag sf_18) — GPLv3; see THIRD_PARTY_NOTICES.md

FROM ubuntu:24.04 AS stockfish-build
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl build-essential git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# Official stable release tag for Stockfish 18
ARG STOCKFISH_REF=sf_18
RUN git clone --depth 1 --branch "${STOCKFISH_REF}" \
      https://github.com/official-stockfish/Stockfish.git . \
    && make -C src -j"$(nproc)" build \
    && install -m 755 src/stockfish /usr/local/bin/stockfish \
    && /usr/local/bin/stockfish <<< "quit" >/dev/null

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STOCKFISH_PATH=/usr/local/bin/stockfish \
    CHESS_BOT_POOL_SIZE=2 \
    CHESS_BOT_THREADS=1 \
    CHESS_BOT_HASH_MB=64 \
    CHESS_BOT_MOVE_TIMEOUT=8

WORKDIR /srv

COPY --from=stockfish-build /usr/local/bin/stockfish /usr/local/bin/stockfish

COPY pyproject.toml ./
RUN pip install --no-cache-dir .

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2"]
