from __future__ import annotations

import uuid

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.evaluation.schemas import (
    AssertionReviewBatchInput,
    AssertionReviewListOutput,
    EvaluateRunInput,
    RunEvaluationOutput,
    SnapshotGenerationSuccessInput,
    SnapshotGenerationSuccessOutput,
)
from app.modules.evaluation.service import EvaluationService

router = APIRouter(prefix="/projects/{project_id}/evaluations", tags=["evaluations"])


@router.post("/runs/{run_id}/evaluate", response_model=RunEvaluationOutput)
def evaluate_run(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    payload: EvaluateRunInput | None = Body(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> RunEvaluationOutput:
    return EvaluationService(db).evaluate_run(user.id, project_id, run_id, payload)


@router.get("/runs/{run_id}", response_model=RunEvaluationOutput)
def get_run_evaluation(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> RunEvaluationOutput:
    return EvaluationService(db).get_run_evaluation(user.id, project_id, run_id)


@router.post(
    "/snapshots/{snapshot_id}/generation-success",
    response_model=SnapshotGenerationSuccessOutput,
)
def compute_snapshot_generation_success(
    project_id: uuid.UUID,
    snapshot_id: uuid.UUID,
    payload: SnapshotGenerationSuccessInput | None = Body(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> SnapshotGenerationSuccessOutput:
    return EvaluationService(db).evaluate_snapshot_generation_success(
        user.id, project_id, snapshot_id, payload
    )


@router.put("/runs/{run_id}/assertion-reviews", response_model=AssertionReviewListOutput)
def upsert_assertion_reviews(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    payload: AssertionReviewBatchInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> AssertionReviewListOutput:
    return EvaluationService(db).upsert_assertion_reviews(
        user.id, project_id, run_id, payload
    )


@router.get("/runs/{run_id}/assertion-reviews", response_model=AssertionReviewListOutput)
def list_assertion_reviews(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> AssertionReviewListOutput:
    return EvaluationService(db).list_assertion_reviews(user.id, project_id, run_id)
