from fastapi import APIRouter

from app.modules.auth.router import router as auth_router
from app.modules.projects.router import router as projects_router
from app.modules.sources.router import router as sources_router

router = APIRouter()
router.include_router(auth_router)
router.include_router(projects_router)
router.include_router(sources_router)


@router.get("/system/info", tags=["system"])
def info() -> dict[str, str]:
    return {"name": "Test Quality Lab", "phase": "scaffold", "features": "not-implemented"}
