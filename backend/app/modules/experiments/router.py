from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.experiments.schemas import (
    ExperimentConfigInput,
    ExperimentCreateInput,
    ExperimentListItem,
    ExperimentOutput,
    ExperimentPatchInput,
    ExperimentSortOrder,
    ExperimentStatus,
    ExperimentValidationOutput,
    SnapshotDetailOutput,
    SnapshotSummaryOutput,
)
from app.modules.experiments.service import EXPERIMENT_LIST_LIMIT_MAX, ExperimentService

router = APIRouter(prefix="/projects/{project_id}/experiments", tags=["experiments"])


@router.post("/validate", response_model=ExperimentValidationOutput)
def validate_experiment_config(
    project_id: uuid.UUID,
    payload: ExperimentConfigInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExperimentValidationOutput:
    return ExperimentService(db).validate_config(user.id, project_id, payload)


@router.post("", status_code=201, response_model=ExperimentOutput)
def create_experiment(
    project_id: uuid.UUID,
    payload: ExperimentCreateInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExperimentOutput:
    return ExperimentService(db).create(user.id, project_id, payload)


@router.get("", response_model=list[ExperimentListItem])
def list_experiments(
    project_id: uuid.UUID,
    response: Response,
    status: ExperimentStatus | None = Query(default=None),
    order: ExperimentSortOrder = Query(default=ExperimentSortOrder.DESC),
    limit: int = Query(default=EXPERIMENT_LIST_LIMIT_MAX, ge=1, le=EXPERIMENT_LIST_LIMIT_MAX),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[ExperimentListItem]:
    """FR-PRJ-003 (#83): sorted by created_at; total matches in `X-Total-Count`."""
    page = ExperimentService(db).list_experiments(
        user.id, project_id, status=status, order=order, limit=limit, offset=offset
    )
    response.headers["X-Total-Count"] = str(page.total)
    return page.items


@router.get("/{experiment_id}", response_model=ExperimentOutput)
def get_experiment(
    project_id: uuid.UUID,
    experiment_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExperimentOutput:
    return ExperimentService(db).get_experiment(user.id, project_id, experiment_id)


@router.patch("/{experiment_id}", response_model=ExperimentOutput)
def patch_experiment(
    project_id: uuid.UUID,
    experiment_id: uuid.UUID,
    payload: ExperimentPatchInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExperimentOutput:
    return ExperimentService(db).patch_experiment(user.id, project_id, experiment_id, payload)


@router.post("/{experiment_id}/snapshots", status_code=201, response_model=SnapshotDetailOutput)
def freeze_experiment_snapshot(
    project_id: uuid.UUID,
    experiment_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SnapshotDetailOutput:
    return ExperimentService(db).freeze_snapshot(user.id, project_id, experiment_id)


@router.get("/{experiment_id}/snapshots", response_model=list[SnapshotSummaryOutput])
def list_experiment_snapshots(
    project_id: uuid.UUID,
    experiment_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> list[SnapshotSummaryOutput]:
    return ExperimentService(db).list_snapshots(user.id, project_id, experiment_id)


@router.get(
    "/{experiment_id}/snapshots/{snapshot_id}", response_model=SnapshotDetailOutput
)
def get_experiment_snapshot(
    project_id: uuid.UUID,
    experiment_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SnapshotDetailOutput:
    return ExperimentService(db).get_snapshot(user.id, project_id, experiment_id, snapshot_id)
