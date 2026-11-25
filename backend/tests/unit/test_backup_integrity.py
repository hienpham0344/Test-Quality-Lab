"""Unit tests for IntegrityService, orphan artifact cleanup, and BackupService export/restore."""

from __future__ import annotations

import copy
import hashlib
import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ErrorCode
from app.core.security import CredentialVault
from app.infrastructure.llm import GenerationParameters, ProviderId
from app.modules.ai_config.schemas import ProviderCredentialInput
from app.modules.ai_config.service import AIConfigService
from app.modules.audit.backup import BackupService
from app.modules.audit.integrity import IntegrityService
from app.modules.audit.models import AuditEvent
from app.modules.datasets.service import DatasetService
from app.modules.experiments.schemas import (
    ExperimentConfigInput,
    ExperimentCreateInput,
    ModelTargetInput,
)
from app.modules.experiments.service import ExperimentService
from app.modules.projects.service import ProjectService
from app.modules.prompts.models import StrategyCode
from app.modules.prompts.schemas import PromptVersionInput
from app.modules.prompts.service import PromptRegistryService
from app.modules.reporting.schemas import ReportRunCreateInput
from app.modules.reporting.service import ReportingService
from app.modules.sources.service import SourceService


def _make_vault() -> CredentialVault:
    key = Fernet.generate_key().decode("ascii")
    return CredentialVault(f"k1:{key}")


def _seed_full_project(db: Session, owner_id: uuid.UUID, artifact_dir: Path) -> dict[str, Any]:
    projects = ProjectService(db)
    project = projects.create(
        owner_id,
        "Integrity & Backup Lab",
        "Initial description with token gsk_abcdefghijklmnop123456",
    )
    projects.patch(
        owner_id,
        project.id,
        {"description": "Updated description Authorization: Bearer superSecretJwt987654321"},
    )

    vault = _make_vault()
    ai_svc = AIConfigService(db, vault)
    ai_svc.upsert_credential(
        owner_id,
        project.id,
        "groq",
        ProviderCredentialInput(
            api_key=SecretStr("gsk_realProviderSecretKey999999999"),
            default_model="llama-3.3-70b-versatile",
            default_params=GenerationParameters(),
        ),
    )

    src_svc = SourceService(db)
    src_ver = src_svc.create(
        owner_id,
        project.id,
        b"def clamp(x: int, lo: int, hi: int) -> int:\n    return max(lo, min(x, hi))\n",
    )
    assert src_ver is not None

    ds_svc = DatasetService(db)
    ds_ver = ds_svc.create(
        owner_id,
        project.id,
        [
            {
                "row_number": 2,
                "task_id": "T-1",
                "function_name": "clamp",
                "input_data": '{"x": 5, "lo": 0, "hi": 10}',
                "expected_output": "5",
            }
        ],
    )
    assert ds_ver is not None
    ds_linked = ds_svc.link_reference(owner_id, project.id, ds_ver.dataset_id, src_ver.source_id, 1)
    assert ds_linked is not None
    ds_selected = ds_svc.select(owner_id, project.id, ds_ver.dataset_id, [2])
    assert ds_selected is not None

    prompt_svc = PromptRegistryService(db)
    pv = prompt_svc.create_version(
        owner_id,
        project.id,
        StrategyCode.L1,
        PromptVersionInput(
            system_template="Test template note (non-official TBD-04 example).",
            user_template="Write unit tests for {function_name}:\n{function_code}",
            notes="Reviewer note sk-abcdefghijklmnop123456",
        ),
    )
    prompt_svc.approve_version(owner_id, project.id, StrategyCode.L1, pv.version)

    exp_svc = ExperimentService(db)
    exp = exp_svc.create(
        owner_id,
        project.id,
        ExperimentCreateInput(
            name="Clamp Benchmark",
            description="Experiment note AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234",
            config=ExperimentConfigInput(
                source_id=src_ver.source_id,
                source_revision=src_ver.revision,
                function_names=["clamp"],
                dataset_id=ds_selected.dataset_id,
                dataset_revision=ds_selected.revision,
                selected_rows=[2],
                models=[ModelTargetInput(provider=ProviderId.GROQ, model="llama-3.3-70b-versatile")],
                strategies=[StrategyCode.L1],
                parameters=GenerationParameters(),
                repeats=1,
            ),
        ),
    )
    snap = exp_svc.freeze_snapshot(owner_id, project.id, exp.id)

    artifact_bytes = b"def test_clamp():\n    assert clamp(5, 0, 10) == 5\n"
    artifact_sha = hashlib.sha256(artifact_bytes).hexdigest()
    relpath = f"{project.id}/runs/run-valid.py"
    artifact_file = artifact_dir / relpath
    artifact_file.parent.mkdir(parents=True, exist_ok=True)
    artifact_file.write_bytes(artifact_bytes)

    reporting = ReportingService(db, artifact_dir=str(artifact_dir))
    run_record = reporting.record_run_result(
        owner_id,
        project.id,
        ReportRunCreateInput(
            snapshot_id=snap.id,
            snapshot_sha256=snap.snapshot_sha256,
            source_id=src_ver.source_id,
            source_name="clamp.py",
            source_sha256=src_ver.sha256,
            dataset_id=ds_selected.dataset_id,
            dataset_name="clamp_cases.csv",
            dataset_sha256=ds_selected.sha256,
            suite_name="Clamp Suite #1",
            function_name="clamp",
            provider="groq",
            model="llama-3.3-70b-versatile",
            strategy="L1",
            prompt_version=pv.version,
            prompt_sha256=pv.sha256,
            repeat_index=1,
            status="COMPLETED",
            duration_ms=420,
            total_cases=1,
            completed_cases=1,
            passed_cases=1,
            failed_cases=0,
            timeout_cases=0,
            syntax_validity_state="MEASURED",
            syntax_validity_value=100.0,
            line_coverage_state="MEASURED",
            line_coverage_value=0.0,
            mutation_score_state="N/A",
            mutation_score_value=None,
            assertion_quality_state="MEASURED",
            assertion_quality_value=100.0,
            artifact_relpath=relpath,
            artifact_sha256=artifact_sha,
        ),
    )

    return {
        "project": project,
        "source_version": src_ver,
        "dataset_version": ds_selected,
        "prompt_version": pv,
        "snapshot": snap,
        "run_record": run_record,
        "artifact_file": artifact_file,
    }


