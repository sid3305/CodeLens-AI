
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import repositories
from backend.routers import analysis
from backend.routers import ai
from backend.routers import dependencies
from backend.services.repository_service import sweep_orphan_workspaces


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
