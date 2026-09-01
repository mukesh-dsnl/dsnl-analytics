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
    # The range ceiling for AI tool calls, on both tiers. Independent of
    # CDR_MAX_RANGE_DAYS rather than derived from it: that one is tuned for
    # what a person will wait for on a dashboard panel, while the questions
    # asked here ("minutes day by day across a fortnight") are legitimately
    # wider. Tying the two together made those questions unanswerable — the
    # model could only satisfy them by calling once per day, which exhausted
    # the round budget before it reached an answer.
    #
    # Raise or lower this on its own; it is what both get_cdr_panel and
    # run_cdr_query are checked against, so it is the one number the model is
    # told about, and the one that bounds how many daily files a single tool
    # call can open.
    AI_MAX_RANGE_DAYS: int = 31
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

    # ── AI cost display ──────────────────────────────────────────────────
    # Price per MILLION tokens, input and output separately — every provider
    # prices them separately, usually with output several times dearer.
    #
    # IMPORTANT: these defaults are Google's published list price for
    # gemini-2.5-flash-lite and are here only so the figure is not zero out of
    # the box. They are not verified against your contract, they do not track
    # provider price changes, and they are wrong for any other model. Set them
    # to your actual rates before treating the cost shown in the UI as
    # anything but an estimate.
    AI_PRICE_INPUT_PER_MTOK: float = 0.10
    AI_PRICE_OUTPUT_PER_MTOK: float = 0.40
    AI_PRICE_CURRENCY: str = "USD"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache()
def get_settings() -> Settings:
    """Cached singleton — call this instead of constructing Settings directly."""
    return Settings()
