"""Environment-backed settings. Read once at import."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Neon connection URL (pooled). psycopg 3 uses postgresql:// scheme.
    database_url: str = Field(..., alias="DATABASE_URL")

    # ASL Belgisi.
    asl_api_base: str = Field("https://xtrace.aslbelgisi.uz", alias="ASL_API_BASE")
    asl_api_key: str = Field("", alias="ASL_API_KEY")

    # For v1 we auto-provision a single admin user with this id/name so the
    # scanning tables have something to reference. Real auth comes with the
    # multi-user phase from plan.md.
    default_user_id: int = 1
    default_user_name: str = "admin"

    # JWT auth (multi-user phase). If unset in prod, generate one and set it —
    # rotating this signs everyone out.
    jwt_secret: str = Field(
        "dev-only-please-override-in-prod-changeme-changeme-changeme",
        alias="JWT_SECRET",
    )
    jwt_algorithm: str = "HS256"
    jwt_ttl_hours: int = 12
    cookie_name: str = "ma_auth"
    cookie_secure: bool = Field(False, alias="COOKIE_SECURE")

    @property
    def aggregation_endpoint(self) -> str:
        return f"{self.asl_api_base.rstrip('/')}/public/api/v1/doc/aggregation"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
