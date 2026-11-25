from __future__ import annotations

import base64
import uuid
from pathlib import Path

import pytest
from pydantic import SecretStr
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.exceptions import AppError, ErrorCode
from app.core.security import CredentialVault
from app.infrastructure.database.base import Base
from app.infrastructure.llm import ProviderId
from app.infrastructure.llm.mock import MockLLMAdapter, MockSuccess
from app.modules.ai_config.schemas import ProviderCredentialInput
from app.modules.ai_config.service import AIConfigService
from app.modules.audit.models import AuditEvent
from app.modules.auth.models import User
from app.modules.experiments.schemas import (
    ExperimentConfigInput,
    ExperimentCreateInput,
    ModelTargetInput,
)
from app.modules.experiments.service import ExperimentService
from app.modules.generation.models import GenerationJob, GenerationJobStatus, GenerationRun
from app.modules.generation.schemas import GenerationStartInput
from app.modules.generation.service import GenerationExecutionService, GenerationService
from app.modules.projects.service import ProjectService
from app.modules.prompts.models import StrategyCode
from app.modules.prompts.schemas import PromptVersionInput
from app.modules.prompts.service import PromptRegistryService
from app.modules.sources.service import SourceService

TEST_KEY = base64.urlsafe_b64encode(b"g" * 32).decode()

SAMPLE_SOURCE = (
    "def clamp(val: int, lo: int, hi: int) -> int:\n"
    '    """Clamp integer value between bounds."""\n'
    "    return max(lo, min(val, hi))\n"
).encode("utf-8")


@pytest.fixture
def gen_unit_env(tmp_path: Path):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    vault = CredentialVault(f"k1:{TEST_KEY}")
    owner_id = uuid.uuid4()
    other_id = uuid.uuid4()

    with Session(engine) as db:
        db.add_all(
            [
                User(id=owner_id, email="owner@example.com", password_digest="unused"),
                User(id=other_id, email="other@example.com", password_digest="unused"),
            ]
        )
        db.commit()

        project_a = ProjectService(db).create(owner_id, "Project A", None)
        project_b = ProjectService(db).create(owner_id, "Project B", None)
        foreign_project = ProjectService(db).create(other_id, "Foreign Project", None)

        snapshots_a: list[uuid.UUID] = []
        for idx in (1, 2):
            src = SourceService(db).create(owner_id, project_a.id, SAMPLE_SOURCE)
            assert src is not None
            AIConfigService(db, vault=vault).upsert_credential(
                owner_id,
                project_a.id,
                "groq",
                ProviderCredentialInput(
                    api_key=SecretStr("gsk_unit_test_dummy_credential_123456"),
                    default_model="llama-3.3-70b-versatile",
                ),
            )
            prompts = PromptRegistryService(db)
            if idx == 1:
                v = prompts.create_version(
                    owner_id,
                    project_a.id,
                    StrategyCode.L1,
                    PromptVersionInput(
                        system_template="Test fixture system",
                        user_template="Write pytest for {function_name}:\n{function_code}",
                        notes="Non-official unit test template",
                    ),
                )
                prompts.approve_version(owner_id, project_a.id, StrategyCode.L1, v.version)
            exp = ExperimentService(db).create(
                owner_id,
                project_a.id,
                ExperimentCreateInput(
                    name=f"Exp A-{idx}",
                    config=ExperimentConfigInput(
                        source_id=src.source_id,
                        source_revision=src.revision,
                        function_names=["clamp"],
                        models=[
                            ModelTargetInput(provider=ProviderId.GROQ, model="llama-3.3-70b-versatile")
                        ],
                        strategies=[StrategyCode.L1],
                        repeats=2,
                    ),
                ),
            )
            snap = ExperimentService(db).freeze_snapshot(owner_id, project_a.id, exp.id)
            snapshots_a.append(snap.id)

        # Also prepare a snapshot in Project B for cross-project request_id isolation tests.
        src_b = SourceService(db).create(owner_id, project_b.id, SAMPLE_SOURCE)
        assert src_b is not None
        AIConfigService(db, vault=vault).upsert_credential(
            owner_id,
            project_b.id,
            "groq",
            ProviderCredentialInput(
                api_key=SecretStr("gsk_unit_test_project_b_cred_654321"),
                default_model="llama-3.3-70b-versatile",
            ),
        )
        prompts_b = PromptRegistryService(db)
        vb = prompts_b.create_version(
            owner_id,
            project_b.id,
            StrategyCode.L1,
            PromptVersionInput(
                user_template="Write pytest for {function_name}:\n{function_code}",
                notes="Non-official Project B template",
            ),
        )
        prompts_b.approve_version(owner_id, project_b.id, StrategyCode.L1, vb.version)
        exp_b = ExperimentService(db).create(
            owner_id,
            project_b.id,
            ExperimentCreateInput(
                name="Exp B-1",
                config=ExperimentConfigInput(
                    source_id=src_b.source_id,
                    source_revision=src_b.revision,
                    function_names=["clamp"],
                    models=[ModelTargetInput(provider=ProviderId.GROQ, model="llama-3.3-70b-versatile")],
                    strategies=[StrategyCode.L1],
                    repeats=1,
                ),
            ),
        )
        snap_b = ExperimentService(db).freeze_snapshot(owner_id, project_b.id, exp_b.id)

        project_a_id = project_a.id
        project_b_id = project_b.id
        foreign_project_id = foreign_project.id
        snap_b_id = snap_b.id

    return {
        "engine": engine,
        "vault": vault,
        "owner_id": owner_id,
        "other_id": other_id,
        "project_a_id": project_a_id,
        "project_b_id": project_b_id,
        "foreign_project_id": foreign_project_id,
        "snap_a1_id": snapshots_a[0],
        "snap_a2_id": snapshots_a[1],
        "snap_b_id": snap_b_id,
        "artifact_dir": tmp_path / "artifacts",
    }


