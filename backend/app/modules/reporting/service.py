"""Reporting service: live summary, strategy comparability, sanitized CSV exports, and safe deletion."""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.exceptions import AppError, ErrorCode
from app.core.logging import redact_secrets
from app.modules.audit.service import AuditAction, AuditService
from app.modules.projects.repository import ProjectRepository
from app.modules.reporting.csv_export import (
    format_metric_csv_cell,
    resolve_safe_artifact_path,
    serialize_csv_rows,
)
from app.modules.reporting.models import ReportRunRecord
from app.modules.reporting.repository import ReportingRepository, UnifiedRunView
from app.modules.reporting.schemas import (
    ComparabilityChecksOutput,
    ComparabilityOutput,
    ComparabilityStatus,
    MetricDisplayValue,
    ReportResultsOutput,
    ReportRunCreateInput,
    ReportRunItemOutput,
    ReportSummaryOutput,
    RunMetricsOutput,
    StrategyComparisonRowOutput,
    ValidityLabel,
)

RUNS_CSV_HEADERS: tuple[str, ...] = (
    "run_id",
    "project_id",
    "snapshot_id",
    "snapshot_sha256",
    "source_id",
    "source_name",
    "source_sha256",
    "dataset_id",
    "dataset_name",
    "dataset_sha256",
    "suite_name",
    "function_name",
    "strategy",
    "prompt_version",
    "prompt_sha256",
    "provider",
    "model",
    "repeat_index",
    "status",
    "duration_ms",
    "total_cases",
    "completed_cases",
    "passed_cases",
    "failed_cases",
    "timeout_cases",
    "syntax_validity",
    "line_coverage",
    "mutation_score",
    "assertion_quality",
    "error_message",
    "created_at",
)

STRATEGY_COMPARISON_CSV_HEADERS: tuple[str, ...] = (
    "project_id",
    "snapshot_id",
    "snapshot_sha256",
    "source_sha256",
    "dataset_sha256",
    "strategy",
    "prompt_version",
    "prompt_sha256",
    "provider",
    "model",
    "total_runs",
    "completed_runs",
    "total_cases",
    "passed_cases",
    "pass_rate",
    "avg_coverage",
    "avg_mutation_score",
    "avg_assertion_quality",
    "baseline_coverage_delta",
    "baseline_mutation_delta",
    "comparability_status",
    "comparability_reasons",
)

_ALLOWED_STATUS_FILTERS = frozenset(
    {"ALL", "COMPLETED", "ACTIVE", "QUEUED", "RUNNING", "FAILED", "TIMEOUT", "CANCELLED"}
)
_ALLOWED_QUALITY_FILTERS = frozenset({"ALL", "ONLY_PASSING", "HAS_FAILURES", "HIGH_COVERAGE"})
_ALLOWED_SORT_KEYS = frozenset(
    {"date", "pass_rate", "coverage", "mutation", "duration", "suite_name"}
)


def _normalize_strategy_code(raw: str) -> str:
    upper = raw.strip().upper()
    for code in ("L1", "L2", "L3", "L4", "L5"):
        if upper == code or upper.startswith(f"{code}:") or upper.startswith(f"{code} "):
            return code
    return upper


def _metric_display(state: str, value: float | None) -> MetricDisplayValue:
    norm = state.strip().upper()
    if norm == "MEASURED" and value is not None:
        return 0.0 if value == 0.0 else round(float(value), 2)
    if norm == "TIMEOUT":
        return "TIMEOUT"
    if norm == "FAILED":
        return "FAILED"
    return "N/A"


def _aggregate_metric(pairs: list[tuple[str, float | None]]) -> MetricDisplayValue:
    measured = [float(val) for st, val in pairs if st == "MEASURED" and val is not None]
    if measured:
        avg = sum(measured) / len(measured)
        return 0.0 if avg == 0.0 else round(avg, 2)
    states = {st.upper() for st, _ in pairs}
    if states and states <= {"TIMEOUT"}:
        return "TIMEOUT"
    if states and states <= {"FAILED"}:
        return "FAILED"
    if "TIMEOUT" in states and not (states - {"TIMEOUT", "N/A"}):
        return "TIMEOUT"
    if "FAILED" in states and not (states - {"FAILED", "N/A"}):
        return "FAILED"
    return "N/A"


