from fastapi import APIRouter

router = APIRouter()


@router.get("/system/info", tags=["system"])
def info() -> dict[str, str]:
    return {"name": "Test Quality Lab", "phase": "scaffold", "features": "not-implemented"}
