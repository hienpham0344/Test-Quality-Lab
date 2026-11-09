import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.sources.service import MAX_SOURCE_BYTES, SourceService

router = APIRouter(prefix="/projects/{project_id}/sources", tags=["sources"])


class SourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str


class SourceOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    current_revision: int
    created_at: datetime
    updated_at: datetime


class FunctionOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    line: int


class VersionOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source_id: uuid.UUID
    revision: int
    sha256: str
    byte_size: int
    created_at: datetime
    functions: list[FunctionOutput]


class VersionWithCode(VersionOutput):
    code: str


async def _source_bytes(request: Request) -> bytes:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in {"application/json", "text/x-python", "application/octet-stream"}:
        raise HTTPException(status_code=415, detail="Use JSON or raw Python file bytes")
    limit = MAX_SOURCE_BYTES * 2 + 1024 if content_type == "application/json" else MAX_SOURCE_BYTES
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise HTTPException(status_code=413, detail="Source exceeds size limit")
    if content_type != "application/json":
        return bytes(body)
    try:
        payload = SourceInput.model_validate_json(body)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail="Expected JSON object with only a code string"
        ) from exc
    return payload.code.encode("utf-8")


@router.post("", status_code=201, response_model=VersionOutput)
async def create_source(
    project_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    data = await _source_bytes(request)
    try:
        version = SourceService(db).create(user.id, project_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if version is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return version


@router.get("", response_model=list[SourceOutput])
def list_sources(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    sources = SourceService(db).list_owned(user.id, project_id)
    if sources is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return sources


@router.post("/{source_id}/versions", status_code=201, response_model=VersionOutput)
async def add_version(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    data = await _source_bytes(request)
    try:
        version = SourceService(db).add_version(user.id, project_id, source_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if version is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return version


@router.get("/{source_id}/versions", response_model=list[VersionOutput])
def list_versions(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    versions = SourceService(db).list_versions(user.id, project_id, source_id)
    if versions is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return versions


@router.get("/{source_id}/versions/{revision}", response_model=VersionWithCode)
def get_version(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    revision: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    version = SourceService(db).get(user.id, project_id, source_id, revision)
    if version is None:
        raise HTTPException(status_code=404, detail="Source version not found")
    return version
