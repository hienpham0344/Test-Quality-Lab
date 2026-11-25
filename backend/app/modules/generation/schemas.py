from __future__ import annotations

import uuid
from datetime import datetime

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
