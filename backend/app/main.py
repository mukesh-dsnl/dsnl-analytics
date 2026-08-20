"""
FastAPI application entrypoint.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, cdr
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

# Include API routers
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(cdr.router, prefix="/api", tags=["CDR Analytics"])


@app.get("/health", tags=["Health"])
def health_check() -> dict:
    """Health check endpoint — returns 200 if the service is running."""
    return {"status": "ok"}
