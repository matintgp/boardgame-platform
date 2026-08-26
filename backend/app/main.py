import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import auth, friends, games, moderation, users, ws
from app.core.config import settings
from app.realtime import bus
from app.realtime.hub import hub as connection_hub


@asynccontextmanager
async def lifespan(app: FastAPI):
    await bus.init_redis()
    await _promote_admin()
    listener = asyncio.create_task(bus.listen(connection_hub.broadcast_internal))
    yield
    listener.cancel()
    await bus.close_redis()


async def _promote_admin() -> None:
    """Bootstrap: the configured ADMIN_EMAIL always has admin rights."""
    if not settings.admin_email:
        return
    from sqlalchemy import update

    from app.db.session import SessionLocal
    from app.models.user import User

    try:
        async with SessionLocal() as db:
            await db.execute(
                update(User).where(User.email == settings.admin_email.lower())
                .values(is_admin=True)
            )
            await db.commit()
    except Exception:
        pass  # first boot before migrations - retry next start


app = FastAPI(
    title="BoardGame Platform API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs" if not settings.is_production else None,
    openapi_url="/api/openapi.json" if not settings.is_production else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok", "env": settings.env})


app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(friends.router, prefix="/api")
app.include_router(moderation.router, prefix="/api")
app.include_router(games.router, prefix="/api")
app.include_router(ws.router, prefix="/api")