class TestIntegrityService:
    def test_verify_project_integrity_detects_clean_and_tampered_records(
        self, db: Session, auth: Any, tmp_path: Path
    ) -> None:
        user = auth.register_verified("owner@example.com")
        other = auth.register_verified("stranger@example.com")
        artifact_dir = tmp_path / "artifacts"
        seeded = _seed_full_project(db, user.id, artifact_dir)
        project_id = seeded["project"].id

        integrity = IntegrityService(db)
        with pytest.raises(AppError) as denied:
            integrity.verify_project_integrity(other.id, project_id, str(artifact_dir))
        assert denied.value.code == ErrorCode.NOT_FOUND

        clean = integrity.verify_project_integrity(user.id, project_id, str(artifact_dir))
        assert clean.ok is True
        assert clean.checked_records >= 4
        assert clean.checked_artifacts == 1
        assert clean.violations == []

        # Tamper on-disk artifact content
        seeded["artifact_file"].write_bytes(b"def test_clamp():\n    assert False\n")
        tampered_art = integrity.verify_project_integrity(user.id, project_id, str(artifact_dir))
        assert tampered_art.ok is False
        assert any(v["kind"] == "artifact_hash_mismatch" for v in tampered_art.violations)

        # Restore file, then tamper SourceVersion, DatasetVersion, PromptVersion, ExperimentSnapshot via SQL
        seeded["artifact_file"].write_bytes(b"def test_clamp():\n    assert clamp(5, 0, 10) == 5\n")
        db.execute(
            text("UPDATE source_versions SET code = :code WHERE id = :id"),
            {"code": "def clamp(x): return 0\n", "id": seeded["source_version"].id.hex},
        )
        db.execute(
            text("UPDATE dataset_versions SET sha256 = :sha WHERE id = :id"),
            {"sha": "0" * 64, "id": seeded["dataset_version"].id.hex},
        )
        db.execute(
            text("UPDATE prompt_versions SET user_template = :tpl WHERE id = :id"),
            {"tpl": "Tampered {function_name}", "id": seeded["prompt_version"].id.hex},
        )
        db.execute(
            text("UPDATE experiment_snapshots SET frozen_code = :code WHERE id = :id"),
            {"code": "def tampered(): pass\n", "id": seeded["snapshot"].id.hex},
        )
        db.commit()
        db.expire_all()

        multi_tampered = integrity.verify_project_integrity(user.id, project_id, str(artifact_dir))
        assert multi_tampered.ok is False
        entities = {v["entity"] for v in multi_tampered.violations}
        assert {
            "source_version",
            "dataset_version",
            "prompt_version",
            "experiment_snapshot",
        } <= entities

    def test_cleanup_orphan_artifacts_supports_dry_run_and_blocks_symlinks(
        self, db: Session, auth: Any, tmp_path: Path
    ) -> None:
        user = auth.register_verified("cleanup@example.com")
        artifact_dir = tmp_path / "artifacts"
        seeded = _seed_full_project(db, user.id, artifact_dir)
        project_id = seeded["project"].id

        orphan = artifact_dir / str(project_id) / "runs" / "orphan-stale.py"
        orphan.write_text("# stale orphan\n", encoding="utf-8")

        integrity = IntegrityService(db)
        preview = integrity.cleanup_orphan_artifacts(
            user.id, project_id, str(artifact_dir), dry_run=True
        )
        assert preview.dry_run is True
        assert preview.deleted_count == 0
        assert len(preview.orphan_files) == 1
        assert orphan.exists()
        assert seeded["artifact_file"].exists()

        executed = integrity.cleanup_orphan_artifacts(
            user.id, project_id, str(artifact_dir), dry_run=False
        )
        assert executed.dry_run is False
        assert executed.deleted_count == 1
        assert not orphan.exists()
        assert seeded["artifact_file"].exists()

        events = list(
            db.scalars(select(AuditEvent).where(AuditEvent.action == "system.artifact_cleanup"))
        )
        assert len(events) == 1

        # Symlink inside project artifact dir must fail closed with ACCESS_DENIED
        outside = tmp_path / "outside_important.txt"
        outside.write_text("important", encoding="utf-8")
        bad_link = artifact_dir / str(project_id) / "runs" / "evil_symlink.py"
        bad_link.symlink_to(outside)

        with pytest.raises(AppError) as sym_exc:
            integrity.cleanup_orphan_artifacts(
                user.id, project_id, str(artifact_dir), dry_run=False
            )
        assert sym_exc.value.code == ErrorCode.ACCESS_DENIED
        assert outside.exists()


