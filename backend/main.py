
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.routers import ai, analysis, dependencies, repositories
from backend.services.repository_service import sweep_orphan_workspaces

logger = logging.getLogger("codelens")


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


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
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
app.include_router(dependencies.router)


@app.get("/")
async def root():
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
