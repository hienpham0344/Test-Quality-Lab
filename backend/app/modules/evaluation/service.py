from __future__ import annotations

import hashlib
import re
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.exceptions import AppError, ErrorCode
from app.core.logging import redact_secrets
from app.modules.audit.service import AuditAction, AuditService
from app.modules.evaluation.assertions import score_assertion_quality
from app.modules.evaluation.coverage import (
    CoverageMeasurement,
    parse_coverage_report,
    score_branch_coverage,
)
from app.modules.evaluation.eligibility import (
    CoverageTracePayload,
    MetricOutcome,
    MetricState,
    RunLifecycleStatus,
    score_line_coverage,
)
from app.modules.evaluation.models import AssertionReview, MetricName, MetricRecord, RubricLabel
from app.modules.evaluation.mutation import parse_mutmut_report, score_mutation_results
from app.modules.evaluation.provenance import build_provenance
from app.modules.evaluation.repository import EvaluationRepository
from app.modules.evaluation.schemas import (
    AssertionDetailsOutput,
    AssertionReviewBatchInput,
    AssertionReviewListOutput,
    AssertionReviewOutput,
    CoverageDetailsOutput,
    EvaluateRunInput,
    MetricRecordOutput,
    MutationDetailsOutput,
    RunEvaluationOutput,
    SnapshotGenerationSuccessInput,
    SnapshotGenerationSuccessOutput,
)
from app.modules.evaluation.validity import score_generation_success, score_syntax_validity
from app.modules.projects.repository import ProjectRepository
from app.modules.sources.repository import SourceRepository

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_PER_RUN_METRIC_ORDER: tuple[MetricName, ...] = (
    MetricName.SYNTAX_VALIDITY,
    MetricName.ASSERTION_QUALITY,
    MetricName.LINE_COVERAGE,
    MetricName.BRANCH_COVERAGE,
    MetricName.MUTATION_SCORE,
)
_TERMINAL_STATES: frozenset[str] = frozenset(
    {
        MetricState.MEASURED.value,
        MetricState.FAILED.value,
        MetricState.TIMEOUT.value,
    }
)


