"""Integration tests for Sprint 7 Reporting, CSV Export, Result Deletion, Audit Events, Integrity & Backup APIs."""

from __future__ import annotations

import copy
import csv
import hashlib
import io
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.modules.audit.models import AuditEvent
from app.modules.reporting.schemas import ReportRunCreateInput
from app.modules.reporting.service import ReportingService
from tests.integration.conftest import Api, bearer


def _override_artifact_dir(artifact_dir: Path) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(artifact_dir=str(artifact_dir))


class TestReportsAndExportsApi:
    def test_summary_results_comparability_csv_exports_and_owner_isolation(
        self, api: Api, engine: Engine, tmp_path: Path
    ) -> None:
        artifact_dir = tmp_path / "artifacts"
        artifact_dir.mkdir(parents=True)
        _override_artifact_dir(artifact_dir)

        owner_tokens = api.register_and_login("reports-owner@example.com")
        other_tokens = api.register_and_login("reports-other@example.com")

        proj_res = api.client.post(
            "/api/v1/projects",
            headers=bearer(owner_tokens),
            json={"name": "Sprint 7 Reports Project", "description": "Analytics test"},
        )
        assert proj_res.status_code == 201
        project_id = uuid.UUID(proj_res.json()["id"])

        snap_id = uuid.uuid4()
        snap_sha = "a" * 64
        src_sha = "b" * 64
        ds_sha = "c" * 64
        prompt_sha_l1 = "d" * 64
        prompt_sha_l2 = "e" * 64

        with Session(engine) as db:
            owner_id = db.scalar(
                text("SELECT owner_id FROM projects WHERE id = :pid"),
                {"pid": project_id.hex},
            )
            owner_uuid = uuid.UUID(str(owner_id))
            svc = ReportingService(db, artifact_dir=str(artifact_dir))

            # Run 1: L1 COMPLETED with numeric 0.0 coverage and N/A mutation_score + formula suite_name + secret error note
            svc.record_run_result(
                owner_uuid,
                project_id,
                ReportRunCreateInput(
                    snapshot_id=snap_id,
                    snapshot_sha256=snap_sha,
                    source_name="target.py",
                    source_sha256=src_sha,
                    dataset_name="bench.csv",
                    dataset_sha256=ds_sha,
                    suite_name="=EvilFormulaSuite",
                    function_name="solve",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L1",
                    prompt_version=1,
                    prompt_sha256=prompt_sha_l1,
                    repeat_index=1,
                    status="COMPLETED",
                    duration_ms=250,
                    total_cases=4,
                    completed_cases=4,
                    passed_cases=0,
                    failed_cases=4,
                    timeout_cases=0,
                    syntax_validity_state="MEASURED",
                    syntax_validity_value=100.0,
                    line_coverage_state="MEASURED",
                    line_coverage_value=0.0,
                    mutation_score_state="N/A",
                    mutation_score_value=None,
                    assertion_quality_state="MEASURED",
                    assertion_quality_value=0.0,
                    error_message="Diagnostic gsk_abcdefghijklmnop123456 redacted",
                ),
            )

            # Run 2: L2 COMPLETED on identical source_sha256, dataset_sha256, and model -> COMPATIBLE!
            svc.record_run_result(
                owner_uuid,
                project_id,
                ReportRunCreateInput(
                    snapshot_id=snap_id,
                    snapshot_sha256=snap_sha,
                    source_name="target.py",
                    source_sha256=src_sha,
                    dataset_name="bench.csv",
                    dataset_sha256=ds_sha,
                    suite_name="CleanL2Suite",
                    function_name="solve",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L2",
                    prompt_version=1,
                    prompt_sha256=prompt_sha_l2,
                    repeat_index=1,
                    status="COMPLETED",
                    duration_ms=350,
                    total_cases=4,
                    completed_cases=4,
                    passed_cases=4,
                    failed_cases=0,
                    timeout_cases=0,
                    syntax_validity_state="MEASURED",
                    syntax_validity_value=100.0,
                    line_coverage_state="MEASURED",
                    line_coverage_value=80.0,
                    mutation_score_state="N/A",
                    mutation_score_value=None,
                    assertion_quality_state="MEASURED",
                    assertion_quality_value=90.0,
                ),
            )

        # Owner isolation: non-owner gets 404 across all report endpoints
        for path in (
            f"/api/v1/projects/{project_id}/reports/summary",
            f"/api/v1/projects/{project_id}/reports/results",
            f"/api/v1/projects/{project_id}/reports/exports/runs.csv",
            f"/api/v1/projects/{project_id}/reports/exports/strategy-comparison.csv",
        ):
            res_other = api.client.get(path, headers=bearer(other_tokens))
            assert res_other.status_code == 404

        # Summary check: COMPATIBLE, avg_coverage = 40.0, avg_mutation_score = "N/A", pass_rate = 50.0
        sum_res = api.client.get(
            f"/api/v1/projects/{project_id}/reports/summary",
            headers=bearer(owner_tokens),
        )
        assert sum_res.status_code == 200
        summary = sum_res.json()
        assert summary["total_runs"] == 2
        assert summary["progress_pct"] == 100.0
        assert summary["pass_rate"] == 50.0
        assert summary["avg_coverage"] == 40.0
        assert summary["avg_mutation_score"] == "N/A"
        assert summary["avg_assertion_quality"] == 45.0
        assert summary["comparability"]["status"] == "COMPATIBLE"

        # Filtering on GET /results: filter strategy=L1 -> numeric 0.0 preserved!
        res_l1 = api.client.get(
            f"/api/v1/projects/{project_id}/reports/results",
            params={"strategy": "L1", "search": "EvilFormula"},
            headers=bearer(owner_tokens),
        )
        assert res_l1.status_code == 200
        l1_body = res_l1.json()
        assert len(l1_body["runs"]) == 1
        assert l1_body["runs"][0]["metrics"]["coverage"] == 0.0
        assert l1_body["runs"][0]["metrics"]["mutation_score"] == "N/A"
        assert l1_body["runs"][0]["metrics"]["assertion_quality"] == 0.0

        # Add a TIMEOUT run on a different model -> transitions comparability to CAUTION
        with Session(engine) as db:
            svc = ReportingService(db, artifact_dir=str(artifact_dir))
            caution_run = svc.record_run_result(
                owner_uuid,
                project_id,
                ReportRunCreateInput(
                    snapshot_id=snap_id,
                    snapshot_sha256=snap_sha,
                    source_name="target.py",
                    source_sha256=src_sha,
                    dataset_name="bench.csv",
                    dataset_sha256=ds_sha,
                    suite_name="TimeoutSuite",
                    function_name="solve",
                    provider="gemini",
                    model="gemini-1.5-pro",
                    strategy="L3",
                    prompt_version=1,
                    prompt_sha256="1" * 64,
                    repeat_index=1,
                    status="TIMEOUT",
                    duration_ms=60000,
                    total_cases=4,
                    completed_cases=0,
                    passed_cases=0,
                    failed_cases=0,
                    timeout_cases=4,
                    syntax_validity_state="TIMEOUT",
                    line_coverage_state="TIMEOUT",
                    mutation_score_state="TIMEOUT",
                    assertion_quality_state="TIMEOUT",
                ),
            )
            caution_run_id = caution_run.id

        sum_caution = api.client.get(
            f"/api/v1/projects/{project_id}/reports/summary",
            headers=bearer(owner_tokens),
        ).json()
        assert sum_caution["comparability"]["status"] == "CAUTION"

        # Add a run with divergent source_sha256 -> transitions comparability to INCOMPARABLE
        with Session(engine) as db:
            svc = ReportingService(db, artifact_dir=str(artifact_dir))
            incomp_run = svc.record_run_result(
                owner_uuid,
                project_id,
                ReportRunCreateInput(
                    snapshot_id=snap_id,
                    snapshot_sha256=snap_sha,
                    source_name="target_v2.py",
                    source_sha256="9" * 64,
                    dataset_name="bench.csv",
                    dataset_sha256=ds_sha,
                    suite_name="+DivergentSuite",
                    function_name="solve",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L4",
                    prompt_version=2,
                    prompt_sha256="2" * 64,
                    repeat_index=1,
                    status="FAILED",
                    duration_ms=100,
                    total_cases=4,
                    completed_cases=0,
                    passed_cases=0,
                    failed_cases=4,
                    timeout_cases=0,
                    syntax_validity_state="FAILED",
                    line_coverage_state="FAILED",
                    mutation_score_state="FAILED",
                    assertion_quality_state="FAILED",
                ),
            )
            incomp_run_id = incomp_run.id

        sum_incomp = api.client.get(
            f"/api/v1/projects/{project_id}/reports/summary",
            headers=bearer(owner_tokens),
        ).json()
        assert sum_incomp["comparability"]["status"] == "INCOMPARABLE"

        # Export runs.csv & strategy-comparison.csv
        runs_csv_res = api.client.get(
            f"/api/v1/projects/{project_id}/reports/exports/runs.csv",
            headers=bearer(owner_tokens),
        )
        assert runs_csv_res.status_code == 200
        assert runs_csv_res.headers["content-type"].startswith("text/csv")
        assert "attachment" in runs_csv_res.headers["content-disposition"]
        raw_runs_csv = runs_csv_res.text
        assert "\r\n" in raw_runs_csv
        assert "gsk_abcdefghijklmnop123456" not in raw_runs_csv
        assert "[REDACTED]" in raw_runs_csv

        runs_rows = list(csv.DictReader(io.StringIO(raw_runs_csv)))
        required_provenance = {
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
        }
        assert required_provenance <= set(runs_rows[0].keys())
        by_strategy = {r["strategy"]: r for r in runs_rows}
        assert by_strategy["L1"]["suite_name"] == "'=EvilFormulaSuite"
        assert by_strategy["L1"]["line_coverage"] == "0.0"
        assert by_strategy["L1"]["mutation_score"] == "N/A"
        assert by_strategy["L3"]["line_coverage"] == "TIMEOUT"
        assert by_strategy["L4"]["line_coverage"] == "FAILED"
        assert by_strategy["L4"]["suite_name"] == "'+DivergentSuite"

        comp_csv_res = api.client.get(
            f"/api/v1/projects/{project_id}/reports/exports/strategy-comparison.csv",
            headers=bearer(owner_tokens),
        )
        assert comp_csv_res.status_code == 200
        assert comp_csv_res.headers["content-type"].startswith("text/csv")
        assert "attachment" in comp_csv_res.headers["content-disposition"]
        comp_rows = list(csv.DictReader(io.StringIO(comp_csv_res.text)))
        assert required_provenance <= set(comp_rows[0].keys())
        comp_by_strat = {r["strategy"]: r for r in comp_rows}
        assert comp_by_strat["L1"]["avg_coverage"] == "0.0"
        assert comp_by_strat["L1"]["avg_mutation_score"] == "N/A"
        assert comp_by_strat["L1"]["comparability_status"] == "INCOMPARABLE"

        # Delete the divergent and timeout runs -> recomputed summary returns to COMPATIBLE!
        del_incomp = api.client.delete(
            f"/api/v1/projects/{project_id}/reports/runs/{incomp_run_id}",
            headers=bearer(owner_tokens),
        )
        assert del_incomp.status_code == 200
        assert del_incomp.json()["total_runs"] == 3
        assert del_incomp.json()["comparability"]["status"] == "CAUTION"

        del_caution = api.client.delete(
            f"/api/v1/projects/{project_id}/reports/runs/{caution_run_id}",
            headers=bearer(owner_tokens),
        )
        assert del_caution.status_code == 200
        assert del_caution.json()["total_runs"] == 2
        assert del_caution.json()["comparability"]["status"] == "COMPATIBLE"

    def test_delete_run_removes_safe_artifact_and_blocks_traversal_or_symlink(
        self, api: Api, engine: Engine, tmp_path: Path
    ) -> None:
        artifact_dir = tmp_path / "artifacts"
        artifact_dir.mkdir(parents=True)
        _override_artifact_dir(artifact_dir)

        tokens = api.register_and_login("delete-sec@example.com")
        other_tokens = api.register_and_login("delete-other@example.com")
        proj = api.client.post(
            "/api/v1/projects",
            headers=bearer(tokens),
            json={"name": "Deletion Security", "description": None},
        ).json()
        project_id = uuid.UUID(proj["id"])

        safe_rel = f"{project_id}/job-1/safe_run.py"
        safe_file = artifact_dir / safe_rel
        safe_file.parent.mkdir(parents=True)
        safe_file.write_text("def test_safe(): assert True\n", encoding="utf-8")

        outside_target = tmp_path / "outside_keep.py"
        outside_target.write_text("sensitive", encoding="utf-8")
        symlink_rel = f"{project_id}/job-1/symlink_run.py"
        (artifact_dir / symlink_rel).symlink_to(outside_target)

        with Session(engine) as db:
            owner_uuid = uuid.UUID(
                str(
                    db.scalar(
                        text("SELECT owner_id FROM projects WHERE id = :pid"),
                        {"pid": project_id.hex},
                    )
                )
            )
            svc = ReportingService(db, artifact_dir=str(artifact_dir))
            safe_run = svc.record_run_result(
                owner_uuid,
                project_id,
                ReportRunCreateInput(
                    source_sha256="a" * 64,
                    suite_name="SafeRun",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L1",
                    status="COMPLETED",
                    artifact_relpath=safe_rel,
                    artifact_sha256=hashlib.sha256(safe_file.read_bytes()).hexdigest(),
                ),
            )
            traversal_run = svc.record_run_result(
                owner_uuid,
                project_id,
                ReportRunCreateInput(
                    source_sha256="a" * 64,
                    suite_name="TraversalRun",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L1",
                    status="COMPLETED",
                    artifact_relpath="../outside_keep.py",
                ),
            )
            symlink_run = svc.record_run_result(
                owner_uuid,
                project_id,
                ReportRunCreateInput(
                    source_sha256="a" * 64,
                    suite_name="SymlinkRun",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L1",
                    status="COMPLETED",
                    artifact_relpath=symlink_rel,
                ),
            )
            safe_id, traversal_id, symlink_id = safe_run.id, traversal_run.id, symlink_run.id

        # Non-owner gets 404
        assert (
            api.client.delete(
                f"/api/v1/projects/{project_id}/reports/runs/{safe_id}",
                headers=bearer(other_tokens),
            ).status_code
            == 404
        )

        # Safe deletion removes file and returns updated summary
        del_ok = api.client.delete(
            f"/api/v1/projects/{project_id}/reports/runs/{safe_id}",
            headers=bearer(tokens),
        )
        assert del_ok.status_code == 200
        assert not safe_file.exists()

        # Traversal & symlink runs fail closed with 403 ACCESS_DENIED
        del_trav = api.client.delete(
            f"/api/v1/projects/{project_id}/reports/runs/{traversal_id}",
            headers=bearer(tokens),
        )
        assert del_trav.status_code == 403
        assert del_trav.json()["detail"]["code"] == "ACCESS_DENIED"
        assert outside_target.exists()

        del_sym = api.client.delete(
            f"/api/v1/projects/{project_id}/reports/runs/{symlink_id}",
            headers=bearer(tokens),
        )
        assert del_sym.status_code == 403
        assert del_sym.json()["detail"]["code"] == "ACCESS_DENIED"
        assert outside_target.exists()


