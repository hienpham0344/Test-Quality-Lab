"""Metric provenance: formula, tool name/version, parameters and input hashes (SRS NFR-REP-001) — issue #57.

Every persisted metric (MEASURED, N/A, FAILED or TIMEOUT) records how it was produced, so a value can be
reproduced or explained later. No secrets or source text are stored here, only hashes and identifiers.
"""

from __future__ import annotations

import hashlib
import platform
import uuid
from datetime import UTC, datetime
from typing import Any

from app.modules.evaluation.models import MetricName

EVALUATOR_VERSION = "tql-evaluator/1.1.0"

FORMULAS: dict[MetricName, str] = {
    MetricName.SYNTAX_VALIDITY: "100 if the generated module parses and has non-empty test_* functions calling the target, else 0",
    MetricName.GENERATION_SUCCESS: "valid_runs / total_planned_runs * 100",
    MetricName.LINE_COVERAGE: "executed_statements / executable_statements * 100",
    MetricName.BRANCH_COVERAGE: "covered_branch_arcs / total_branch_arcs * 100",
    MetricName.MUTATION_SCORE: "killed / (killed + survived) * 100; timeout, suspicious, skipped, equivalent and invalid mutants excluded",
    MetricName.ASSERTION_QUALITY: "effective_non_trivial_assertions / total_assertions * cases_with_assertions / total_test_cases * 100",
}

_STATIC_TOOL = ("python-ast", platform.python_version())
_RUNTIME_TOOLS: dict[MetricName, str] = {
    MetricName.LINE_COVERAGE: "coverage.py",
    MetricName.BRANCH_COVERAGE: "coverage.py",
    MetricName.MUTATION_SCORE: "mutmut",
}


def sha256_text(text: str | None) -> str | None:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text is not None else None


def tool_for(metric: MetricName, runtime_tool_version: str | None) -> dict[str, str | None]:
    """Static metrics are computed here with Python's `ast`; runtime metrics name the report's tool."""
    if metric in _RUNTIME_TOOLS:
        return {"name": _RUNTIME_TOOLS[metric], "version": runtime_tool_version}
    if metric == MetricName.GENERATION_SUCCESS:
        return {"name": "tql-evaluator", "version": EVALUATOR_VERSION}
    return {"name": _STATIC_TOOL[0], "version": _STATIC_TOOL[1]}


def build_provenance(
    metric: MetricName,
    *,
    run_id: uuid.UUID,
    snapshot_id: uuid.UUID | None,
    source_sha256: str,
    generated_code: str | None,
    evaluated_at: datetime,
    runtime_tool_version: str | None = None,
    parameters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "evaluator_version": EVALUATOR_VERSION,
        "formula": FORMULAS[metric],
        "tool": tool_for(metric, runtime_tool_version),
        "parameters": dict(parameters or {}),
        "inputs": {
            "run_id": str(run_id),
            "snapshot_id": str(snapshot_id) if snapshot_id else None,
            "source_sha256": source_sha256,
            "generated_code_sha256": sha256_text(generated_code),
        },
        "evaluated_at": evaluated_at.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z"),
    }
