from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import Settings, get_settings
from app.core.exceptions import AppError, ErrorCode
from app.core.logging import redact_secrets
from app.core.security import CredentialVault, get_credential_vault
from app.infrastructure.llm import (
    GenerationParameters,
    LLMRequest,
    ProviderId,
    ProviderRegistry,
)
from app.modules.ai_config.repository import AIConfigRepository
from app.modules.ai_config.service import AIConfigService
from app.modules.audit.service import AuditAction, AuditService
from app.modules.experiments.models import ExperimentSnapshot
from app.modules.generation.models import (
    ACTIVE_JOB_STATUSES,
    TERMINAL_JOB_STATUSES,
    TERMINAL_RUN_STATUSES,
    GenerationJob,
    GenerationJobStatus,
    GenerationRun,
    GenerationRunStatus,
)
from app.modules.generation.repository import GenerationRepository
from app.modules.generation.schemas import (
    ApprovedSnapshotOption,
    GenerationDashboardOutput,
    GenerationErrorOutput,
    GenerationJobOutput,
    GenerationLaunchOutput,
    GenerationRunOutput,
    GenerationStartInput,
)
from app.modules.projects.models import Project
from app.modules.projects.repository import ProjectRepository
from app.modules.prompts.models import StrategyCode
from app.modules.prompts.renderer import SafePromptRenderer, normalize_newlines

_TRANSIENT_HTTP_RE = re.compile(r"\bHTTP\s+(429|502|503|504)\b")


class TransientGenerationError(Exception):
    """Raised when a run hits a retryable transient upstream provider error."""


def _iso_utc(dt: datetime) -> str:
    return dt.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")


def _build_sanitized_error(
    *,
    stage: str,
    code: str,
    message: str,
    occurred_at: datetime,
    extra_secrets: Sequence[str] = (),
) -> dict[str, str]:
    return {
        "stage": redact_secrets(stage, extra_secrets=extra_secrets),
        "code": redact_secrets(code, extra_secrets=extra_secrets),
        "message": redact_secrets(message, extra_secrets=extra_secrets),
        "occurred_at": _iso_utc(occurred_at),
    }


