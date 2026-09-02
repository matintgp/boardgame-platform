# AGENTS.md — BoardGame Platform

Guidance for AI coding agents working in this repository. The reader is assumed to know nothing about the project.

## Project overview

A self-hosted, online board game platform: user accounts, friends, lobby/matchmaking, realtime gameplay over WebSocket, and pluggable game engines. Currently playable games: **chess**, **Battle for Rokugan** (hidden-info), **Mafia**, and **Salem 1692** (social deduction, hidden-info).

- Backend: `backend/` — FastAPI (Python ≥3.12), SQLAlchemy 2 async, PostgreSQL 17, Redis 7, Celery (worker + beat).
- Frontend: `frontend/` — Next.js 15 (App Router), React 19, Tailwind CSS v4, next-intl (locales `fa` + `en`, RTL/LTR), PWA shell.
- Infra: `infra/nginx/nginx.conf` (reverse proxy, rate limiting, WS upgrade), `infra/livekit/livekit.yaml` (self-hosted LiveKit for voice chat), `docker-compose.yml` orchestrates everything.
- Docs: `README.md` (prose mostly in Persian, commands in English), `docs/kimi-prompt-salem-ui.md` (English design brief for the Salem UI), `board-games-salem-1692-salem-rulebook-link.pdf` (rulebook reference).

### Language conventions

Code, identifiers, comments, and docstrings are in **English**. User-facing strings are bilingual: every string must exist in **both** `frontend/messages/fa.json` and `frontend/messages/en.json` (next-intl keys). Persian UI copy is the primary locale (default locale is `fa`). The README mixes Persian prose with English headings/commands.

## Architecture essentials (read before touching gameplay code)

These invariants are load-bearing; do not break them:

1. **Game logic is 100% server-side.** The client only renders; no move validation happens client-side.
2. **Event sourcing.** Table `game_events` is append-only and is the source of truth for each game. `games.state` is only a materialized cache, updated transactionally together with the events on every action. `games.last_seq` is a per-game monotonic sequence number.
3. **Pluggable game engines.** Every game implements `BaseEngine` in `backend/app/games/base.py` — `init_state(config, seats)`, `apply_action(state, seat, action_type, payload) -> ApplyResult`, `visible_state(state, seat)` — plus optional `validate_config`. Engines must be **pure/synchronous** (no I/O; the service layer does all DB/network work). To add a game: create `backend/app/games/<name>_engine.py` and register it in `backend/app/games/registry.py` (`ENGINES` dict).
4. **Hidden information.** Hidden-info games MUST filter per seat in `visible_state(state, seat)` (`seat=None` means spectator). Secret event types are filtered per viewer in `game_service.event_visible_to` (`SECRET_EVENT_TYPES`) so replays/sync never leak other players' secrets.
5. **Realtime fan-out.** All realtime messages are published to a single Redis pub/sub channel `bg:events` (`backend/app/realtime/bus.py`); each FastAPI node subscribes **once** (app-level listener in `main.py` lifespan) and forwards to its locally connected sockets via `app/realtime/hub.py`. Nodes are stateless and scale horizontally without sticky sessions. Do NOT add per-connection Redis listeners (see the NOTE in `ws.py`) or messages will be delivered once per socket.
6. **Reconnect protocol.** After reconnecting, the client sends `sync {room, last_seq}`; the server replays missed events from the DB (filtered by seat visibility) and sends a fresh visible-state snapshot.
7. **Timers.** Server-side per-game chess timers (`app/realtime/timers.py`) tick once per second under a Redis lock so exactly one worker ticks each game: 10-minute clock, 60s offline grace (clock pauses), 60s idle → server plays a random legal move. Presence (`app/realtime/presence.py`) is Redis-backed so any worker sees the same online set.

### Auth model

