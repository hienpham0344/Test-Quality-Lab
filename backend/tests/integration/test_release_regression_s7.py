"""Sprint 7 Release Regression Suite (Issue #71).

End-to-end multi-sprint regression checks covering:
1. Full S1 -> S7 pipeline (Auth, Projects, Python AST Sources, CSV Datasets,
   Encrypted AI Credentials, L1-L5 Prompts, Frozen Experiment Snapshots,
   Idempotent Generation & Redacted Artifacts, Static/Runtime Evaluation &
   Human Rubric Reviews, Reporting Summary/Results/Comparability/CSV Exports,
   Audit Trail, SHA-256 Integrity Verification, and Secret-Free Backup/Restore).
2. Metric State & Zero-vs-NA Regression (0.0 strictly preserved and distinct
   from N/A, FAILED, and TIMEOUT across evaluation, reporting JSON, and CSV).
3. Security & Cross-Tenant Isolation Regression (User B 404 isolation across
   all module endpoints, secret redaction in errors/artifacts/CSVs, RFC 4180
   CSV formula injection neutralization for '=', '+', '-', '@', '\\t', '\\r',
   backup credential exclusion, and tampered backup 422 rejection).
"""

from __future__ import annotations

import base64
import copy
import csv
import hashlib
import io
import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.security import CredentialVault
from app.infrastructure.llm import ProviderId
from app.infrastructure.llm.mock import (
    MockHTTPError,
    MockLLMAdapter,
    MockSuccess,
    MockTimeout,
)
from app.main import app
from app.modules.ai_config.dependencies import get_vault
from app.modules.generation import router as generation_router
from app.modules.generation.service import GenerationExecutionService
from app.modules.reporting.schemas import ReportRunCreateInput
from app.modules.reporting.service import ReportingService
from tests.integration.conftest import Api, bearer

TEST_FERNET_KEY = base64.urlsafe_b64encode(b"r" * 32).decode()
SYNTHETIC_GROQ_KEY = "".join(("gsk_", "release_regression_secret_key_2026_s7"))

SAMPLE_PYTHON_SOURCE = (
    '"""Release regression sample target module."""\n\n'
    "def clamp(val: int, low: int, high: int) -> int:\n"
    '    """Clamp val into [low, high]."""\n'
    "    if low > high:\n"
    "        raise ValueError('low > high')\n"
    "    return max(low, min(val, high))\n\n"
    "def scale(val: int, factor: int) -> int:\n"
    '    """Multiply val by factor."""\n'
    "    return val * factor\n"
).encode("utf-8")

SAMPLE_CSV_BYTES = (
    "\ufeffTaskID,TargetFn,InputJSON,ExpectedJSON\r\n"
    "T-01,clamp,\"[15, 0, 10]\",10\r\n"
    "T-02,clamp,\"[-5, 0, 10]\",0\r\n"
    "T-03,scale,\"[4, 0]\",0\r\n"
).encode("utf-8")


def _configure_test_runtime(
    monkeypatch: pytest.MonkeyPatch,
    artifact_dir: Path,
) -> tuple[CredentialVault, Settings, list[uuid.UUID]]:
    artifact_dir.mkdir(parents=True, exist_ok=True)
    vault = CredentialVault(f"k1:{TEST_FERNET_KEY}")
    settings = Settings(artifact_dir=str(artifact_dir))
    app.dependency_overrides[get_vault] = lambda: vault
    app.dependency_overrides[get_settings] = lambda: settings

    enqueued_jobs: list[uuid.UUID] = []

    def _fake_enqueue(job_id: uuid.UUID) -> str:
        enqueued_jobs.append(job_id)
        return f"regression-task-{len(enqueued_jobs)}"

    monkeypatch.setattr(generation_router, "enqueue_generation_job", _fake_enqueue)
    return vault, settings, enqueued_jobs


def _finalize_l1_to_l5_prompts(api: Api, headers: dict[str, str], project_id: str) -> None:
    """Create and approve non-official L1-L5 prompt versions and finalize bundle (SRS TBD-04)."""
    # First create and approve an explicit L1 version via the version endpoint
    v_res = api.client.post(
        f"/api/v1/projects/{project_id}/prompts/L1/versions",
        headers=headers,
        json={
            "system_template": "Non-official QA regression fixture (SRS TBD-04).",
            "user_template": (
                "Generate pytest for {function_name} ({function_signature}):\n{function_code}"
            ),
            "notes": "Draft v1 before bundle finalization",
        },
    )
    assert v_res.status_code == 201
    app_res = api.client.post(
        f"/api/v1/projects/{project_id}/prompts/L1/versions/1/approve",
        headers=headers,
    )
    assert app_res.status_code == 200
    assert app_res.json()["status"] == "APPROVED"

    # Finalize complete L1-L5 prompt bundle
    bundle_res = api.client.post(
        f"/api/v1/projects/{project_id}/prompts/bundles/finalize",
        headers=headers,
        json={
            "strategies": [
                {
                    "strategy": code,
                    "system_template": f"Non-official S7 regression system prompt ({code}).",
                    "user_template": (
                        f"[{code}] Target: {{function_name}} ({{function_signature}})\n"
                        "Docstring: {docstring}\n"
                        "Code:\n{function_code}\n"
                        "Cases:\n{csv_cases}"
                    ),
                    "review_notes": f"S7 regression fixture for {code} (TBD-04 compliant)",
                    "placeholder_verified": True,
                }
                for code in ("L1", "L2", "L3", "L4", "L5")
            ]
        },
    )
    assert bundle_res.status_code == 200
    assert len(bundle_res.json()["versions"]) == 5
    assert all(v["status"] == "APPROVED" for v in bundle_res.json()["versions"])


