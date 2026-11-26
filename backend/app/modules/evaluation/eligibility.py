"""Metric states, domain invariants, and eligibility gating (FR-EVL-001, Issue #52)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from app.core.logging import redact_secrets
from app.modules.evaluation.models import MetricName

SANDBOX_DISABLE_REASON = "Untrusted execution is disabled by sandbox security policy"


class MetricState(StrEnum):
    MEASURED = "MEASURED"
    NOT_APPLICABLE = "N/A"
    FAILED = "FAILED"
    TIMEOUT = "TIMEOUT"


class RunLifecycleStatus(StrEnum):
    QUEUED = "QUEUED"
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    CANCELLING = "CANCELLING"
    CANCELLED = "CANCELLED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    TIMEOUT = "TIMEOUT"


STATIC_METRICS: frozenset[MetricName] = frozenset(
    {
        MetricName.SYNTAX_VALIDITY,
        MetricName.ASSERTION_QUALITY,
        MetricName.GENERATION_SUCCESS,
    }
)

DYNAMIC_RUNTIME_METRICS: frozenset[MetricName] = frozenset(
    {
        MetricName.LINE_COVERAGE,
        MetricName.BRANCH_COVERAGE,
        MetricName.MUTATION_SCORE,
    }
)

_NON_ELIGIBLE_ACTIVE_OR_CANCELLED: frozenset[RunLifecycleStatus] = frozenset(
    {
        RunLifecycleStatus.QUEUED,
        RunLifecycleStatus.PENDING,
        RunLifecycleStatus.RUNNING,
        RunLifecycleStatus.CANCELLING,
        RunLifecycleStatus.CANCELLED,
    }
)


def _clean_reason(reason: str | None) -> str | None:
    if reason is None:
        return None
    cleaned = redact_secrets(reason.strip())
    if not cleaned:
        return None
    return cleaned[:500]


@dataclass(frozen=True)
class MetricOutcome:
    """Immutable metric outcome enforcing 0.0 vs N/A, FAILED, and TIMEOUT invariants."""

    metric_name: MetricName
    state: MetricState
    numeric_value: float | None = None
    numerator: int | None = None
    denominator: int | None = None
    reason: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        cleaned_reason = _clean_reason(self.reason)
        object.__setattr__(self, "reason", cleaned_reason)

        if self.numerator is not None:
            if isinstance(self.numerator, bool) or not isinstance(self.numerator, int) or self.numerator < 0:
                raise ValueError("MetricOutcome.numerator must be a non-negative int or None")
        if self.denominator is not None:
            if (
                isinstance(self.denominator, bool)
                or not isinstance(self.denominator, int)
                or self.denominator < 0
            ):
                raise ValueError("MetricOutcome.denominator must be a non-negative int or None")

        if self.state == MetricState.MEASURED:
            if (
                self.numeric_value is None
                or isinstance(self.numeric_value, bool)
                or not isinstance(self.numeric_value, (int, float))
            ):
                raise ValueError("MEASURED MetricOutcome requires a finite numeric_value")
            as_float = float(self.numeric_value)
            if not math.isfinite(as_float):
                raise ValueError("MEASURED MetricOutcome requires a finite float (got NaN/Inf)")
            # Normalize -0.0 -> 0.0 and preserve 0.0 distinctly as float
            if as_float == 0.0:
                as_float = 0.0
            object.__setattr__(self, "numeric_value", as_float)
        else:
            if self.numeric_value is not None:
                raise ValueError(
                    f"State '{self.state.value}' requires numeric_value=None (got {self.numeric_value!r})"
                )
            if not cleaned_reason:
                raise ValueError(f"State '{self.state.value}' requires a non-empty reason")


@dataclass(frozen=True)
class CoverageTracePayload:
    """Verified structured line-coverage trace payload (never invokes untrusted code)."""

    covered_lines: int
    total_lines: int
    covered_ranges: list[str] = field(default_factory=list)
    missed_ranges: list[str] = field(default_factory=list)
    runner_status: str = "COMPLETED"
    error_message: str | None = None
    verified: bool = True


def normalize_run_status(run_status: RunLifecycleStatus | str) -> RunLifecycleStatus:
    if isinstance(run_status, RunLifecycleStatus):
        return run_status
    try:
        return RunLifecycleStatus(str(run_status).strip().upper())
    except ValueError as exc:
        raise ValueError(f"Unsupported run lifecycle status: {run_status!r}") from exc


def check_metric_eligibility(
    metric_name: MetricName,
    run_status: RunLifecycleStatus | str,
    *,
    execution_enabled: bool = False,
    has_verified_runtime_trace: bool = False,
    failure_reason: str | None = None,
) -> MetricOutcome | None:
    """Return None when eligible to compute metric, or the terminal gated MetricOutcome."""
    status = normalize_run_status(run_status)

    if status in _NON_ELIGIBLE_ACTIVE_OR_CANCELLED:
        return MetricOutcome(
            metric_name=metric_name,
            state=MetricState.NOT_APPLICABLE,
            numeric_value=None,
            reason=f"Run is in state '{status.value}' and not eligible for metric evaluation",
        )

    if status == RunLifecycleStatus.TIMEOUT:
        return MetricOutcome(
            metric_name=metric_name,
            state=MetricState.TIMEOUT,
            numeric_value=None,
            reason=failure_reason or "Run timed out before metric evaluation completed",
        )

    if status == RunLifecycleStatus.FAILED:
        return MetricOutcome(
            metric_name=metric_name,
            state=MetricState.FAILED,
            numeric_value=None,
            reason=failure_reason or "Run failed before metric evaluation could complete",
        )

    if metric_name in DYNAMIC_RUNTIME_METRICS and not (
        execution_enabled or has_verified_runtime_trace
    ):
        return MetricOutcome(
            metric_name=metric_name,
            state=MetricState.NOT_APPLICABLE,
            numeric_value=None,
            reason=SANDBOX_DISABLE_REASON,
        )

    return None


def score_line_coverage(
    run_status: RunLifecycleStatus | str,
    trace: CoverageTracePayload | None = None,
    *,
    execution_enabled: bool = False,
    failure_reason: str | None = None,
) -> MetricOutcome:
    """Score structured line coverage trace while failing closed when execution is disabled."""
    has_verified = trace is not None and trace.verified
    gated = check_metric_eligibility(
        MetricName.LINE_COVERAGE,
        run_status,
        execution_enabled=execution_enabled,
        has_verified_runtime_trace=has_verified,
        failure_reason=failure_reason,
    )
    if gated is not None:
        return gated

    if trace is None:
        return MetricOutcome(
            metric_name=MetricName.LINE_COVERAGE,
            state=MetricState.NOT_APPLICABLE,
            numeric_value=None,
            reason="Line coverage trace is not available for this run",
        )

    runner_state = trace.runner_status.strip().upper()
    if runner_state == "TIMEOUT":
        return MetricOutcome(
            metric_name=MetricName.LINE_COVERAGE,
            state=MetricState.TIMEOUT,
            numeric_value=None,
            reason=trace.error_message or "Coverage runner timed out",
        )
    if runner_state in {"FAILED", "ERROR"}:
        return MetricOutcome(
            metric_name=MetricName.LINE_COVERAGE,
            state=MetricState.FAILED,
            numeric_value=None,
            reason=trace.error_message or "Coverage runner failed with an error",
        )

    if trace.covered_lines < 0 or trace.total_lines < 0 or trace.covered_lines > trace.total_lines:
        raise ValueError(
            f"Invalid coverage counts: covered_lines={trace.covered_lines}, total_lines={trace.total_lines}"
        )

    details = {
        "covered_lines": trace.covered_lines,
        "total_lines": trace.total_lines,
        "covered_ranges": list(trace.covered_ranges),
        "missed_ranges": list(trace.missed_ranges),
    }

    if trace.total_lines == 0:
        return MetricOutcome(
            metric_name=MetricName.LINE_COVERAGE,
            state=MetricState.NOT_APPLICABLE,
            numeric_value=None,
            numerator=0,
            denominator=0,
            reason="No executable statements in target source",
            details=details,
        )

    pct = round((trace.covered_lines / trace.total_lines) * 100.0, 2)
    return MetricOutcome(
        metric_name=MetricName.LINE_COVERAGE,
        state=MetricState.MEASURED,
        numeric_value=pct,
        numerator=trace.covered_lines,
        denominator=trace.total_lines,
        details=details,
    )
