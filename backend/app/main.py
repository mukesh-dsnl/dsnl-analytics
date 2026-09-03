"""
FastAPI application entrypoint.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import HTMLResponse, JSONResponse

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


TAGS_METADATA = [
    {
        "name": "Auth",
        "description": (
            "Sign in, sign out, and identity. `POST /api/auth/login` is the only "
            "place a password is checked; everything after it is authenticated by "
            "a session row. Accounts are inserted directly into the `users` table."
        ),
    },
    {
        "name": "CDR Analytics",
        "description": (
            "Attempt metrics over the CDR/CODR parquet lake. Read-only and not "
            "per-user: the same question returns the same figures for everyone, "
            "so these need a signed-in caller but not a particular one."
        ),
    },
    {
        "name": "Campaign Metrics",
        "description": "Per-account, per-carrier and per-location campaign reporting.",
    },
    {
        "name": "AI Chat",
        "description": (
            "Natural-language questions over the same lake. Unlike the dashboards "
            "these are **per-user**: conversations belong to the account that "
            "created them, and another user's thread answers 404 exactly as a "
            "nonexistent one does."
        ),
    },
    {"name": "Health", "description": "Liveness. The one route with no authentication."},
]

DESCRIPTION = """
Analytics over the CDR/CODR call-detail lake, plus a natural-language assistant
over the same data.

### Authenticating

Every endpoint below except `POST /api/auth/login`, `POST /api/auth/logout` and
`GET /health` requires a session.

1. `POST /api/auth/login` with a username and password.
2. The response sets an **httpOnly** session cookie.
3. The browser attaches it to everything else automatically — including the
   "Try it out" buttons on this page, provided you signed in from this browser.

There is no bearer token to paste. The cookie cannot be read by script, which is
deliberate: this application renders model-generated content, and a token in
`localStorage` would be readable by anything injected into it.

### Failure codes

| Code | Meaning |
| --- | --- |
| 401 | No session, or it expired. Sign in again. |
| 404 | Not found — or not yours. The two are deliberately indistinguishable. |
| 422 | The request body failed validation. |
| 502 | The AI provider or its tool loop failed. |
| 503 | No AI provider configured; the response names the variable to set. |
"""

app = FastAPI(
    title="DSNL Analytics",
    description=DESCRIPTION,
    version="0.1.0",
    lifespan=lifespan,
    openapi_tags=TAGS_METADATA,
    # The built-in docs routes are switched off and re-declared below, behind
    # the same session guard as everything else. FastAPI serves all three
    # unauthenticated by default, which would have left the full API surface —
    # every route, every schema — readable by anyone who can reach the port.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
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


# ── API documentation ────────────────────────────────────────────────────
# Swagger UI, ReDoc and the schema they read, all behind the session.
#
# FastAPI provides these for free and unauthenticated. That default is fine for
# a public API and wrong for this one: the schema lists every route, every
# request shape and every field name in the system, which is a map worth having
# before attacking it. Re-declared here so they inherit the same guard as the
# endpoints they describe.
#
# Signing in through the frontend is enough to read them. Cookies are scoped by
# host and ignore the port, so a session obtained at localhost:5174 is sent to
# this server too — which is also why "Try it out" below works without pasting
# anything.
#
# `include_in_schema=False`: documentation about the API is not part of it.


@app.get("/openapi.json", include_in_schema=False)
def openapi_schema(_: None = Depends(require_user)) -> JSONResponse:
    """The generated schema. Guarded, or the page above would be a formality."""
    return JSONResponse(app.openapi())


@app.get("/docs", include_in_schema=False)
def swagger_ui(_: None = Depends(require_user)) -> HTMLResponse:
    """Swagger UI — the interactive page, with a Try-it-out button per route."""
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title=f"{app.title} — API",
        swagger_favicon_url="/favicon.ico",
    )


@app.get("/redoc", include_in_schema=False)
def redoc(_: None = Depends(require_user)) -> HTMLResponse:
    """ReDoc — the same schema as a reference document rather than a console."""
    return get_redoc_html(
        openapi_url="/openapi.json",
        title=f"{app.title} — API reference",
        redoc_favicon_url="/favicon.ico",
    )