class TestAuditIntegrityAndBackupApi:
    def test_audit_events_owner_scoping_filters_and_pagination(
        self, api: Api, engine: Engine
    ) -> None:
        alice_tokens = api.register_and_login("alice-audit@example.com")
        bob_tokens = api.register_and_login("bob-audit@example.com")

        with Session(engine) as db:
            alice_id = uuid.UUID(
                str(db.scalar(text("SELECT id FROM users WHERE email = 'alice-audit@example.com'")))
            )
            bob_id = uuid.UUID(
                str(db.scalar(text("SELECT id FROM users WHERE email = 'bob-audit@example.com'")))
            )
            db.add_all(
                [
                    AuditEvent(
                        id=uuid.uuid4(),
                        user_id=alice_id,
                        action="system.backup_exported",
                        created_at=datetime(2026, 11, 10, 8, 30, 0),
                    ),
                    AuditEvent(
                        id=uuid.uuid4(),
                        user_id=alice_id,
                        action="report.result_deleted",
                        created_at=datetime(2026, 11, 15, 14, 0, 0),
                    ),
                    AuditEvent(
                        id=uuid.uuid4(),
                        user_id=bob_id,
                        action="system.backup_exported",
                        created_at=datetime(2026, 11, 15, 15, 0, 0),
                    ),
                    AuditEvent(
                        id=uuid.uuid4(),
                        user_id=None,
                        action="auth.login_failed",
                        created_at=datetime(2026, 11, 15, 16, 0, 0),
                    ),
                ]
            )
            db.commit()

        # Unauthenticated -> 401
        assert api.client.get("/api/v1/audit-events").status_code == 401

        # Alice sees ONLY her own events, newest first; Bob sees ONLY Bob's own events
        res_bob = api.client.get("/api/v1/audit-events", headers=bearer(bob_tokens))
        assert res_bob.status_code == 200
        assert all(ev["user_id"] == str(bob_id) for ev in res_bob.json())

        res_all = api.client.get("/api/v1/audit-events", headers=bearer(alice_tokens))
        assert res_all.status_code == 200
        events = res_all.json()
        assert len(events) >= 4  # registered, verified, login_succeeded, + 2 seeded
        assert all(ev["user_id"] == str(alice_id) for ev in events)
        timestamps = [ev["created_at"] for ev in events]
        assert timestamps == sorted(timestamps, reverse=True)

        # Action + YYYY-MM-DD date range filter
        res_filtered = api.client.get(
            "/api/v1/audit-events",
            params={
                "action": "report.result_deleted",
                "from": "2026-11-15",
                "to": "2026-11-15",
            },
            headers=bearer(alice_tokens),
        )
        assert res_filtered.status_code == 200
        assert len(res_filtered.json()) == 1
        assert res_filtered.json()[0]["action"] == "report.result_deleted"

        # Limit & offset pagination
        page1 = api.client.get(
            "/api/v1/audit-events",
            params={"limit": 2, "offset": 0},
            headers=bearer(alice_tokens),
        ).json()
        page2 = api.client.get(
            "/api/v1/audit-events",
            params={"limit": 2, "offset": 2},
            headers=bearer(alice_tokens),
        ).json()
        assert len(page1) == 2
        assert len(page2) == 2
        assert {e["id"] for e in page1}.isdisjoint({e["id"] for e in page2})

        # Inverted range -> 422 INPUT_INVALID
        bad_range = api.client.get(
            "/api/v1/audit-events",
            params={"from": "2026-11-20", "to": "2026-11-10"},
            headers=bearer(alice_tokens),
        )
        assert bad_range.status_code == 422
        assert bad_range.json()["detail"]["code"] == "INPUT_INVALID"

    def test_integrity_cleanup_and_backup_restore_http_endpoints(
        self, api: Api, tmp_path: Path
    ) -> None:
        artifact_dir = tmp_path / "artifacts"
        artifact_dir.mkdir(parents=True)
        _override_artifact_dir(artifact_dir)

        tokens = api.register_and_login("ops-admin@example.com")
        other_tokens = api.register_and_login("ops-stranger@example.com")

        proj = api.client.post(
            "/api/v1/projects",
            headers=bearer(tokens),
            json={"name": "Ops Backup Project", "description": "Key sk-abcdefghijklmnop123456"},
        ).json()
        project_id = proj["id"]

        src_res = api.client.post(
            f"/api/v1/projects/{project_id}/sources",
            headers={**bearer(tokens), "Content-Type": "text/x-python"},
            content=b"def double(n: int) -> int:\n    return n * 2\n",
        )
        assert src_res.status_code == 201

        pv_res = api.client.post(
            f"/api/v1/projects/{project_id}/prompts/L1/versions",
            headers=bearer(tokens),
            json={
                "system_template": "Non-official test template (TBD-04).",
                "user_template": "Generate tests for {function_name}:\n{function_code}",
                "notes": "Initial test prompt",
            },
        )
        assert pv_res.status_code == 201

        # Create an orphan file on disk and clean it up over HTTP
        orphan_path = artifact_dir / project_id / "orphan.py"
        orphan_path.parent.mkdir(parents=True, exist_ok=True)
        orphan_path.write_text("# orphan\n", encoding="utf-8")

        assert (
            api.client.get(
                f"/api/v1/projects/{project_id}/audit/integrity",
                headers=bearer(other_tokens),
            ).status_code
            == 404
        )

        integ_res = api.client.get(
            f"/api/v1/projects/{project_id}/audit/integrity",
            headers=bearer(tokens),
        )
        assert integ_res.status_code == 200
        assert integ_res.json()["ok"] is True

        cleanup_res = api.client.post(
            f"/api/v1/projects/{project_id}/audit/cleanup-orphans",
            params={"dry_run": "false"},
            headers=bearer(tokens),
        )
        assert cleanup_res.status_code == 200
        assert cleanup_res.json()["deleted_count"] == 1
        assert not orphan_path.exists()

        # Backup export -> tamper rejection -> valid restore
        export_res = api.client.post(
            f"/api/v1/projects/{project_id}/audit/backup-export",
            headers=bearer(tokens),
        )
        assert export_res.status_code == 200
        bundle = export_res.json()
        assert "sk-abcdefghijklmnop123456" not in export_res.text
        assert bundle["schema_version"] == "1.0"

        tampered = copy.deepcopy(bundle)
        tampered["sources"][0]["versions"][0]["code"] = "def double(n: int) -> int:\n    return 0\n"
        bad_restore = api.client.post(
            "/api/v1/audit/backup-restore",
            headers=bearer(tokens),
            json=tampered,
        )
        assert bad_restore.status_code == 422
        assert bad_restore.json()["detail"]["code"] == "INPUT_INVALID"

        good_restore = api.client.post(
            "/api/v1/audit/backup-restore",
            headers=bearer(tokens),
            json=bundle,
        )
        assert good_restore.status_code == 201
        restored_project_id = good_restore.json()["project_id"]
        assert restored_project_id != project_id

        restored_integ = api.client.get(
            f"/api/v1/projects/{restored_project_id}/audit/integrity",
            headers=bearer(tokens),
        )
        assert restored_integ.status_code == 200
        assert restored_integ.json()["ok"] is True