class GenerationService:
    def __init__(
        self,
        db: Session,
        vault: CredentialVault | None = None,
        enqueue_fn: Callable[[uuid.UUID], str | None] | None = None,
    ) -> None:
        self.db = db
        self.vault = vault
        self.enqueue_fn = enqueue_fn
        self.repo = GenerationRepository(db)
        self.projects = ProjectRepository(db)
        self.ai_repo = AIConfigRepository(db)
        self.ai_service = AIConfigService(db, vault=vault)
        self.audit = AuditService(db)

    def _require_project(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> Project:
        project = self.projects.get(owner_id, project_id)
        if project is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found")
        return project

    @staticmethod
    def _to_job_output(job: GenerationJob) -> GenerationJobOutput:
        return GenerationJobOutput(
            id=job.id,
            project_id=job.project_id,
            snapshot_id=job.snapshot_id,
            request_id=job.request_id,
            status=GenerationJobStatus(job.status),
            celery_task_id=job.celery_task_id,
            cancel_reason=job.cancel_reason,
            cancelled_at=job.cancelled_at,
            created_at=job.created_at,
            updated_at=job.updated_at,
        )

    @staticmethod
    def _to_run_output(run: GenerationRun) -> GenerationRunOutput:
        err: GenerationErrorOutput | None = None
        if isinstance(run.error_info, dict):
            err = GenerationErrorOutput(
                stage=redact_secrets(str(run.error_info.get("stage", "provider"))),
                code=redact_secrets(str(run.error_info.get("code", "GENERATION_ERROR"))),
                message=redact_secrets(str(run.error_info.get("message", "Generation failed"))),
                occurred_at=str(run.error_info.get("occurred_at", _iso_utc(run.updated_at))),
            )
        return GenerationRunOutput(
            id=run.id,
            job_id=run.job_id,
            snapshot_id=run.snapshot_id,
            function_name=run.function_name,
            provider=ProviderId(run.provider),
            model=run.model,
            strategy=StrategyCode(run.strategy),
            repeat=run.repeat_index,
            status=GenerationRunStatus(run.status),
            attempt_count=run.attempt_count,
            artifact_sha256=run.artifact_sha256,
            error=err,
        )

    @staticmethod
    def _to_launch_output(
        job: GenerationJob, *, run_count: int, deduplicated: bool
    ) -> GenerationLaunchOutput:
        return GenerationLaunchOutput(
            job_id=job.id,
            project_id=job.project_id,
            snapshot_id=job.snapshot_id,
            request_id=job.request_id,
            status=GenerationJobStatus(job.status),
            run_count=run_count,
            deduplicated=deduplicated,
            created_at=job.created_at,
        )

    def get_dashboard(
        self, owner_id: uuid.UUID, project_id: uuid.UUID
    ) -> GenerationDashboardOutput:
        self._require_project(owner_id, project_id)
        configured_providers = {
            item.provider for item in self.ai_repo.list_by_project(project_id)
        }
        jobs = self.repo.list_project_jobs(project_id)
        active_snapshots = {
            job.snapshot_id for job in jobs if job.status in ACTIVE_JOB_STATUSES
        }

        approved_snapshots: list[ApprovedSnapshotOption] = []
        for snap, exp_name in self.repo.list_project_snapshots(project_id):
            if not snap.frozen_prompts or snap.run_count <= 0:
                continue
            needed_providers = {
                str(model_entry.get("provider", ""))
                for model_entry in snap.frozen_models
                if isinstance(model_entry, dict)
            }
            creds_ready = bool(needed_providers) and needed_providers.issubset(
                configured_providers
            )
            can_start = creds_ready and (snap.id not in active_snapshots)
            approved_snapshots.append(
                ApprovedSnapshotOption(
                    id=snap.id,
                    experiment_id=snap.experiment_id,
                    name=f"{exp_name} #{snap.snapshot_number}",
                    snapshot_number=snap.snapshot_number,
                    run_count=snap.run_count,
                    can_start=can_start,
                )
            )

        runs = self.repo.list_project_runs(project_id)
        return GenerationDashboardOutput(
            launch_enabled=True,
            approved_snapshots=approved_snapshots,
            jobs=[self._to_job_output(j) for j in jobs],
            runs=[self._to_run_output(r) for r in runs],
        )

    def start_generation(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        payload: GenerationStartInput,
    ) -> GenerationLaunchOutput:
        self._require_project(owner_id, project_id)
        clean_request_id = payload.request_id.strip()
        if not clean_request_id:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "request_id cannot be blank",
                {"request_id": "Must contain at least 1 non-whitespace character"},
            )

        existing = self.repo.get_job_by_request_id(project_id, clean_request_id)
        if existing is not None:
            if existing.snapshot_id != payload.snapshot_id:
                raise AppError(
                    ErrorCode.GENERATION_CONFLICT,
                    "request_id was already used for a different snapshot",
                    {"request_id": "Already bound to another snapshot_id"},
                )
            existing_runs = self.repo.list_job_runs(existing.id)
            return self._to_launch_output(
                existing, run_count=len(existing_runs), deduplicated=True
            )

        snapshot = self.repo.get_project_snapshot(project_id, payload.snapshot_id)
        if snapshot is None:
            raise AppError(ErrorCode.NOT_FOUND, "Experiment snapshot not found")

        planned_runs = self.repo.list_snapshot_runs(snapshot.id)
        if not planned_runs:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Snapshot contains no planned runs",
                {"snapshot_id": "Run count must be greater than zero"},
            )

        # Verify frozen prompt approval metadata exists for every planned strategy.
        for pr in planned_runs:
            if pr.strategy not in snapshot.frozen_prompts:
                raise AppError(
                    ErrorCode.PROMPT_NOT_APPROVED,
                    f"Snapshot lacks frozen approved prompt for {pr.strategy}",
                    {"strategy": pr.strategy},
                )

        # Verify encrypted provider credentials currently exist for all required providers.
        seen_providers: list[str] = []
        for model_item in snapshot.frozen_models:
            prov_name = str(model_item.get("provider", ""))
            if prov_name and prov_name not in seen_providers:
                seen_providers.append(prov_name)
        for pr in planned_runs:
            if pr.provider not in seen_providers:
                seen_providers.append(pr.provider)
        for prov_name in seen_providers:
            self.ai_service.get_credential_metadata(owner_id, project_id, prov_name)

        # Block concurrent launch of the same snapshot under a different request_id.
        active = self.repo.get_active_job_for_snapshot(snapshot.id)
        if active is not None:
            raise AppError(
                ErrorCode.GENERATION_CONFLICT,
                "Snapshot already has an active generation job",
                {"snapshot_id": "An active generation job is already queued or running"},
            )

        now = utcnow()
        job_id = uuid.uuid4()
        job = GenerationJob(
            id=job_id,
            project_id=project_id,
            snapshot_id=snapshot.id,
            request_id=clean_request_id,
            status=GenerationJobStatus.QUEUED.value,
            celery_task_id=None,
            cancel_reason=None,
            cancelled_at=None,
            created_at=now,
            updated_at=now,
        )
        run_rows = [
            GenerationRun(
                id=uuid.uuid4(),
                job_id=job_id,
                project_id=project_id,
                snapshot_id=snapshot.id,
                snapshot_run_id=pr.id,
                ordinal=pr.ordinal,
                function_name=pr.function_name,
                provider=pr.provider,
                model=pr.model,
                strategy=pr.strategy,
                repeat_index=pr.repeat_index,
                status=GenerationRunStatus.QUEUED.value,
                attempt_count=0,
                generated_code=None,
                artifact_relpath=None,
                artifact_sha256=None,
                prompt_tokens=None,
                completion_tokens=None,
                latency_ms=None,
                error_info=None,
                started_at=None,
                finished_at=None,
                created_at=now,
                updated_at=now,
            )
            for pr in planned_runs
        ]

        try:
            self.repo.add_job(job)
            self.db.flush()
            self.repo.add_runs(run_rows)
            self.audit.record(AuditAction.GENERATION_STARTED, owner_id)
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raced = self.repo.get_job_by_request_id(project_id, clean_request_id)
            if raced is not None:
                if raced.snapshot_id != payload.snapshot_id:
                    raise AppError(
                        ErrorCode.GENERATION_CONFLICT,
                        "request_id was already used for a different snapshot",
                        {"request_id": "Already bound to another snapshot_id"},
                    ) from None
                raced_runs = self.repo.list_job_runs(raced.id)
                return self._to_launch_output(
                    raced, run_count=len(raced_runs), deduplicated=True
                )
            raise

        if self.enqueue_fn is not None:
            task_id = self.enqueue_fn(job.id)
            self.db.expire_all()
            refreshed = self.repo.get_project_job(project_id, job.id)
            if refreshed is not None:
                if task_id and refreshed.celery_task_id is None:
                    refreshed.celery_task_id = str(task_id)
                    self.db.commit()
                    self.db.refresh(refreshed)
                return self._to_launch_output(
                    refreshed, run_count=len(run_rows), deduplicated=False
                )

        self.db.refresh(job)
        return self._to_launch_output(job, run_count=len(run_rows), deduplicated=False)

    def cancel_job(
        self,
        owner_id: uuid.UUID,
        project_id: uuid.UUID,
        job_id: uuid.UUID,
        reason: str | None = None,
    ) -> GenerationJobOutput:
        self._require_project(owner_id, project_id)
        job = self.repo.get_project_job(project_id, job_id)
        if job is None:
            raise AppError(ErrorCode.NOT_FOUND, "Generation job not found")
        if job.status in TERMINAL_JOB_STATUSES:
            raise AppError(
                ErrorCode.GENERATION_CONFLICT,
                f"Generation job is already in terminal state {job.status}",
                {"status": job.status},
            )

        now = utcnow()
        clean_reason = redact_secrets((reason or "").strip()) or "Cancelled by user"
        job.status = GenerationJobStatus.CANCELLED.value
        job.cancel_reason = clean_reason[:500]
        job.cancelled_at = now
        job.updated_at = now

        for run in self.repo.list_job_runs(job.id):
            if run.status == GenerationRunStatus.QUEUED.value:
                run.status = GenerationRunStatus.CANCELLED.value
                run.finished_at = now
                run.updated_at = now

        self.audit.record(AuditAction.GENERATION_CANCELLED, owner_id)
        self.db.commit()
        self.db.refresh(job)
        return self._to_job_output(job)


