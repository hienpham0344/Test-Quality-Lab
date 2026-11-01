from fastapi import APIRouter

from app.modules.auth.router import router as auth_router

router = APIRouter()
router.include_router(auth_router)


@router.get("/system/info", tags=["system"])
def info() -> dict[str, str]:
    return {"name": "Test Quality Lab", "phase": "scaffold", "features": "not-implemented"}
