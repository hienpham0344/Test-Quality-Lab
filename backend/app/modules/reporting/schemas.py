from __future__ import annotations

import math
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MetricStateLiteral = Literal["MEASURED", "N/A", "FAILED", "TIMEOUT"]
MetricDisplayValue = float | Literal["N/A", "FAILED", "TIMEOUT"]
ValidityLabel = Literal["PASSED", "FAILED", "TIMEOUT", "N/A"]
ComparabilityStatus = Literal["COMPATIBLE", "CAUTION", "INCOMPARABLE"]
RunStatusLiteral = Literal["QUEUED", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT", "CANCELLED"]


def _validate_metric_pair(
    name: str, state: MetricStateLiteral, value: float | None
) -> float | None:
    if state == "MEASURED":
        if value is None or not math.isfinite(value):
            raise ValueError(f"{name}: MEASURED state requires a finite numeric value")
        return 0.0 if value == 0.0 else float(value)
    if value is not None:
        raise ValueError(f"{name}: {state} state must have numeric value None")
    return None


class ReportRunCreateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    snapshot_id: uuid.UUID | None = None
    snapshot_sha256: str | None = None
    source_id: uuid.UUID | None = None
    source_name: str | None = None
    source_sha256: str = Field(min_length=1, max_length=64)
    dataset_id: uuid.UUID | None = None
    dataset_name: str | None = None
    dataset_sha256: str | None = None
    suite_name: str = Field(min_length=1, max_length=200)
    function_name: str | None = None
    provider: str = Field(min_length=1, max_length=32)
    model: str = Field(min_length=1, max_length=120)
    strategy: str = Field(min_length=1, max_length=16)
    prompt_version: int | None = None
    prompt_sha256: str | None = None
    repeat_index: int = Field(default=1, ge=1)
    status: RunStatusLiteral = "COMPLETED"
    duration_ms: int | None = Field(default=None, ge=0)
    total_cases: int = Field(default=0, ge=0)
    completed_cases: int = Field(default=0, ge=0)
    passed_cases: int = Field(default=0, ge=0)
    failed_cases: int = Field(default=0, ge=0)
    timeout_cases: int = Field(default=0, ge=0)
    syntax_validity_state: MetricStateLiteral = "N/A"
    syntax_validity_value: float | None = None
    line_coverage_state: MetricStateLiteral = "N/A"
    line_coverage_value: float | None = None
    mutation_score_state: MetricStateLiteral = "N/A"
    mutation_score_value: float | None = None
    assertion_quality_state: MetricStateLiteral = "N/A"
    assertion_quality_value: float | None = None
    artifact_relpath: str | None = None
    artifact_sha256: str | None = None
    error_message: str | None = None

    @model_validator(mode="after")
    def _check_metrics(self) -> ReportRunCreateInput:
        self.syntax_validity_value = _validate_metric_pair(
            "syntax_validity", self.syntax_validity_state, self.syntax_validity_value
        )
        self.line_coverage_value = _validate_metric_pair(
            "line_coverage", self.line_coverage_state, self.line_coverage_value
        )
        self.mutation_score_value = _validate_metric_pair(
            "mutation_score", self.mutation_score_state, self.mutation_score_value
        )
        self.assertion_quality_value = _validate_metric_pair(
            "assertion_quality", self.assertion_quality_state, self.assertion_quality_value
        )
        return self


class RunMetricsOutput(BaseModel):
    coverage: MetricDisplayValue
    line_coverage: MetricDisplayValue
    mutation_score: MetricDisplayValue
    assertion_quality: MetricDisplayValue
    assertion_score: MetricDisplayValue
    syntax_validity: MetricDisplayValue
    validity: ValidityLabel


class ReportRunItemOutput(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    snapshot_id: uuid.UUID | None
    snapshot_sha256: str | None
    source_id: uuid.UUID | None
    source_name: str | None
    source_sha256: str
    dataset_id: uuid.UUID | None
    dataset_name: str | None
    dataset_sha256: str | None
    suite_name: str
    function_name: str | None
    provider: str
    model: str
    strategy: str
    prompt_version: int | None
    prompt_sha256: str | None
    repeat_index: int
    status: str
    duration_ms: int | None
    total_cases: int
    completed_cases: int
    passed_cases: int
    failed_cases: int
    timeout_cases: int
    metrics: RunMetricsOutput
    error_message: str | None
    created_at: datetime


class ComparabilityChecksOutput(BaseModel):
    source_consistent: bool
    dataset_consistent: bool
    single_model: bool
    balanced_samples: bool
    all_completed: bool


class ComparabilityOutput(BaseModel):
    status: ComparabilityStatus
    reasons: list[str]
    checks: ComparabilityChecksOutput
    distinct_source_sha256: list[str]
    distinct_dataset_sha256: list[str]
    distinct_models: list[str]


class StrategyComparisonRowOutput(BaseModel):
    strategy: str
    provider: str
    model: str
    snapshot_id: str | None
    snapshot_sha256: str | None
    source_sha256: str
    dataset_sha256: str | None
    prompt_version: str | int | None
    prompt_sha256: str | None
    total_runs: int
    completed_runs: int
    total_cases: int
    completed_cases: int
    passed_cases: int
    pass_rate: MetricDisplayValue
    avg_coverage: MetricDisplayValue
    avg_mutation_score: MetricDisplayValue
    avg_assertion_quality: MetricDisplayValue
    baseline_coverage_delta: float | Literal["N/A"]
    baseline_mutation_delta: float | Literal["N/A"]
    comparability_status: ComparabilityStatus


class ReportSummaryOutput(BaseModel):
    project_id: uuid.UUID
    total_runs: int
    completed_runs: int
    failed_runs: int
    timeout_runs: int
    cancelled_runs: int
    queued_runs: int
    running_runs: int
    progress_pct: float
    pass_rate: MetricDisplayValue
    avg_coverage: MetricDisplayValue
    avg_mutation_score: MetricDisplayValue
    avg_assertion_quality: MetricDisplayValue
    comparability: ComparabilityOutput
    strategy_comparison: list[StrategyComparisonRowOutput]


class ReportResultsOutput(BaseModel):
    project_id: uuid.UUID
    total_runs: int
    filtered_runs: int
    summary: ReportSummaryOutput
    comparability: ComparabilityOutput
    strategy_comparison: list[StrategyComparisonRowOutput]
    runs: list[ReportRunItemOutput]