- Access token: short-lived JWT (15 min), kept in browser **memory only** on the frontend (never localStorage).
- Refresh token: random 48-byte, stored **sha256-hashed** in DB with rotation, family-revocation on reuse detection, and expiry; sent as an `httpOnly` cookie scoped to `path=/api/auth`. `logout` revokes it.
- WebSocket auth: client connects with no credentials, then MUST send `{"type":"auth","token":"<access JWT>"}` as the first frame (within 10 s). Query-string tokens are deliberately ignored so JWTs never land in logs. Unauthenticated sockets are closed with code 4401.
- Rate limiting on login/register exists both in FastAPI (`app/core/limiter.py`, Redis counters) and in Nginx.
- Bootstrap: the user whose email matches `ADMIN_EMAIL` env var is promoted to `is_admin` at startup (`main.py._promote_admin`).

## Code organization

### Backend (`backend/app/`)

- `main.py` — FastAPI app, lifespan (Redis init, bus listener, timer supervisor, admin bootstrap), CORS, `/api/health`, routers under `/api`.
- `core/` — `config.py` (pydantic-settings, env-driven; `ENV` ∈ development|production|test), `security.py` (JWT + Argon2 via pwdlib), `deps.py` (auth dependencies, `MAX_WS_MESSAGE_BYTES`), `limiter.py` (Redis rate limiting).
- `api/routes/` — `auth.py` (register/login/refresh/logout/change-password/me), `users.py` (profiles), `friends.py` (requests/search/respond), `games.py` (catalog, lobbies, create/join/start, matchmaking queue, rematch, actions, LiveKit voice-token), `moderation.py` (reports, admin ban), `ws.py` (the single `/api/ws` WebSocket endpoint: auth, subscribe, sync, action, chat).
- `games/` — engine plugin interface (`base.py`), `registry.py`, and one engine per game (`chess_engine.py`, `rokugan_engine.py`, `mafia_engine.py`, `salem_engine.py`, `salem_data.py`).
- `services/` — business logic. `game_service.py` is the chokepoint for all game state changes (event logging, snapshots, broadcasting, ELO update on finish); also `friend_service.py`, `matchmaking.py`, `rating.py` (ELO).
- `realtime/` — `bus.py` (Redis pub/sub), `hub.py` (local socket registry), `presence.py` (online status), `timers.py` (chess clocks).
- `models/` — SQLAlchemy models: `user`, `friendship`, `game` (+ `GameSeat`, statuses waiting/active/finished/aborted), `game_event`, `refresh_token`, `report`.
- `db/` — `base.py` (Base, `utcnow`, portable JSON type), `session.py` (async engine/session).
- `workers/` — Celery app (Redis broker) and tasks: cleanup of expired refresh tokens (daily) and stale lobbies (lobbies have a 10-minute TTL; a user may have at most 2 open lobbies).
- `schemas/api.py` — Pydantic request/response models.
- `alembic/` — migrations (numbered `0001_...`, `0002_...`, ...). The backend container runs `alembic upgrade head` on startup.

When modifying game rules or state flow: engines stay pure; persistence, event emission, per-seat snapshots, and broadcasting all go through `services/game_service.py`. Any read-modify-write on a game row (join/start/action) must use `get_game(..., for_update=True)` to avoid seat/seq races.

### Frontend (`frontend/src/`)

- `app/[locale]/` — App Router pages: home, login, register, lobby, friends, profile, `game/[id]`, not-found; all routes are locale-prefixed (`localePrefix: "always"` — do not switch to "as-needed", see comment in `i18n/routing.ts`). Middleware (`middleware.ts`) is next-intl only.
- `components/` — one game UI per engine (`ChessGame.tsx`, `RokuganGame.tsx`, `MafiaGame.tsx`, `SalemGame.tsx`) routed by `GameRouter.tsx`, plus `AuthForm`, `Navbar`, `ChatPanel`, `VoicePanel` (LiveKit), and the `salem/` component set. Per-game styles live in `styles/rokugan.css`, `styles/salem.css`.
- `lib/` — `api.ts` (fetch client; access token in memory, deduped refresh — critical because the backend rotates refresh tokens), `gameSocket.ts` (WS client with reconnect/sync), `rematch.ts`, `sounds.ts`.
- `i18n/` — next-intl routing/request/navigation. Translations in `frontend/messages/{fa,en}.json`.
- `next.config.ts` — `output: "standalone"` (required by the Docker image); dev rewrites `/api/*` to `NEXT_PUBLIC_API_BASE` or `http://127.0.0.1:8000`.
- `public/` — chess piece PNGs, per-game art/sounds; `public/salem/CREDITS.md` must be kept up to date with source/license for every Salem asset (public-domain art only).

