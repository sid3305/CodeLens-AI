
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import repositories
from backend.routers import analysis


app = FastAPI(
    title="CodeLens AI API",
    description="Backend API for the CodeLens AI Repository Intelligence Platform.",
    version="1.0.0",
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
