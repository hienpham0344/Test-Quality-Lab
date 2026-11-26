"""Executions API and worker (FR-EXE-001..004, FR-EVL-002) — #45–#49.

The default launcher is disabled, so real runs end BLOCKED. Runner outcomes are exercised with a fake
launcher that returns canned runner output; no generated code is executed."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.infrastructure.llm import ProviderId
from app.infrastructure.llm.mock import MockLLMAdapter, MockSuccess
from app.infrastructure.sandbox.launcher import LaunchRequest, LaunchResult
from app.infrastructure.sandbox.policy import SandboxPolicy
from app.infrastructure.sandbox.results import JUNIT_BEGIN, JUNIT_END
from app.modules.audit.models import AuditEvent
from app.modules.execution import router as execution_router
from app.modules.execution.models import Execution
from app.modules.execution.service import ExecutionWorker
from app.modules.generation.models import GenerationRun
from app.modules.generation.service import GenerationExecutionService
from tests.integration.test_generation_retry_cancel import (  # noqa: F401 — fixture reuse
    _create_and_freeze_snapshot,
    gen_qa_api,
)

GOOD_TEST = "from target import divide\n\ndef test_divide():\n    assert divide(6, 2) == 3.0\n\ndef test_zero():\n    assert divide(0, 1) == 0\n"
JUNIT_OK = (
    '<testsuite tests="2"><testcase classname="test_generated" name="test_divide" time="0.01"/>'
    '<testcase classname="test_generated" name="test_zero" time="0.02"><failure message="assert 1 == 0"/></testcase>'
    "</testsuite>"
)


@pytest.fixture
def exec_api(gen_qa_api, monkeypatch, tmp_path):  # noqa: F811
    api = gen_qa_api
    queued: list[uuid.UUID] = []
    monkeypatch.setattr(execution_router, "enqueue_execution", lambda eid: queued.append(eid) or f"task-{eid}")
    api["settings"].sandbox_workdir = str(tmp_path / "sandbox-work")
    api["queued"] = queued
    return api


def _eligible_run(api, content: str = GOOD_TEST, request_id: str = "req-exec") -> GenerationRun:
    client, proj_id = api["client"], api["proj_a_id"]
    snap_id = _create_and_freeze_snapshot(client, proj_id, api["src_a_id"], repeats=1,
                                          dataset_id=api["ds_a_id"], dataset_rev=api["ds_a_rev"])
    job_id = uuid.UUID(client.post(f"/api/v1/projects/{proj_id}/generation",
                                   json={"snapshot_id": snap_id, "request_id": request_id}).json()["job_id"])
    with Session(api["engine"]) as db:
        GenerationExecutionService(
            db, vault=api["vault"], settings=api["settings"],
            registry=MockLLMAdapter.build_registry(MockLLMAdapter(ProviderId.GROQ, steps=[MockSuccess(content=content)])),
        ).execute_job(job_id)
        run = db.scalars(select(GenerationRun).where(GenerationRun.job_id == job_id)).one()
        db.expunge(run)
        return run


class FakeLauncher:
    def __init__(self, result: Callable[[LaunchRequest, Callable[[], bool]], LaunchResult]):
        self.policy = SandboxPolicy()
        self.result = result
        self.requests: list[LaunchRequest] = []
        self.workspace_files: list[str] = []

    def run(self, request, should_cancel):
        self.requests.append(request)
        self.workspace_files = sorted(p.name for p in Path(request.workspace_host_path).iterdir())
        return self.result(request, should_cancel)


def _work(api, execution_id: str, launcher=None) -> Execution:
    with Session(api["engine"]) as db:
        execution = ExecutionWorker(db, launcher=launcher, settings=api["settings"]).run(uuid.UUID(execution_id))
        db.refresh(execution)
        db.expunge(execution)
        return execution


def test_trigger_records_oracle_policy_and_blocks_while_sandbox_disabled(exec_api):
    api = exec_api
    client, proj_id = api["client"], api["proj_a_id"]
    run = _eligible_run(api)
    created = client.post(f"/api/v1/projects/{proj_id}/executions", json={"suite_name": "Divide suite"})
    assert created.status_code == 201
    body = created.json()
    assert body["status"] == "QUEUED" and body["generation_run_id"] == str(run.id)
    assert body["total_cases"] == 2 and body["artifact_sha256"] == run.artifact_sha256
    assert body["sandbox_policy"]["network"] == "none" and body["sandbox_policy"]["timeout_seconds"] == 60
    assert body["sandbox_policy"]["memory"] == "1 GiB" and body["sandbox_policy"]["cpus"] == 1.0
    # FR-EVL-002: dataset expected value is traceable but not verified (no reference run yet).
    [row] = body["oracle"]["rows"]
    assert row["source"] == "DATASET_UNVERIFIED" and row["expected_output"] == "3.0"
    assert row["provenance"]["dataset_sha256"] and api["queued"] == [uuid.UUID(body["id"])]

    finished = _work(api, body["id"])  # default launcher: disabled
    assert finished.status == "BLOCKED"
    assert finished.error_info["code"] == "SANDBOX_DISABLED"
    assert finished.passed_cases == finished.failed_cases == 0 and finished.cases == []
    assert not any(Path(api["settings"].sandbox_workdir).iterdir())  # workspace cleaned
    detail = client.get(f"/api/v1/projects/{proj_id}/executions/{body['id']}").json()
    assert detail["status"] == "BLOCKED" and any(log["level"] == "SECURITY" for log in detail["logs"])
    listed = client.get(f"/api/v1/projects/{proj_id}/executions").json()
    assert [e["id"] for e in listed] == [body["id"]] and listed[0]["logs"] == [] and listed[0]["oracle"] is None

    with Session(api["engine"]) as db:
        actions = [e.action for e in db.scalars(select(AuditEvent)) if e.resource_id == uuid.UUID(body["id"])]
    assert actions == ["execution.started"]


def test_worker_records_runner_results_and_safe_logs(exec_api):
    api = exec_api
    _eligible_run(api)
    body = api["client"].post(f"/api/v1/projects/{api['proj_a_id']}/executions", json={}).json()
    out = f"collected 2 items\n{JUNIT_BEGIN}\n{JUNIT_OK}\n{JUNIT_END}\nkey=gsk_live_leaky_secret_1234567890\n"
    launcher = FakeLauncher(lambda req, _: LaunchResult(1, out + req.workspace_host_path, "", 420))
    finished = _work(api, body["id"], launcher)
    assert finished.status == "COMPLETED"  # the suite ran; one test failed
    assert (finished.passed_cases, finished.failed_cases, finished.total_cases) == (1, 1, 2)
    assert [c["status"] for c in finished.cases] == ["PASSED", "FAILED"] and finished.duration_ms == 420
    assert launcher.workspace_files == ["target.py", "test_generated.py"]
    assert launcher.requests[0].command[-1] == "test_generated.py"
    logs = str(finished.logs)
    assert "gsk_live_leaky_secret" not in logs and api["settings"].sandbox_workdir not in logs


@pytest.mark.parametrize(("result", "status", "code"), [
    (LaunchResult(None, "", "", 60000, timed_out=True), "TIMEOUT", "RUNNER_TIMEOUT"),
    (LaunchResult(78, "", "Sandbox execution is disabled", 5), "BLOCKED", "SANDBOX_DISABLED"),
    (LaunchResult(2, "interrupted", "", 5), "FAILED", "RUNNER_ERROR"),
    (LaunchResult(5, f"{JUNIT_BEGIN}<testsuite/>{JUNIT_END}", "", 5), "FAILED", "NO_TESTS_COLLECTED"),
    (LaunchResult(0, f"{JUNIT_BEGIN}<!DOCTYPE x><testsuite/>{JUNIT_END}", "", 5), "FAILED", "RUNNER_ERROR"),
])
def test_worker_never_turns_runner_problems_into_results(exec_api, result, status, code):
    api = exec_api
    _eligible_run(api)
    body = api["client"].post(f"/api/v1/projects/{api['proj_a_id']}/executions", json={}).json()
    finished = _work(api, body["id"], FakeLauncher(lambda *_: result))
    assert finished.status == status and finished.error_info["code"] == code
    assert finished.passed_cases == 0
    if status == "TIMEOUT":
        assert finished.timeout_cases == 2 and {c["status"] for c in finished.cases} == {"TIMEOUT"}


def test_cancel_queued_now_and_running_after_worker_confirms(exec_api):
    api = exec_api
    client, proj_id = api["client"], api["proj_a_id"]
    _eligible_run(api)
    url = f"/api/v1/projects/{proj_id}/executions"
    first = client.post(url, json={}).json()
    cancelled = client.post(f"{url}/{first['id']}/cancel", json={"reason": "Not needed"})
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
    assert cancelled.json()["cancel_reason"] == "Not needed" and cancelled.json()["cancelled_at"]
    assert _work(api, first["id"]).status == "CANCELLED"  # worker redelivery is a no-op
    again = client.post(f"{url}/{first['id']}/cancel", json={})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "EXECUTION_CANNOT_BE_CANCELLED"

    second = client.post(url, json={}).json()

    def cancel_while_running(_req, should_cancel):
        response = client.post(f"{url}/{second['id']}/cancel", json={})
        assert response.json()["status"] == "CANCELLING"
        assert should_cancel() is True
        return LaunchResult(None, "partial output", "", 900, cancelled=True)

    finished = _work(api, second["id"], FakeLauncher(cancel_while_running))
    assert finished.status == "CANCELLED" and finished.passed_cases == 0
    assert any("partial output" in log["message"] for log in finished.logs)


def test_ownership_eligibility_and_validation(exec_api):
    api = exec_api
    client, proj_id = api["client"], api["proj_a_id"]
    url = f"/api/v1/projects/{proj_id}/executions"
    no_artifact = client.post(url, json={})
    assert no_artifact.status_code == 422 and "generation_run_id" in no_artifact.json()["detail"]["fields"]

    bad = _eligible_run(api, content="def helper():\n    return 1\n", request_id="req-bad")
    not_eligible = client.post(url, json={"generation_run_id": str(bad.id)})
    assert not_eligible.status_code == 422
    assert client.post(url, json={"generation_run_id": str(uuid.uuid4())}).status_code == 404
    assert client.post(url, json={"source_id": str(api["src_b_id"]), "generation_run_id": str(bad.id)}).status_code == 422
    assert client.post(url, json={"unknown": 1}).status_code == 422
    assert client.get(f"{url}/{uuid.uuid4()}").status_code == 404

    good = _eligible_run(api, request_id="req-good")
    foreign_source = client.post(url, json={"source_id": str(api["src_b_id"]), "generation_run_id": str(good.id)})
    assert foreign_source.status_code == 404
    mine = client.post(url, json={"generation_run_id": str(good.id)}).json()
    api["state"]["user_id"] = api["owner_b"]
    assert client.get(url).status_code == 404
    assert client.get(f"{url}/{mine['id']}").status_code == 404
    assert client.post(f"{url}/{mine['id']}/cancel", json={}).status_code == 404
