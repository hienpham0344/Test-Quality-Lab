from __future__ import annotations

import base64
import json
import logging
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.exceptions import AppError, ErrorCode
from app.core.security import CredentialVault
from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.infrastructure.llm import (
    GeminiAdapter,
    GenerationParameters,
    LLMRequest,
    LLMUsage,
    OpenRouterAdapter,
    ProviderId,
)
from app.main import app
from app.modules.ai_config.dependencies import get_vault
from app.modules.ai_config.service import AIConfigService
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.datasets.service import DatasetService
from app.modules.projects.service import ProjectService
from app.modules.prompts.service import PromptRegistryService
from app.modules.sources.service import SourceService

KEY_1 = base64.urlsafe_b64encode(b"1" * 32).decode()
KEY_2 = base64.urlsafe_b64encode(b"2" * 32).decode()

# Build synthetic non-real test tokens at runtime so source text holds no raw token literals.
SYNTHETIC_GEMINI_SECRET = "".join(("AIza", "SyntheticE2EFixtureGeminiKey9901"))
SYNTHETIC_OPENROUTER_SECRET = "".join(("sk-or-v1-", "synthetic_e2e_fixture_openrouter_8802"))
SYNTHETIC_GROQ_SECRET = "".join(("gsk_", "synthetic_e2e_fixture_groq_7703"))

SOURCE_MODULE = (
    '"""Numeric utility module for Sprint 3 integration tests."""\n\n'
    "def clamp(value: int, low: int, high: int) -> int:\n"
    '    """Clamp value into the inclusive [low, high] range."""\n'
    "    return max(low, min(value, high))\n\n"
    "def safe_add(a: int, b: int) -> int:\n"
    '    """Return the integer sum of a and b."""\n'
    "    return a + b\n"
).encode("utf-8")


@pytest.fixture
def s3_env():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _enable_fk(connection, _) -> None:
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    owner_id = uuid.uuid4()

    with Session(engine) as db:
        db.add(User(id=owner_id, email="s3-owner@example.com", password_digest="unused"))
        db.commit()

        project = ProjectService(db).create(owner_id, "Sprint 3 E2E Lab", "Cross-module harness")
        src = SourceService(db).create(owner_id, project.id, SOURCE_MODULE)
        assert src is not None

        ds_svc = DatasetService(db)
        ds_v1 = ds_svc.create(
            owner_id,
            project.id,
            [
                {
                    "row_number": 2,
                    "task_id": "t1",
                    "function_name": "clamp",
                    "input_data": "[15, 0, 10]",
                    "expected_output": "10",
                },
                {
                    "row_number": 3,
                    "task_id": "t2",
                    "function_name": "safe_add",
                    "input_data": "[4, 5]",
                    "expected_output": "9",
                },
            ],
        )
        assert ds_v1 is not None
        ds_v2 = ds_svc.link_reference(
            owner_id, project.id, ds_v1.dataset_id, src.source_id, src.revision
        )
        assert ds_v2 is not None
        ds_v3 = ds_svc.select(owner_id, project.id, ds_v1.dataset_id, [2])
        assert ds_v3 is not None

        project_id = project.id
        source_id = src.source_id
        dataset_id = ds_v3.dataset_id
        dataset_rev = ds_v3.revision

    state: dict[str, Any] = {"user_id": owner_id, "keyring": f"k1:{KEY_1}"}

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = lambda: User(
        id=state["user_id"], email="s3-owner@example.com", password_digest="unused"
    )
    app.dependency_overrides[get_vault] = lambda: CredentialVault(state["keyring"])
    with TestClient(app) as client:
        yield {
            "client": client,
            "engine": engine,
            "owner_id": owner_id,
            "project_id": project_id,
            "source_id": source_id,
            "dataset_id": dataset_id,
            "dataset_rev": dataset_rev,
            "state": state,
        }
    app.dependency_overrides.clear()