## Build and run

Everything runs via Docker Compose (canonical dev + prod environment):

```bash
cp .env.example .env          # then set a real SECRET_KEY: python -c "import secrets; print(secrets.token_hex(64))"
docker compose up --build
```

Services: `db` (Postgres 17), `redis`, `backend` (uvicorn, 2 workers, runs migrations on start), `worker` + `beat` (Celery), `frontend` (standalone Next.js), `nginx` (entry point, port `$HTTP_PORT`, default 80), `livekit`.

- App via Nginx: `http://localhost`
- Frontend direct: `http://localhost:3000`
- API docs (dev only): `http://localhost/api/docs`
- Frontend dev server (outside Docker): `cd frontend && npm install && npm run dev`
- Local backend: `cd backend && pip install -e ".[dev]"` (requires Python ≥3.12 and running Postgres/Redis, or the test env vars from `tests/conftest.py`)

### Migrations

```bash
docker compose exec backend alembic upgrade head                    # apply
docker compose exec backend alembic revision --autogenerate -m "…"  # after changing models
```

## Testing

Backend only (the frontend has no test setup):

```bash
cd backend && pip install -e ".[dev]" && pytest -q
```

- ~109 tests across `backend/tests/` (engine unit tests for all four games, lobby TTL, matchmaking, presence/timers, refresh-token families, rematch, secret-event visibility, security, WS auth).
- Tests need **no external services**: `tests/conftest.py` sets env vars before any app import (`DATABASE_URL=sqlite+aiosqlite:///:memory:`, `ENV=test`, dummy `SECRET_KEY`) and provides a `FakeRedis` fixture monkeypatched over `app.realtime.bus.get_redis`.
- `pytest` config in `pyproject.toml`: `testpaths = ["tests"]`, `asyncio_mode = "auto"` (async tests need no marker).
- All existing tests must stay green when changing gameplay or auth code — especially `test_salem_engine.py` and `test_secret_events.py` (hidden-info guarantees).

## Code style guidelines

- **Python**: Ruff, `line-length = 100`, `target-version = py312` (config in `backend/pyproject.toml`). Type-annotated async code; SQLAlchemy 2.0 `Mapped`/`mapped_column` style. Module docstrings explain *why*, comments are terse and in English.
- **TypeScript/React**: strict TS, functional components, client components marked `"use client"`; game UIs are per-engine components selected by `GameRouter.tsx`.
- Keep engines pure and synchronous; keep I/O in routes/services.
- Minimal, scoped changes: don't refactor unrelated code; match surrounding conventions.
- New UI strings: add keys to **both** `messages/fa.json` and `messages/en.json`, and verify RTL layout for `fa`.

## Security considerations

- Never move validation to the client or expose raw game state; always go through `visible_state` / `event_visible_to` projections.
- Never log or URL-encode tokens; access tokens stay in memory, refresh tokens only in the scoped httpOnly cookie, hashed at rest.
- `ENV=production` disables API docs and enables secure cookies (`settings.is_production`). `SECRET_KEY` must be replaced before any real deployment (dev default is a placeholder).
- Nginx sets `X-Forwarded-For`/`X-Forwarded-Proto` and applies rate limits + security headers; when deployed behind a real proxy, keep trusting these headers accordingly.
- The refresh-token rotation dedupe in `frontend/src/lib/api.ts` is intentional — parallel refresh calls would reuse a revoked cookie and falsely log the user out.
- Before any public release, review IP/licensing of the commercial games being modeled (Battle for Rokugan, Town of Salem) — noted in the README roadmap.
