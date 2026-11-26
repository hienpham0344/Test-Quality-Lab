"""Generation raw response (#39, FR-GEN-002), parse/validate (#40, FR-GEN-003/004) and provider error
classification (#41, FR-GEN-005, FR-AIC-004). Uses the deterministic mock provider; no network."""

from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.llm import ProviderId
from app.infrastructure.llm.base import ProviderHTTPError, parse_retry_after
from app.infrastructure.llm.mock import MockHTTPError, MockLLMAdapter, MockSuccess, MockTimeout
from app.modules.generation.artifacts import StageState, check_generated_output, static_collect
from app.modules.generation.errors import ProviderErrorKind, RunErrorCode, classify_run_error
from app.modules.generation.models import GenerationJob, GenerationRun
from app.modules.generation.service import GenerationExecutionService, TransientGenerationError
from tests.integration.test_generation_retry_cancel import (  # noqa: F401 — fixture reuse
    _create_and_freeze_snapshot,
    gen_qa_api,
)


@pytest.fixture
def gen_api(gen_qa_api):  # noqa: F811 — wraps the shared fixture from test_generation_retry_cancel
    return gen_qa_api


GOOD_TEST = "```python\nfrom module import divide\n\ndef test_divide():\n    assert divide(6, 2) == 3.0\n```\n"


# ---------------------------------------------------------------- #40 static checks (unit)

def test_check_passes_every_static_stage_and_marks_execution_not_verified():
    check = check_generated_output(GOOD_TEST, "divide")
    assert check.eligible and check.parsed
    assert check.parsed_code == "from module import divide\n\ndef test_divide():\n    assert divide(6, 2) == 3.0\n"
    assert check.collected_tests == ["test_divide"]
    stages = check.to_json()["stages"]
    assert stages == {
        "generated": "PASSED", "parsed": "PASSED", "syntax_valid": "PASSED", "structure_valid": "PASSED",
        "target_linked": "PASSED", "collected": "PASSED", "executable": "NOT_VERIFIED",
    }
    assert check.to_json()["schema_version"] == "pytest-module/v1"


@pytest.mark.parametrize(
    ("raw", "failed_stage"),
    [
        ("", "parsed"),
        ("   \n", "parsed"),
        ("def test_x(:\n    pass", "syntax_valid"),
        ("def helper():\n    return 1\n", "structure_valid"),
        ("def test_x():\n    pass\n", "structure_valid"),
        ("def test_x():\n    assert 1 == 1\n", "target_linked"),
    ],
)
def test_check_reports_the_first_failing_stage_and_skips_later_ones(raw, failed_stage):
    check = check_generated_output(raw, "divide")
    assert not check.eligible
    assert check.failed_stage == failed_stage
    assert check.stages[failed_stage] == StageState.FAILED
    stage_names = list(check.stages)
    later = stage_names[stage_names.index(failed_stage) + 1 : -1]
    assert all(check.stages[name] == StageState.SKIPPED for name in later)
    assert check.stages["generated"] == StageState.PASSED
    assert check.reason


def test_static_collection_follows_pytest_default_rules():
    import ast

    tree = ast.parse(
        "def test_a(): assert f()\n"
        "def helper(): pass\n"
        "class TestB:\n    def test_c(self): assert f()\n    def other(self): pass\n"
        "class TestInit:\n    def __init__(self): pass\n    def test_d(self): assert f()\n"
        "class Helper:\n    def test_e(self): assert f()\n"
    )
    assert static_collect(tree) == ["test_a", "TestB::test_c"]


def test_collection_fails_when_only_non_collectable_tests_exist():
    raw = "class TestInit:\n    def __init__(self):\n        pass\n    def test_d(self):\n        assert divide(1, 1) == 1\n"
    check = check_generated_output(raw, "divide")
    assert check.failed_stage == "collected"


# ---------------------------------------------------------------- #41 classification (unit)