def _approve_fixture_l1_prompt(client: TestClient, project_id: uuid.UUID) -> dict[str, Any]:
    """Register and approve a non-official L1 test fixture template (respecting SRS TBD-04)."""
    create_res = client.post(
        f"/api/v1/projects/{project_id}/prompts/L1/versions",
        json={
            "system_template": "Synthetic test fixture system prompt for {function_name}.",
            "user_template": (
                "Target: {function_signature}\n"
                "Docstring: {docstring}\n"
                "Code:\n{function_code}\n"
                "Cases:\n{csv_cases}"
            ),
            "notes": "Synthetic integration fixture only — NOT an official SRS TBD-04 template",
        },
    )
    assert create_res.status_code == 201
    version = create_res.json()["version"]
    approve_res = client.post(
        f"/api/v1/projects/{project_id}/prompts/L1/versions/{version}/approve"
    )
    assert approve_res.status_code == 200
    body: dict[str, Any] = approve_res.json()
    assert body["status"] == "APPROVED"
    return body


def test_full_sprint3_e2e_pipeline_with_gemini_and_openrouter_zero_secret_leakage(
    s3_env: dict[str, Any], caplog: pytest.LogCaptureFixture
) -> None:
    client: TestClient = s3_env["client"]
    engine = s3_env["engine"]
    owner_id: uuid.UUID = s3_env["owner_id"]
    project_id: uuid.UUID = s3_env["project_id"]
    source_id: uuid.UUID = s3_env["source_id"]
    dataset_id: uuid.UUID = s3_env["dataset_id"]
    dataset_rev: int = s3_env["dataset_rev"]
    state = s3_env["state"]

    caplog.set_level(logging.DEBUG)

    # 1. Save encrypted Gemini and OpenRouter credentials.
    gem_put = client.put(
        f"/api/v1/projects/{project_id}/ai-configs/gemini",
        json={
            "api_key": SYNTHETIC_GEMINI_SECRET,
            "default_model": "gemini-2.5-flash",
            "default_params": {"temperature": 0.1, "max_tokens": 512, "top_p": 0.9},
        },
    )
    assert gem_put.status_code == 200
    assert gem_put.json()["key_hint"] == "••••••••9901"
    assert SYNTHETIC_GEMINI_SECRET not in gem_put.text

    or_put = client.put(
        f"/api/v1/projects/{project_id}/ai-configs/openrouter",
        json={
            "api_key": SYNTHETIC_OPENROUTER_SECRET,
            "default_model": "openai/gpt-4o-mini",
            "default_params": {"temperature": 0.2, "max_tokens": 1024, "top_p": 0.95},
        },
    )
    assert or_put.status_code == 200
    assert or_put.json()["key_hint"] == "••••••••8802"
    assert SYNTHETIC_OPENROUTER_SECRET not in or_put.text

    # 2. Register and approve L1 prompt template.
    approved_prompt = _approve_fixture_l1_prompt(client, project_id)

    # 3. Validate, create, and freeze multi-provider experiment snapshot.
    exp_cfg = {
        "source_id": str(source_id),
        "source_revision": 1,
        "function_names": ["clamp"],
        "dataset_id": str(dataset_id),
        "dataset_revision": dataset_rev,
        "selected_rows": [2],
        "models": [
            {"provider": "gemini", "model": "gemini-2.5-flash"},
            {"provider": "openrouter", "model": "openai/gpt-4o-mini"},
        ],
        "strategies": ["L1"],
        "repeats": 1,
        "parameters": {
            "temperature": 0.15,
            "max_tokens": 768,
            "top_p": 0.9,
            "seed": 101,
            "timeout_seconds": 25.0,
        },
    }
    val_res = client.post(f"/api/v1/projects/{project_id}/experiments/validate", json=exp_cfg)
    assert val_res.status_code == 200
    assert val_res.json()["can_freeze"] is True
    assert val_res.json()["run_count"] == 2

    exp_res = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={"name": "Cross-Provider E2E", "description": "Gemini + OpenRouter", "config": exp_cfg},
    )
    assert exp_res.status_code == 201
    exp_id = exp_res.json()["id"]

    snap_res = client.post(f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots")
    assert snap_res.status_code == 201
    snapshot = snap_res.json()
    assert snapshot["run_count"] == 2
    assert len(snapshot["runs"]) == 2

    # Snapshot JSON must never leak plaintext secrets or raw vault ciphertext envelopes.
    for forbidden in (SYNTHETIC_GEMINI_SECRET, SYNTHETIC_OPENROUTER_SECRET, "v1:k1:"):
        assert forbidden not in snap_res.text

    frozen_fn = snapshot["frozen_functions"][0]
    matching_cases = [
        row for row in (snapshot["frozen_rows"] or []) if row.get("function_name") == "clamp"
    ]
    render_ctx = {
        "function_name": frozen_fn["name"],
        "function_signature": frozen_fn["signature"],
        "function_code": frozen_fn["code"],
        "module_code": snapshot["frozen_code"],
        "docstring": frozen_fn["docstring"],
        "csv_cases": json.dumps(
            matching_cases, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ),
    }

    captured_requests: dict[str, dict[str, Any]] = {}

    def gemini_handler(request: httpx.Request) -> httpx.Response:
        captured_requests["gemini"] = {
            "url": str(request.url),
            "header_key": request.headers.get("x-goog-api-key"),
            "body": json.loads(request.content.decode("utf-8")),
        }
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [{"text": "def test_clamp_high():\n    assert clamp(15, 0, 10) == 10"}]
                        },
                        "finishReason": "STOP",
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": 64,
                    "candidatesTokenCount": 28,
                    "totalTokenCount": 92,
                },
            },
        )

    def openrouter_handler(request: httpx.Request) -> httpx.Response:
        captured_requests["openrouter"] = {
            "url": str(request.url),
            "auth": request.headers.get("Authorization"),
            "referer": request.headers.get("HTTP-Referer"),
            "title": request.headers.get("X-Title"),
            "body": json.loads(request.content.decode("utf-8")),
        }
        return httpx.Response(
            200,
            json={
                "model": "openai/gpt-4o-mini",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "def test_clamp_bounds():\n    assert clamp(-3, 0, 10) == 0",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 70, "completion_tokens": 35, "total_tokens": 105},
            },
        )

    gemini_adapter = GeminiAdapter(
        base_url="https://generativelanguage.googleapis.com/v1beta",
        client=httpx.Client(transport=httpx.MockTransport(gemini_handler)),
    )
    openrouter_adapter = OpenRouterAdapter(
        base_url="https://openrouter.ai/api/v1",
        app_url="http://localhost:5173",
        app_title="Test Quality Lab",
        client=httpx.Client(transport=httpx.MockTransport(openrouter_handler)),
    )
    adapters = {"gemini": gemini_adapter, "openrouter": openrouter_adapter}

    frozen_params = GenerationParameters.model_validate(snapshot["frozen_parameters"])
    responses_by_provider = {}

    # 4. Resolve decrypted SecretStr + render approved domain prompt + execute mock adapters.
    with Session(engine) as db:
        vault = CredentialVault(state["keyring"])
        ai_svc = AIConfigService(db, vault)
        prompt_svc = PromptRegistryService(db)

        for run in snapshot["runs"]:
            provider_key = run["provider"]
            secret = ai_svc.resolve_api_key(owner_id, project_id, provider_key)
            assert isinstance(secret, SecretStr)
            assert SYNTHETIC_GEMINI_SECRET not in str(secret)
            assert SYNTHETIC_OPENROUTER_SECRET not in repr(secret)

            rendered = prompt_svc.render_approved_domain(
                owner_id, project_id, run["strategy"], render_ctx
            )
            assert rendered.template_sha256 == approved_prompt["sha256"]
            assert rendered.template_sha256 == run["prompt_sha256"]
            assert rendered.rendered_sha256 == run["rendered_prompt_sha256"]

            llm_req = LLMRequest(
                model=run["model"],
                system_prompt=rendered.rendered_system,
                user_prompt=rendered.rendered_user,
                parameters=frozen_params,
            )
            responses_by_provider[provider_key] = adapters[provider_key].generate(llm_req, secret)

    # Emit diagnostic log lines simulating accidental header logging to verify redaction.
    audit_logger = logging.getLogger("tql.sprint3.e2e")
    audit_logger.info(
        "Dispatched headers x-goog-api-key: %s and Authorization: Bearer %s",
        SYNTHETIC_GEMINI_SECRET,
        SYNTHETIC_OPENROUTER_SECRET,
    )

    # 5. Assert adapter payloads, parsed outputs, token usage, and zero log/snapshot secret leaks.
    gem_res = responses_by_provider["gemini"]
    assert gem_res.provider == ProviderId.GEMINI
    assert gem_res.model == "gemini-2.5-flash"
    assert "assert clamp(15, 0, 10) == 10" in gem_res.content
    assert gem_res.finish_reason == "STOP"
    assert gem_res.usage == LLMUsage(prompt_tokens=64, completion_tokens=28, total_tokens=92)
    assert captured_requests["gemini"]["header_key"] == SYNTHETIC_GEMINI_SECRET
    assert SYNTHETIC_GEMINI_SECRET not in captured_requests["gemini"]["url"]
    assert captured_requests["gemini"]["body"]["generationConfig"]["seed"] == 101

    or_res = responses_by_provider["openrouter"]
    assert or_res.provider == ProviderId.OPENROUTER
    assert or_res.model == "openai/gpt-4o-mini"
    assert "assert clamp(-3, 0, 10) == 0" in or_res.content
    assert or_res.finish_reason == "stop"
    assert or_res.usage == LLMUsage(prompt_tokens=70, completion_tokens=35, total_tokens=105)
    assert captured_requests["openrouter"]["auth"] == f"Bearer {SYNTHETIC_OPENROUTER_SECRET}"
    assert captured_requests["openrouter"]["referer"] == "http://localhost:5173"
    assert captured_requests["openrouter"]["body"]["seed"] == 101

    # Verify upstream error reflection is also scrubbed end-to-end.
    failing_or = OpenRouterAdapter(
        client=httpx.Client(
            transport=httpx.MockTransport(
                lambda _req: httpx.Response(
                    401, json={"error": f"Rejected key {SYNTHETIC_OPENROUTER_SECRET}"}
                )
            )
        )
    )
    with pytest.raises(AppError) as upstream_err:
        failing_or.generate(
            LLMRequest(model="openai/gpt-4o-mini", user_prompt="probe"),
            SecretStr(SYNTHETIC_OPENROUTER_SECRET),
        )
    assert upstream_err.value.code == ErrorCode.PROVIDER_UPSTREAM_ERROR
    assert SYNTHETIC_OPENROUTER_SECRET not in upstream_err.value.message

    for record in caplog.records:
        combined = f"{record.getMessage()} {record.msg} {record.exc_text or ''}"
        assert SYNTHETIC_GEMINI_SECRET not in combined
        assert SYNTHETIC_OPENROUTER_SECRET not in combined