class TestEndToEndReleaseRegressionS1ToS7:
    """Full S1 -> S7 lifecycle verification from user registration to backup restore."""

    def test_full_s1_to_s7_pipeline_regression(
        self,
        api: Api,
        engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        artifact_dir = tmp_path / "artifacts"
        vault, settings, enqueued_jobs = _configure_test_runtime(monkeypatch, artifact_dir)

        # ------------------------------------------------------------------
        # S1: Register/authenticate user, create project, patch metadata
        # ------------------------------------------------------------------
        owner_tokens = api.register_and_login("s7-release-owner@example.com")
        owner_hdr = bearer(owner_tokens)

        proj_res = api.client.post(
            "/api/v1/projects",
            headers=owner_hdr,
            json={
                "name": "S7 Release Regression Lab",
                "description": "Initial project description",
            },
        )
        assert proj_res.status_code == 201
        project_id = proj_res.json()["id"]
        project_uuid = uuid.UUID(project_id)

        patch_res = api.client.patch(
            f"/api/v1/projects/{project_id}",
            headers=owner_hdr,
            json={
                "name": "S7 Release Regression Lab v2",
                "description": "Patched metadata before experiment freeze",
            },
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["name"] == "S7 Release Regression Lab v2"

        hist_res = api.client.get(
            f"/api/v1/projects/{project_id}/history",
            headers=owner_hdr,
        )
        assert hist_res.status_code == 200
        assert [h["revision"] for h in hist_res.json()] == [2, 1]

        # ------------------------------------------------------------------
        # S2: Upload Python source & verify AST functions; import CSV dataset,
        #     link Python reference & select rows
        # ------------------------------------------------------------------
        src_res = api.client.post(
            f"/api/v1/projects/{project_id}/sources",
            headers={**owner_hdr, "Content-Type": "text/x-python"},
            content=SAMPLE_PYTHON_SOURCE,
        )
        assert src_res.status_code == 201
        src_body = src_res.json()
        source_id = src_body["source_id"]
        source_rev = src_body["revision"]
        source_sha256 = src_body["sha256"]
        assert [fn["name"] for fn in src_body["functions"]] == ["clamp", "scale"]

        preview_res = api.client.post(
            f"/api/v1/projects/{project_id}/datasets/preview",
            headers={**owner_hdr, "Content-Type": "text/csv; charset=utf-8"},
            content=SAMPLE_CSV_BYTES,
        )
        assert preview_res.status_code == 200
        assert preview_res.json()["row_count"] == 3

        mapping_param = json.dumps(
            {
                "task_id": "TaskID",
                "function_name": "TargetFn",
                "input_data": "InputJSON",
                "expected_output": "ExpectedJSON",
            }
        )
        import_res = api.client.post(
            f"/api/v1/projects/{project_id}/datasets/import",
            params={"mapping": mapping_param},
            headers={**owner_hdr, "Content-Type": "text/csv; charset=utf-8"},
            content=SAMPLE_CSV_BYTES,
        )
        assert import_res.status_code == 201
        dataset_id = import_res.json()["dataset_id"]
        assert import_res.json()["revision"] == 1

        link_res = api.client.post(
            f"/api/v1/projects/{project_id}/datasets/{dataset_id}/reference",
            headers=owner_hdr,
            json={"source_id": source_id, "revision": source_rev},
        )
        assert link_res.status_code == 200
        assert link_res.json()["revision"] == 2
        assert all(r["status"] == "valid" for r in link_res.json()["rows"])
        assert all(r["execution_enabled"] is False for r in link_res.json()["rows"])

        sel_res = api.client.post(
            f"/api/v1/projects/{project_id}/datasets/{dataset_id}/selection",
            headers=owner_hdr,
            json={"row_numbers": [2, 3]},
        )
        assert sel_res.status_code == 200
        dataset_rev = sel_res.json()["revision"]
        dataset_sha256 = sel_res.json()["sha256"]
        assert dataset_rev == 3
        assert sel_res.json()["selected_rows"] == [2, 3]

        # ------------------------------------------------------------------
        # S3: Configure encrypted AI provider credential & verify masking;
        #     approve L1-L5 prompts; validate & create experiment; freeze snapshot
        # ------------------------------------------------------------------
        cred_res = api.client.put(
            f"/api/v1/projects/{project_id}/ai-configs/groq",
            headers=owner_hdr,
            json={
                "api_key": SYNTHETIC_GROQ_KEY,
                "default_model": "llama-3.3-70b-versatile",
                "default_params": {"temperature": 0.1, "max_tokens": 512, "top_p": 0.9},
            },
        )
        assert cred_res.status_code == 200
        assert SYNTHETIC_GROQ_KEY not in cred_res.text
        assert cred_res.json()["key_hint"].startswith("••••••••")

        _finalize_l1_to_l5_prompts(api, owner_hdr, project_id)

        exp_cfg = {
            "source_id": source_id,
            "source_revision": source_rev,
            "function_names": ["clamp"],
            "dataset_id": dataset_id,
            "dataset_revision": dataset_rev,
            "selected_rows": [2, 3],
            "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
            "strategies": ["L1", "L2"],
            "repeats": 1,
            "parameters": {
                "temperature": 0.0,
                "max_tokens": 512,
                "top_p": 1.0,
                "seed": 42,
                "timeout_seconds": 30.0,
            },
        }
        val_res = api.client.post(
            f"/api/v1/projects/{project_id}/experiments/validate",
            headers=owner_hdr,
            json=exp_cfg,
        )
        assert val_res.status_code == 200
        assert val_res.json()["can_freeze"] is True
        assert val_res.json()["run_count"] == 2

        exp_res = api.client.post(
            f"/api/v1/projects/{project_id}/experiments",
            headers=owner_hdr,
            json={
                "name": "S7 Matrix Clamp L1-L2",
                "description": "End-to-end release regression experiment",
                "config": exp_cfg,
            },
        )
        assert exp_res.status_code == 201
        experiment_id = exp_res.json()["id"]

        snap_res = api.client.post(
            f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots",
            headers=owner_hdr,
        )
        assert snap_res.status_code == 201
        snapshot = snap_res.json()
        snapshot_id = snapshot["id"]
        snapshot_sha256 = snapshot["snapshot_sha256"]
        assert snapshot["source_sha256"] == source_sha256
        assert snapshot["dataset_sha256"] == dataset_sha256
        assert snapshot["run_count"] == 2
        assert SYNTHETIC_GROQ_KEY not in snap_res.text

        # BR-03 / FR-PRJ-002: Editing project metadata never mutates frozen snapshot
        post_freeze_patch = api.client.patch(
            f"/api/v1/projects/{project_id}",
            headers=owner_hdr,
            json={"name": "S7 Release Regression Lab Final", "description": "Post-freeze edit"},
        )
        assert post_freeze_patch.status_code == 200
        refetched_snap = api.client.get(
            f"/api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots/{snapshot_id}",
            headers=owner_hdr,
        )
        assert refetched_snap.status_code == 200
        assert refetched_snap.json() == snapshot

        # ------------------------------------------------------------------
        # S4: Dispatch idempotent generation job, execute via MockLLMAdapter,
        #     verify redacted .py artifact persistence
        # ------------------------------------------------------------------
        gen_start = api.client.post(
            f"/api/v1/projects/{project_id}/generation",
            headers=owner_hdr,
            json={"snapshot_id": snapshot_id, "request_id": "req-s7-e2e-main"},
        )
        assert gen_start.status_code == 202
        job_id = uuid.UUID(gen_start.json()["job_id"])
        assert len(enqueued_jobs) == 1

        # Idempotent retry with identical request_id returns same job_id without re-enqueueing
        gen_dup = api.client.post(
            f"/api/v1/projects/{project_id}/generation",
            headers=owner_hdr,
            json={"snapshot_id": snapshot_id, "request_id": "req-s7-e2e-main"},
        )
        assert gen_dup.status_code == 202
        assert gen_dup.json()["job_id"] == str(job_id)
        assert len(enqueued_jobs) == 1

        # Concurrent distinct request_id while job is active is rejected with 409
        gen_conflict = api.client.post(
            f"/api/v1/projects/{project_id}/generation",
            headers=owner_hdr,
            json={"snapshot_id": snapshot_id, "request_id": "req-s7-e2e-conflict"},
        )
        assert gen_conflict.status_code == 409
        assert gen_conflict.json()["detail"]["code"] == "GENERATION_CONFLICT"

        adapter = MockLLMAdapter(
            ProviderId.GROQ,
            steps=[
                MockSuccess(
                    content=(
                        f"# Accidental leaked token {SYNTHETIC_GROQ_KEY}\n"
                        "def test_clamp_l1():\n"
                        "    assert clamp(15, 0, 10) == 10\n"
                        "    assert True\n"
                    )
                ),
                MockSuccess(
                    content=(
                        "def test_clamp_l2():\n"
                        "    assert clamp(15, 0, 10) == 10\n"
                        "    assert clamp(-5, 0, 10) == 0\n"
                    )
                ),
            ],
        )
        with Session(engine) as db:
            finished_job = GenerationExecutionService(
                db,
                vault=vault,
                registry=MockLLMAdapter.build_registry(adapter),
                settings=settings,
            ).execute_job(job_id)
            assert finished_job.status == "COMPLETED"

        gen_dash = api.client.get(
            f"/api/v1/projects/{project_id}/generation",
            headers=owner_hdr,
        )
        assert gen_dash.status_code == 200
        assert SYNTHETIC_GROQ_KEY not in gen_dash.text
        runs_by_strategy = {r["strategy"]: r for r in gen_dash.json()["runs"]}
        assert set(runs_by_strategy.keys()) == {"L1", "L2"}

        for strat, run_item in runs_by_strategy.items():
            assert run_item["status"] == "COMPLETED", f"Run {strat} did not complete"
            artifact_path = artifact_dir / project_id / str(job_id) / f"{run_item['id']}.py"
            assert artifact_path.is_file()
            disk_text = artifact_path.read_text(encoding="utf-8")
            assert SYNTHETIC_GROQ_KEY not in disk_text
            assert (
                hashlib.sha256(disk_text.encode("utf-8")).hexdigest()
                == run_item["artifact_sha256"]
            )
        assert "[REDACTED]" in (
            artifact_dir / project_id / str(job_id) / f"{runs_by_strategy['L1']['id']}.py"
        ).read_text(encoding="utf-8")

        run_l1_id = runs_by_strategy["L1"]["id"]
        run_l2_id = runs_by_strategy["L2"]["id"]

        # ------------------------------------------------------------------
        # S5/S6: Evaluate generated runs (fail-closed N/A vs verified-trace
        #        0.0% and non-zero metrics), human assertion rubric review,
        #        and snapshot generation success rate
        # ------------------------------------------------------------------
        # First evaluate L1 without runtime trace -> coverage & mutation fail closed to N/A
        eval_l1_na = api.client.post(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_l1_id}/evaluate",
            headers=owner_hdr,
            json={},
        )
        assert eval_l1_na.status_code == 200
        l1_na_metrics = {m["metric_name"]: m for m in eval_l1_na.json()["metric_records"]}
        assert l1_na_metrics["syntax_validity"]["state"] == "MEASURED"
        assert l1_na_metrics["syntax_validity"]["numeric_value"] == 100.0
        assert l1_na_metrics["assertion_quality"]["state"] == "MEASURED"
        assert l1_na_metrics["assertion_quality"]["numeric_value"] == 50.0
        assert l1_na_metrics["line_coverage"]["state"] == "N/A"
        assert l1_na_metrics["line_coverage"]["numeric_value"] is None
        assert l1_na_metrics["mutation_score"]["state"] == "N/A"
        assert l1_na_metrics["mutation_score"]["numeric_value"] is None

        # Re-evaluate L1 with verified 0.0% coverage trace (and keep mutation_score N/A)
        eval_l1_zero = api.client.post(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_l1_id}/evaluate",
            headers=owner_hdr,
            json={
                "coverage_trace": {
                    "covered_lines": 0,
                    "total_lines": 8,
                    "covered_ranges": [],
                    "missed_ranges": ["L1-L8"],
                }
            },
        )
        assert eval_l1_zero.status_code == 200
        l1_zero_metrics = {m["metric_name"]: m for m in eval_l1_zero.json()["metric_records"]}
        assert l1_zero_metrics["line_coverage"]["state"] == "MEASURED"
        assert l1_zero_metrics["line_coverage"]["numeric_value"] == 0.0
        assert l1_zero_metrics["mutation_score"]["state"] == "N/A"
        assert l1_zero_metrics["mutation_score"]["numeric_value"] is None

        # Evaluate L2 with verified 80.0% coverage trace and 50.0% mutation report
        eval_l2 = api.client.post(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_l2_id}/evaluate",
            headers=owner_hdr,
            json={
                "coverage_trace": {
                    "covered_lines": 4,
                    "total_lines": 5,
                    "covered_ranges": ["L1-L4"],
                    "missed_ranges": ["L5-L5"],
                },
                "mutation_report": {
                    "mutants": [
                        {
                            "id": "MUT-01",
                            "operator": "ROR",
                            "line": 5,
                            "original": "low > high",
                            "mutated": "low >= high",
                            "status": "KILLED",
                        },
                        {
                            "id": "MUT-02",
                            "operator": "AOR",
                            "line": 11,
                            "original": "val * factor",
                            "mutated": "val + factor",
                            "status": "SURVIVED",
                        },
                    ]
                },
            },
        )
        assert eval_l2.status_code == 200
        l2_metrics = {m["metric_name"]: m for m in eval_l2.json()["metric_records"]}
        assert l2_metrics["syntax_validity"]["numeric_value"] == 100.0
        assert l2_metrics["assertion_quality"]["numeric_value"] == 100.0
        assert l2_metrics["line_coverage"]["numeric_value"] == 80.0
        assert l2_metrics["mutation_score"]["numeric_value"] == 50.0

        # Human assertion rubric review on L1 with secret redaction
        rev_put = api.client.put(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_l1_id}/assertion-reviews",
            headers=owner_hdr,
            json={
                "reviews": [
                    {
                        "assertion_id": "AST-01",
                        "rubric_label": "EFFECTIVE",
                        "notes": f"Checks upper bound; key {SYNTHETIC_GROQ_KEY} must be scrubbed",
                    },
                    {
                        "assertion_id": "AST-02",
                        "rubric_label": "TRIVIAL",
                        "notes": "assert True tautology",
                    },
                ]
            },
        )
        assert rev_put.status_code == 200
        assert SYNTHETIC_GROQ_KEY not in rev_put.text
        assert "[REDACTED]" in rev_put.text

        rev_get = api.client.get(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_l1_id}/assertion-reviews",
            headers=owner_hdr,
        )
        assert rev_get.status_code == 200
        assert len(rev_get.json()["reviews"]) == 2

        snap_gs = api.client.post(
            f"/api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success",
            headers=owner_hdr,
        )
        assert snap_gs.status_code == 200
        assert snap_gs.json()["metric"]["state"] == "MEASURED"
        assert snap_gs.json()["metric"]["numeric_value"] == 100.0

        # ------------------------------------------------------------------
        # S7: Reporting summary, filtered results, comparability transitions
        #     (COMPATIBLE -> CAUTION -> INCOMPARABLE -> COMPATIBLE),
        #     RFC 4180 CSV exports, Audit trail, SHA-256 Integrity, Backup/Restore
        # ------------------------------------------------------------------
        sum_compat = api.client.get(
            f"/api/v1/projects/{project_id}/reports/summary",
            headers=owner_hdr,
        )
        assert sum_compat.status_code == 200
        sum_body = sum_compat.json()
        assert sum_body["total_runs"] == 2
        assert sum_body["pass_rate"] == 100.0
        assert sum_body["avg_coverage"] == 40.0  # (0.0 + 80.0) / 2
        assert sum_body["avg_mutation_score"] == 50.0
        assert sum_body["avg_assertion_quality"] == 75.0  # (50.0 + 100.0) / 2
        assert sum_body["comparability"]["status"] == "COMPATIBLE"

        # Filtered results query for L1 preserves numeric 0.0 coverage and N/A mutation_score
        res_l1 = api.client.get(
            f"/api/v1/projects/{project_id}/reports/results",
            params={"strategy": "L1"},
            headers=owner_hdr,
        )
        assert res_l1.status_code == 200
        l1_runs = res_l1.json()["runs"]
        assert len(l1_runs) == 1
        assert l1_runs[0]["metrics"]["coverage"] == 0.0
        assert isinstance(l1_runs[0]["metrics"]["coverage"], float)
        assert l1_runs[0]["metrics"]["mutation_score"] == "N/A"

        # Add a TIMEOUT run on a different model -> comparability becomes CAUTION
        with Session(engine) as db:
            owner_uuid = uuid.UUID(
                str(
                    db.scalar(
                        text("SELECT owner_id FROM projects WHERE id = :pid"),
                        {"pid": project_uuid.hex},
                    )
                )
            )
            rep_svc = ReportingService(db, artifact_dir=str(artifact_dir))
            caution_run = rep_svc.record_run_result(
                owner_uuid,
                project_uuid,
                ReportRunCreateInput(
                    snapshot_id=uuid.UUID(snapshot_id),
                    snapshot_sha256=snapshot_sha256,
                    source_name="source_rev_1.py",
                    source_sha256=source_sha256,
                    dataset_name="dataset_rev_3.csv",
                    dataset_sha256=dataset_sha256,
                    suite_name="=FormulaTimeoutSuite",
                    function_name="clamp",
                    provider="gemini",
                    model="gemini-2.5-flash",
                    strategy="L3",
                    prompt_version=1,
                    prompt_sha256="3" * 64,
                    repeat_index=1,
                    status="TIMEOUT",
                    duration_ms=30000,
                    total_cases=1,
                    completed_cases=1,
                    passed_cases=0,
                    failed_cases=0,
                    timeout_cases=1,
                    syntax_validity_state="TIMEOUT",
                    line_coverage_state="TIMEOUT",
                    mutation_score_state="TIMEOUT",
                    assertion_quality_state="TIMEOUT",
                ),
            )
            caution_run_id = caution_run.id

        sum_caution = api.client.get(
            f"/api/v1/projects/{project_id}/reports/summary",
            headers=owner_hdr,
        ).json()
        assert sum_caution["comparability"]["status"] == "CAUTION"

        # Add a FAILED run with divergent source_sha256 -> comparability becomes INCOMPARABLE
        with Session(engine) as db:
            rep_svc = ReportingService(db, artifact_dir=str(artifact_dir))
            incomp_run = rep_svc.record_run_result(
                owner_uuid,
                project_uuid,
                ReportRunCreateInput(
                    snapshot_id=uuid.UUID(snapshot_id),
                    snapshot_sha256=snapshot_sha256,
                    source_name="source_rev_2.py",
                    source_sha256="f" * 64,
                    dataset_name="dataset_rev_3.csv",
                    dataset_sha256=dataset_sha256,
                    suite_name="+DivergentFailedSuite",
                    function_name="clamp",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L4",
                    prompt_version=1,
                    prompt_sha256="4" * 64,
                    repeat_index=1,
                    status="FAILED",
                    duration_ms=120,
                    total_cases=1,
                    completed_cases=1,
                    passed_cases=0,
                    failed_cases=1,
                    timeout_cases=0,
                    syntax_validity_state="FAILED",
                    line_coverage_state="FAILED",
                    mutation_score_state="FAILED",
                    assertion_quality_state="FAILED",
                    error_message=f"Provider rejected key {SYNTHETIC_GROQ_KEY}",
                ),
            )
            incomp_run_id = incomp_run.id

        sum_incomp = api.client.get(
            f"/api/v1/projects/{project_id}/reports/summary",
            headers=owner_hdr,
        ).json()
        assert sum_incomp["comparability"]["status"] == "INCOMPARABLE"

        # Export RFC 4180 runs.csv & strategy-comparison.csv
        runs_csv_res = api.client.get(
            f"/api/v1/projects/{project_id}/reports/exports/runs.csv",
            headers=owner_hdr,
        )
        assert runs_csv_res.status_code == 200
        assert "\r\n" in runs_csv_res.text
        assert SYNTHETIC_GROQ_KEY not in runs_csv_res.text
        assert "[REDACTED]" in runs_csv_res.text
        runs_csv_rows = {
            r["strategy"]: r for r in csv.DictReader(io.StringIO(runs_csv_res.text))
        }
        assert runs_csv_rows["L1"]["line_coverage"] == "0.0"
        assert runs_csv_rows["L1"]["mutation_score"] == "N/A"
        assert runs_csv_rows["L2"]["line_coverage"] == "80.0"
        assert runs_csv_rows["L2"]["mutation_score"] == "50.0"
        assert runs_csv_rows["L3"]["line_coverage"] == "TIMEOUT"
        assert runs_csv_rows["L3"]["suite_name"] == "'=FormulaTimeoutSuite"
        assert runs_csv_rows["L4"]["line_coverage"] == "FAILED"
        assert runs_csv_rows["L4"]["suite_name"] == "'+DivergentFailedSuite"

        comp_csv_res = api.client.get(
            f"/api/v1/projects/{project_id}/reports/exports/strategy-comparison.csv",
            headers=owner_hdr,
        )
        assert comp_csv_res.status_code == 200
        comp_csv_rows = {
            r["strategy"]: r for r in csv.DictReader(io.StringIO(comp_csv_res.text))
        }
        assert comp_csv_rows["L1"]["avg_coverage"] == "0.0"
        assert comp_csv_rows["L1"]["avg_mutation_score"] == "N/A"
        assert comp_csv_rows["L1"]["comparability_status"] == "INCOMPARABLE"

        # Delete the divergent and timeout runs -> returns to COMPATIBLE
        assert (
            api.client.delete(
                f"/api/v1/projects/{project_id}/reports/runs/{incomp_run_id}",
                headers=owner_hdr,
            ).status_code
            == 200
        )
        del_caution = api.client.delete(
            f"/api/v1/projects/{project_id}/reports/runs/{caution_run_id}",
            headers=owner_hdr,
        )
        assert del_caution.status_code == 200
        assert del_caution.json()["comparability"]["status"] == "COMPATIBLE"

        # Verify SHA-256 project integrity check over sources, datasets, prompts, snapshots, and artifacts
        integ_res = api.client.get(
            f"/api/v1/projects/{project_id}/audit/integrity",
            headers=owner_hdr,
        )
        assert integ_res.status_code == 200
        integ_body = integ_res.json()
        assert integ_body["ok"] is True
        assert integ_body["violations"] == []
        assert integ_body["checked_artifacts"] == 2

        # Secret-free JSON backup export & restore round-trip
        backup_res = api.client.post(
            f"/api/v1/projects/{project_id}/audit/backup-export",
            headers=owner_hdr,
        )
        assert backup_res.status_code == 200
        bundle = backup_res.json()
        assert SYNTHETIC_GROQ_KEY not in backup_res.text
        assert "v1:k1:" not in backup_res.text
        assert "provider_credentials" not in bundle

        restore_res = api.client.post(
            "/api/v1/audit/backup-restore",
            headers=owner_hdr,
            json=bundle,
        )
        assert restore_res.status_code == 201
        restored_info = restore_res.json()
        restored_project_id = restored_info["project_id"]
        assert restored_project_id != project_id
        assert restored_info["restored_sources"] == 1
        assert restored_info["restored_datasets"] == 1
        assert restored_info["restored_prompts"] == 6
        assert restored_info["restored_experiments"] == 1
        assert restored_info["restored_snapshots"] == 1

        restored_integ = api.client.get(
            f"/api/v1/projects/{restored_project_id}/audit/integrity",
            headers=owner_hdr,
        )
        assert restored_integ.status_code == 200
        assert restored_integ.json()["ok"] is True

        # Verify audit trail events recorded across S1-S7 actions
        audit_res = api.client.get("/api/v1/audit-events", headers=owner_hdr)
        assert audit_res.status_code == 200
        recorded_actions = {ev["action"] for ev in audit_res.json()}
        for expected_action in (
            "auth.registered",
            "auth.login_succeeded",
            "evaluation.assertion_reviewed",
            "report.result_deleted",
            "system.backup_exported",
            "system.backup_restored",
        ):
            assert expected_action in recorded_actions