def test_duplicate_request_id_is_idempotent_and_conflicts_on_different_snapshot(
    gen_unit_env,
) -> None:
    enqueued: list[uuid.UUID] = []

    def fake_enqueue(job_id: uuid.UUID) -> str:
        enqueued.append(job_id)
        return f"celery-{len(enqueued)}"

    with Session(gen_unit_env["engine"]) as db:
        svc = GenerationService(db, vault=gen_unit_env["vault"], enqueue_fn=fake_enqueue)
        first = svc.start_generation(
            gen_unit_env["owner_id"],
            gen_unit_env["project_a_id"],
            GenerationStartInput(snapshot_id=gen_unit_env["snap_a1_id"], request_id="req-idem-001"),
        )
        assert first.deduplicated is False
        assert first.status == GenerationJobStatus.QUEUED
        assert first.run_count == 2

        # Exact duplicate request_id + snapshot_id returns original job_id without re-enqueuing.
        second = svc.start_generation(
            gen_unit_env["owner_id"],
            gen_unit_env["project_a_id"],
            GenerationStartInput(snapshot_id=gen_unit_env["snap_a1_id"], request_id="req-idem-001"),
        )
        assert second.deduplicated is True
        assert second.job_id == first.job_id
        assert len(enqueued) == 1

        jobs = list(
            db.scalars(
                select(GenerationJob).where(
                    GenerationJob.project_id == gen_unit_env["project_a_id"]
                )
            )
        )
        runs = list(db.scalars(select(GenerationRun).where(GenerationRun.job_id == first.job_id)))
        started_audits = list(
            db.scalars(
                select(AuditEvent).where(
                    AuditEvent.user_id == gen_unit_env["owner_id"],
                    AuditEvent.action == "generation.started",
                )
            )
        )
        assert len(jobs) == 1
        assert len(runs) == 2
        assert len(started_audits) == 1

        # Reusing the same request_id for a DIFFERENT snapshot_id raises 409 GENERATION_CONFLICT.
        with pytest.raises(AppError) as conflict_exc:
            svc.start_generation(
                gen_unit_env["owner_id"],
                gen_unit_env["project_a_id"],
                GenerationStartInput(
                    snapshot_id=gen_unit_env["snap_a2_id"], request_id="req-idem-001"
                ),
            )
        assert conflict_exc.value.code == ErrorCode.GENERATION_CONFLICT

        # Same request_id string in Project B is isolated and allowed.
        other_proj_launch = svc.start_generation(
            gen_unit_env["owner_id"],
            gen_unit_env["project_b_id"],
            GenerationStartInput(snapshot_id=gen_unit_env["snap_b_id"], request_id="req-idem-001"),
        )
        assert other_proj_launch.deduplicated is False
        assert other_proj_launch.job_id != first.job_id