def test_run_count_ceiling_exact_1000_succeeds_and_above_1000_fails_with_run_limit(
    s3_env: dict[str, Any],
) -> None:
    client: TestClient = s3_env["client"]
    project_id: uuid.UUID = s3_env["project_id"]
    source_id: uuid.UUID = s3_env["source_id"]

    assert (
        client.put(
            f"/api/v1/projects/{project_id}/ai-configs/openrouter",
            json={"api_key": SYNTHETIC_OPENROUTER_SECRET, "default_model": "openai/gpt-4o-mini"},
        ).status_code
        == 200
    )
    _approve_fixture_l1_prompt(client, project_id)

    # 1. Exact ceiling: 1 function * 1 model * 1 strategy * 1000 repeats == 1000 -> 200 OK.
    exact_1000_cfg = {
        "source_id": str(source_id),
        "source_revision": 1,
        "function_names": ["clamp", "clamp"],  # Deduplicates to 1 function before run_count math.
        "models": [{"provider": "openrouter", "model": "openai/gpt-4o-mini"}],
        "strategies": ["L1", "L1"],  # Deduplicates to 1 strategy.
        "repeats": 1000,
    }
    val_1000 = client.post(
        f"/api/v1/projects/{project_id}/experiments/validate", json=exact_1000_cfg
    )
    assert val_1000.status_code == 200
    assert val_1000.json()["run_count"] == 1000
    assert val_1000.json()["can_freeze"] is True

    create_1000 = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={"name": "Ceiling 1000", "config": exact_1000_cfg},
    )
    assert create_1000.status_code == 201
    exp_id = create_1000.json()["id"]
    assert create_1000.json()["run_count"] == 1000

    snap_1000 = client.post(f"/api/v1/projects/{project_id}/experiments/{exp_id}/snapshots")
    assert snap_1000.status_code == 201
    assert snap_1000.json()["run_count"] == 1000
    assert len(snap_1000.json()["runs"]) == 1000

    # 2. Exact boundary + 1: 1 function * 11 models * 1 strategy * 91 repeats == 1001 -> 422.
    over_1001_cfg = {
        "source_id": str(source_id),
        "source_revision": 1,
        "function_names": ["clamp"],
        "models": [
            {"provider": "openrouter", "model": f"openai/gpt-4o-mini-v{idx}"}
            for idx in range(1, 12)
        ],
        "strategies": ["L1"],
        "repeats": 91,
    }
    val_1001 = client.post(
        f"/api/v1/projects/{project_id}/experiments/validate", json=over_1001_cfg
    )
    assert val_1001.status_code == 422
    assert val_1001.json()["detail"]["code"] == "EXPERIMENT_RUN_LIMIT"

    # 3. 2 functions * 1 model * 1 strategy * 501 repeats == 1002 -> 422 on validate/create/patch.
    over_1002_cfg = {
        "source_id": str(source_id),
        "source_revision": 1,
        "function_names": ["clamp", "safe_add"],
        "models": [{"provider": "openrouter", "model": "openai/gpt-4o-mini"}],
        "strategies": ["L1"],
        "repeats": 501,
    }
    val_1002 = client.post(
        f"/api/v1/projects/{project_id}/experiments/validate", json=over_1002_cfg
    )
    assert val_1002.status_code == 422
    assert val_1002.json()["detail"]["code"] == "EXPERIMENT_RUN_LIMIT"

    create_1002 = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={"name": "Over Ceiling 1002", "config": over_1002_cfg},
    )
    assert create_1002.status_code == 422
    assert create_1002.json()["detail"]["code"] == "EXPERIMENT_RUN_LIMIT"

    patch_1002 = client.patch(
        f"/api/v1/projects/{project_id}/experiments/{exp_id}",
        json={"config": over_1002_cfg},
    )
    assert patch_1002.status_code == 422
    assert patch_1002.json()["detail"]["code"] == "EXPERIMENT_RUN_LIMIT"

    # Existing valid draft remains untouched after rejected patch.
    preserved = client.get(f"/api/v1/projects/{project_id}/experiments/{exp_id}")
    assert preserved.status_code == 200
    assert preserved.json()["run_count"] == 1000