class GenerationExecutionService:
    """Idempotent worker execution service rendering frozen prompts and saving redacted artifacts."""

    def __init__(
        self,
        db: Session,
        vault: CredentialVault | None = None,
        registry: ProviderRegistry | None = None,
        settings: Settings | None = None,
        max_attempts: int = 3,
    ) -> None:
        self.db = db
        self.settings = settings or get_settings()
        self.vault = vault if vault is not None else get_credential_vault()
        self.registry = registry or ProviderRegistry.default(self.settings)
        self.max_attempts = max(1, max_attempts)
        self.repo = GenerationRepository(db)
        self.ai_service = AIConfigService(db, vault=self.vault)

    def _cancel_remaining_queued_runs(self, job_id: uuid.UUID) -> None:
        now = utcnow()
        for run in self.repo.list_job_runs(job_id):
            if run.status == GenerationRunStatus.QUEUED.value:
                run.status = GenerationRunStatus.CANCELLED.value
                run.finished_at = now
                run.updated_at = now

    def _render_frozen_prompt(
        self, snapshot: ExperimentSnapshot, run: GenerationRun
    ) -> tuple[str | None, str]:
        fn_by_name: dict[str, dict[str, Any]] = {
            str(fn["name"]): fn
            for fn in snapshot.frozen_functions
            if isinstance(fn, dict) and "name" in fn
        }
        fn_info = fn_by_name.get(run.function_name)
        if fn_info is None:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                f"Frozen function '{run.function_name}' missing from snapshot",
            )
        prompt_info = snapshot.frozen_prompts.get(run.strategy)
        if not isinstance(prompt_info, dict):
            raise AppError(
                ErrorCode.PROMPT_NOT_APPROVED,
                f"Frozen prompt strategy '{run.strategy}' missing from snapshot",
            )

        matching_cases = (
            [r for r in snapshot.frozen_rows if r.get("function_name") == run.function_name]
            if snapshot.frozen_rows is not None
            else []
        )
        render_ctx = {
            "function_name": str(fn_info["name"]),
            "function_signature": str(fn_info.get("signature") or ""),
            "function_code": str(fn_info.get("code") or ""),
            "module_code": snapshot.frozen_code,
            "docstring": str(fn_info.get("docstring") or ""),
            "csv_cases": json.dumps(
                matching_cases, sort_keys=True, separators=(",", ":"), ensure_ascii=False
            ),
        }
        rendered = SafePromptRenderer.render(
            strategy=run.strategy,
            version=int(prompt_info["version"]),
            template_sha256=str(prompt_info["sha256"]),
            system_template=prompt_info.get("system_template"),
            user_template=str(prompt_info["user_template"]),
            required_variables=list(prompt_info.get("required_variables") or []),
            context=render_ctx,
        )
        return rendered.rendered_system, rendered.rendered_user

    def _write_redacted_artifact(
        self,
        *,
        project_id: uuid.UUID,
        job_id: uuid.UUID,
        run_id: uuid.UUID,
        sanitized_code: str,
    ) -> tuple[str, str]:
        artifact_root = Path(self.settings.artifact_dir).resolve(strict=False)
        artifact_root.mkdir(parents=True, exist_ok=True)

        proj_dir = artifact_root / str(project_id)
        job_dir = proj_dir / str(job_id)
        target_file = job_dir / f"{run_id}.py"

        for candidate in (proj_dir, job_dir, target_file):
            if candidate.is_symlink():
                raise AppError(
                    ErrorCode.ACCESS_DENIED,
                    "Artifact path symlink traversal is forbidden",
                )

        resolved_target = target_file.resolve(strict=False)
        if not resolved_target.is_relative_to(artifact_root):
            raise AppError(
                ErrorCode.ACCESS_DENIED,
                "Artifact path escapes configured artifact root",
            )

        job_dir.mkdir(parents=True, exist_ok=True)
        for candidate in (proj_dir, job_dir, target_file):
            if candidate.is_symlink():
                raise AppError(
                    ErrorCode.ACCESS_DENIED,
                    "Artifact path symlink traversal is forbidden",
                )
        if not target_file.resolve(strict=False).is_relative_to(artifact_root):
            raise AppError(
                ErrorCode.ACCESS_DENIED,
                "Artifact path escapes configured artifact root",
            )

        normalized = normalize_newlines(sanitized_code)
        target_file.write_text(normalized, encoding="utf-8")
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        relpath = f"{project_id}/{job_id}/{run_id}.py"
        return relpath, digest

    @staticmethod
    def _classify_exception(exc: Exception) -> tuple[str, str, str]:
        """Return (classification, stage, error_code) where classification in {'timeout','transient','failed'}."""
        cause = exc.__cause__
        if isinstance(exc, (TimeoutError, httpx.TimeoutException)) or isinstance(
            cause, (TimeoutError, httpx.TimeoutException)
        ):
            return ("timeout", "provider", "PROVIDER_TIMEOUT")

        if isinstance(exc, AppError):
            if exc.code == ErrorCode.ACCESS_DENIED:
                return ("failed", "artifact", exc.code.value)
            if exc.code == ErrorCode.CREDENTIAL_MISSING:
                return ("failed", "credential", exc.code.value)
            if exc.code in (ErrorCode.PROMPT_NOT_APPROVED, ErrorCode.INPUT_INVALID):
                return ("failed", "prompt", exc.code.value)
            if exc.code == ErrorCode.SERVICE_UNAVAILABLE:
                return ("transient", "provider", exc.code.value)
            if exc.code == ErrorCode.PROVIDER_UPSTREAM_ERROR:
                if _TRANSIENT_HTTP_RE.search(exc.message) is not None:
                    return ("transient", "provider", exc.code.value)
                if isinstance(cause, httpx.TransportError):
                    return ("transient", "provider", exc.code.value)
                return ("failed", "provider", exc.code.value)
            return ("failed", "provider", exc.code.value)

        if isinstance(exc, httpx.TransportError):
            return ("transient", "provider", ErrorCode.PROVIDER_UPSTREAM_ERROR.value)

        return ("failed", "provider", "GENERATION_ERROR")

    def execute_job(self, job_id: uuid.UUID) -> GenerationJob:
        job = self.repo.get_job_by_id(job_id)
        if job is None:
            raise AppError(ErrorCode.NOT_FOUND, "Generation job not found")

        if job.status == GenerationJobStatus.COMPLETED.value:
            return job
        if job.status == GenerationJobStatus.CANCELLED.value:
            self._cancel_remaining_queued_runs(job.id)
            self.db.commit()
            self.db.refresh(job)
            return job

        project = self.db.scalar(select(Project).where(Project.id == job.project_id))
        if project is None:
            raise AppError(ErrorCode.NOT_FOUND, "Project not found for generation job")
        snapshot = self.repo.get_snapshot_by_id(job.snapshot_id)
        if snapshot is None:
            raise AppError(ErrorCode.NOT_FOUND, "Snapshot not found for generation job")

        params = GenerationParameters.model_validate(snapshot.frozen_parameters)
        job.status = GenerationJobStatus.RUNNING.value
        job.updated_at = utcnow()
        self.db.commit()

        runs = self.repo.list_job_runs(job.id)
        for run in runs:
            self.db.expire(job)
            self.db.expire(run)
            self.db.refresh(job)
            self.db.refresh(run)

            if job.status == GenerationJobStatus.CANCELLED.value:
                self._cancel_remaining_queued_runs(job.id)
                self.db.commit()
                self.db.refresh(job)
                return job

            if run.status in TERMINAL_RUN_STATUSES:
                continue

            started = utcnow()
            run.status = GenerationRunStatus.RUNNING.value
            run.attempt_count = run.attempt_count + 1
            if run.started_at is None:
                run.started_at = started
            run.updated_at = started
            self.db.commit()

            extra_secrets: list[str] = []
            try:
                system_prompt, user_prompt = self._render_frozen_prompt(snapshot, run)
                api_key = self.ai_service.resolve_api_key(
                    project.owner_id, job.project_id, run.provider
                )
                raw_secret = api_key.get_secret_value().strip()
                if raw_secret:
                    extra_secrets.append(raw_secret)

                adapter = self.registry.get(run.provider)
                llm_res = adapter.generate(
                    LLMRequest(
                        model=run.model,
                        user_prompt=user_prompt,
                        system_prompt=system_prompt,
                        parameters=params,
                    ),
                    api_key,
                )
                sanitized_code = redact_secrets(llm_res.content, extra_secrets=extra_secrets)
                relpath, artifact_sha = self._write_redacted_artifact(
                    project_id=job.project_id,
                    job_id=job.id,
                    run_id=run.id,
                    sanitized_code=sanitized_code,
                )

                done_at = utcnow()
                run.status = GenerationRunStatus.COMPLETED.value
                run.generated_code = sanitized_code
                run.artifact_relpath = relpath
                run.artifact_sha256 = artifact_sha
                run.prompt_tokens = llm_res.usage.prompt_tokens
                run.completion_tokens = llm_res.usage.completion_tokens
                run.latency_ms = llm_res.latency_ms
                run.error_info = None
                run.finished_at = done_at
                run.updated_at = done_at
                self.db.commit()

            except Exception as exc:
                err_at = utcnow()
                kind, stage, code = self._classify_exception(exc)
                raw_msg = exc.message if isinstance(exc, AppError) else str(exc)
                err_payload = _build_sanitized_error(
                    stage=stage,
                    code=code,
                    message=raw_msg or "Generation run failed",
                    occurred_at=err_at,
                    extra_secrets=extra_secrets,
                )

                if kind == "transient" and run.attempt_count < self.max_attempts:
                    run.status = GenerationRunStatus.QUEUED.value
                    run.error_info = err_payload
                    run.updated_at = err_at
                    self.db.expire(job)
                    self.db.refresh(job)
                    if job.status != GenerationJobStatus.CANCELLED.value:
                        job.status = GenerationJobStatus.QUEUED.value
                        job.updated_at = err_at
                    self.db.commit()
                    raise TransientGenerationError(err_payload["message"]) from None

                run.status = (
                    GenerationRunStatus.TIMEOUT.value
                    if kind == "timeout"
                    else GenerationRunStatus.FAILED.value
                )
                run.error_info = err_payload
                run.finished_at = err_at
                run.updated_at = err_at
                self.db.commit()

        self.db.expire(job)
        self.db.refresh(job)
        if job.status == GenerationJobStatus.CANCELLED.value:
            self._cancel_remaining_queued_runs(job.id)
            self.db.commit()
            self.db.refresh(job)
            return job

        final_runs = self.repo.list_job_runs(job.id)
        all_completed = all(
            r.status == GenerationRunStatus.COMPLETED.value for r in final_runs
        )
        job.status = (
            GenerationJobStatus.COMPLETED.value
            if all_completed
            else GenerationJobStatus.FAILED.value
        )
        job.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(job)
        return job