class TestStackedGenerationAndEvaluationAdapter:
    def test_aggregates_and_deletes_generation_runs_and_metric_records_when_present(
        self, api: Api, engine: Engine, tmp_path: Path
    ) -> None:
        artifact_dir = tmp_path / "artifacts"
        artifact_dir.mkdir(parents=True)
        _override_artifact_dir(artifact_dir)

        tokens = api.register_and_login("stacked-owner@example.com")
        proj = api.client.post(
            "/api/v1/projects",
            headers=bearer(tokens),
            json={"name": "Stacked S4+S6+S7", "description": None},
        ).json()
        project_id = uuid.UUID(proj["id"])

        # Create S3 source + prompt + credential + experiment + frozen snapshot
        src_res = api.client.post(
            f"/api/v1/projects/{project_id}/sources",
            headers={**bearer(tokens), "Content-Type": "text/x-python"},
            content=b"def inc(x: int) -> int:\n    return x + 1\n",
        )
        assert src_res.status_code == 201
        source_id = src_res.json()["source_id"]

        pv_res = api.client.post(
            f"/api/v1/projects/{project_id}/prompts/L1/versions",
            headers=bearer(tokens),
            json={
                "system_template": None,
                "user_template": "Test {function_name}:\n{function_code}",
                "notes": "TBD-04 test example",
            },
        )
        assert pv_res.status_code == 201
        api.client.post(
            f"/api/v1/projects/{project_id}/prompts/L1/versions/1/approve",
            headers=bearer(tokens),
        )

        # Create dynamic generation_runs, metric_records, and assertion_reviews tables matching S4 & S6
        gen_run_id = uuid.uuid4()
        job_id = uuid.uuid4()
        relpath = f"{project_id}/{job_id}/{gen_run_id}.py"
        art_file = artifact_dir / relpath
        art_file.parent.mkdir(parents=True, exist_ok=True)
        art_bytes = b"def test_inc():\n    assert inc(1) == 2\n"
        art_file.write_bytes(art_bytes)
        art_sha = hashlib.sha256(art_bytes).hexdigest()

        with Session(engine) as db:
            from cryptography.fernet import Fernet
            from pydantic import SecretStr

            from app.core.security import CredentialVault
            from app.infrastructure.llm import GenerationParameters, ProviderId
            from app.modules.ai_config.schemas import ProviderCredentialInput
            from app.modules.ai_config.service import AIConfigService
            from app.modules.experiments.schemas import (
                ExperimentConfigInput,
                ExperimentCreateInput,
                ModelTargetInput,
            )
            from app.modules.experiments.service import ExperimentService
            from app.modules.prompts.models import StrategyCode

            owner_uuid = uuid.UUID(
                str(
                    db.scalar(
                        text("SELECT owner_id FROM projects WHERE id = :pid"),
                        {"pid": project_id.hex},
                    )
                )
            )
            vault = CredentialVault(f"k1:{Fernet.generate_key().decode('ascii')}")
            AIConfigService(db, vault).upsert_credential(
                owner_uuid,
                project_id,
                "groq",
                ProviderCredentialInput(
                    api_key=SecretStr("gsk_stackedSecretKey9999999999"),
                    default_model="llama-3.3-70b-versatile",
                    default_params=GenerationParameters(),
                ),
            )
            exp_svc = ExperimentService(db)
            exp = exp_svc.create(
                owner_uuid,
                project_id,
                ExperimentCreateInput(
                    name="Inc Suite",
                    description=None,
                    config=ExperimentConfigInput(
                        source_id=uuid.UUID(source_id),
                        source_revision=1,
                        function_names=["inc"],
                        models=[
                            ModelTargetInput(
                                provider=ProviderId.GROQ, model="llama-3.3-70b-versatile"
                            )
                        ],
                        strategies=[StrategyCode.L1],
                        parameters=GenerationParameters(),
                        repeats=1,
                    ),
                ),
            )
            snap = exp_svc.freeze_snapshot(owner_uuid, project_id, exp.id)
            snap_run_id = snap.runs[0].id

            from app.core.clock import utcnow
            from app.modules.evaluation.models import AssertionReview, MetricRecord
            from app.modules.generation.models import GenerationJob, GenerationRun

            now_dt = utcnow()
            job = GenerationJob(
                id=job_id,
                project_id=project_id,
                snapshot_id=snap.id,
                request_id="req-stacked-s4-s6-s7",
                status="COMPLETED",
                created_at=now_dt,
                updated_at=now_dt,
            )
            db.add(job)
            db.flush()

            db.add(
                GenerationRun(
                    id=gen_run_id,
                    job_id=job_id,
                    project_id=project_id,
                    snapshot_id=snap.id,
                    snapshot_run_id=snap_run_id,
                    ordinal=1,
                    function_name="inc",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L1",
                    repeat_index=1,
                    status="COMPLETED",
                    attempt_count=1,
                    generated_code="def test_inc():\n    assert inc(1) == 2\n",
                    artifact_relpath=relpath,
                    artifact_sha256=art_sha,
                    latency_ms=180,
                    error_info=None,
                    created_at=now_dt,
                    updated_at=now_dt,
                )
            )
            for m_name, m_state, m_val in (
                ("syntax_validity", "MEASURED", 100.0),
                ("line_coverage", "MEASURED", 0.0),
                ("mutation_score", "N/A", None),
                ("assertion_quality", "MEASURED", 100.0),
            ):
                db.add(
                    MetricRecord(
                        id=uuid.uuid4(),
                        project_id=project_id,
                        snapshot_id=snap.id,
                        run_id=gen_run_id,
                        metric_name=m_name,
                        state=m_state,
                        numeric_value=m_val,
                        reason="Disabled" if m_state == "N/A" else None,
                        source_sha256=snap.source_sha256,
                        details={},
                        evaluated_at=now_dt,
                    )
                )
            db.add(
                AssertionReview(
                    id=uuid.uuid4(),
                    project_id=project_id,
                    run_id=gen_run_id,
                    assertion_id="AST-01",
                    rubric_label="EFFECTIVE",
                    notes="Good check",
                    reviewer_id=owner_uuid,
                    created_at=now_dt,
                    updated_at=now_dt,
                )
            )
            db.commit()

        # Summary aggregates dynamic generation_runs + metric_records seamlessly
        summary = api.client.get(
            f"/api/v1/projects/{project_id}/reports/summary",
            headers=bearer(tokens),
        ).json()
        assert summary["total_runs"] == 1
        assert summary["avg_coverage"] == 0.0
        assert summary["avg_mutation_score"] == "N/A"
        assert summary["avg_assertion_quality"] == 100.0

        # Integrity verifies the generation_runs artifact too
        integ = api.client.get(
            f"/api/v1/projects/{project_id}/audit/integrity",
            headers=bearer(tokens),
        ).json()
        assert integ["ok"] is True
        assert integ["checked_artifacts"] == 1

        # DELETE /reports/runs/{gen_run_id} deletes generation_runs + metric_records + assertion_reviews + artifact!
        del_res = api.client.delete(
            f"/api/v1/projects/{project_id}/reports/runs/{gen_run_id}",
            headers=bearer(tokens),
        )
        assert del_res.status_code == 200
        assert del_res.json()["total_runs"] == 0
        assert not art_file.exists()

        with Session(engine) as db:
            assert db.scalar(text("SELECT COUNT(*) FROM generation_runs")) == 0
            assert db.scalar(text("SELECT COUNT(*) FROM metric_records")) == 0
            assert db.scalar(text("SELECT COUNT(*) FROM assertion_reviews")) == 0
