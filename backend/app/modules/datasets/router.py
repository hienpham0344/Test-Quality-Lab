import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.datasets.constants import MAX_REQUEST_BYTES
from app.modules.datasets.csv_import import PREVIEW_ROWS, decode_mapping
from app.modules.datasets.service import DatasetService

router = APIRouter(prefix="/projects/{project_id}/datasets", tags=["datasets"])


class DatasetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: list[dict]


class SelectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    row_numbers: list[int]


class ReferenceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: uuid.UUID
    revision: int = Field(gt=0)


class DatasetOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    project_id: uuid.UUID
    current_revision: int
    created_at: datetime
    updated_at: datetime


class VersionOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    dataset_id: uuid.UUID
    revision: int
    sha256: str
    rows: list[dict]
    selected_rows: list[int]
    reference_source_id: uuid.UUID | None
    reference_revision: int | None
    created_at: datetime


class CsvPreviewRow(BaseModel):
    row_number: int
    values: list[str]


class CsvPreviewOutput(BaseModel):
    headers: list[str]
    delimiter: str
    row_count: int
    preview_rows: list[CsvPreviewRow]


async def _request_bytes(request: Request, media_types: set[str], expected: str) -> bytes:
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() not in media_types:
        raise HTTPException(status_code=415, detail={
            "code": "CSV_SCHEMA", "message": expected, "fields": {}
        })
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail={
                "code": "CSV_SCHEMA", "message": "Dataset request exceeds size limit", "fields": {}
            })
        body.extend(chunk)
    return bytes(body)


async def _dataset_input(request: Request) -> DatasetInput:
    body = await _request_bytes(request, {"application/json"}, "Use JSON normalized rows")
    try:
        return DatasetInput.model_validate_json(body)
    except ValidationError as exc:
        raise AppError(ErrorCode.CSV_SCHEMA, "Expected JSON object with rows") from exc


@router.post("/preview", response_model=CsvPreviewOutput)
async def preview_csv(
    project_id: uuid.UUID,
    request: Request,
    delimiter: str | None = Query(default=None, description="Comma or semicolon; omit to detect"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    data = await _request_bytes(
        request, {"text/csv", "application/octet-stream"}, "Use raw CSV file bytes"
    )
    parsed = DatasetService(db).preview_csv(user.id, project_id, data, delimiter)
    if parsed is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found")
    return {
        "headers": parsed.headers,
        "delimiter": parsed.delimiter,
        "row_count": len(parsed.rows),
        "preview_rows": [
            {"row_number": row.row_number, "values": row.values}
            for row in parsed.rows[:PREVIEW_ROWS]
        ],
    }


@router.post("/import", status_code=201, response_model=VersionOutput)
async def import_csv(
    project_id: uuid.UUID,
    request: Request,
    mapping: str | None = Query(default=None, description="JSON canonical field -> CSV header"),
    delimiter: str | None = Query(default=None, description="Comma or semicolon; omit to detect"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    data = await _request_bytes(
        request, {"text/csv", "application/octet-stream"}, "Use raw CSV file bytes"
    )
    version = DatasetService(db).import_csv(
        user.id, project_id, data, decode_mapping(mapping), delimiter
    )
    if version is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found")
    return version


@router.post("", status_code=201, response_model=VersionOutput)
async def create_dataset(
    project_id: uuid.UUID,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    payload = await _dataset_input(request)
    try:
        version = DatasetService(db).create(user.id, project_id, payload.rows)
    except (TypeError, ValueError) as exc:
        raise AppError(ErrorCode.CSV_SCHEMA, str(exc)) from exc
    if version is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found")
    return version


@router.get("", response_model=list[DatasetOutput])
def list_datasets(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    datasets = DatasetService(db).list_owned(user.id, project_id)
    if datasets is None:
        raise AppError(ErrorCode.NOT_FOUND, "Project not found")
    return datasets


@router.get("/{dataset_id}", response_model=VersionOutput)
def get_dataset(
    project_id: uuid.UUID,
    dataset_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    version = DatasetService(db).get(user.id, project_id, dataset_id)
    if version is None:
        raise AppError(ErrorCode.NOT_FOUND, "Dataset not found")
    return version


@router.get("/{dataset_id}/versions/{revision}", response_model=VersionOutput)
def get_version(
    project_id: uuid.UUID,
    dataset_id: uuid.UUID,
    revision: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    version = DatasetService(db).get(user.id, project_id, dataset_id, revision)
    if version is None:
        raise AppError(ErrorCode.NOT_FOUND, "Dataset version not found")
    return version


@router.post("/{dataset_id}/selection", response_model=VersionOutput)
def select_rows(
    project_id: uuid.UUID,
    dataset_id: uuid.UUID,
    payload: SelectionInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    try:
        version = DatasetService(db).select(user.id, project_id, dataset_id, payload.row_numbers)
    except ValueError as exc:
        raise AppError(ErrorCode.CSV_ROW_INVALID, str(exc)) from exc
    if version is None:
        raise AppError(ErrorCode.NOT_FOUND, "Dataset not found")
    return version


@router.post("/{dataset_id}/reference", response_model=VersionOutput)
def link_reference(
    project_id: uuid.UUID,
    dataset_id: uuid.UUID,
    payload: ReferenceInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    version = DatasetService(db).link_reference(
        user.id, project_id, dataset_id, payload.source_id, payload.revision
    )
    if version is None:
        raise AppError(ErrorCode.NOT_FOUND, "Dataset or source version not found")
    return version
