from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.modules.execution.models import ExecutionStatus


class ExecutionTriggerInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suite_name: str = Field(default="Test Suite Execution", min_length=1, max_length=200)
    generation_run_id: uuid.UUID | None = None
    source_id: uuid.UUID | None = None
    dataset_id: uuid.UUID | None = None


class ExecutionCancelInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=500)


class ExecutionErrorOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    stage: str
    code: str
    message: str
    occurred_at: str


class ExecutionOutput(BaseModel):
    """List item and detail. `cases`, `logs` and `oracle` are empty/None in list responses."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    project_id: uuid.UUID
    suite_name: str
    status: ExecutionStatus
    generation_run_id: uuid.UUID | None
    source_id: uuid.UUID | None
    source_name: str | None
    source_sha256: str | None
    dataset_id: uuid.UUID | None
    dataset_name: str | None
    dataset_sha256: str | None
    artifact_sha256: str | None
    total_cases: int
    completed_cases: int
    passed_cases: int
    failed_cases: int
    error_cases: int
    skipped_cases: int
    timeout_cases: int
    duration_ms: int | None
    # Metrics are computed by evaluation (FR-EVL) from a completed run; never filled here.
    metrics: dict[str, Any] | None = None
    cases: list[dict[str, Any]] = Field(default_factory=list)
    logs: list[dict[str, Any]] = Field(default_factory=list)
    oracle: dict[str, Any] | None = None
    sandbox_policy: dict[str, Any]
    error: ExecutionErrorOutput | None
    cancel_reason: str | None
    cancelled_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