def _validity_label(run: UnifiedRunView) -> ValidityLabel:
    if run.syntax_validity_state == "MEASURED" and run.syntax_validity_value is not None:
        return "PASSED" if run.syntax_validity_value > 0.0 else "FAILED"
    if run.status == "TIMEOUT" or run.syntax_validity_state == "TIMEOUT":
        return "TIMEOUT"
    if run.status == "FAILED" or run.syntax_validity_state == "FAILED":
        return "FAILED"
    if run.status == "COMPLETED":
        return "PASSED"
    return "N/A"


def _collapse_provenance_str(values: list[str | None]) -> str | None:
    distinct = sorted({v for v in values if v is not None})
    if not distinct:
        return None
    if len(distinct) == 1:
        return distinct[0]
    return "MIXED"


def _collapse_provenance_int_or_str(values: list[int | None]) -> int | str | None:
    distinct = sorted({v for v in values if v is not None})
    if not distinct:
        return None
    if len(distinct) == 1:
        return distinct[0]
    return "MIXED"


class ReportingService:
    def __init__(self, db: Session, *, artifact_dir: str | None = None) -> None:
        self.db = db
        self.repo = ReportingRepository(db)
        self.projects = ProjectRepository(db)
        self.audit = AuditService(db)
        self.artifact_dir = artifact_dir if artifact_dir is not None else get_settings().artifact_dir

    def _require_project(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> None:
        if self.projects.get(owner_id, project_id) is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    def record_run_result(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        payload: ReportRunCreateInput,
    ) -> ReportRunRecord:
        self._require_project(owner_id, project_id)
        now = utcnow()
        record = ReportRunRecord(
            id=payload.id or uuid.uuid4(),
            project_id=project_id,
            snapshot_id=payload.snapshot_id,
            snapshot_sha256=payload.snapshot_sha256,
            source_id=payload.source_id,
            source_name=redact_secrets(payload.source_name) if payload.source_name else None,
            source_sha256=payload.source_sha256,
            dataset_id=payload.dataset_id,
            dataset_name=redact_secrets(payload.dataset_name) if payload.dataset_name else None,
            dataset_sha256=payload.dataset_sha256,
            suite_name=redact_secrets(payload.suite_name),
            function_name=payload.function_name,
            provider=payload.provider.strip().lower(),
            model=payload.model.strip(),
            strategy=_normalize_strategy_code(payload.strategy),
            prompt_version=payload.prompt_version,
            prompt_sha256=payload.prompt_sha256,
            repeat_index=payload.repeat_index,
            status=payload.status,
            duration_ms=payload.duration_ms,
            total_cases=payload.total_cases,
            completed_cases=payload.completed_cases,
            passed_cases=payload.passed_cases,
            failed_cases=payload.failed_cases,
            timeout_cases=payload.timeout_cases,
            syntax_validity_state=payload.syntax_validity_state,
            syntax_validity_value=payload.syntax_validity_value,
            line_coverage_state=payload.line_coverage_state,
            line_coverage_value=payload.line_coverage_value,
            mutation_score_state=payload.mutation_score_state,
            mutation_score_value=payload.mutation_score_value,
            assertion_quality_state=payload.assertion_quality_state,
            assertion_quality_value=payload.assertion_quality_value,
            artifact_relpath=payload.artifact_relpath,
            artifact_sha256=payload.artifact_sha256,
            error_message=redact_secrets(payload.error_message) if payload.error_message else None,
            created_at=now,
            updated_at=now,
        )
        self.repo.add_run(record)
        self.db.commit()
        self.db.refresh(record)
        return record

    @staticmethod
    def _to_run_item(run: UnifiedRunView) -> ReportRunItemOutput:
        cov = _metric_display(run.line_coverage_state, run.line_coverage_value)
        mut = _metric_display(run.mutation_score_state, run.mutation_score_value)
        ast_q = _metric_display(run.assertion_quality_state, run.assertion_quality_value)
        syn = _metric_display(run.syntax_validity_state, run.syntax_validity_value)
        return ReportRunItemOutput(
            id=run.id,
            project_id=run.project_id,
            snapshot_id=run.snapshot_id,
            snapshot_sha256=run.snapshot_sha256,
            source_id=run.source_id,
            source_name=redact_secrets(run.source_name) if run.source_name else None,
            source_sha256=run.source_sha256,
            dataset_id=run.dataset_id,
            dataset_name=redact_secrets(run.dataset_name) if run.dataset_name else None,
            dataset_sha256=run.dataset_sha256,
            suite_name=redact_secrets(run.suite_name),
            function_name=run.function_name,
            provider=run.provider,
            model=run.model,
            strategy=_normalize_strategy_code(run.strategy),
            prompt_version=run.prompt_version,
            prompt_sha256=run.prompt_sha256,
            repeat_index=run.repeat_index,
            status=run.status,
            duration_ms=run.duration_ms,
            total_cases=run.total_cases,
            completed_cases=run.completed_cases,
            passed_cases=run.passed_cases,
            failed_cases=run.failed_cases,
            timeout_cases=run.timeout_cases,
            metrics=RunMetricsOutput(
                coverage=cov,
                line_coverage=cov,
                mutation_score=mut,
                assertion_quality=ast_q,
                assertion_score=ast_q,
                syntax_validity=syn,
                validity=_validity_label(run),
            ),
            error_message=redact_secrets(run.error_message) if run.error_message else None,
            created_at=run.created_at,
        )

    @staticmethod
    def _compute_comparability(runs: list[UnifiedRunView]) -> ComparabilityOutput:
        if not runs:
            return ComparabilityOutput(
                status="COMPATIBLE",
                reasons=[],
                checks=ComparabilityChecksOutput(
                    source_consistent=True,
                    dataset_consistent=True,
                    single_model=True,
                    balanced_samples=True,
                    all_completed=True,
                ),
                distinct_source_sha256=[],
                distinct_dataset_sha256=[],
                distinct_models=[],
            )

        source_hashes = sorted({r.source_sha256 for r in runs})
        dataset_tokens = sorted({r.dataset_sha256 or "<NONE>" for r in runs})
        models = sorted({f"{r.provider}/{r.model}" for r in runs})

        source_consistent = len(source_hashes) <= 1
        dataset_consistent = len(dataset_tokens) <= 1
        single_model = len(models) <= 1
        all_completed = all(r.status == "COMPLETED" for r in runs)

        counts_by_strategy: dict[str, int] = {}
        for r in runs:
            key = _normalize_strategy_code(r.strategy)
            counts_by_strategy[key] = counts_by_strategy.get(key, 0) + max(r.total_cases, 1)
        counts = list(counts_by_strategy.values())
        min_c = min(counts) if counts else 1
        max_c = max(counts) if counts else 1
        balanced_samples = (max_c / min_c) <= 2.5 if min_c > 0 else False

        reasons: list[str] = []
        if not source_consistent:
            reasons.append(
                f"Divergent source_sha256 values detected ({len(source_hashes)} revisions)"
            )
        if not dataset_consistent:
            reasons.append(
                f"Divergent dataset_sha256 values detected ({len(dataset_tokens)} snapshots)"
            )
        if not single_model:
            reasons.append(f"Multiple LLM models mixed across runs ({', '.join(models)})")
        if not balanced_samples:
            reasons.append("Sample volume imbalance exceeds 2.5x across strategies")
        if not all_completed:
            reasons.append("One or more runs are incomplete, failed, cancelled, or timed out")

        status: ComparabilityStatus
        if not source_consistent or not dataset_consistent:
            status = "INCOMPARABLE"
        elif not single_model or not balanced_samples or not all_completed:
            status = "CAUTION"
        else:
            status = "COMPATIBLE"

        return ComparabilityOutput(
            status=status,
            reasons=reasons,
            checks=ComparabilityChecksOutput(
                source_consistent=source_consistent,
                dataset_consistent=dataset_consistent,
                single_model=single_model,
                balanced_samples=balanced_samples,
                all_completed=all_completed,
            ),
            distinct_source_sha256=source_hashes,
            distinct_dataset_sha256=[d for d in dataset_tokens if d != "<NONE>"],
            distinct_models=models,
        )

    @classmethod
    def _build_strategy_comparison(
        cls,
        runs: list[UnifiedRunView],
        comparability: ComparabilityOutput,
    ) -> list[StrategyComparisonRowOutput]:
        buckets: dict[tuple[str, str, str], list[UnifiedRunView]] = {}
        for r in runs:
            key = (_normalize_strategy_code(r.strategy), r.provider, r.model)
            buckets.setdefault(key, []).append(r)

        prelim: list[StrategyComparisonRowOutput] = []
        for (strategy, provider, model), group in sorted(buckets.items()):
            total_runs = len(group)
            completed_runs = sum(1 for r in group if r.status == "COMPLETED")
            total_cases = sum(r.total_cases for r in group)
            completed_cases = sum(r.completed_cases for r in group)
            passed_cases = sum(r.passed_cases for r in group)
            pass_rate: MetricDisplayValue = (
                (
                    0.0
                    if passed_cases == 0
                    else round((passed_cases / completed_cases) * 100.0, 2)
                )
                if completed_cases > 0
                else "N/A"
            )
            avg_cov = _aggregate_metric(
                [(r.line_coverage_state, r.line_coverage_value) for r in group]
            )
            avg_mut = _aggregate_metric(
                [(r.mutation_score_state, r.mutation_score_value) for r in group]
            )
            avg_ast = _aggregate_metric(
                [(r.assertion_quality_state, r.assertion_quality_value) for r in group]
            )
            snap_id_str = _collapse_provenance_str(
                [str(r.snapshot_id) if r.snapshot_id else None for r in group]
            )
            snap_sha_str = _collapse_provenance_str([r.snapshot_sha256 for r in group])
            src_sha_str = _collapse_provenance_str([r.source_sha256 for r in group]) or ("0" * 64)
            ds_sha_str = _collapse_provenance_str([r.dataset_sha256 for r in group])
            p_ver = _collapse_provenance_int_or_str([r.prompt_version for r in group])
            p_sha = _collapse_provenance_str([r.prompt_sha256 for r in group])

            prelim.append(
                StrategyComparisonRowOutput(
                    strategy=strategy,
                    provider=provider,
                    model=model,
                    snapshot_id=snap_id_str,
                    snapshot_sha256=snap_sha_str,
                    source_sha256=src_sha_str,
                    dataset_sha256=ds_sha_str,
                    prompt_version=p_ver,
                    prompt_sha256=p_sha,
                    total_runs=total_runs,
                    completed_runs=completed_runs,
                    total_cases=total_cases,
                    completed_cases=completed_cases,
                    passed_cases=passed_cases,
                    pass_rate=pass_rate,
                    avg_coverage=avg_cov,
                    avg_mutation_score=avg_mut,
                    avg_assertion_quality=avg_ast,
                    baseline_coverage_delta="N/A",
                    baseline_mutation_delta="N/A",
                    comparability_status=comparability.status,
                )
            )

        # Compute deltas relative to matching model's L1 row (or first L1 row if single baseline)
        l1_by_model = {
            (row.provider, row.model): row for row in prelim if row.strategy == "L1"
        }
        first_l1 = next((row for row in prelim if row.strategy == "L1"), None)

        final_rows: list[StrategyComparisonRowOutput] = []
        for row in prelim:
            base = l1_by_model.get((row.provider, row.model)) or first_l1
            cov_delta: float | Literal["N/A"] = "N/A"
            mut_delta: float | Literal["N/A"] = "N/A"
            if base is not None:
                if isinstance(row.avg_coverage, float) and isinstance(base.avg_coverage, float):
                    diff = round(row.avg_coverage - base.avg_coverage, 2)
                    cov_delta = 0.0 if diff == 0.0 else diff
                if isinstance(row.avg_mutation_score, float) and isinstance(
                    base.avg_mutation_score, float
                ):
                    mdiff = round(row.avg_mutation_score - base.avg_mutation_score, 2)
                    mut_delta = 0.0 if mdiff == 0.0 else mdiff
            final_rows.append(
                row.model_copy(
                    update={
                        "baseline_coverage_delta": cov_delta,
                        "baseline_mutation_delta": mut_delta,
                    }
                )
            )
        return final_rows

    def _compute_summary_from_runs(
        self, project_id: uuid.UUID, runs: list[UnifiedRunView]
    ) -> ReportSummaryOutput:
        total_runs = len(runs)
        completed_runs = sum(1 for r in runs if r.status == "COMPLETED")
        failed_runs = sum(1 for r in runs if r.status == "FAILED")
        timeout_runs = sum(1 for r in runs if r.status == "TIMEOUT")
        cancelled_runs = sum(1 for r in runs if r.status == "CANCELLED")
        queued_runs = sum(1 for r in runs if r.status == "QUEUED")
        running_runs = sum(1 for r in runs if r.status == "RUNNING")

        terminal_runs = completed_runs + failed_runs + timeout_runs + cancelled_runs
        progress_pct = (
            round((terminal_runs / total_runs) * 100.0, 2) if total_runs > 0 else 0.0
        )
        if progress_pct == 0.0:
            progress_pct = 0.0

        completed_cases = sum(r.completed_cases for r in runs)
        passed_cases = sum(r.passed_cases for r in runs)
        pass_rate: MetricDisplayValue
        if completed_cases > 0:
            raw_pass = round((passed_cases / completed_cases) * 100.0, 2)
            pass_rate = 0.0 if raw_pass == 0.0 else raw_pass
        else:
            pass_rate = "N/A"

        avg_cov = _aggregate_metric(
            [(r.line_coverage_state, r.line_coverage_value) for r in runs]
        )
        avg_mut = _aggregate_metric(
            [(r.mutation_score_state, r.mutation_score_value) for r in runs]
        )
        avg_ast = _aggregate_metric(
            [(r.assertion_quality_state, r.assertion_quality_value) for r in runs]
        )
        comparability = self._compute_comparability(runs)
        matrix = self._build_strategy_comparison(runs, comparability)

        return ReportSummaryOutput(
            project_id=project_id,
            total_runs=total_runs,
            completed_runs=completed_runs,
            failed_runs=failed_runs,
            timeout_runs=timeout_runs,
            cancelled_runs=cancelled_runs,
            queued_runs=queued_runs,
            running_runs=running_runs,
            progress_pct=progress_pct,
            pass_rate=pass_rate,
            avg_coverage=avg_cov,
            avg_mutation_score=avg_mut,
            avg_assertion_quality=avg_ast,
            comparability=comparability,
            strategy_comparison=matrix,
        )

    @staticmethod
    def _filter_and_sort_runs(
        runs: list[UnifiedRunView],
        *,
        status: str | None = None,
        strategy: str | None = None,
        model: str | None = None,
        quality: str | None = None,
        search: str | None = None,
        sort_by: str = "date",
        sort_dir: str = "desc",
    ) -> list[UnifiedRunView]:
        norm_status = status.strip().upper() if status and status.strip() else "ALL"
        if norm_status not in _ALLOWED_STATUS_FILTERS:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                f"Unsupported status filter: {status!r}",
                {"status": f"Allowed: {', '.join(sorted(_ALLOWED_STATUS_FILTERS))}"},
            )

        norm_strategy = _normalize_strategy_code(strategy) if strategy and strategy.strip() else "ALL"
        if norm_strategy != "ALL" and norm_strategy not in {"L1", "L2", "L3", "L4", "L5"}:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                f"Unsupported strategy filter: {strategy!r}",
                {"strategy": "Must be ALL or one of L1, L2, L3, L4, L5"},
            )

        norm_quality = quality.strip().upper() if quality and quality.strip() else "ALL"
        if norm_quality not in _ALLOWED_QUALITY_FILTERS:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                f"Unsupported quality filter: {quality!r}",
                {"quality": f"Allowed: {', '.join(sorted(_ALLOWED_QUALITY_FILTERS))}"},
            )

        norm_sort = sort_by.strip().lower() if sort_by else "date"
        if norm_sort not in _ALLOWED_SORT_KEYS:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                f"Unsupported sort_by key: {sort_by!r}",
                {"sort_by": f"Allowed: {', '.join(sorted(_ALLOWED_SORT_KEYS))}"},
            )

        reverse = sort_dir.strip().lower() != "asc"
        norm_model = model.strip().lower() if model and model.strip() and model.strip().upper() != "ALL" else None
        norm_search = search.strip().lower() if search and search.strip() else None

        filtered: list[UnifiedRunView] = []
        for r in runs:
            r_status = r.status.upper()
            if norm_status != "ALL":
                if norm_status == "ACTIVE":
                    if r_status not in {"QUEUED", "RUNNING"}:
                        continue
                elif r_status != norm_status:
                    continue

            if norm_strategy != "ALL" and _normalize_strategy_code(r.strategy) != norm_strategy:
                continue

            if norm_model is not None and norm_model not in r.model.lower():
                continue

            if norm_quality != "ALL":
                if norm_quality == "ONLY_PASSING":
                    if r_status != "COMPLETED" or r.failed_cases > 0 or r.passed_cases == 0:
                        continue
                elif norm_quality == "HAS_FAILURES":
                    if r.failed_cases == 0 and r_status not in {"FAILED", "TIMEOUT"}:
                        continue
                elif norm_quality == "HIGH_COVERAGE":
                    if r.line_coverage_state != "MEASURED" or (r.line_coverage_value or 0.0) < 80.0:
                        continue

            if norm_search is not None:
                haystack = " ".join(
                    filter(
                        None,
                        [
                            str(r.id),
                            r.suite_name,
                            r.dataset_name,
                            r.source_name,
                            r.function_name,
                            r.model,
                            r.provider,
                            r.strategy,
                        ],
                    )
                ).lower()
                if norm_search not in haystack:
                    continue

            filtered.append(r)

        def sort_key(item: UnifiedRunView) -> tuple[float | str, str]:
            if norm_sort == "pass_rate":
                rate = (
                    (item.passed_cases / item.completed_cases) * 100.0
                    if item.completed_cases > 0
                    else -1.0
                )
                return (rate, str(item.id))
            if norm_sort == "coverage":
                cov = (
                    item.line_coverage_value
                    if item.line_coverage_state == "MEASURED" and item.line_coverage_value is not None
                    else -1.0
                )
                return (cov, str(item.id))
            if norm_sort == "mutation":
                mut = (
                    item.mutation_score_value
                    if item.mutation_score_state == "MEASURED" and item.mutation_score_value is not None
                    else -1.0
                )
                return (mut, str(item.id))
            if norm_sort == "duration":
                return (float(item.duration_ms or 0), str(item.id))
            if norm_sort == "suite_name":
                return (item.suite_name.lower(), str(item.id))
            return (item.created_at.isoformat(), str(item.id))

        return sorted(filtered, key=sort_key, reverse=reverse)

    def get_summary(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> ReportSummaryOutput:
        self._require_project(owner_id, project_id)
        runs = self.repo.list_unified_runs(project_id)
        return self._compute_summary_from_runs(project_id, runs)

    def get_results(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        *,
        status: str | None = None,
        strategy: str | None = None,
        model: str | None = None,
        quality: str | None = None,
        search: str | None = None,
        sort_by: str = "date",
        sort_dir: str = "desc",
    ) -> ReportResultsOutput:
        self._require_project(owner_id, project_id)
        all_runs = self.repo.list_unified_runs(project_id)
        filtered = self._filter_and_sort_runs(
            all_runs,
            status=status,
            strategy=strategy,
            model=model,
            quality=quality,
            search=search,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
        summary = self._compute_summary_from_runs(project_id, all_runs)
        return ReportResultsOutput(
            project_id=project_id,
            total_runs=len(all_runs),
            filtered_runs=len(filtered),
            summary=summary,
            comparability=summary.comparability,
            strategy_comparison=summary.strategy_comparison,
            runs=[self._to_run_item(r) for r in filtered],
        )

    def export_runs_csv(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        *,
        status: str | None = None,
        strategy: str | None = None,
        model: str | None = None,
        search: str | None = None,
    ) -> str:
        self._require_project(owner_id, project_id)
        all_runs = self.repo.list_unified_runs(project_id)
        filtered = self._filter_and_sort_runs(
            all_runs,
            status=status,
            strategy=strategy,
            model=model,
            search=search,
        )
        rows = [
            [
                str(r.id),
                str(r.project_id),
                str(r.snapshot_id) if r.snapshot_id else "",
                r.snapshot_sha256 or "",
                str(r.source_id) if r.source_id else "",
                r.source_name or "",
                r.source_sha256,
                str(r.dataset_id) if r.dataset_id else "",
                r.dataset_name or "",
                r.dataset_sha256 or "",
                r.suite_name,
                r.function_name or "",
                _normalize_strategy_code(r.strategy),
                r.prompt_version,
                r.prompt_sha256 or "",
                r.provider,
                r.model,
                r.repeat_index,
                r.status,
                r.duration_ms,
                r.total_cases,
                r.completed_cases,
                r.passed_cases,
                r.failed_cases,
                r.timeout_cases,
                format_metric_csv_cell(r.syntax_validity_state, r.syntax_validity_value),
                format_metric_csv_cell(r.line_coverage_state, r.line_coverage_value),
                format_metric_csv_cell(r.mutation_score_state, r.mutation_score_value),
                format_metric_csv_cell(r.assertion_quality_state, r.assertion_quality_value),
                r.error_message or "",
                r.created_at.isoformat() + "Z",
            ]
            for r in filtered
        ]
        return serialize_csv_rows(RUNS_CSV_HEADERS, rows)

    def export_strategy_comparison_csv(
        self, owner_id: uuid.UUID, project_id: uuid.UUID
    ) -> str:
        summary = self.get_summary(owner_id, project_id)
        reasons_joined = "; ".join(summary.comparability.reasons)
        rows = [
            [
                str(project_id),
                item.snapshot_id or "",
                item.snapshot_sha256 or "",
                item.source_sha256,
                item.dataset_sha256 or "",
                item.strategy,
                item.prompt_version,
                item.prompt_sha256 or "",
                item.provider,
                item.model,
                item.total_runs,
                item.completed_runs,
                item.total_cases,
                item.passed_cases,
                item.pass_rate,
                item.avg_coverage,
                item.avg_mutation_score,
                item.avg_assertion_quality,
                item.baseline_coverage_delta,
                item.baseline_mutation_delta,
                item.comparability_status,
                reasons_joined,
            ]
            for item in summary.strategy_comparison
        ]
        return serialize_csv_rows(STRATEGY_COMPARISON_CSV_HEADERS, rows)

    def delete_run_result(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, run_id: uuid.UUID
    ) -> ReportSummaryOutput:
        self._require_project(owner_id, project_id)
        found, relpaths = self.repo.find_run_artifacts_and_exists(project_id, run_id)
        if not found:
            raise AppError(ErrorCode.NOT_FOUND, "Run result not found")

        # Validate ALL referenced artifact paths BEFORE mutating DB or unlinking files
        safe_targets = [
            resolve_safe_artifact_path(self.artifact_dir, rel) for rel in relpaths
        ]
        for resolved in safe_targets:
            if resolved.exists() and resolved.is_file():
                resolved.unlink()

        self.repo.delete_run_records(project_id, run_id)
        self.audit.record(AuditAction.REPORT_RESULT_DELETED, owner_id)
        self.db.commit()

        remaining = self.repo.list_unified_runs(project_id)
        return self._compute_summary_from_runs(project_id, remaining)