class TestMetricStateAndZeroVsNaRegression:
    """Strict verification that numeric 0.0 is never coerced to N/A, None, or False."""

    def test_zero_vs_na_failed_and_timeout_across_evaluation_reporting_and_csv(
        self,
        api: Api,
        engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        artifact_dir = tmp_path / "artifacts"
        _configure_test_runtime(monkeypatch, artifact_dir)

        tokens = api.register_and_login("zero-vs-na@example.com")
        hdr = bearer(tokens)

        proj_res = api.client.post(
            "/api/v1/projects",
            headers=hdr,
            json={"name": "Zero vs NA Lab", "description": "Metric state regression"},
        )
        assert proj_res.status_code == 201
        project_id = proj_res.json()["id"]
        project_uuid = uuid.UUID(project_id)

        src_res = api.client.post(
            f"/api/v1/projects/{project_id}/sources",
            headers={**hdr, "Content-Type": "text/x-python"},
            content=SAMPLE_PYTHON_SOURCE,
        )
        assert src_res.status_code == 201
        source_id = src_res.json()["source_id"]
        source_sha256 = src_res.json()["sha256"]

        assert (
            api.client.put(
                f"/api/v1/projects/{project_id}/ai-configs/groq",
                headers=hdr,
                json={
                    "api_key": SYNTHETIC_GROQ_KEY,
                    "default_model": "llama-3.3-70b-versatile",
                },
            ).status_code
            == 200
        )
        _finalize_l1_to_l5_prompts(api, hdr, project_id)

        exp_res = api.client.post(
            f"/api/v1/projects/{project_id}/experiments",
            headers=hdr,
            json={
                "name": "Zero vs NA Experiment",
                "config": {
                    "source_id": source_id,
                    "source_revision": 1,
                    "function_names": ["clamp"],
                    "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                    "strategies": ["L1", "L2"],
                    "repeats": 1,
                },
            },
        )
        assert exp_res.status_code == 201
        exp_id = exp_res.json()["id"]
        snap_res = api.client.post(
            f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots",
            headers=hdr,
        )
        assert snap_res.status_code == 201
        snapshot_id = snap_res.json()["id"]
        snapshot_sha256 = snap_res.json()["snapshot_sha256"]

        # 1. Before any runs are evaluated, snapshot generation-success is N/A (not 0.0)
        gs_initial = api.client.post(
            f"/api/v1/projects/{project_id}/evaluations/snapshots/{snapshot_id}/generation-success",
            headers=hdr,
        )
        assert gs_initial.status_code == 200
        assert gs_initial.json()["metric"]["state"] == "N/A"
        assert gs_initial.json()["metric"]["numeric_value"] is None

        # 2. Evaluate a COMPLETED run with only trivial assertion -> assertion_quality = 0.0 (MEASURED),
        #    while coverage & mutation without runtime trace are N/A (None)
        run_zero_id = uuid.uuid4()
        eval_trivial = api.client.post(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_zero_id}/evaluate",
            headers=hdr,
            json={
                "run_status": "COMPLETED",
                "snapshot_id": snapshot_id,
                "target_function": "clamp",
                "generated_code": "def test_trivial_only():\n    assert True\n",
                "coverage_trace": {
                    "covered_lines": 0,
                    "total_lines": 10,
                    "covered_ranges": [],
                    "missed_ranges": ["L1-L10"],
                },
            },
        )
        assert eval_trivial.status_code == 200
        m_zero = {m["metric_name"]: m for m in eval_trivial.json()["metric_records"]}
        assert m_zero["assertion_quality"]["state"] == "MEASURED"
        assert m_zero["assertion_quality"]["numeric_value"] == 0.0
        assert isinstance(m_zero["assertion_quality"]["numeric_value"], float)
        assert not isinstance(m_zero["assertion_quality"]["numeric_value"], bool)
        assert m_zero["line_coverage"]["state"] == "MEASURED"
        assert m_zero["line_coverage"]["numeric_value"] == 0.0
        assert m_zero["mutation_score"]["state"] == "N/A"
        assert m_zero["mutation_score"]["numeric_value"] is None

        # 3. Evaluate a FAILED run -> all 4 metrics have state="FAILED" and numeric_value=None
        run_failed_id = uuid.uuid4()
        eval_failed = api.client.post(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_failed_id}/evaluate",
            headers=hdr,
            json={
                "run_status": "FAILED",
                "snapshot_id": snapshot_id,
                "failure_reason": "Provider 502 upstream failure",
            },
        )
        assert eval_failed.status_code == 200
        for m in eval_failed.json()["metric_records"]:
            assert m["state"] == "FAILED"
            assert m["numeric_value"] is None

        # 4. Evaluate a TIMEOUT run -> all 4 metrics have state="TIMEOUT" and numeric_value=None
        run_timeout_id = uuid.uuid4()
        eval_timeout = api.client.post(
            f"/api/v1/projects/{project_id}/evaluations/runs/{run_timeout_id}/evaluate",
            headers=hdr,
            json={
                "run_status": "TIMEOUT",
                "snapshot_id": snapshot_id,
                "failure_reason": "Provider timed out after 30s",
            },
        )
        assert eval_timeout.status_code == 200
        for m in eval_timeout.json()["metric_records"]:
            assert m["state"] == "TIMEOUT"
            assert m["numeric_value"] is None

        # 5. Record L1 (0.0 coverage, 0.0 assertion_quality, N/A mutation),
        #    L2 (FAILED), and L3 (TIMEOUT) in ReportingService and verify JSON + CSV
        with Session(engine) as db:
            owner_uuid = uuid.UUID(
                str(
                    db.scalar(
                        text("SELECT owner_id FROM projects WHERE id = :pid"),
                        {"pid": project_uuid.hex},
                    )
                )
            )
            rep_svc = ReportingService(db, artifact_dir=str(artifact_dir))
            rep_svc.record_run_result(
                owner_uuid,
                project_uuid,
                ReportRunCreateInput(
                    id=run_zero_id,
                    snapshot_id=uuid.UUID(snapshot_id),
                    snapshot_sha256=snapshot_sha256,
                    source_sha256=source_sha256,
                    suite_name="ZeroMeasuredSuite",
                    function_name="clamp",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L1",
                    prompt_version=1,
                    prompt_sha256="1" * 64,
                    repeat_index=1,
                    status="COMPLETED",
                    duration_ms=100,
                    total_cases=2,
                    completed_cases=2,
                    passed_cases=0,
                    failed_cases=2,
                    timeout_cases=0,
                    syntax_validity_state="MEASURED",
                    syntax_validity_value=100.0,
                    line_coverage_state="MEASURED",
                    line_coverage_value=0.0,
                    mutation_score_state="N/A",
                    mutation_score_value=None,
                    assertion_quality_state="MEASURED",
                    assertion_quality_value=0.0,
                ),
            )
            rep_svc.record_run_result(
                owner_uuid,
                project_uuid,
                ReportRunCreateInput(
                    id=run_failed_id,
                    snapshot_id=uuid.UUID(snapshot_id),
                    snapshot_sha256=snapshot_sha256,
                    source_sha256=source_sha256,
                    suite_name="FailedStateSuite",
                    function_name="clamp",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L2",
                    prompt_version=1,
                    prompt_sha256="2" * 64,
                    repeat_index=1,
                    status="FAILED",
                    duration_ms=50,
                    total_cases=2,
                    completed_cases=0,
                    passed_cases=0,
                    failed_cases=2,
                    timeout_cases=0,
                    syntax_validity_state="FAILED",
                    line_coverage_state="FAILED",
                    mutation_score_state="FAILED",
                    assertion_quality_state="FAILED",
                ),
            )
            rep_svc.record_run_result(
                owner_uuid,
                project_uuid,
                ReportRunCreateInput(
                    id=run_timeout_id,
                    snapshot_id=uuid.UUID(snapshot_id),
                    snapshot_sha256=snapshot_sha256,
                    source_sha256=source_sha256,
                    suite_name="TimeoutStateSuite",
                    function_name="clamp",
                    provider="groq",
                    model="llama-3.3-70b-versatile",
                    strategy="L3",
                    prompt_version=1,
                    prompt_sha256="3" * 64,
                    repeat_index=1,
                    status="TIMEOUT",
                    duration_ms=30000,
                    total_cases=2,
                    completed_cases=0,
                    passed_cases=0,
                    failed_cases=0,
                    timeout_cases=2,
                    syntax_validity_state="TIMEOUT",
                    line_coverage_state="TIMEOUT",
                    mutation_score_state="TIMEOUT",
                    assertion_quality_state="TIMEOUT",
                ),
            )

        # Summary JSON preserves 0.0 average coverage & 0.0 assertion quality, while mutation is N/A
        summary_json = api.client.get(
            f"/api/v1/projects/{project_id}/reports/summary",
            headers=hdr,
        ).json()
        assert summary_json["avg_coverage"] == 0.0
        assert isinstance(summary_json["avg_coverage"], float)
        assert summary_json["avg_assertion_quality"] == 0.0
        assert isinstance(summary_json["avg_assertion_quality"], float)
        assert summary_json["avg_mutation_score"] == "N/A"
        assert summary_json["pass_rate"] == 0.0

        # Results JSON distinguishes 0.0, N/A, FAILED, TIMEOUT per run
        results_json = api.client.get(
            f"/api/v1/projects/{project_id}/reports/results",
            headers=hdr,
        ).json()
        by_strat_json = {r["strategy"]: r["metrics"] for r in results_json["runs"]}
        assert by_strat_json["L1"]["coverage"] == 0.0
        assert by_strat_json["L1"]["mutation_score"] == "N/A"
        assert by_strat_json["L1"]["assertion_quality"] == 0.0
        assert by_strat_json["L2"]["coverage"] == "FAILED"
        assert by_strat_json["L2"]["mutation_score"] == "FAILED"
        assert by_strat_json["L3"]["coverage"] == "TIMEOUT"
        assert by_strat_json["L3"]["mutation_score"] == "TIMEOUT"

        # CSV exports strictly output "0.0", "N/A", "FAILED", "TIMEOUT"
        runs_csv = api.client.get(
            f"/api/v1/projects/{project_id}/reports/exports/runs.csv",
            headers=hdr,
        ).text
        csv_by_strat = {r["strategy"]: r for r in csv.DictReader(io.StringIO(runs_csv))}
        assert csv_by_strat["L1"]["line_coverage"] == "0.0"
        assert csv_by_strat["L1"]["mutation_score"] == "N/A"
        assert csv_by_strat["L1"]["assertion_quality"] == "0.0"
        assert csv_by_strat["L2"]["line_coverage"] == "FAILED"
        assert csv_by_strat["L2"]["mutation_score"] == "FAILED"
        assert csv_by_strat["L3"]["line_coverage"] == "TIMEOUT"
        assert csv_by_strat["L3"]["mutation_score"] == "TIMEOUT"

        comp_csv = api.client.get(
            f"/api/v1/projects/{project_id}/reports/exports/strategy-comparison.csv",
            headers=hdr,
        ).text
        comp_by_strat = {r["strategy"]: r for r in csv.DictReader(io.StringIO(comp_csv))}
        assert comp_by_strat["L1"]["avg_coverage"] == "0.0"
        assert comp_by_strat["L1"]["avg_mutation_score"] == "N/A"
        assert comp_by_strat["L2"]["avg_coverage"] == "FAILED"
        assert comp_by_strat["L3"]["avg_coverage"] == "TIMEOUT"