@pytest.mark.parametrize(
    ("exc", "kind", "code", "retryable", "pauses"),
    [
        (ProviderHTTPError("groq returned HTTP 401: bad key", status_code=401), ProviderErrorKind.AUTH,
         RunErrorCode.PROVIDER_AUTH_FAILED, False, False),
        (ProviderHTTPError("HTTP 429: You exceeded your current quota", status_code=429), ProviderErrorKind.QUOTA,
         RunErrorCode.PROVIDER_QUOTA_EXHAUSTED, False, True),
        (ProviderHTTPError("HTTP 402: payment required", status_code=402), ProviderErrorKind.QUOTA,
         RunErrorCode.PROVIDER_QUOTA_EXHAUSTED, False, True),
        (ProviderHTTPError("HTTP 429: slow down", status_code=429, retry_after=7), ProviderErrorKind.RATE_LIMIT,
         RunErrorCode.PROVIDER_RATE_LIMITED, True, True),
        (ProviderHTTPError("HTTP 503: overloaded", status_code=503), ProviderErrorKind.SERVICE,
         RunErrorCode.PROVIDER_UNAVAILABLE, True, False),
        (ProviderHTTPError("HTTP 400: bad model", status_code=400), ProviderErrorKind.BAD_REQUEST,
         RunErrorCode.PROVIDER_BAD_REQUEST, False, False),
        (AppError(ErrorCode.PROVIDER_UPSTREAM_ERROR, "groq returned HTTP 504: gateway"), ProviderErrorKind.SERVICE,
         RunErrorCode.PROVIDER_UNAVAILABLE, True, False),
        (AppError(ErrorCode.PROVIDER_UPSTREAM_ERROR, "groq returned malformed JSON response"),
         ProviderErrorKind.UNKNOWN, RunErrorCode.UNKNOWN_PROVIDER_ERROR, False, False),
        (httpx.ConnectError("refused"), ProviderErrorKind.SERVICE, RunErrorCode.PROVIDER_UNAVAILABLE, True, False),
        (TimeoutError("slow"), ProviderErrorKind.TIMEOUT, RunErrorCode.PROVIDER_TIMEOUT, False, False),
        (RuntimeError("boom"), ProviderErrorKind.UNKNOWN, RunErrorCode.UNKNOWN_PROVIDER_ERROR, False, False),
        (AppError(ErrorCode.CREDENTIAL_MISSING, "no key"), ProviderErrorKind.CREDENTIAL, "CREDENTIAL_MISSING",
         False, False),
    ],
)
def test_classify_run_error(exc, kind, code, retryable, pauses):
    result = classify_run_error(exc)
    assert (result.kind, result.code, result.retryable, result.pauses_provider) == (kind, code, retryable, pauses)


def test_retry_after_parsing_and_countdown_bounds():
    assert parse_retry_after("12") == 12.0
    assert parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT") is None
    assert parse_retry_after("-1") is None
    assert parse_retry_after(None) is None
    assert TransientGenerationError("x").countdown == 5.0
    assert TransientGenerationError("x", retry_after=0.1).countdown == 1.0
    assert TransientGenerationError("x", retry_after=9999).countdown == 300.0


# ---------------------------------------------------------------- worker + API (integration)

def _start(api, repeats: int, request_id: str) -> tuple[str, uuid.UUID]:
    client = api["client"]
    proj_id = api["proj_a_id"]
    snap_id = _create_and_freeze_snapshot(client, proj_id, api["src_a_id"], repeats=repeats)
    started = client.post(f"/api/v1/projects/{proj_id}/generation",
                          json={"snapshot_id": snap_id, "request_id": request_id})
    assert started.status_code == 202
    return snap_id, uuid.UUID(started.json()["job_id"])


def _execute(api, job_id: uuid.UUID, adapter: MockLLMAdapter, max_attempts: int = 3) -> GenerationJob:
    with Session(api["engine"]) as db:
        return GenerationExecutionService(
            db, vault=api["vault"], registry=MockLLMAdapter.build_registry(adapter),
            settings=api["settings"], max_attempts=max_attempts,
        ).execute_job(job_id)


def _runs(api, job_id: uuid.UUID) -> list[GenerationRun]:
    with Session(api["engine"]) as db:
        return list(db.scalars(select(GenerationRun).where(GenerationRun.job_id == job_id)
                               .order_by(GenerationRun.ordinal)))


def test_raw_response_metadata_parsed_artifact_and_artifacts_endpoint(gen_api):
    api = gen_api
    client, proj_id = api["client"], api["proj_a_id"]
    _, job_id = _start(api, 3, "req-artifacts")
    adapter = MockLLMAdapter(ProviderId.GROQ, steps=[
        MockSuccess(content=GOOD_TEST),
        MockSuccess(content="Sorry, I cannot help with that."),
        MockSuccess(content=""),
    ])
    assert _execute(api, job_id, adapter).status == "FAILED"  # not every run completed

    good, prose, empty = _runs(api, job_id)
    # FR-GEN-002: raw text kept unchanged; metadata has hashes and usage, never the key.
    assert good.generated_code == GOOD_TEST
    meta = good.response_metadata
    assert meta["model_requested"] == "llama-3.3-70b-versatile"
    assert meta["finish_reason"] == "stop" and meta["usage"]["total_tokens"] == 64
    assert len(meta["user_prompt_sha256"]) == 64 and meta["response_chars"] == len(GOOD_TEST)
    assert "gsk_live" not in str(meta)
    # FR-GEN-003/004: fenced code extracted; artifact file holds the parsed module.
    assert good.status == "COMPLETED" and good.validation["eligible"] is True
    artifact = (api["artifact_dir"] / good.artifact_relpath).read_text(encoding="utf-8")
    assert artifact == good.parsed_code and "```" not in artifact

    # Prose is not valid Python: Generated, but not Syntax valid (stages stay separate, FR-GEN-004).
    assert prose.status == "COMPLETED"
    assert prose.validation["eligible"] is False
    assert prose.validation["failed_stage"] in {"syntax_valid", "structure_valid"}

    # An empty response cannot be parsed: Parsing Failed, raw response kept (empty), no artifact.
    assert empty.status == "FAILED"
    assert empty.error_info["stage"] == "parse" and empty.error_info["code"] == "ARTIFACT_INVALID"
    assert empty.generated_code == "" and empty.artifact_relpath is None

    res = client.get(f"/api/v1/projects/{proj_id}/generation/runs/{good.id}/artifacts")
    assert res.status_code == 200
    body = res.json()
    assert body["raw_response"] == GOOD_TEST and body["parsed_test"] == good.parsed_code
    assert body["validation"]["stages"]["executable"] == "NOT_VERIFIED"
    failed = client.get(f"/api/v1/projects/{proj_id}/generation/runs/{empty.id}/artifacts").json()
    assert failed["parsed_test"] is None and failed["error"]["stage"] == "parse"

    dashboard = client.get(f"/api/v1/projects/{proj_id}/generation").json()
    by_id = {r["id"]: r for r in dashboard["runs"]}
    assert by_id[str(good.id)]["artifact_eligible"] is True
    assert by_id[str(empty.id)]["validation_failed_stage"] == "parsed"

    assert client.get(f"/api/v1/projects/{proj_id}/generation/runs/{uuid.uuid4()}/artifacts").status_code == 404
    api["state"]["user_id"] = api["owner_b"]
    foreign = client.get(f"/api/v1/projects/{proj_id}/generation/runs/{good.id}/artifacts")
    assert foreign.status_code == 404 and "def test" not in foreign.text


