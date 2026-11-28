from __future__ import annotations

import uuid

from fastapi import APIRouter, Body, Depends, Response
from sqlalchemy.orm import Session

from app.core.security import CredentialVault
from app.infrastructure.database.session import get_db
from app.jobs.tasks import execute_generation_job
from app.modules.ai_config.dependencies import get_vault
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.generation.schemas import (
    GenerationArtifactsOutput,
    GenerationCancelInput,
    GenerationDashboardOutput,
    GenerationJobOutput,
    GenerationLaunchOutput,
    GenerationStartInput,
)
from app.modules.generation.service import GenerationService

router = APIRouter(prefix="/projects/{project_id}/generation", tags=["generation"])


def enqueue_generation_job(job_id: uuid.UUID) -> str | None:
    async_result = execute_generation_job.delay(str(job_id))
    task_id = getattr(async_result, "id", None)
    return str(task_id) if task_id is not None else None


@router.get("", response_model=GenerationDashboardOutput)
def get_generation_dashboard(
    project_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    vault: CredentialVault = Depends(get_vault),
) -> GenerationDashboardOutput:
    return GenerationService(db, vault=vault).get_dashboard(user.id, project_id)


@router.post("", status_code=202, response_model=GenerationLaunchOutput)
def start_generation(
    project_id: uuid.UUID,
    payload: GenerationStartInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    vault: CredentialVault = Depends(get_vault),
) -> GenerationLaunchOutput:
    return GenerationService(
        db, vault=vault, enqueue_fn=enqueue_generation_job
    ).start_generation(user.id, project_id, payload)


@router.post("/jobs/{job_id}/cancel", response_model=GenerationJobOutput)
def cancel_generation_job(
    project_id: uuid.UUID,
    job_id: uuid.UUID,
    payload: GenerationCancelInput | None = Body(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    vault: CredentialVault = Depends(get_vault),
) -> GenerationJobOutput:
    reason = payload.reason if payload is not None else None
    return GenerationService(db, vault=vault).cancel_job(user.id, project_id, job_id, reason)


@router.get("/runs/{run_id}/artifacts", response_model=GenerationArtifactsOutput)
def get_generation_run_artifacts(
    project_id: uuid.UUID,
    run_id: uuid.UUID,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    vault: CredentialVault = Depends(get_vault),
) -> GenerationArtifactsOutput:
    """FR-GEN-002/003/004 (#39, #40): raw response, parsed test, metadata and validation stages."""
    response.headers["Cache-Control"] = "no-store"
    return GenerationService(db, vault=vault).get_run_artifacts(user.id, project_id, run_id)
