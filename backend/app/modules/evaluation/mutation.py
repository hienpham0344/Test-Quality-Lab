"""Structured mutmut result parser and mutation score calculator (FR-EVL-004, Issue #54)."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from app.modules.evaluation.eligibility import (
    MetricOutcome,
    MetricState,
    RunLifecycleStatus,
    check_metric_eligibility,
)
from app.modules.evaluation.models import MetricName


class MutantStatus(StrEnum):
    KILLED = "KILLED"
    SURVIVED = "SURVIVED"
    TIMEOUT = "TIMEOUT"
    SUSPICIOUS = "SUSPICIOUS"
    SKIPPED = "SKIPPED"
    EQUIVALENT = "EQUIVALENT"
    INVALID = "INVALID"


class MutationOperator(StrEnum):
    AOR = "AOR"
    ROR = "ROR"
    LCR = "LCR"
    SDL = "SDL"
    UOI = "UOI"


_STATUS_ALIASES: dict[str, MutantStatus] = {
    "KILLED": MutantStatus.KILLED,
    "OK_KILLED": MutantStatus.KILLED,
    "SURVIVED": MutantStatus.SURVIVED,
    "BAD_SURVIVED": MutantStatus.SURVIVED,
    "TIMEOUT": MutantStatus.TIMEOUT,
    "BAD_TIMEOUT": MutantStatus.TIMEOUT,
    "SUSPICIOUS": MutantStatus.SUSPICIOUS,
    "OK_SUSPICIOUS": MutantStatus.SUSPICIOUS,
    "SKIPPED": MutantStatus.SKIPPED,
    "UNTESTED": MutantStatus.SKIPPED,
    "EQUIVALENT": MutantStatus.EQUIVALENT,
    "INVALID": MutantStatus.INVALID,
}

_LOGICAL_RE = re.compile(r"\b(?:and|or)\b")
_RELATIONAL_RE = re.compile(r"(?:<=|>=|==|!=|<|>|\bis\s+not\b|\bnot\s+in\b|\bis\b|\bin\b)")
_ARITHMETIC_RE = re.compile(r"(?:\*\*|//|[+\-*/%])")
_UNARY_PREFIX_RE = re.compile(r"^\s*(?:not\b|[-+~])")


@dataclass(frozen=True)
class MutantRecord:
    id: str
    operator: MutationOperator
    line: int
    original: str
    mutated: str
    status: MutantStatus
    killed_by: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "operator": self.operator.value,
            "line": self.line,
            "original": self.original,
            "mutated": self.mutated,
            "status": self.status.value,
            "killed_by": self.killed_by,
        }


@dataclass(frozen=True)
class MutationReport:
    mutants: list[MutantRecord] = field(default_factory=list)
    runner_status: str = "COMPLETED"
    error_message: str | None = None
    verified: bool = True


def infer_mutation_operator(original: str, mutated: str) -> MutationOperator:
    """Infer standard mutation operator code (AOR, ROR, LCR, SDL, UOI) from source diff."""
    orig = original.strip()
    mut = mutated.strip()

    if not mut or mut in {"pass", "...", "None", "return None"} and orig != mut:
        return MutationOperator.SDL

    # Unary insertion/deletion: e.g. 'not flag' <-> 'flag', '-x' <-> 'x'
    orig_unary = _UNARY_PREFIX_RE.match(orig)
    mut_unary = _UNARY_PREFIX_RE.match(mut)
    if bool(orig_unary) != bool(mut_unary):
        orig_core = _UNARY_PREFIX_RE.sub("", orig).strip()
        mut_core = _UNARY_PREFIX_RE.sub("", mut).strip()
        if orig_core == mut_core:
            return MutationOperator.UOI

    if _LOGICAL_RE.findall(orig) != _LOGICAL_RE.findall(mut):
        return MutationOperator.LCR

    if _RELATIONAL_RE.findall(orig) != _RELATIONAL_RE.findall(mut):
        return MutationOperator.ROR

    if _ARITHMETIC_RE.findall(orig) != _ARITHMETIC_RE.findall(mut):
        return MutationOperator.AOR

    return MutationOperator.SDL


def _normalize_mutant_status(raw_status: Any) -> MutantStatus:
    if isinstance(raw_status, MutantStatus):
        return raw_status
    key = str(raw_status).strip().upper()
    if key in _STATUS_ALIASES:
        return _STATUS_ALIASES[key]
    raise ValueError(f"Unsupported mutant status: {raw_status!r}")


def _normalize_operator(raw_operator: Any, original: str, mutated: str) -> MutationOperator:
    if raw_operator is None or str(raw_operator).strip() == "":
        return infer_mutation_operator(original, mutated)
    if isinstance(raw_operator, MutationOperator):
        return raw_operator
    try:
        return MutationOperator(str(raw_operator).strip().upper())
    except ValueError as exc:
        raise ValueError(f"Unsupported mutation operator: {raw_operator!r}") from exc


def parse_mutmut_report(payload: Mapping[str, Any]) -> MutationReport:
    """Parse structured mutmut JSON/dict payload into validated MutantRecord items."""
    raw_mutants = payload.get("mutants", [])
    if not isinstance(raw_mutants, list):
        raise ValueError("Mutation report 'mutants' field must be a list")

    records: list[MutantRecord] = []
    for idx, item in enumerate(raw_mutants, start=1):
        if not isinstance(item, Mapping):
            raise ValueError("Each mutant entry must be a mapping")
        original = str(item.get("original", ""))
        mutated = str(item.get("mutated", ""))
        line_raw = item.get("line", 1)
        if isinstance(line_raw, bool) or not isinstance(line_raw, int) or line_raw < 1:
            raise ValueError(f"Invalid mutant line number: {line_raw!r}")
        mutant_id = str(item.get("id") or f"MUT-{idx:02d}")
        operator = _normalize_operator(item.get("operator"), original, mutated)
        status = _normalize_mutant_status(item.get("status", ""))
        killed_by_raw = item.get("killed_by")
        killed_by = str(killed_by_raw) if killed_by_raw is not None else None
        records.append(
            MutantRecord(
                id=mutant_id,
                operator=operator,
                line=line_raw,
                original=original,
                mutated=mutated,
                status=status,
                killed_by=killed_by,
            )
        )

    runner_status = str(payload.get("runner_status", "COMPLETED")).strip().upper()
    error_message_raw = payload.get("error_message")
    error_message = str(error_message_raw) if error_message_raw is not None else None
    verified = bool(payload.get("verified", True))

    return MutationReport(
        mutants=records,
        runner_status=runner_status,
        error_message=error_message,
        verified=verified,
    )


def build_mutation_details(report: MutationReport) -> dict[str, Any]:
    counts: dict[MutantStatus, int] = {status: 0 for status in MutantStatus}
    for mutant in report.mutants:
        counts[mutant.status] += 1

    killed = counts[MutantStatus.KILLED]
    survived = counts[MutantStatus.SURVIVED]
    denominator = killed + survived
    runner_err = 1 if report.runner_status in {"FAILED", "ERROR"} else 0

    return {
        "mutants": [m.to_dict() for m in report.mutants],
        "summary": {
            "killed": killed,
            "survived": survived,
            "timeout": counts[MutantStatus.TIMEOUT],
            "suspicious": counts[MutantStatus.SUSPICIOUS],
            "skipped": counts[MutantStatus.SKIPPED],
            "equivalent": counts[MutantStatus.EQUIVALENT],
            "invalid": counts[MutantStatus.INVALID],
            "error": counts[MutantStatus.INVALID] + runner_err,
            "denominator": denominator,
        },
    }


def score_mutation_results(
    run_status: RunLifecycleStatus | str,
    report: MutationReport | Mapping[str, Any] | None = None,
    *,
    execution_enabled: bool = False,
    failure_reason: str | None = None,
) -> MetricOutcome:
    """Compute mutation_score = round((killed / (killed + survived)) * 100.0, 2)."""
    parsed: MutationReport | None
    if isinstance(report, Mapping):
        parsed = parse_mutmut_report(report)
    else:
        parsed = report

    has_verified = parsed is not None and parsed.verified
    gated = check_metric_eligibility(
        MetricName.MUTATION_SCORE,
        run_status,
        execution_enabled=execution_enabled,
        has_verified_runtime_trace=has_verified,
        failure_reason=failure_reason,
    )
    if gated is not None:
        return gated

    if parsed is None:
        return MetricOutcome(
            metric_name=MetricName.MUTATION_SCORE,
            state=MetricState.NOT_APPLICABLE,
            numeric_value=None,
            reason="Mutation testing report is not available for this run",
        )

    details = build_mutation_details(parsed)

    if parsed.runner_status == "TIMEOUT":
        return MetricOutcome(
            metric_name=MetricName.MUTATION_SCORE,
            state=MetricState.TIMEOUT,
            numeric_value=None,
            reason=parsed.error_message or "Mutation testing runner timed out",
            details=details,
        )

    if parsed.runner_status in {"FAILED", "ERROR"}:
        return MetricOutcome(
            metric_name=MetricName.MUTATION_SCORE,
            state=MetricState.FAILED,
            numeric_value=None,
            reason=parsed.error_message or "Mutation testing runner failed with an error",
            details=details,
        )

    killed = int(details["summary"]["killed"])
    survived = int(details["summary"]["survived"])
    denominator = killed + survived

    if denominator == 0:
        return MetricOutcome(
            metric_name=MetricName.MUTATION_SCORE,
            state=MetricState.NOT_APPLICABLE,
            numeric_value=None,
            numerator=0,
            denominator=0,
            reason="No eligible non-equivalent mutants to score",
            details=details,
        )

    score = round((killed / denominator) * 100.0, 2)
    return MetricOutcome(
        metric_name=MetricName.MUTATION_SCORE,
        state=MetricState.MEASURED,
        numeric_value=score,
        numerator=killed,
        denominator=denominator,
        details=details,
    )
