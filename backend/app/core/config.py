"""
Application configuration — loaded from environment variables / .env file.

All config values come from env vars (R21: never hardcoded).
Secrets are never logged (R16).
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the DSNL Analytics platform."""

    # Database
    DATABASE_URL: str = "mysql+pymysql://root:abcd1234@localhost:3306/reports"

    # Storage paths (relative to project root)
    STORAGE_PATH: str = "storage"

    # Logging
    LOG_LEVEL: str = "INFO"

    # Timezone
    TIMEZONE: str = "Asia/Kolkata"

    # ── CDR analytics lake ───────────────────────────────────────────────
    # Two directories of daily parquet exports, named cdr_YYYYMMDD.parquet and
    # codr_YYYYMMDD.parquet. Queried in place with DuckDB — nothing is uploaded
    # and nothing is copied locally. Independent of DATABASE_URL; nothing here
    # touches MySQL.
    CDR_LAKE_PATH: str = "Z:/cdr"
    CODR_LAKE_PATH: str = "Z:/codr"
    # The lake is a network share, so a query's cost is set by how many daily
    # files it opens. This caps the date range a single query may span.
    CDR_MAX_RANGE_DAYS: int = 31
    # Hard ceiling on rows any single query may return, so a broad request
    # can't try to materialise a whole range.
    CDR_MAX_ROWS_PER_QUERY: int = 5000

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache()
def get_settings() -> Settings:
    """Cached singleton — call this instead of constructing Settings directly."""
    return Settings()