class EvaluationService:
    """Owner-scoped static & verified-trace evaluation workflow (Issues #52, #54, #55, #56)."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = EvaluationRepository(db)
        self.projects = ProjectRepository(db)
        self.sources = SourceRepository(db)
        self.audit = AuditService(db)

    def _require_project(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> None:
        if self.projects.get(owner_id, project_id) is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    def _guard_run_project_ownership(self, project_id: uuid.UUID, run_id: uuid.UUID) -> None:
        existing_metric = self.repo.find_any_metric_for_run(run_id)
        if existing_metric is not None and existing_metric.project_id != project_id:
            raise AppError(ErrorCode.NOT_FOUND, "Evaluation run not found")
        existing_review = self.repo.find_any_review_for_run(run_id)
        if existing_review is not None and existing_review.project_id != project_id:
            raise AppError(ErrorCode.NOT_FOUND, "Evaluation run not found")
        gen_run = self.repo.lookup_generation_run(run_id)
        if gen_run is not None and gen_run["project_id"] != project_id:
            raise AppError(ErrorCode.NOT_FOUND, "Evaluation run not found")

    def _resolve_source_sha256(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        *,
        snapshot_id: uuid.UUID | None,
        source_id: uuid.UUID | None,
        source_revision: int | None,
        source_code: str | None,
        source_sha256: str | None,
        generated_code: str | None,
    ) -> str:
        if snapshot_id is not None:
            snapshot = self.repo.get_snapshot_by_project(project_id, snapshot_id)
            if snapshot is None:
                raise AppError(ErrorCode.NOT_FOUND, "Experiment snapshot not found")
            if source_sha256 is not None and source_sha256.lower() != snapshot.source_sha256:
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    "Provided source_sha256 does not match frozen snapshot provenance",
                    {"source_sha256": "Must match snapshot.source_sha256"},
                )
            return snapshot.source_sha256

        if source_id is not None:
            src = self.sources.source(owner_id, project_id, source_id)
            if src is None:
                raise AppError(ErrorCode.NOT_FOUND, "Python source not found")
            rev = source_revision if source_revision is not None else src.current_revision
            ver = self.sources.version(source_id, rev)
            if ver is None:
                raise AppError(ErrorCode.NOT_FOUND, "Python source revision not found")
            return ver.sha256

        if source_sha256 is not None:
            normalized = source_sha256.strip().lower()
            if not _SHA256_RE.match(normalized):
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    "Invalid source_sha256 hex digest",
                    {"source_sha256": "Expected 64 lowercase hex characters"},
                )
            return normalized

        if source_code is not None:
            return hashlib.sha256(source_code.encode("utf-8")).hexdigest()

        return hashlib.sha256((generated_code or "").encode("utf-8")).hexdigest()

    @staticmethod
    def _to_metric_output(record: MetricRecord) -> MetricRecordOutput:
        return MetricRecordOutput(
            id=record.id,
            project_id=record.project_id,
            snapshot_id=record.snapshot_id,
            run_id=record.run_id,
            metric_name=MetricName(record.metric_name),
            state=MetricState(record.state),
            numeric_value=record.numeric_value,
            numerator=record.numerator,
            denominator=record.denominator,
            reason=record.reason,
            source_sha256=record.source_sha256,
            details=dict(record.details),
            provenance=record.provenance,
            evaluated_at=record.evaluated_at,
        )

    @staticmethod
    def _to_review_output(review: AssertionReview) -> AssertionReviewOutput:
        return AssertionReviewOutput(
            id=review.id,
            project_id=review.project_id,
            run_id=review.run_id,
            assertion_id=review.assertion_id,
            rubric_label=RubricLabel(review.rubric_label),
            notes=review.notes,
            reviewer_id=review.reviewer_id,
            created_at=review.created_at,
            updated_at=review.updated_at,
        )

    def _build_run_output(
        self,
        project_id: uuid.UUID,
        run_id: uuid.UUID,
        records: list[MetricRecord],
    ) -> RunEvaluationOutput:
        by_name: dict[str, MetricRecord] = {r.metric_name: r for r in records}
        ordered_records = [
            by_name[m.value] for m in _PER_RUN_METRIC_ORDER if m.value in by_name
        ]
        if not ordered_records:
            ordered_records = records

        first = ordered_records[0]
        evaluated_at = max(r.evaluated_at for r in ordered_records)

        ast_rec = by_name.get(MetricName.ASSERTION_QUALITY.value)
        if ast_rec is not None and ast_rec.details:
            assertion_details = AssertionDetailsOutput.model_validate(ast_rec.details)
        else:
            assertion_details = AssertionDetailsOutput(
                score=None,
                summary={
                    "total": 0,
                    "verified": 0,
                    "failed": 0,
                    "ineffective": 0,
                    "unchecked": 0,
                    "pass_rate": None,
                    "density": None,
                    "assertion_less_cases": 0,
                    "coverage_factor": None,
                },
                assertions=[],
                unavailable_reason="Assertion analysis has not been recorded",
            )

        mut_rec = by_name.get(MetricName.MUTATION_SCORE.value)
        mutation_details: MutationDetailsOutput | None = None
        if mut_rec is not None and mut_rec.details and "mutants" in mut_rec.details:
            mutation_details = MutationDetailsOutput.model_validate(mut_rec.details)

        cov_rec = by_name.get(MetricName.LINE_COVERAGE.value)
        coverage_details: CoverageDetailsOutput | None = None
        if cov_rec is not None and cov_rec.details and "total_lines" in cov_rec.details:
            branch_rec = by_name.get(MetricName.BRANCH_COVERAGE.value)
            branch = branch_rec.details if branch_rec is not None and branch_rec.details else {}
            coverage_details = CoverageDetailsOutput.model_validate({
                **cov_rec.details,
                "covered_branches": branch.get("covered_branches"),
                "total_branches": branch.get("total_branches"),
                "missing_arcs": branch.get("missing_arcs", []),
            })

        return RunEvaluationOutput(
            project_id=project_id,
            run_id=run_id,
            snapshot_id=first.snapshot_id,
            source_sha256=first.source_sha256,
            evaluated_at=evaluated_at,
            metric_records=[self._to_metric_output(r) for r in ordered_records],
            assertion_details=assertion_details,
            mutation_details=mutation_details,
            coverage_details=coverage_details,
        )

    def _compute_and_persist_run_metrics(
        self,
        *,
        project_id: uuid.UUID,
        run_id: uuid.UUID,
        snapshot_id: uuid.UUID | None,
        source_sha256: str,
        run_status: RunLifecycleStatus,
        generated_code: str | None,
        target_function: str | None,
        failure_reason: str | None,
        coverage_payload: CoverageTracePayload | None,
        mutation_payload: dict[str, Any] | None,
        coverage_measurement: CoverageMeasurement | None = None,
    ) -> list[MetricRecord]:
        try:
            syntax_outcome = score_syntax_validity(
                run_status,
                generated_code,
                target_function=target_function,
                failure_reason=failure_reason,
            )
            assertion_outcome = score_assertion_quality(
                run_status,
                generated_code,
                failure_reason=failure_reason,
            )
            coverage_outcome = score_line_coverage(
                run_status,
                coverage_measurement.statements if coverage_measurement is not None else coverage_payload,
                execution_enabled=False,
                failure_reason=failure_reason,
            )
            branch_outcome = score_branch_coverage(
                run_status,
                coverage_measurement,
                execution_enabled=False,
                failure_reason=failure_reason,
            )
            parsed_mutation = (
                parse_mutmut_report(mutation_payload) if mutation_payload is not None else None
            )
            mutation_outcome = score_mutation_results(
                run_status,
                parsed_mutation,
                execution_enabled=False,
                failure_reason=failure_reason,
            )
        except ValueError as exc:
            raise AppError(ErrorCode.INPUT_INVALID, str(exc)) from exc

        now = utcnow()
        outcomes: tuple[MetricOutcome, ...] = (
            syntax_outcome,
            assertion_outcome,
            coverage_outcome,
            branch_outcome,
            mutation_outcome,
        )
        coverage_version = coverage_measurement.tool_version if coverage_measurement is not None else None
        tool_versions = {
            MetricName.LINE_COVERAGE: coverage_version,
            MetricName.BRANCH_COVERAGE: coverage_version,
            MetricName.MUTATION_SCORE: (mutation_payload or {}).get("tool_version"),
        }
        parameters: dict[MetricName, dict[str, Any]] = {
            MetricName.SYNTAX_VALIDITY: {"target_function": target_function},
            MetricName.LINE_COVERAGE: {
                "report": "coverage-json" if coverage_measurement is not None else
                ("coverage-trace" if coverage_payload is not None else None),
                "target_file": coverage_measurement.target_file if coverage_measurement is not None else None,
            },
            MetricName.BRANCH_COVERAGE: {
                "report": "coverage-json" if coverage_measurement is not None else None,
                "branch": bool(coverage_measurement and coverage_measurement.branches is not None),
            },
            MetricName.MUTATION_SCORE: {"report": "mutmut" if mutation_payload is not None else None},
        }
        persisted: list[MetricRecord] = []
        for outcome in outcomes:
            rec = self.repo.upsert_metric_record(
                project_id=project_id,
                snapshot_id=snapshot_id,
                run_id=run_id,
                outcome=outcome,
                source_sha256=source_sha256,
                evaluated_at=now,
                provenance=build_provenance(
                    outcome.metric_name,
                    run_id=run_id,
                    snapshot_id=snapshot_id,
                    source_sha256=source_sha256,
                    generated_code=generated_code,
                    evaluated_at=now,
                    runtime_tool_version=tool_versions.get(outcome.metric_name),
                    parameters=parameters.get(outcome.metric_name),
                ),
            )
            persisted.append(rec)
        return persisted

    def evaluate_run(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        run_id: uuid.UUID,
        payload: EvaluateRunInput | None = None,
    ) -> RunEvaluationOutput:
        self._require_project(owner_id, project_id)
        self._guard_run_project_ownership(project_id, run_id)

        req = payload or EvaluateRunInput()
        gen_run = self.repo.lookup_generation_run(run_id)

        effective_status = req.run_status
        effective_code = req.generated_code
        effective_snapshot_id = req.snapshot_id
        effective_target_fn = req.target_function
        effective_failure_reason = req.failure_reason

        if gen_run is not None:
            if effective_status is None and gen_run.get("status"):
                effective_status = RunLifecycleStatus(str(gen_run["status"]).upper())
            if effective_code is None:
                effective_code = gen_run.get("generated_code")
            if effective_snapshot_id is None:
                effective_snapshot_id = gen_run.get("snapshot_id")
            if effective_target_fn is None:
                effective_target_fn = gen_run.get("function_name")
            if effective_failure_reason is None and isinstance(gen_run.get("error_info"), dict):
                err_msg = gen_run["error_info"].get("message")
                if err_msg:
                    effective_failure_reason = str(err_msg)

        if effective_status is None:
            if effective_code is not None:
                effective_status = RunLifecycleStatus.COMPLETED
            else:
                raise AppError(ErrorCode.NOT_FOUND, "Evaluation target run not found")

        source_sha256 = self._resolve_source_sha256(
            owner_id,
            project_id,
            snapshot_id=effective_snapshot_id,
            source_id=req.source_id,
            source_revision=req.source_revision,
            source_code=req.source_code,
            source_sha256=req.source_sha256,
            generated_code=effective_code,
        )

        coverage_payload = (
            CoverageTracePayload(
                covered_lines=req.coverage_trace.covered_lines,
                total_lines=req.coverage_trace.total_lines,
                covered_ranges=list(req.coverage_trace.covered_ranges),
                missed_ranges=list(req.coverage_trace.missed_ranges),
                runner_status=req.coverage_trace.runner_status,
                error_message=req.coverage_trace.error_message,
                verified=req.coverage_trace.verified,
            )
            if req.coverage_trace is not None
            else None
        )
        mutation_payload = (
            req.mutation_report.model_dump(mode="json")
            if req.mutation_report is not None
            else None
        )
        coverage_measurement: CoverageMeasurement | None = None
        if req.coverage_report is not None:
            try:
                coverage_measurement = parse_coverage_report(
                    req.coverage_report, runner_status=req.coverage_runner_status
                )
            except ValueError as exc:
                raise AppError(
                    ErrorCode.INPUT_INVALID, "Invalid coverage report", {"coverage_report": str(exc)}
                ) from exc

        records = self._compute_and_persist_run_metrics(
            project_id=project_id,
            run_id=run_id,
            snapshot_id=effective_snapshot_id,
            source_sha256=source_sha256,
            run_status=effective_status,
            generated_code=effective_code,
            target_function=effective_target_fn,
            failure_reason=effective_failure_reason,
            coverage_payload=coverage_payload,
            mutation_payload=mutation_payload,
            coverage_measurement=coverage_measurement,
        )
        self.db.commit()
        return self._build_run_output(project_id, run_id, records)

    def get_run_evaluation(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, run_id: uuid.UUID
    ) -> RunEvaluationOutput:
        self._require_project(owner_id, project_id)
        records = self.repo.list_metrics_for_run(project_id, run_id)
        if not records:
            raise AppError(ErrorCode.NOT_FOUND, "Run evaluation not found")
        return self._build_run_output(project_id, run_id, records)

    def evaluate_snapshot_generation_success(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        snapshot_id: uuid.UUID,
        payload: SnapshotGenerationSuccessInput | None = None,
    ) -> SnapshotGenerationSuccessOutput:
        self._require_project(owner_id, project_id)
        snapshot = self.repo.get_snapshot_by_project(project_id, snapshot_id)
        if snapshot is None:
            raise AppError(ErrorCode.NOT_FOUND, "Experiment snapshot not found")

        if payload is not None and payload.runs:
            for item in payload.runs:
                self._guard_run_project_ownership(project_id, item.run_id)
                self._compute_and_persist_run_metrics(
                    project_id=project_id,
                    run_id=item.run_id,
                    snapshot_id=snapshot.id,
                    source_sha256=snapshot.source_sha256,
                    run_status=item.run_status,
                    generated_code=item.generated_code,
                    target_function=item.target_function,
                    failure_reason=item.failure_reason,
                    coverage_payload=None,
                    mutation_payload=None,
                )
            self.db.flush()

        # Also evaluate any completed/failed/timeout GenerationRun rows in DB not yet evaluated
        gen_runs = self.repo.list_generation_runs_for_snapshot(project_id, snapshot.id)
        if gen_runs:
            existing_syntax = {
                r.run_id for r in self.repo.list_snapshot_syntax_metrics(project_id, snapshot.id)
            }
            for gr in gen_runs:
                gr_id = gr["id"]
                gr_status = RunLifecycleStatus(str(gr["status"]).upper())
                if gr_id not in existing_syntax and gr_status in {
                    RunLifecycleStatus.COMPLETED,
                    RunLifecycleStatus.FAILED,
                    RunLifecycleStatus.TIMEOUT,
                }:
                    err_reason: str | None = None
                    if isinstance(gr.get("error_info"), dict) and gr["error_info"].get("message"):
                        err_reason = str(gr["error_info"]["message"])
                    self._compute_and_persist_run_metrics(
                        project_id=project_id,
                        run_id=gr_id,
                        snapshot_id=snapshot.id,
                        source_sha256=snapshot.source_sha256,
                        run_status=gr_status,
                        generated_code=gr.get("generated_code"),
                        target_function=gr.get("function_name"),
                        failure_reason=err_reason,
                        coverage_payload=None,
                        mutation_payload=None,
                    )
            self.db.flush()

        syntax_records = [
            rec
            for rec in self.repo.list_snapshot_syntax_metrics(project_id, snapshot.id)
            if rec.run_id != snapshot.id
        ]
        terminal_records = [rec for rec in syntax_records if rec.state in _TERMINAL_STATES]
        evaluated_runs = len(terminal_records)
        valid_runs = sum(
            1
            for rec in terminal_records
            if rec.state == MetricState.MEASURED.value and rec.numeric_value == 100.0
        )
        total_planned_runs = max(snapshot.run_count, evaluated_runs)

        outcome = score_generation_success(
            valid_runs=valid_runs,
            evaluated_runs=evaluated_runs,
            total_planned_runs=total_planned_runs,
        )
        evaluated_at = utcnow()
        persisted = self.repo.upsert_metric_record(
            project_id=project_id,
            snapshot_id=snapshot.id,
            run_id=snapshot.id,
            outcome=outcome,
            source_sha256=snapshot.source_sha256,
            evaluated_at=evaluated_at,
            provenance=build_provenance(
                MetricName.GENERATION_SUCCESS,
                run_id=snapshot.id,
                snapshot_id=snapshot.id,
                source_sha256=snapshot.source_sha256,
                generated_code=None,
                evaluated_at=evaluated_at,
                parameters={"snapshot_sha256": snapshot.snapshot_sha256, "planned_runs": snapshot.run_count},
            ),
        )
        self.db.commit()

        return SnapshotGenerationSuccessOutput(
            project_id=project_id,
            snapshot_id=snapshot.id,
            source_sha256=snapshot.source_sha256,
            total_planned_runs=total_planned_runs,
            evaluated_runs=evaluated_runs,
            valid_runs=valid_runs,
            metric=self._to_metric_output(persisted),
        )

    def upsert_assertion_reviews(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        run_id: uuid.UUID,
        payload: AssertionReviewBatchInput,
    ) -> AssertionReviewListOutput:
        self._require_project(owner_id, project_id)
        self._guard_run_project_ownership(project_id, run_id)

        records = self.repo.list_metrics_for_run(project_id, run_id)
        gen_run = self.repo.lookup_generation_run(run_id)
        if not records and gen_run is None:
            raise AppError(ErrorCode.NOT_FOUND, "Run evaluation not found")

        known_assertion_ids: set[str] | None = None
        for rec in records:
            if rec.metric_name == MetricName.ASSERTION_QUALITY.value:
                raw_assertions = rec.details.get("assertions")
                if isinstance(raw_assertions, list) and raw_assertions:
                    known_assertion_ids = {
                        str(item["id"]) for item in raw_assertions if isinstance(item, dict) and "id" in item
                    }
                break

        now = utcnow()
        for item in payload.reviews:
            clean_id = item.assertion_id.strip()
            if not clean_id:
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    "assertion_id must not be empty",
                    {"assertion_id": "Must be a non-empty assertion identifier"},
                )
            if known_assertion_ids is not None and clean_id not in known_assertion_ids:
                raise AppError(
                    ErrorCode.INPUT_INVALID,
                    f"Assertion '{clean_id}' does not exist in evaluated run",
                    {"assertion_id": f"Unknown assertion '{clean_id}'"},
                )
            scrubbed_notes = (
                redact_secrets(item.notes.strip())
                if item.notes is not None and item.notes.strip()
                else None
            )
            self.repo.upsert_assertion_review(
                project_id=project_id,
                run_id=run_id,
                assertion_id=clean_id,
                rubric_label=item.rubric_label,
                notes=scrubbed_notes,
                reviewer_id=owner_id,
                now=now,
            )

        self.audit.record(AuditAction.EVALUATION_ASSERTION_REVIEWED, owner_id)
        self.db.commit()
        reviews = self.repo.list_assertion_reviews(project_id, run_id)
        return AssertionReviewListOutput(
            project_id=project_id,
            run_id=run_id,
            reviews=[self._to_review_output(r) for r in reviews],
        )

    def list_assertion_reviews(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, run_id: uuid.UUID
    ) -> AssertionReviewListOutput:
        self._require_project(owner_id, project_id)
        self._guard_run_project_ownership(project_id, run_id)

        records = self.repo.list_metrics_for_run(project_id, run_id)
        reviews = self.repo.list_assertion_reviews(project_id, run_id)
        gen_run = self.repo.lookup_generation_run(run_id)
        if not records and not reviews and gen_run is None:
            raise AppError(ErrorCode.NOT_FOUND, "Run evaluation not found")

        return AssertionReviewListOutput(
            project_id=project_id,
            run_id=run_id,
            reviews=[self._to_review_output(r) for r in reviews],
        )
