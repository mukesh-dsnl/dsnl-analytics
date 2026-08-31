"""
Application configuration — loaded from environment variables / .env file.

All config values come from env vars (R21: never hardcoded).
Secrets are never logged (R16).
"""

from functools import lru_cache
from typing import Optional

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

    # ── AI chat ──────────────────────────────────────────────────────────
    # Optional throughout. None of these may be required at import time: the
    # CDR dashboards have to keep working with no AI configured at all, so a
    # missing key is an error raised inside POST /api/ai/chat (503), never a
    # failed startup.
    #
    # AI_PROVIDER unset means auto-detect — the first key present wins, in the
    # order Anthropic, OpenAI, Gemini (see providers/factory.py).
    AI_PROVIDER: Optional[str] = None  # "anthropic" | "openai" | "gemini"
    AI_MODEL: Optional[str] = None  # provider-specific id; None = that provider's default
    # Deliberately tighter than CDR_MAX_RANGE_DAYS. The dashboard's range is
    # chosen by a person who sees the cost in the loading spinner; an ad-hoc
    # range is chosen by a model that doesn't, and each round of the tool loop
    # can pick a new one.
    AI_MAX_RANGE_DAYS: int = 7
    # How many result rows may go back to the model. This is a context budget,
    # not a safety limit — it is applied as a structural LIMIT wrapper the
    # model's own SQL cannot widen.
    AI_MAX_ROWS_TO_MODEL: int = 500
    # Tool-calling rounds per question before the loop gives up. Bounds both
    # latency and spend on a model that keeps refining instead of answering.
    AI_MAX_TOOL_ROUNDS: int = 5

    ANTHROPIC_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache()
def get_settings() -> Settings:
    """Cached singleton — call this instead of constructing Settings directly."""
    return Settings()
