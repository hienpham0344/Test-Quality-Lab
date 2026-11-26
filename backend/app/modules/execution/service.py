"""Sandbox executions: trigger, list, cancel, and the worker run (FR-EXE-001..004, FR-EVL-002) — #45–#49.

No untrusted code runs in this process. The worker hands a read-only workspace to a ``SandboxLauncher``;
the default launcher is disabled, so runs end ``BLOCKED`` with ``SANDBOX_DISABLED`` and no results.
"""

from __future__ import annotations

import shutil
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import Settings, get_settings
from app.core.exceptions import AppError, ErrorCode
from app.core.logging import redact_secrets
from app.infrastructure.sandbox.launcher import (
    RUNNER_DISABLED_EXIT_CODE,
    LaunchRequest,
    LaunchResult,
    SandboxDisabledError,
    SandboxLauncher,
    get_launcher,
)
from app.infrastructure.sandbox.policy import SandboxPolicy, pytest_command
from app.infrastructure.sandbox.results import (
    CaseStatus,
    JUnitError,
    extract_junit,
    parse_junit_xml,
    reconcile_with_collected,
    sanitize_logs,
)
from app.modules.audit.service import AuditAction, AuditService
from app.modules.datasets.repository import DatasetRepository
from app.modules.execution.models import (
    CANCELLABLE_STATUSES,
    TERMINAL_STATUSES,
    Execution,
    ExecutionStatus,
)
from app.modules.execution.oracle import resolve_rows
from app.modules.execution.repository import ExecutionRepository
from app.modules.execution.schemas import (
    ExecutionErrorOutput,
    ExecutionOutput,
    ExecutionTriggerInput,
)
from app.modules.experiments.models import ExperimentSnapshot
from app.modules.generation.models import GenerationRun
from app.modules.projects.repository import ProjectRepository
from app.modules.sources.repository import SourceRepository

TEST_FILE = "test_generated.py"
TARGET_FILE = "target.py"
PYTEST_EXIT_NO_TESTS = 5


def _iso(dt: datetime) -> str:
    return dt.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")


def _error(stage: str, code: str, message: str, at: datetime) -> dict[str, str]:
    return {"stage": stage, "code": code, "message": redact_secrets(message)[:1000], "occurred_at": _iso(at)}


def _system_log(level: str, message: str) -> dict[str, str]:
    return {"stream": "system", "level": level, "message": message}


def to_output(execution: Execution, *, detail: bool) -> ExecutionOutput:
    err = execution.error_info
    return ExecutionOutput(
        id=execution.id,
        project_id=execution.project_id,
        suite_name=execution.suite_name,
        status=ExecutionStatus(execution.status),
        generation_run_id=execution.generation_run_id,
        source_id=execution.source_id,
        source_name=f"Source r{execution.source_revision}" if execution.source_revision else None,
        source_sha256=execution.source_sha256,
        dataset_id=execution.dataset_id,
        dataset_name=f"Dataset r{execution.dataset_revision}" if execution.dataset_revision else None,
        dataset_sha256=execution.dataset_sha256,
        artifact_sha256=execution.artifact_sha256,
        total_cases=execution.total_cases,
        completed_cases=execution.passed_cases + execution.failed_cases + execution.error_cases
        + execution.skipped_cases,
        passed_cases=execution.passed_cases,
        failed_cases=execution.failed_cases,
        error_cases=execution.error_cases,
        skipped_cases=execution.skipped_cases,
        timeout_cases=execution.timeout_cases,
        duration_ms=execution.duration_ms,
        cases=list(execution.cases or []) if detail else [],
        logs=list(execution.logs or []) if detail else [],
        oracle=execution.oracle if detail else None,
        sandbox_policy=execution.sandbox_policy or {},
        error=ExecutionErrorOutput(**err) if isinstance(err, dict) else None,
        cancel_reason=execution.cancel_reason,
        cancelled_at=execution.cancelled_at,
        started_at=execution.started_at,
        completed_at=execution.completed_at,
        created_at=execution.created_at,
        updated_at=execution.updated_at,
    )