def test_failed_run_has_no_fake_response(gen_api):
    api = gen_api
    _, job_id = _start(api, 1, "req-no-fake")
    _execute(api, job_id, MockLLMAdapter(ProviderId.GROQ, steps=[MockTimeout()]))
    [run] = _runs(api, job_id)
    assert run.status == "TIMEOUT"
    assert run.generated_code is None and run.response_metadata is None and run.parsed_code is None


def test_quota_exhaustion_pauses_unsent_runs_and_keeps_completed_ones(gen_api):
    api = gen_api
    _, job_id = _start(api, 4, "req-quota")
    adapter = MockLLMAdapter(ProviderId.GROQ, steps=[
        MockSuccess(content=GOOD_TEST),
        MockHTTPError(status_code=429, body="You exceeded your current quota"),
    ])
    job = _execute(api, job_id, adapter)
    assert job.status == "FAILED"
    first, quota, *unsent = _runs(api, job_id)
    assert first.status == "COMPLETED" and first.artifact_sha256  # completed result kept
    assert quota.status == "FAILED" and quota.error_info["code"] == "PROVIDER_QUOTA_EXHAUSTED"
    assert [r.status for r in unsent] == ["FAILED", "FAILED"]
    assert all(r.error_info["code"] == "PROVIDER_PAUSED" and r.attempt_count == 0 for r in unsent)
    assert len(adapter.calls) == 2  # paused runs were never sent
    assert job.error_summary == {
        "code": "PROVIDER_QUOTA_EXHAUSTED", "provider": "groq",
        "first_failed_run_id": str(quota.id), "first_failed_ordinal": quota.ordinal,
        "unsent_runs": 2, "retry_after_seconds": None,
        "occurred_at": job.error_summary["occurred_at"],
    }
    jobs = api["client"].get(f"/api/v1/projects/{api['proj_a_id']}/generation").json()["jobs"]
    assert jobs[0]["error_summary"]["unsent_runs"] == 2


def test_rate_limit_retries_with_retry_after_then_pauses_when_exhausted(gen_api):
    api = gen_api
    _, job_id = _start(api, 2, "req-rate")
    limited = MockHTTPError(status_code=429, body="Rate limit reached", retry_after=12)
    adapter = MockLLMAdapter(ProviderId.GROQ, steps=[limited, limited])
    with pytest.raises(TransientGenerationError) as retry:
        _execute(api, job_id, adapter, max_attempts=2)
    assert retry.value.countdown == 12.0
    assert _runs(api, job_id)[0].status == "QUEUED"

    job = _execute(api, job_id, adapter, max_attempts=2)  # second attempt: retries exhausted
    first, second = _runs(api, job_id)
    assert first.status == "FAILED" and first.error_info["code"] == "PROVIDER_RATE_LIMITED"
    assert second.error_info["code"] == "PROVIDER_PAUSED"
    assert job.error_summary["retry_after_seconds"] == 12


def test_unknown_error_is_recorded_and_never_completed(gen_api):
    api = gen_api
    _, job_id = _start(api, 1, "req-unknown")

    def explode(_request, _key, _idx):
        raise RuntimeError("unexpected adapter crash")

    _execute(api, job_id, MockLLMAdapter(ProviderId.GROQ, steps=[explode]))
    [run] = _runs(api, job_id)
    assert run.status == "FAILED"
    assert run.error_info["code"] == "UNKNOWN_PROVIDER_ERROR" and run.error_info["occurred_at"]
