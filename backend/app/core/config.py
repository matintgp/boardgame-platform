from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"
    secret_key: str
    frontend_origin: str = "http://localhost:3000"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    database_url: str
    redis_url: str

    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    admin_email: str = ""

    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "devsecret-please-change-me-32-chars-min!!"
    livekit_public_url: str = "ws://localhost:7880"

    # Chess vs Bot (Stockfish 18 UCI pool)
    stockfish_path: str = "/usr/local/bin/stockfish"
    chess_bot_pool_size: int = 2
    chess_bot_threads: int = 1
    chess_bot_hash_mb: int = 64
    chess_bot_move_timeout: float = 8.0
    chess_bot_max_concurrent_per_user: int = 3

    @field_validator("env")
    @classmethod
    def _validate_env(cls, v: str) -> str:
        if v not in ("development", "production", "test"):
            raise ValueError("ENV must be development | production | test")
        return v

    @property
    def is_production(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
