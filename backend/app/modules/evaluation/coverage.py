"""Statement and branch coverage from a coverage.py JSON report (SRS FR-EVL-003) — issue #53.

Statement coverage = executed statements / executable statements x 100 (``line_coverage``).
Branch coverage    = covered branch arcs / total branch arcs x 100 (``branch_coverage``).
Both keep their numerator, denominator and the exact lines/arcs so every value is traceable.
Reports come from the sandbox runner (untrusted): they are validated, never trusted blindly.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from app.modules.evaluation.eligibility import (
    CoverageTracePayload,
    MetricOutcome,
    MetricState,
    RunLifecycleStatus,
    check_metric_eligibility,
)
from app.modules.evaluation.models import MetricName

TOOL_NAME = "coverage.py"
DEFAULT_TARGET_FILE = "target.py"
MAX_LINES = 100_000


@dataclass(frozen=True)
class BranchCoverage:
    covered: int
    total: int
    missing_arcs: list[str] = field(default_factory=list)
    partial_lines: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class CoverageMeasurement:
    statements: CoverageTracePayload
    branches: BranchCoverage | None  # None when the report was produced without --branch
    tool_version: str | None
    target_file: str
    runner_status: str = "COMPLETED"
    error_message: str | None = None


def line_ranges(lines: Iterable[int]) -> list[str]:
    """[1, 2, 3, 7] -> ["L1-L3", "L7"]."""
    ordered = sorted(set(lines))
    ranges: list[str] = []
    if not ordered:
        return ranges
    start = prev = ordered[0]
    for line in ordered[1:]:
        if line == prev + 1:
            prev = line
            continue
        ranges.append(f"L{start}" if start == prev else f"L{start}-L{prev}")
        start = prev = line
    ranges.append(f"L{start}" if start == prev else f"L{start}-L{prev}")
    return ranges


def _int_list(value: Any, field_name: str) -> list[int]:
    if not isinstance(value, list) or len(value) > MAX_LINES:
        raise ValueError(f"Coverage report '{field_name}' must be a list of line numbers")
    if any(isinstance(v, bool) or not isinstance(v, int) or v < 1 for v in value):
        raise ValueError(f"Coverage report '{field_name}' must contain positive line numbers")
    return list(value)


def _count(summary: Mapping[str, Any], key: str) -> int:
    value = summary.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"Coverage summary '{key}' must be a non-negative integer")
    return value


def parse_coverage_report(
    report: Mapping[str, Any], *, target_file: str = DEFAULT_TARGET_FILE,
    runner_status: str = "COMPLETED", error_message: str | None = None,
) -> CoverageMeasurement:
    """Reads the target module's entry from `coverage json` output and checks it is consistent."""
    files = report.get("files")
    if not isinstance(files, Mapping) or not files:
        raise ValueError("Coverage report has no 'files' section")
    matches = [name for name in files if str(name).replace("\\", "/").split("/")[-1] == target_file]
    if len(matches) != 1:
        raise ValueError(f"Coverage report must contain exactly one entry for {target_file}")
    entry = files[matches[0]]
    if not isinstance(entry, Mapping) or not isinstance(entry.get("summary"), Mapping):
        raise ValueError("Coverage report entry has no summary")
    summary = entry["summary"]

    executed = _int_list(entry.get("executed_lines", []), "executed_lines")
    missing = _int_list(entry.get("missing_lines", []), "missing_lines")
    total = _count(summary, "num_statements")
    covered = _count(summary, "covered_lines")
    if covered > total or covered != len(set(executed)) or total != len(set(executed) | set(missing)):
        raise ValueError("Coverage summary does not match the executed and missing lines")

    branches: BranchCoverage | None = None
    if "num_branches" in summary:
        num_branches = _count(summary, "num_branches")
        covered_branches = _count(summary, "covered_branches")
        if covered_branches > num_branches:
            raise ValueError("covered_branches cannot exceed num_branches")
        raw_missing = entry.get("missing_branches", [])
        if not isinstance(raw_missing, list) or len(raw_missing) > MAX_LINES:
            raise ValueError("Coverage report 'missing_branches' must be a list")
        arcs: list[str] = []
        for arc in raw_missing:
            if (not isinstance(arc, list) or len(arc) != 2
                    or any(isinstance(v, bool) or not isinstance(v, int) for v in arc)):
                raise ValueError("Each missing branch must be a [from_line, to_line] pair")
            arcs.append(f"L{arc[0]}->{'exit' if arc[1] < 0 else f'L{arc[1]}'}")
        if num_branches - covered_branches != len(arcs):
            raise ValueError("Branch summary does not match the missing branch arcs")
        branches = BranchCoverage(
            covered=covered_branches, total=num_branches, missing_arcs=arcs,
            partial_lines=sorted({arc[0] for arc in raw_missing if arc[0] in set(executed)}),
        )

    raw_meta = report.get("meta")
    meta: Mapping[str, Any] = raw_meta if isinstance(raw_meta, Mapping) else {}
    raw_version = meta.get("version")
    version = raw_version if isinstance(raw_version, str) else None
    return CoverageMeasurement(
        statements=CoverageTracePayload(
            covered_lines=covered, total_lines=total,
            covered_ranges=line_ranges(executed), missed_ranges=line_ranges(missing),
            runner_status=runner_status, error_message=error_message,
        ),
        branches=branches,
        tool_version=version[:32] if version else None,
        target_file=target_file,
        runner_status=runner_status,
        error_message=error_message,
    )


def score_branch_coverage(
    run_status: RunLifecycleStatus | str,
    measurement: CoverageMeasurement | None,
    *,
    execution_enabled: bool = False,
    failure_reason: str | None = None,
) -> MetricOutcome:
    """Branch coverage with the same 0.0 vs N/A / FAILED / TIMEOUT rules as statement coverage."""
    gated = check_metric_eligibility(
        MetricName.BRANCH_COVERAGE, run_status,
        execution_enabled=execution_enabled,
        has_verified_runtime_trace=measurement is not None,
        failure_reason=failure_reason,
    )
    if gated is not None:
        return gated
    if measurement is None:
        return MetricOutcome(MetricName.BRANCH_COVERAGE, MetricState.NOT_APPLICABLE,
                             reason="Branch coverage report is not available for this run")
    runner_state = measurement.runner_status.strip().upper()
    if runner_state == "TIMEOUT":
        return MetricOutcome(MetricName.BRANCH_COVERAGE, MetricState.TIMEOUT,
                             reason=measurement.error_message or "Coverage runner timed out")
    if runner_state in {"FAILED", "ERROR"}:
        return MetricOutcome(MetricName.BRANCH_COVERAGE, MetricState.FAILED,
                             reason=measurement.error_message or "Coverage runner failed with an error")
    branches = measurement.branches
    if branches is None:
        return MetricOutcome(MetricName.BRANCH_COVERAGE, MetricState.NOT_APPLICABLE,
                             reason="Coverage was measured without branch tracing")
    details = {"covered_branches": branches.covered, "total_branches": branches.total,
               "missing_arcs": branches.missing_arcs, "partial_lines": branches.partial_lines}
    if branches.total == 0:
        return MetricOutcome(MetricName.BRANCH_COVERAGE, MetricState.NOT_APPLICABLE,
                             numerator=0, denominator=0, reason="No branches in target source", details=details)
    return MetricOutcome(
        MetricName.BRANCH_COVERAGE, MetricState.MEASURED,
        numeric_value=round(branches.covered / branches.total * 100.0, 2),
        numerator=branches.covered, denominator=branches.total, details=details,
    )
