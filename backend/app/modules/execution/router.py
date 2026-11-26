from __future__ import annotations

import uuid

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.jobs.tasks import run_execution
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.execution.schemas import (
    ExecutionCancelInput,
    ExecutionOutput,
    ExecutionTriggerInput,
)
from app.modules.execution.service import ExecutionService

router = APIRouter(prefix="/projects/{project_id}/executions", tags=["executions"])


def enqueue_execution(execution_id: uuid.UUID) -> str | None:
    async_result = run_execution.delay(str(execution_id))
    task_id = getattr(async_result, "id", None)
    return str(task_id) if task_id is not None else None


@router.get("", response_model=list[ExecutionOutput])
def list_executions(
    project_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[ExecutionOutput]:
    return ExecutionService(db).list(user.id, project_id)


@router.post("", status_code=201, response_model=ExecutionOutput)
def trigger_execution(
    project_id: uuid.UUID,
    payload: ExecutionTriggerInput,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExecutionOutput:
    """FR-EXE-001: queues an eligible artifact for the sandbox (disabled until the security review)."""
    return ExecutionService(db, enqueue_fn=enqueue_execution).trigger(user.id, project_id, payload)


@router.get("/{execution_id}", response_model=ExecutionOutput)
def get_execution(
    project_id: uuid.UUID,
    execution_id: uuid.UUID,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExecutionOutput:
    return ExecutionService(db).get(user.id, project_id, execution_id)


@router.post("/{execution_id}/cancel", response_model=ExecutionOutput)
def cancel_execution(
    project_id: uuid.UUID,
    execution_id: uuid.UUID,
    payload: ExecutionCancelInput | None = Body(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> ExecutionOutput:
    reason = payload.reason if payload is not None else None
    return ExecutionService(db).cancel(user.id, project_id, execution_id, reason)