def test_python_only_vs_dataset_snapshot_and_kek_rotation_preserves_snapshot_sha256(
    s3_env: dict[str, Any],
) -> None:
    client: TestClient = s3_env["client"]
    engine = s3_env["engine"]
    owner_id: uuid.UUID = s3_env["owner_id"]
    project_id: uuid.UUID = s3_env["project_id"]
    source_id: uuid.UUID = s3_env["source_id"]
    dataset_id: uuid.UUID = s3_env["dataset_id"]
    dataset_rev: int = s3_env["dataset_rev"]
    state = s3_env["state"]

    assert (
        client.put(
            f"/api/v1/projects/{project_id}/ai-configs/groq",
            json={"api_key": SYNTHETIC_GROQ_SECRET, "default_model": "llama-3.3-70b-versatile"},
        ).status_code
        == 200
    )
    _approve_fixture_l1_prompt(client, project_id)

    base_cfg: dict[str, Any] = {
        "source_id": str(source_id),
        "source_revision": 1,
        "function_names": ["clamp"],
        "models": [{"provider": "groq", "model": "llama-3.3-70b-versatile"}],
        "strategies": ["L1"],
        "repeats": 1,
        "parameters": {"temperature": 0.0, "max_tokens": 512, "top_p": 1.0, "seed": 7},
    }

    # Selecting CSV rows without attaching a dataset is rejected with 422 INPUT_INVALID.
    orphan_rows_res = client.post(
        f"/api/v1/projects/{project_id}/experiments/validate",
        json={**base_cfg, "dataset_id": None, "selected_rows": [2]},
    )
    assert orphan_rows_res.status_code == 422
    assert orphan_rows_res.json()["detail"]["code"] == "INPUT_INVALID"

    # 1. Freeze Python-only experiment snapshot (FR-EXP-004: dataset_id=None).
    py_exp_id = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={"name": "Python Only", "config": {**base_cfg, "dataset_id": None}},
    ).json()["id"]
    py_snap_res = client.post(f"/api/v1/projects/{project_id}/experiments/{py_exp_id}/snapshots")
    assert py_snap_res.status_code == 201
    py_snap = py_snap_res.json()
    assert py_snap["dataset_id"] is None
    assert py_snap["dataset_revision"] is None
    assert py_snap["dataset_sha256"] is None
    assert py_snap["frozen_rows"] is None
    assert py_snap["frozen_selected_rows"] is None

    # 2. Freeze dataset-backed experiment snapshot on identical function/model/strategy/params.
    ds_exp_id = client.post(
        f"/api/v1/projects/{project_id}/experiments",
        json={
            "name": "Dataset Backed",
            "config": {
                **base_cfg,
                "dataset_id": str(dataset_id),
                "dataset_revision": dataset_rev,
                "selected_rows": [2],
            },
        },
    ).json()["id"]
    ds_snap_res = client.post(f"/api/v1/projects/{project_id}/experiments/{ds_exp_id}/snapshots")
    assert ds_snap_res.status_code == 201
    ds_snap = ds_snap_res.json()
    assert ds_snap["dataset_id"] == str(dataset_id)
    assert ds_snap["dataset_revision"] == dataset_rev
    assert isinstance(ds_snap["dataset_sha256"], str) and len(ds_snap["dataset_sha256"]) == 64
    assert ds_snap["frozen_selected_rows"] == [2]
    assert len(ds_snap["frozen_rows"]) == 1
    assert ds_snap["frozen_rows"][0]["task_id"] == "t1"

    # Source hash matches, while rendered prompt hash, run hash, and snapshot hash diverge.
    assert py_snap["source_sha256"] == ds_snap["source_sha256"]
    assert py_snap["runs"][0]["rendered_prompt_sha256"] != ds_snap["runs"][0]["rendered_prompt_sha256"]
    assert py_snap["runs"][0]["run_hash"] != ds_snap["runs"][0]["run_hash"]
    assert py_snap["snapshot_sha256"] != ds_snap["snapshot_sha256"]

    py_sha_before = py_snap["snapshot_sha256"]
    ds_sha_before = ds_snap["snapshot_sha256"]

    # 3. Rotate CREDENTIAL_ENCRYPTION_KEYS to k2 and re-encrypt stored credential.
    state["keyring"] = f"k2:{KEY_2},k1:{KEY_1}"
    cfg_list = client.get(f"/api/v1/projects/{project_id}/ai-configs")
    assert cfg_list.status_code == 200
    assert cfg_list.json()[0]["needs_rotation"] is True

    rot_res = client.post(f"/api/v1/projects/{project_id}/ai-configs/groq/rotate-encryption")
    assert rot_res.status_code == 200
    assert rot_res.json()["key_id"] == "k2"
    assert rot_res.json()["needs_rotation"] is False

    # Existing frozen snapshots must retain identical snapshot_sha256 and provenance metadata.
    refetched_py = client.get(
        f"/api/v1/projects/{project_id}/experiments/{py_exp_id}/snapshots/{py_snap['id']}"
    ).json()
    refetched_ds = client.get(
        f"/api/v1/projects/{project_id}/experiments/{ds_exp_id}/snapshots/{ds_snap['id']}"
    ).json()
    assert refetched_py == py_snap
    assert refetched_ds == ds_snap
    assert refetched_py["snapshot_sha256"] == py_sha_before
    assert refetched_ds["snapshot_sha256"] == ds_sha_before

    # Even after retiring legacy key k1, resolve_api_key decrypts cleanly with k2 alone.
    with Session(engine) as db:
        k2_only_vault = CredentialVault(f"k2:{KEY_2}")
        resolved = AIConfigService(db, k2_only_vault).resolve_api_key(
            owner_id, project_id, "groq"
        )
        assert resolved.get_secret_value() == SYNTHETIC_GROQ_SECRET


