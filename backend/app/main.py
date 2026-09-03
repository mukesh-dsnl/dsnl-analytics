"""
FastAPI application entrypoint.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import ai, auth, campaign, cdr
from app.api.deps import require_user
from app.core.config import get_settings
from app.core.database import Base, engine

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Application startup/shutdown lifecycle."""
    # Import all models so they're registered with Base
    import app.models  # noqa: F401

    # Create tables (dev convenience — Alembic handles production migrations)
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables ensured")

    yield

    logger.info("Application shutting down")


app = FastAPI(
    title="DSNL Analytics",
    description="Analytics Platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow all origins for dev (tighten in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────
# Everything except /api/auth/* and /health requires a signed-in caller, and
# the guard is attached here rather than on each endpoint. That is the point:
# a route added to any of these modules later inherits it, where a per-endpoint
# decorator would have to be remembered every time. `require_user` resolves the
# session and discards the result — the dashboards read a parquet lake and hold
# no per-user data, so they need the caller to exist, not to know who it is.
#
# The AI router is protected the same way *and* its endpoints take the user
# explicitly, because its data is per-user and has to be scoped, not just
# gated.
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(
    cdr.router,
    prefix="/api",
    dependencies=[Depends(require_user)],
    tags=["CDR Analytics"],
)
app.include_router(
    campaign.router,
    prefix="/api",
    dependencies=[Depends(require_user)],
    tags=["Campaign Metrics"],
)
# Registers unconditionally. With no AI key configured the route still exists
# and answers 503 naming the variable to set — the dashboards above are
# unaffected either way.
app.include_router(
    ai.router,
    prefix="/api",
    dependencies=[Depends(require_user)],
    tags=["AI Chat"],
)


@app.get("/health", tags=["Health"])
def health_check() -> dict:
    """Health check endpoint — returns 200 if the service is running."""
    return {"status": "ok"}
