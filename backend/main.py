
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.routers import ai, analysis, chat, dependencies, export, jobs, repositories
from backend.services.repository_service import sweep_orphan_workspaces

logger = logging.getLogger("codelens")

# A built frontend to serve from this server (one app, one origin), e.g. in
# the Docker image. Unset in development, where Vite serves the frontend.
_static = os.getenv("CODELENS_STATIC_DIR", "").strip()
STATIC_DIR = Path(_static).resolve() if _static else None
if STATIC_DIR is not None and not (STATIC_DIR / "index.html").is_file():
    STATIC_DIR = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Remove workspaces left behind by an interrupted import.
    sweep_orphan_workspaces()
    yield


app = FastAPI(
    title="CodeLens AI API",
    description="Backend API for the CodeLens AI Repository Intelligence Platform.",
    version="1.0.0",
    lifespan=lifespan,
)


extra_origins = [o.strip() for o in os.getenv("CODELENS_CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        *extra_origins,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, error: Exception):
    """
    Log unexpected failures with their traceback and return a generic 500.

    Exception details can contain local paths or third-party messages, so
    they are written to the server log only, never to the response.
    """

    logger.error(
        "Unhandled error on %s %s",
        request.method,
        request.url.path,
        exc_info=error,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Unexpected server error. Check the server log for details."},
    )


# Register API routers
app.include_router(repositories.router)
app.include_router(analysis.router)
app.include_router(ai.router)
app.include_router(chat.router)
app.include_router(dependencies.router)
app.include_router(jobs.router)
app.include_router(export.router)


@app.get("/", include_in_schema=False)
async def root():
    if STATIC_DIR is not None:
        return FileResponse(STATIC_DIR / "index.html")
    return {
        "message": "Welcome to CodeLens AI API",
        "status": "running",
    }


@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "application": "CodeLens AI",
        "version": "1.0.0",
    }


if STATIC_DIR is not None:
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend(full_path: str):
        """Files of the built frontend; any other address is a client-side route."""

        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = (STATIC_DIR / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(STATIC_DIR):
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