def test_active_snapshot_lock_and_relaunch_after_terminal_state(gen_unit_env) -> None:
    enqueued: list[uuid.UUID] = []

    with Session(gen_unit_env["engine"]) as db:
        svc = GenerationService(
            db,
            vault=gen_unit_env["vault"],
            enqueue_fn=lambda jid: (enqueued.append(jid) or "task-1"),
        )
        first = svc.start_generation(
            gen_unit_env["owner_id"],
            gen_unit_env["project_a_id"],
            GenerationStartInput(snapshot_id=gen_unit_env["snap_a1_id"], request_id="req-lock-1"),
        )

        # Different request_id targeting an already QUEUED snapshot fails with 409 GENERATION_CONFLICT.
        with pytest.raises(AppError) as active_exc:
            svc.start_generation(
                gen_unit_env["owner_id"],
                gen_unit_env["project_a_id"],
                GenerationStartInput(
                    snapshot_id=gen_unit_env["snap_a1_id"], request_id="req-lock-2"
                ),
            )
        assert active_exc.value.code == ErrorCode.GENERATION_CONFLICT

        # Cancel the active job -> reaches terminal CANCELLED state -> relaunch with new request_id succeeds.
        cancelled = svc.cancel_job(
            gen_unit_env["owner_id"], gen_unit_env["project_a_id"], first.job_id, "Reset test"
        )
        assert cancelled.status == GenerationJobStatus.CANCELLED

        relaunched = svc.start_generation(
            gen_unit_env["owner_id"],
            gen_unit_env["project_a_id"],
            GenerationStartInput(snapshot_id=gen_unit_env["snap_a1_id"], request_id="req-lock-2"),
        )
        assert relaunched.job_id != first.job_id
        assert relaunched.status == GenerationJobStatus.QUEUED


def test_missing_credential_and_ownership_guards_and_symlink_artifact_defense(
    gen_unit_env, tmp_path: Path
) -> None:
    with Session(gen_unit_env["engine"]) as db:
        svc = GenerationService(db, vault=gen_unit_env["vault"], enqueue_fn=lambda _: "task-x")

        # Non-owner gets 404 NOT_FOUND.
        with pytest.raises(AppError) as owner_exc:
            svc.start_generation(
                gen_unit_env["other_id"],
                gen_unit_env["project_a_id"],
                GenerationStartInput(snapshot_id=gen_unit_env["snap_a1_id"], request_id="req-x"),
            )
        assert owner_exc.value.code == ErrorCode.NOT_FOUND

        # Snapshot belonging to Project B passed to Project A gets 404 NOT_FOUND.
        with pytest.raises(AppError) as cross_snap_exc:
            svc.start_generation(
                gen_unit_env["owner_id"],
                gen_unit_env["project_a_id"],
                GenerationStartInput(snapshot_id=gen_unit_env["snap_b_id"], request_id="req-cross"),
            )
        assert cross_snap_exc.value.code == ErrorCode.NOT_FOUND

        # Delete Groq credential -> launch fails with 409 CREDENTIAL_MISSING.
        AIConfigService(db, vault=gen_unit_env["vault"]).delete_credential(
            gen_unit_env["owner_id"], gen_unit_env["project_a_id"], "groq"
        )
        with pytest.raises(AppError) as cred_exc:
            svc.start_generation(
                gen_unit_env["owner_id"],
                gen_unit_env["project_a_id"],
                GenerationStartInput(
                    snapshot_id=gen_unit_env["snap_a1_id"], request_id="req-no-cred"
                ),
            )
        assert cred_exc.value.code == ErrorCode.CREDENTIAL_MISSING

        # Symlink inside Project B's artifact directory is blocked by GenerationExecutionService.
        launch_b = svc.start_generation(
            gen_unit_env["owner_id"],
            gen_unit_env["project_b_id"],
            GenerationStartInput(snapshot_id=gen_unit_env["snap_b_id"], request_id="req-symlink"),
        )
        artifact_root = gen_unit_env["artifact_dir"]
        artifact_root.mkdir(parents=True, exist_ok=True)
        outside_dir = tmp_path / "outside_escape"
        outside_dir.mkdir(parents=True, exist_ok=True)
        (artifact_root / str(gen_unit_env["project_b_id"])).symlink_to(
            outside_dir, target_is_directory=True
        )

        mock_adapter = MockLLMAdapter(ProviderId.GROQ, steps=[MockSuccess()])
        exec_svc = GenerationExecutionService(
            db,
            vault=gen_unit_env["vault"],
            registry=MockLLMAdapter.build_registry(mock_adapter),
            settings=Settings(artifact_dir=str(artifact_root)),
        )
        finished_job = exec_svc.execute_job(launch_b.job_id)
        assert finished_job.status == GenerationJobStatus.FAILED
        run_b = db.scalar(select(GenerationRun).where(GenerationRun.job_id == launch_b.job_id))
        assert run_b is not None
        assert run_b.status == "FAILED"
        assert run_b.error_info is not None
        assert run_b.error_info["code"] == "ACCESS_DENIED"
        assert list(outside_dir.iterdir()) == []