class ExecutionService:
    """API side: owner-scoped trigger, list, detail and cancel."""

    def __init__(
        self,
        db: Session,
        enqueue_fn: Callable[[uuid.UUID], str | None] | None = None,
        policy: SandboxPolicy | None = None,
    ) -> None:
        self.db = db
        self.enqueue_fn = enqueue_fn
        self.policy = policy or SandboxPolicy()
        self.repo = ExecutionRepository(db)
        self.projects = ProjectRepository(db)
        self.sources = SourceRepository(db)
        self.datasets = DatasetRepository(db)
        self.audit = AuditService(db)

    def _require_project(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> None:
        if self.projects.get(owner_id, project_id) is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found")

    def _require_execution(self, owner_id: uuid.UUID, project_id: uuid.UUID, execution_id: uuid.UUID) -> Execution:
        self._require_project(owner_id, project_id)
        execution = self.repo.get_project_execution(project_id, execution_id)
        if execution is None:
            raise AppError(ErrorCode.NOT_FOUND, "Execution not found")
        return execution

    def _resolve_run(self, project_id: uuid.UUID, run_id: uuid.UUID | None) -> GenerationRun:
        if run_id is None:
            run = self.repo.latest_eligible_run(project_id)
            if run is None:
                raise AppError(ErrorCode.INPUT_INVALID, "No eligible generated test artifact",
                               {"generation_run_id": "Generate tests that pass every static check first"})
            return run
        run = self.repo.get_project_run(project_id, run_id)
        if run is None:
            raise AppError(ErrorCode.NOT_FOUND, "Generation run not found")
        if run.parsed_code is None or (run.validation or {}).get("eligible") is not True:
            raise AppError(ErrorCode.INPUT_INVALID, "Generated tests are not eligible for execution",
                           {"generation_run_id": "Only artifacts that passed every static check can run"})
        return run

    def trigger(self, owner_id: uuid.UUID, project_id: uuid.UUID, payload: ExecutionTriggerInput) -> ExecutionOutput:
        self._require_project(owner_id, project_id)
        run = self._resolve_run(project_id, payload.generation_run_id)
        snapshot = self.db.get(ExperimentSnapshot, run.snapshot_id)
        if snapshot is None:
            raise AppError(ErrorCode.NOT_FOUND, "Snapshot not found")

        source_id, source_rev, source_sha = snapshot.source_id, snapshot.source_revision, snapshot.source_sha256
        if payload.source_id is not None:
            source = self.sources.source(owner_id, project_id, payload.source_id)
            version = self.sources.version(source.id, source.current_revision) if source else None
            if source is None or version is None:
                raise AppError(ErrorCode.NOT_FOUND, "Python source not found")
            source_id, source_rev, source_sha = source.id, version.revision, version.sha256

        dataset_id, dataset_rev, dataset_sha = snapshot.dataset_id, snapshot.dataset_revision, snapshot.dataset_sha256
        rows: list[dict[str, Any]] = list(snapshot.frozen_rows or [])
        if payload.dataset_id is not None:
            dataset = self.datasets.dataset(owner_id, project_id, payload.dataset_id)
            dversion = self.datasets.version(dataset.id, dataset.current_revision) if dataset else None
            if dataset is None or dversion is None:
                raise AppError(ErrorCode.NOT_FOUND, "Dataset not found")
            dataset_id, dataset_rev, dataset_sha = dataset.id, dversion.revision, dversion.sha256
            selected = set(dversion.selected_rows or [])
            rows = [r for r in dversion.rows if not selected or r.get("row_number") in selected]

        # FR-EVL-002: expected outputs with provenance; no reference run until the sandbox is approved.
        oracle = resolve_rows(
            [r for r in rows if r.get("function_name") == run.function_name],
            references=None,
            dataset_id=str(dataset_id) if dataset_id else None,
            dataset_revision=dataset_rev,
            dataset_sha256=dataset_sha,
            reference_source_sha256=source_sha,
        )
        now = utcnow()
        execution = Execution(
            id=uuid.uuid4(), project_id=project_id, generation_run_id=run.id,
            suite_name=payload.suite_name.strip() or "Test Suite Execution",
            source_id=source_id, source_revision=source_rev, source_sha256=source_sha,
            dataset_id=dataset_id, dataset_revision=dataset_rev, dataset_sha256=dataset_sha,
            artifact_sha256=run.artifact_sha256, status=ExecutionStatus.QUEUED.value,
            total_cases=len((run.validation or {}).get("collected_tests") or []),
            cases=[], logs=[_system_log("INFO", "Execution queued")], oracle=oracle,
            sandbox_policy=self.policy.describe(), created_at=now, updated_at=now,
        )
        self.repo.add(execution)
        self.audit.record(AuditAction.EXECUTION_STARTED, owner_id, execution.id)
        self.db.commit()
        if self.enqueue_fn is not None:
            execution.celery_task_id = self.enqueue_fn(execution.id)
            self.db.commit()
        return to_output(execution, detail=True)

    def list(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> list[ExecutionOutput]:
        self._require_project(owner_id, project_id)
        return [to_output(e, detail=False) for e in self.repo.list_project(project_id)]

    def get(self, owner_id: uuid.UUID, project_id: uuid.UUID, execution_id: uuid.UUID) -> ExecutionOutput:
        return to_output(self._require_execution(owner_id, project_id, execution_id), detail=True)

    def cancel(
        self, owner_id: uuid.UUID, project_id: uuid.UUID, execution_id: uuid.UUID, reason: str | None
    ) -> ExecutionOutput:
        """FR-EXE-004: queued runs cancel now; a running one waits for the worker to confirm the stop."""
        execution = self._require_execution(owner_id, project_id, execution_id)
        status = ExecutionStatus(execution.status)
        if status not in CANCELLABLE_STATUSES:
            raise AppError(
                ErrorCode.EXECUTION_CANNOT_BE_CANCELLED,
                f"Execution run cannot be cancelled because it is already in state '{status.value}'.",
            )
        now = utcnow()
        execution.cancel_reason = (reason or "Cancelled by user").strip()[:500]
        if status == ExecutionStatus.RUNNING:
            execution.status = ExecutionStatus.CANCELLING.value
            execution.logs = [*execution.logs, _system_log("WARN", "Cancel requested; stopping the sandbox")]
        else:
            execution.status = ExecutionStatus.CANCELLED.value
            execution.cancelled_at = now
            execution.completed_at = now
            execution.logs = [*execution.logs, _system_log("WARN", "Cancelled before the sandbox started")]
        execution.updated_at = now
        self.audit.record(AuditAction.EXECUTION_CANCELLED, owner_id, execution.id)
        self.db.commit()
        return to_output(execution, detail=True)


class ExecutionWorker:
    """Worker side: prepares the workspace, calls the launcher, records results, always cleans up."""

    def __init__(self, db: Session, launcher: SandboxLauncher | None = None, settings: Settings | None = None):
        self.db = db
        self.settings = settings or get_settings()
        self.launcher = launcher or get_launcher(
            enabled=self.settings.sandbox_execution_enabled,
            security_review_id=self.settings.sandbox_security_review_id,
            image=self.settings.sandbox_image,
        )
        self.repo = ExecutionRepository(db)

    def _cancel_requested(self, execution_id: uuid.UUID) -> bool:
        execution = self.repo.get(execution_id)
        if execution is None:
            return True
        self.db.refresh(execution)
        return execution.status in (ExecutionStatus.CANCELLING.value, ExecutionStatus.CANCELLED.value)

    def _workspace(self, execution: Execution, run: GenerationRun, code: str) -> Path:
        root = Path(self.settings.sandbox_workdir).resolve(strict=False)
        root.mkdir(parents=True, exist_ok=True)
        workspace = root / execution.id.hex
        if workspace.is_symlink() or not workspace.resolve(strict=False).is_relative_to(root):
            raise AppError(ErrorCode.ACCESS_DENIED, "Workspace path escapes the sandbox work directory")
        workspace.mkdir(mode=0o755, exist_ok=False)
        (workspace / TEST_FILE).write_text(run.parsed_code or "", encoding="utf-8")
        (workspace / TARGET_FILE).write_text(code, encoding="utf-8")
        return workspace

    @staticmethod
    def _cleanup(workspace: Path | None) -> str | None:
        if workspace is None or not workspace.exists():
            return None
        if workspace.is_symlink():
            return "workspace was a symlink and was not followed"
        shutil.rmtree(workspace, ignore_errors=False)
        return None

    def _finish(self, execution: Execution, status: ExecutionStatus, at: datetime) -> None:
        execution.status = status.value
        execution.completed_at = at
        execution.updated_at = at
        if status == ExecutionStatus.CANCELLED:
            execution.cancelled_at = at
        if execution.started_at is not None:
            execution.duration_ms = execution.duration_ms or int((at - execution.started_at).total_seconds() * 1000)

    def run(self, execution_id: uuid.UUID) -> Execution:
        execution = self.repo.get(execution_id)
        if execution is None:
            raise AppError(ErrorCode.NOT_FOUND, "Execution not found")
        if execution.status in {s.value for s in TERMINAL_STATUSES}:
            return execution  # idempotent redelivery
        if execution.status == ExecutionStatus.CANCELLING.value:
            self._finish(execution, ExecutionStatus.CANCELLED, utcnow())
            self.db.commit()
            return execution

        run = self.db.get(GenerationRun, execution.generation_run_id) if execution.generation_run_id else None
        snapshot = self.db.get(ExperimentSnapshot, run.snapshot_id) if run else None
        now = utcnow()
        execution.status, execution.started_at, execution.updated_at = ExecutionStatus.PENDING.value, now, now
        self.db.commit()

        workspace: Path | None = None
        result: LaunchResult | None = None
        try:
            if run is None or snapshot is None or not run.parsed_code:
                raise AppError(ErrorCode.NOT_FOUND, "Generated test artifact is no longer available")
            workspace = self._workspace(execution, run, snapshot.frozen_code)
            execution.status = ExecutionStatus.RUNNING.value
            execution.container_name = f"tql-exec-{execution.id.hex}"
            execution.logs = [*execution.logs, _system_log("INFO", "Sandbox started")]
            self.db.commit()
            result = self.launcher.run(
                LaunchRequest(
                    container_name=execution.container_name,
                    workspace_host_path=str(workspace),
                    command=pytest_command(TEST_FILE),
                ),
                should_cancel=lambda: self._cancel_requested(execution.id),
            )
            self._record(execution, run, result, host_paths=[str(workspace)])
        except SandboxDisabledError as exc:
            at = utcnow()
            execution.error_info = _error("sandbox", "SANDBOX_DISABLED", str(exc), at)
            execution.logs = [*execution.logs, _system_log("SECURITY", str(exc))]
            self._finish(execution, ExecutionStatus.BLOCKED, at)
        except AppError as exc:
            at = utcnow()
            execution.error_info = _error("workspace", exc.code.value, exc.message, at)
            self._finish(execution, ExecutionStatus.FAILED, at)
        finally:
            try:
                problem = self._cleanup(workspace)
            except OSError as exc:
                problem = f"workspace cleanup failed: {type(exc).__name__}"
            for issue in filter(None, [problem, result.cleanup_error if result else None]):
                # FR-EXE-004: a stop/cleanup problem is recorded separately, never hidden.
                execution.logs = [*execution.logs, _system_log("SECURITY", f"Cleanup incident: {issue}")]
            self.db.commit()
        return execution

    def _record(self, execution: Execution, run: GenerationRun, result: LaunchResult, *, host_paths: list[str]) -> None:
        at = utcnow()
        policy = self.launcher.policy
        execution.duration_ms = result.duration_ms
        execution.logs = [
            *execution.logs,
            *sanitize_logs(result.stdout, result.stderr, host_paths=host_paths, limit_bytes=policy.log_limit_bytes),
        ]
        collected = list((run.validation or {}).get("collected_tests") or [])
        if result.cancelled:
            execution.logs = [*execution.logs, _system_log("WARN", "Sandbox stopped after cancel request")]
            self._finish(execution, ExecutionStatus.CANCELLED, at)
            return
        if result.timed_out:
            # No valid pass/fail, coverage or mutation data from a stopped run (FR-EXE-004).
            execution.cases = [
                {"id": f"case-{i + 1}", "name": name, "status": CaseStatus.TIMEOUT.value,
                 "duration_ms": None, "traceback": None}
                for i, name in enumerate(collected)
            ]
            execution.timeout_cases = len(collected)
            execution.error_info = _error("runner", "RUNNER_TIMEOUT",
                                          f"Suite exceeded {policy.timeout_seconds} seconds", at)
            self._finish(execution, ExecutionStatus.TIMEOUT, at)
            return
        if result.exit_code == RUNNER_DISABLED_EXIT_CODE:
            execution.error_info = _error("sandbox", "SANDBOX_DISABLED",
                                          "Sandbox runner is fail-closed pending the security review", at)
            self._finish(execution, ExecutionStatus.BLOCKED, at)
            return
        junit = extract_junit(result.stdout)
        if junit is None:
            execution.error_info = _error("runner", "RUNNER_ERROR",
                                          f"Runner exited {result.exit_code} without structured results", at)
            self._finish(execution, ExecutionStatus.FAILED, at)
            return
        try:
            suite = parse_junit_xml(junit)
        except JUnitError as exc:
            execution.error_info = _error("runner", "RUNNER_ERROR", str(exc), at)
            self._finish(execution, ExecutionStatus.FAILED, at)
            return
        reconcile_with_collected(suite, collected)
        counts = suite.counts()
        execution.cases = suite.cases
        execution.total_cases = len(suite.cases)
        execution.passed_cases = counts["PASSED"]
        execution.failed_cases = counts["FAILED"]
        execution.error_cases = counts["ERROR"]
        execution.skipped_cases = counts["SKIPPED"]
        if suite.problem:
            execution.logs = [*execution.logs, _system_log("WARN", suite.problem)]
        if result.exit_code in (0, 1):
            self._finish(execution, ExecutionStatus.COMPLETED, at)
        elif result.exit_code == PYTEST_EXIT_NO_TESTS:
            execution.error_info = _error("runner", "NO_TESTS_COLLECTED", "pytest collected no tests", at)
            self._finish(execution, ExecutionStatus.FAILED, at)
        else:
            execution.error_info = _error("runner", "RUNNER_ERROR", f"pytest exited {result.exit_code}", at)
            self._finish(execution, ExecutionStatus.FAILED, at)
