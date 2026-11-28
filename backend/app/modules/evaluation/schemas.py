from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.modules.evaluation.assertions import AssertionStrength, AssertionType
from app.modules.evaluation.eligibility import MetricState, RunLifecycleStatus
from app.modules.evaluation.models import MetricName, RubricLabel
from app.modules.evaluation.mutation import MutantStatus, MutationOperator


class CoverageTraceInput(BaseModel):
    covered_lines: int = Field(ge=0)
    total_lines: int = Field(ge=0)
    covered_ranges: list[str] = Field(default_factory=list)
    missed_ranges: list[str] = Field(default_factory=list)
    runner_status: Literal["COMPLETED", "FAILED", "TIMEOUT", "ERROR"] = "COMPLETED"
    error_message: str | None = None
    verified: bool = True


class MutantItemInput(BaseModel):
    id: str | None = None
    operator: MutationOperator | None = None
    line: int = Field(ge=1)
    original: str
    mutated: str
    status: str
    killed_by: str | None = None


class MutationReportInput(BaseModel):
    runner_status: Literal["COMPLETED", "FAILED", "TIMEOUT", "ERROR"] = "COMPLETED"
    tool_version: str | None = Field(default=None, max_length=32)
    error_message: str | None = None
    verified: bool = True
    mutants: list[MutantItemInput] = Field(default_factory=list)


class EvaluateRunInput(BaseModel):
    run_status: RunLifecycleStatus | None = None
    generated_code: str | None = None
    snapshot_id: uuid.UUID | None = None
    source_id: uuid.UUID | None = None
    source_revision: int | None = Field(default=None, ge=1)
    source_code: str | None = None
    source_sha256: str | None = None
    target_function: str | None = None
    failure_reason: str | None = None
    coverage_trace: CoverageTraceInput | None = None
    # FR-EVL-003 (#53): raw `coverage json` report (statements + branches); takes precedence over coverage_trace.
    coverage_report: dict[str, Any] | None = None
    coverage_runner_status: Literal["COMPLETED", "FAILED", "TIMEOUT", "ERROR"] = "COMPLETED"
    mutation_report: MutationReportInput | None = None


class MetricRecordOutput(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    snapshot_id: uuid.UUID | None
    run_id: uuid.UUID
    metric_name: MetricName
    state: MetricState
    numeric_value: float | None
    numerator: int | None
    denominator: int | None
    reason: str | None
    source_sha256: str
    details: dict[str, Any]
    provenance: dict[str, Any] | None = None
    evaluated_at: datetime


class AssertionItemOutput(BaseModel):
    id: str
    test_case: str
    statement: str
    type: AssertionType
    line: int
    status: str
    strength: AssertionStrength
    explanation: str


class AssertionDetailsOutput(BaseModel):
    score: float | None
    summary: dict[str, Any]
    assertions: list[AssertionItemOutput]
    unavailable_reason: str | None


class MutantItemOutput(BaseModel):
    id: str
    operator: MutationOperator
    line: int
    original: str
    mutated: str
    status: MutantStatus
    killed_by: str | None


class MutationDetailsOutput(BaseModel):
    mutants: list[MutantItemOutput]
    summary: dict[str, int]


class CoverageDetailsOutput(BaseModel):
    covered_lines: int
    total_lines: int
    covered_ranges: list[str]
    missed_ranges: list[str]
    # FR-EVL-003 (#53): branch arcs; None when the run has no branch report.
    covered_branches: int | None = None
    total_branches: int | None = None
    missing_arcs: list[str] = Field(default_factory=list)


class RunEvaluationOutput(BaseModel):
    project_id: uuid.UUID
    run_id: uuid.UUID
    snapshot_id: uuid.UUID | None
    source_sha256: str
    evaluated_at: datetime
    metric_records: list[MetricRecordOutput]
    assertion_details: AssertionDetailsOutput
    mutation_details: MutationDetailsOutput | None
    coverage_details: CoverageDetailsOutput | None


class SnapshotRunEvaluationItem(BaseModel):
    run_id: uuid.UUID
    run_status: RunLifecycleStatus = RunLifecycleStatus.COMPLETED
    generated_code: str | None = None
    target_function: str | None = None
    failure_reason: str | None = None


class SnapshotGenerationSuccessInput(BaseModel):
    runs: list[SnapshotRunEvaluationItem] | None = None


class SnapshotGenerationSuccessOutput(BaseModel):
    project_id: uuid.UUID
    snapshot_id: uuid.UUID
    source_sha256: str
    total_planned_runs: int
    evaluated_runs: int
    valid_runs: int
    metric: MetricRecordOutput


class AssertionReviewItemInput(BaseModel):
    assertion_id: str = Field(min_length=1, max_length=64)
    rubric_label: RubricLabel
    notes: str | None = Field(default=None, max_length=4000)


class AssertionReviewBatchInput(BaseModel):
    reviews: list[AssertionReviewItemInput] = Field(min_length=1)


class AssertionReviewOutput(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    run_id: uuid.UUID
    assertion_id: str
    rubric_label: RubricLabel
    notes: str | None
    reviewer_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class AssertionReviewListOutput(BaseModel):
    project_id: uuid.UUID
    run_id: uuid.UUID
    reviews: list[AssertionReviewOutput]