class TestSecurityAndCrossTenantIsolationRegression:
    """Cross-tenant 404 isolation, secret redaction, formula neutralization, and backup security."""

    def test_cross_tenant_404_isolation_secret_redaction_csv_formulas_and_tampered_backup(
        self,
        api: Api,
        engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        artifact_dir = tmp_path / "artifacts"
        vault, settings, _ = _configure_test_runtime(monkeypatch, artifact_dir)

        user_a_tokens = api.register_and_login("tenant-a-sec@example.com")
        user_b_tokens = api.register_and_login("tenant-b-sec@example.com")
        hdr_a = bearer(user_a_tokens)
        hdr_b = bearer(user_b_tokens)

        # User A creates project, source, dataset, AI credential, prompts, experiment, snapshot, job, evaluation
        proj_a = api.client.post(
            "/api/v1/projects",
            headers=hdr_a,
            json={"name": "Tenant A Secret Lab", "description": "Isolated project"},
        ).json()
        project_id = proj_a["id"]
        project_uuid = uuid.UUID(project_id)

        src_a = api.client.post(
            f"/api/v1/projects/{project_id}/sources",
            headers={**hdr_a, "Content-Type": "text/x-python"},
            content=SAMPLE_PYTHON_SOURCE,
        ).json()
        source_id = src_a["source_id"]
        source_sha256 = src_a["sha256"]

        ds_a = api.client.post(
            f"/api/v1/projects/{project_id}/datasets",
            headers=hdr_a,
            json={
                "rows": [
                    {
                        "row_number": 2,
                        "task_id": "T-1",
                        "function_name": "clamp",
                        "input_data": "[5, 0, 10]",
                        "expected_output": "5",
                    }
                ]
            },
        ).json()
        dataset_id = ds_a["dataset_id"]
        api.client.post(
            f"/api/v1/projects/{project_id}/datasets/{dataset_id}/reference",
            headers=hdr_a,
            json={"source_id": source_id, "revision": 1},
        )
        api.client.post(
            f"/api/v1/projects/{project_id}/datasets/{dataset_id}/selection",
            headers=hdr_a,
            json={"row_numbers": [2]},
        )

        custom_secret = "custom_tenant_a_ultra_secret_token_99112233"
        api.client.put(
            f"/api/v1/projects/{project_id}/ai-configs/groq",
            headers=hdr_a,
            json={"api_key": custom_secret, "default_model": "llama-3.3-70b-versatile"},
        )
        _finalize_l1_to_l5_prompts(api, hdr_a, project_id)

        exp_a = api.client.post(
            f"/api/v1/projects/{project_id}/experiments",
            headers=hdr_a,
            json={
                "name": "Tenant A Experiment",
                "config": {
                    "source_id": source_id,
                    "source_revision": 1,
                    "function_names": ["clamp"],
                    "dataset_id": dataset_id,
                    "dataset_revision": 3,
                    "selected_rows": [2],
                    "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
                    "strategies": ["L1", "L2"],
                    "repeats": 1,
                },
            },
        ).json()
        exp_id = exp_a["id"]
        snap_a = api.client.post(
            f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots",
            headers=hdr_a,
        ).json()
        snapshot_id = snap_a["id"]

        gen_a = api.client.post(
            f"/api/v1/projects/{project_id}/generation",
            headers=hdr_a,
            json={"snapshot_id": snapshot_id, "request_id": "req-sec-isolation"},
        ).json()
        job_id = uuid.UUID(gen_a["job_id"])

        # Execute Job A with reflected 401 secret error and timeout secret error
        adapter = MockLLMAdapter(
            ProviderId.GROQ,
            steps=[
                MockHTTPError(
                    status_code=401,
                    body=f"Unauthorized token {custom_secret} rejected",
                    reflect_api_key=True,
                ),
                MockTimeout(message=f"Gateway timeout for Bearer {custom_secret}"),
            ],
        )
        with Session(engine) as db:
            GenerationExecutionService(
                db,
                vault=vault,
                registry=MockLLMAdapter.build_registry(adapter),
                settings=settings,
            ).execute_job(job_id)

        gen_dash = api.client.get(
            f"/api/v1/projects/{project_id}/generation",
            headers=hdr_a,
        )
        assert gen_dash.status_code == 200
        assert custom_secret not in gen_dash.text
        run_id = gen_dash.json()["runs"][0]["id"]
        assert "[REDACTED]" in gen_dash.json()["runs"][0]["error"]["message"]
        assert "[REDACTED]" in gen_dash.json()["runs"][1]["error"]["message"]

        # Evaluate a run under User A so evaluation endpoints have persisted state
        eval_run_id = uuid.uuid4()
        assert (
            api.client.post(
                f"/api/v1/projects/{project_id}/evaluations/runs/{eval_run_id}/evaluate",
                headers=hdr_a,
                json={
                    "run_status": "COMPLETED",
                    "snapshot_id": snapshot_id,
                    "target_function": "clamp",
                    "generated_code": "def test_c():\n    assert clamp(5, 0, 10) == 5\n",
                },
            ).status_code
            == 200
        )

        # ------------------------------------------------------------------
        # 1. Cross-tenant (User B) 404 isolation across all S1-S7 endpoints
        # ------------------------------------------------------------------
        get_endpoints_404 = (
            f"/api/v1/projects/{project_id}",
            f"/api/v1/projects/{project_id}/history",
            f"/api/v1/projects/{project_id}/sources",
            f"/api/v1/projects/{project_id}/sources/{source_id}",
            f"/api/v1/projects/{project_id}/datasets",
            f"/api/v1/projects/{project_id}/datasets/{dataset_id}",
            f"/api/v1/projects/{project_id}/datasets/{dataset_id}/versions/1",
            f"/api/v1/projects/{project_id}/ai-configs",
            f"/api/v1/projects/{project_id}/prompts",
            f"/api/v1/projects/{project_id}/prompts/L1",
            f"/api/v1/projects/{project_id}/experiments",
            f"/api/v1/projects/{project_id}/experiments/{exp_id}",
            f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots",
            f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots/{snapshot_id}",
            f"/api/v1/projects/{project_id}/generation",
            f"/api/v1/projects/{project_id}/evaluations/runs/{eval_run_id}",
            f"/api/v1/projects/{project_id}/evaluations/runs/{eval_run_id}/assertion-reviews",
            f"/api/v1/projects/{project_id}/reports/summary",
            f"/api/v1/projects/{project_id}/reports/results",
            f"/api/v1/projects/{project_id}/reports/exports/runs.csv",
            f"/api/v1/projects/{project_id}/reports/exports/strategy-comparison.csv",
            f"/api/v1/projects/{project_id}/audit/integrity",
        )
        for path in get_endpoints_404:
            res = api.client.get(path, headers=hdr_b)
            assert res.status_code == 404, f"Expected 404 for User B on GET {path}, got {res.status_code}"

        assert (
            api.client.patch(
                f"/api/v1/projects/{project_id}",
                headers=hdr_b,
                json={"name": "Hijack"},
            ).status_code
            == 404
        )
        assert (
            api.client.post(
                f"/api/v1/projects/{project_id}/generation",
                headers=hdr_b,
                json={"snapshot_id": snapshot_id, "request_id": "req-hijack"},
            ).status_code
            == 404
        )
        assert (
            api.client.post(
                f"/api/v1/projects/{project_id}/generation/jobs/{job_id}/cancel",
                headers=hdr_b,
            ).status_code
            == 404
        )
        assert (
            api.client.post(
                f"/api/v1/projects/{project_id}/evaluations/runs/{eval_run_id}/evaluate",
                headers=hdr_b,
                json={"run_status": "COMPLETED", "generated_code": "def test_x(): assert True\n"},
            ).status_code
            == 404
        )
        assert (
            api.client.put(
                f"/api/v1/projects/{project_id}/evaluations/runs/{eval_run_id}/assertion-reviews",
                headers=hdr_b,
                json={"reviews": [{"assertion_id": "AST-01", "rubric_label": "EFFECTIVE"}]},
            ).status_code
            == 404
        )
        assert (
            api.client.delete(
                f"/api/v1/projects/{project_id}/reports/runs/{run_id}",
                headers=hdr_b,
            ).status_code
            == 404
        )
        assert (
            api.client.post(
                f"/api/v1/projects/{project_id}/audit/backup-export",
                headers=hdr_b,
            ).status_code
            == 404
        )

        # Audit events list for User B never leaks User A's events
        audit_b = api.client.get("/api/v1/audit-events", headers=hdr_b).json()
        with Session(engine) as db:
            user_b_id = str(
                uuid.UUID(
                    str(
                        db.scalar(
                            text("SELECT id FROM users WHERE email = 'tenant-b-sec@example.com'")
                        )
                    )
                )
            )
        assert all(ev["user_id"] == user_b_id for ev in audit_b)

        # ------------------------------------------------------------------
        # 2. CSV formula injection neutralization for '=', '+', '-', '@', '\t', '\r'
        # ------------------------------------------------------------------
        formula_cases = {
            "=": "=CMD|' /C calc'!A0",
            "+": "+SUM(1,1)",
            "-": "-2+3+cmd",
            "@": "@SUM(A1:A2)",
            "\t": "\t=1+1",
            "\r": "\r=1+1",
        }
        with Session(engine) as db:
            owner_a_uuid = uuid.UUID(
                str(
                    db.scalar(
                        text("SELECT owner_id FROM projects WHERE id = :pid"),
                        {"pid": project_uuid.hex},
                    )
                )
            )
            rep_svc = ReportingService(db, artifact_dir=str(artifact_dir))
            for idx, (prefix, payload) in enumerate(formula_cases.items(), start=1):
                rep_svc.record_run_result(
                    owner_a_uuid,
                    project_uuid,
                    ReportRunCreateInput(
                        source_sha256=source_sha256,
                        suite_name=payload,
                        function_name=f"fn_{idx}",
                        provider="groq",
                        model="llama-3.3-70b-versatile",
                        strategy="L1",
                        repeat_index=idx,
                        status="COMPLETED",
                        error_message=f"Leaked {SYNTHETIC_GROQ_KEY} with prefix {prefix!r}",
                    ),
                )

        csv_text = api.client.get(
            f"/api/v1/projects/{project_id}/reports/exports/runs.csv",
            headers=hdr_a,
        ).text
        assert SYNTHETIC_GROQ_KEY not in csv_text
        assert custom_secret not in csv_text
        csv_rows = list(csv.DictReader(io.StringIO(csv_text)))
        suites_in_csv = {r["function_name"]: r["suite_name"] for r in csv_rows}
        for idx, (_prefix, payload) in enumerate(formula_cases.items(), start=1):
            assert suites_in_csv[f"fn_{idx}"] == f"'{payload}"

        # ------------------------------------------------------------------
        # 3. Backup credential exclusion & tampered hash rejection (422)
        # ------------------------------------------------------------------
        backup_res = api.client.post(
            f"/api/v1/projects/{project_id}/audit/backup-export",
            headers=hdr_a,
        )
        assert backup_res.status_code == 200
        bundle = backup_res.json()
        assert custom_secret not in backup_res.text
        assert SYNTHETIC_GROQ_KEY not in backup_res.text
        assert "provider_credentials" not in bundle
        assert "ai_configs" not in bundle

        # Tamper 1: modify top-level bundle_sha256 -> 422 INPUT_INVALID
        tampered_bundle_sha = copy.deepcopy(bundle)
        tampered_bundle_sha["bundle_sha256"] = "0" * 64
        r_bad_bundle = api.client.post(
            "/api/v1/audit/backup-restore",
            headers=hdr_a,
            json=tampered_bundle_sha,
        )
        assert r_bad_bundle.status_code == 422
        assert r_bad_bundle.json()["detail"]["code"] == "INPUT_INVALID"

        # Tamper 2: modify source code inside bundle without updating hashes -> 422 INPUT_INVALID
        tampered_source = copy.deepcopy(bundle)
        tampered_source["sources"][0]["versions"][0]["code"] = "def clamp():\n    return 999\n"
        r_bad_source = api.client.post(
            "/api/v1/audit/backup-restore",
            headers=hdr_a,
            json=tampered_source,
        )
        assert r_bad_source.status_code == 422
        assert r_bad_source.json()["detail"]["code"] == "INPUT_INVALID"

        # Tamper 3: inject unexpected provider_credentials key into bundle -> 422 INPUT_INVALID
        tampered_extra_key = copy.deepcopy(bundle)
        tampered_extra_key["provider_credentials"] = [{"provider": "groq", "api_key": "leaked"}]
        r_bad_extra = api.client.post(
            "/api/v1/audit/backup-restore",
            headers=hdr_a,
            json=tampered_extra_key,
        )
        assert r_bad_extra.status_code == 422
        assert r_bad_extra.json()["detail"]["code"] == "INPUT_INVALID"