def test_openapi_schema_audit_excludes_encrypted_secret_and_plaintext_api_key_on_outputs(
    s3_env: dict[str, Any],
) -> None:
    client: TestClient = s3_env["client"]
    res = client.get("/openapi.json")
    assert res.status_code == 200
    openapi = res.json()
    schemas: dict[str, dict[str, Any]] = openapi["components"]["schemas"]

    audited_output_models = (
        "ProviderCredentialOutput",
        "SnapshotDetailOutput",
        "PromptVersionOutput",
        "SnapshotSummaryOutput",
        "SnapshotRunOutput",
        "ExperimentOutput",
        "ExperimentValidationOutput",
        "PromptTemplateSummary",
        "PromptRenderOutput",
    )
    for model_name in audited_output_models:
        assert model_name in schemas, f"Missing expected response schema {model_name}"
        props = schemas[model_name].get("properties", {})
        assert "encrypted_secret" not in props, f"{model_name} leaked encrypted_secret"
        assert "api_key" not in props, f"{model_name} leaked plaintext api_key"

    # Input-only credential schema marks api_key as password/write-only and never appears in 2xx responses.
    cred_input_props = schemas["ProviderCredentialInput"]["properties"]
    assert cred_input_props["api_key"].get("format") == "password"
    assert cred_input_props["api_key"].get("writeOnly") is True

    def _collect_refs(node: Any) -> set[str]:
        refs: set[str] = set()
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
                refs.add(ref.rsplit("/", 1)[-1])
            for val in node.values():
                refs.update(_collect_refs(val))
        elif isinstance(node, list):
            for item in node:
                refs.update(_collect_refs(item))
        return refs

    for path, path_item in openapi["paths"].items():
        for method, operation in path_item.items():
            if not isinstance(operation, dict):
                continue
            for status_code, resp_spec in operation.get("responses", {}).items():
                if not str(status_code).startswith("2"):
                    continue
                referenced = _collect_refs(resp_spec)
                assert "ProviderCredentialInput" not in referenced, (
                    f"{method.upper()} {path} ({status_code}) returned ProviderCredentialInput"
                )
                for schema_name in referenced:
                    props = schemas.get(schema_name, {}).get("properties", {})
                    assert "encrypted_secret" not in props
                    assert "api_key" not in props
