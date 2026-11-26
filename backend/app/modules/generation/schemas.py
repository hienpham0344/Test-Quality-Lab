from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.infrastructure.llm import ProviderId
from app.modules.generation.models import GenerationJobStatus, GenerationRunStatus
from app.modules.prompts.models import StrategyCode


class ApprovedSnapshotOption(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    experiment_id: uuid.UUID
    name: str
    snapshot_number: int
    run_count: int
    can_start: bool


class GenerationErrorOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    stage: str
    code: str
    message: str
    occurred_at: str


class GenerationJobOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    project_id: uuid.UUID
    snapshot_id: uuid.UUID
    request_id: str
    status: GenerationJobStatus
    celery_task_id: str | None
    cancel_reason: str | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # FR-AIC-004 (#41): set when quota/rate limit paused unsent runs of a provider.
    error_summary: dict[str, Any] | None = None


class GenerationRunOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: uuid.UUID
    job_id: uuid.UUID
    snapshot_id: uuid.UUID
    function_name: str
    provider: ProviderId
    model: str
    strategy: StrategyCode
    repeat: int
    status: GenerationRunStatus
    attempt_count: int
    artifact_sha256: str | None
    error: GenerationErrorOutput | None
    # FR-GEN-004 (#40): eligible for the runner; None before the response was checked.
    artifact_eligible: bool | None = None
    validation_failed_stage: str | None = None


class GenerationArtifactsOutput(BaseModel):
    """FR-GEN-002/003/004 (#39, #40): raw response, parsed test and per-stage validation of one run."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: uuid.UUID
    job_id: uuid.UUID
    status: GenerationRunStatus
    raw_response: str | None
    parsed_test: str | None
    response_metadata: dict[str, Any] | None
    validation: dict[str, Any] | None
    artifact_sha256: str | None
    error: GenerationErrorOutput | None


class GenerationDashboardOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    launch_enabled: bool
    approved_snapshots: list[ApprovedSnapshotOption]
    jobs: list[GenerationJobOutput]
    runs: list[GenerationRunOutput]


class GenerationStartInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot_id: uuid.UUID
    request_id: str = Field(min_length=1, max_length=128)


class GenerationLaunchOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    job_id: uuid.UUID
    project_id: uuid.UUID
    snapshot_id: uuid.UUID
    request_id: str
    status: GenerationJobStatus
    run_count: int
    deduplicated: bool
    created_at: datetime


class GenerationCancelInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=500)