class TestBackupService:
    def test_export_omits_credentials_redacts_secrets_and_verifies_restore_hashes(
        self, db: Session, auth: Any, tmp_path: Path
    ) -> None:
        user = auth.register_verified("backup-owner@example.com")
        artifact_dir = tmp_path / "artifacts"
        seeded = _seed_full_project(db, user.id, artifact_dir)
        project_id = seeded["project"].id

        backup_svc = BackupService(db)
        bundle = backup_svc.export_project_backup(user.id, project_id, str(artifact_dir))

        assert bundle["schema_version"] == "1.0"
        assert set(bundle.keys()) >= {
            "schema_version",
            "project",
            "project_history",
            "sources",
            "datasets",
            "prompts",
            "experiments",
            "snapshots",
            "artifact_checksums",
            "bundle_sha256",
        }
        assert "provider_credentials" not in bundle

        serialized = json.dumps(bundle)
        assert "gsk_realProviderSecretKey999999999" not in serialized
        assert "gsk_abcdefghijklmnop123456" not in serialized
        assert "superSecretJwt987654321" not in serialized
        assert "sk-abcdefghijklmnop123456" not in serialized
        assert "AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234" not in serialized
        assert "encrypted_secret" not in serialized
        assert "[REDACTED]" in serialized

        # 1. Tamper bundle_sha256 -> 422 INPUT_INVALID
        bad_bundle_hash = copy.deepcopy(bundle)
        bad_bundle_hash["bundle_sha256"] = "f" * 64
        with pytest.raises(AppError) as err1:
            backup_svc.restore_project_backup(user.id, bad_bundle_hash)
        assert err1.value.code == ErrorCode.INPUT_INVALID

        # 2. Tamper embedded source code AND recompute outer bundle_sha256 -> still 422 INPUT_INVALID!
        bad_source = copy.deepcopy(bundle)
        bad_source["sources"][0]["versions"][0]["code"] = "def clamp(x: int) -> int:\n    return -999\n"
        payload_no_sha = {k: v for k, v in bad_source.items() if k != "bundle_sha256"}
        bad_source["bundle_sha256"] = hashlib.sha256(
            json.dumps(payload_no_sha, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        with pytest.raises(AppError) as err2:
            backup_svc.restore_project_backup(user.id, bad_source)
        assert err2.value.code == ErrorCode.INPUT_INVALID

        # 3. Tamper embedded prompt user_template AND recompute outer bundle_sha256 -> still 422 INPUT_INVALID!
        bad_prompt = copy.deepcopy(bundle)
        bad_prompt["prompts"][0]["versions"][0]["user_template"] = "Injected template {function_name}"
        payload_no_sha2 = {k: v for k, v in bad_prompt.items() if k != "bundle_sha256"}
        bad_prompt["bundle_sha256"] = hashlib.sha256(
            json.dumps(payload_no_sha2, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        with pytest.raises(AppError) as err3:
            backup_svc.restore_project_backup(user.id, bad_prompt)
        assert err3.value.code == ErrorCode.INPUT_INVALID

        # 4. Valid restore into a new owned project in the same database
        restored = backup_svc.restore_project_backup(user.id, bundle)
        assert restored.project_id != project_id
        assert restored.restored_sources == 1
        assert restored.restored_datasets == 1
        assert restored.restored_prompts >= 1
        assert restored.restored_experiments == 1
        assert restored.restored_snapshots == 1

        # Restored project passes full integrity verification
        check = IntegrityService(db).verify_project_integrity(
            user.id, restored.project_id, str(artifact_dir)
        )
        assert check.ok is True

        actions = [
            ev.action
            for ev in db.scalars(select(AuditEvent).where(AuditEvent.user_id == user.id))
        ]
        assert "system.backup_exported" in actions
        assert "system.backup_restored" in actions
