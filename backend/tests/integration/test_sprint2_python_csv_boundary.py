import hashlib
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.infrastructure.database.base import Base
from app.infrastructure.database.session import get_db
from app.main import app
from app.modules.auth.dependencies import current_user
from app.modules.auth.models import User
from app.modules.datasets.models import Dataset  # noqa: F401 - register metadata
from app.modules.projects.service import ProjectService
from app.modules.sources.models import Source  # noqa: F401 - register metadata
from app.modules.sources.service import MAX_SOURCE_BYTES


@pytest.fixture
def boundary_api():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    owner_id, other_id = uuid.uuid4(), uuid.uuid4()

    with Session(engine) as db:
        db.add_all(
            [
                User(id=owner_id, email="owner@example.com", password_digest="unused"),
                User(id=other_id, email="other@example.com", password_digest="unused"),
            ]
        )
        db.commit()
        project_service = ProjectService(db)
        owner_project_id = project_service.create(owner_id, "Owner Primary Project", None).id
        owner_second_project_id = project_service.create(
            owner_id, "Owner Secondary Project", None
        ).id
        other_project_id = project_service.create(other_id, "Other User Project", None).id

    active_user = {"target": "owner"}

    def db_override():
        with Session(engine) as db:
            yield db

    def user_override():
        if active_user["target"] == "owner":
            return User(id=owner_id, email="owner@example.com", password_digest="unused")
        return User(id=other_id, email="other@example.com", password_digest="unused")

    def switch_user(target: str) -> None:
        active_user["target"] = target

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[current_user] = user_override
    with TestClient(app) as client:
        yield {
            "client": client,
            "owner_id": owner_id,
            "other_id": other_id,
            "project_id": owner_project_id,
            "second_project_id": owner_second_project_id,
            "other_project_id": other_project_id,
            "switch_user": switch_user,
        }
    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 1. Python source upload & paste boundaries (FR-PYS-001..004)
# ---------------------------------------------------------------------------


def test_python_source_valid_utf8_multiple_functions_paste_and_upload(boundary_api):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/sources"

    code_v1 = (
        '"""Mathematically pure helper module with UTF-8 symbols: α, β, ∑."""\n'
        "import math\n"
        "from decimal import Decimal\n\n"
        "def hypotenuse(a: float, b: float) -> float:\n"
        '    """Compute √(a² + b²)."""\n'
        "    return math.hypot(a, b)\n\n"
        "def clamp_decimal(val: int, low: int, high: int) -> Decimal:\n"
        "    return Decimal(max(low, min(val, high)))\n\n"
        "def factorial_sum(n: int) -> int:\n"
        "    return math.factorial(n) + 1\n"
    )
    expected_sha_v1 = hashlib.sha256(code_v1.encode("utf-8")).hexdigest()

    pasted = client.post(base, json={"code": code_v1})
    assert pasted.status_code == 201
    pasted_data = pasted.json()
    assert pasted_data["revision"] == 1
    assert pasted_data["sha256"] == expected_sha_v1
    assert pasted_data["byte_size"] == len(code_v1.encode("utf-8"))
    assert pasted_data["functions"] == [
        {"name": "hypotenuse", "line": 5},
        {"name": "clamp_decimal", "line": 9},
        {"name": "factorial_sum", "line": 12},
    ]

    code_v2 = (
        "import statistics\n\n"
        "def mean_value(items: list[float]) -> float:\n"
        "    return statistics.mean(items)\n\n"
        "def median_value(items: list[float]) -> float:\n"
        "    return statistics.median(items)\n"
    )
    raw_v2 = code_v2.encode("utf-8")
    uploaded = client.post(
        base,
        content=raw_v2,
        headers={"Content-Type": "text/x-python; charset=utf-8"},
    )
    assert uploaded.status_code == 201
    uploaded_data = uploaded.json()
    assert uploaded_data["revision"] == 1
    assert uploaded_data["sha256"] == hashlib.sha256(raw_v2).hexdigest()
    assert uploaded_data["byte_size"] == len(raw_v2)
    assert uploaded_data["functions"] == [
        {"name": "mean_value", "line": 3},
        {"name": "median_value", "line": 6},
    ]


@pytest.mark.parametrize(
    "bad_code",
    [
        "def broken(:\n    return 1\n",
        "def unclosed(a, b:\n    return a + b\n",
        "def bad_indent():\nreturn 1\n",
    ],
)
def test_python_source_rejects_syntax_errors_with_422(boundary_api, bad_code):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/sources"

    res_json = client.post(base, json={"code": bad_code})
    assert res_json.status_code == 422
    assert "Invalid Python syntax" in res_json.json()["detail"]

    res_raw = client.post(
        base,
        content=bad_code.encode("utf-8"),
        headers={"Content-Type": "text/x-python"},
    )
    assert res_raw.status_code == 422
    assert "Invalid Python syntax" in res_raw.json()["detail"]
    assert client.get(base).json() == []


@pytest.mark.parametrize(
    ("dangerous_code", "expected_fragment"),
    [
        ("import os\ndef run():\n    return os.system('id')\n", "Unsupported import 'os'"),
        (
            "import subprocess\ndef run():\n    return subprocess.Popen(['id'])\n",
            "Unsupported import 'subprocess'",
        ),
        (
            "import socket\ndef connect():\n    return socket.socket()\n",
            "Unsupported import 'socket'",
        ),
        (
            "from os import system\ndef run():\n    return system('id')\n",
            "Unsupported import 'os'",
        ),
        (
            "from math import *\ndef f(x):\n    return sin(x)\n",
            "Wildcard import is unsupported",
        ),
        ("def run_eval(expr):\n    return eval(expr)\n", "Unsupported call 'eval'"),
        ("def run_exec(stmt):\n    exec(stmt)\n", "Unsupported call 'exec'"),
        ("def read_secret():\n    return open('/etc/passwd')\n", "Unsupported call 'open'"),
        (
            "def dyn_import():\n    return __import__('os')\n",
            "Unsupported call '__import__'",
        ),
        ("async def coro():\n    return 1\n", "Async functions are unsupported"),
        ("@decorator\ndef decorated():\n    return 1\n", "Decorators are unsupported"),
        ("SIDE_EFFECT = 1\ndef f():\n    return SIDE_EFFECT\n", "Top-level behavior is unsupported"),
        ("def gen():\n    yield 1\n", "Unsupported behavior"),
    ],
)
def test_python_source_blocks_dangerous_imports_and_calls_without_execution(
    boundary_api, dangerous_code, expected_fragment
):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/sources"

    res = client.post(base, json={"code": dangerous_code})
    assert res.status_code == 422
    assert expected_fragment in res.json()["detail"]
    assert client.get(base).json() == []


@pytest.mark.parametrize(
    "empty_or_functionless",
    [
        "",
        "   \n\t  \n",
        "# comment only\n",
        '"""Module docstring without functions."""\nimport math\n',
    ],
)
def test_python_source_rejects_empty_whitespace_and_functionless_code(
    boundary_api, empty_or_functionless
):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/sources"

    res = client.post(base, json={"code": empty_or_functionless})
    assert res.status_code == 422

    raw_res = client.post(
        base,
        content=empty_or_functionless.encode("utf-8"),
        headers={"Content-Type": "text/x-python"},
    )
    assert raw_res.status_code == 422
    assert client.get(base).json() == []


def test_python_source_size_limit_and_encoding_boundaries(boundary_api):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/sources"

    # Non-UTF-8 raw upload is rejected with 422
    bad_utf8 = client.post(
        base,
        content=b"\xff\xfe\x00def f(): pass\n",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert bad_utf8.status_code == 422
    assert "UTF-8" in bad_utf8.json()["detail"]

    # Exact MAX_SOURCE_BYTES boundary succeeds (201)
    prefix = "def max_boundary():\n    return '"
    suffix = "'\n"
    filler_len = MAX_SOURCE_BYTES - len(prefix) - len(suffix)
    exact_max_code = f"{prefix}{'a' * filler_len}{suffix}"
    assert len(exact_max_code.encode("utf-8")) == MAX_SOURCE_BYTES

    exact_res = client.post(base, json={"code": exact_max_code})
    assert exact_res.status_code == 201
    assert exact_res.json()["byte_size"] == MAX_SOURCE_BYTES

    # MAX_SOURCE_BYTES + 1 via JSON paste is rejected by service boundary with 422
    over_max_code = f"{prefix}{'a' * (filler_len + 1)}{suffix}"
    assert len(over_max_code.encode("utf-8")) == MAX_SOURCE_BYTES + 1
    over_json_res = client.post(base, json={"code": over_max_code})
    assert over_json_res.status_code == 422
    assert f"1 to {MAX_SOURCE_BYTES} bytes" in over_json_res.json()["detail"]

    # MAX_SOURCE_BYTES + 1 via raw upload stream is rejected with 413
    over_raw_res = client.post(
        base,
        content=over_max_code.encode("utf-8"),
        headers={"Content-Type": "text/x-python"},
    )
    assert over_raw_res.status_code == 413


def test_python_source_immutable_sha256_revision_incrementing(boundary_api):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/sources"

    v1_code = "def compute(x):\n    return x + 1\n"
    v2_code = "def compute(x):\n    return x + 2\n\ndef helper(y):\n    return y * 2\n"
    v3_code = "def compute(x):\n    return x + 3\n"

    sha1 = hashlib.sha256(v1_code.encode("utf-8")).hexdigest()
    sha2 = hashlib.sha256(v2_code.encode("utf-8")).hexdigest()
    sha3 = hashlib.sha256(v3_code.encode("utf-8")).hexdigest()

    r1 = client.post(base, json={"code": v1_code})
    assert r1.status_code == 201
    source_id = r1.json()["source_id"]
    assert r1.json()["revision"] == 1
    assert r1.json()["sha256"] == sha1

    # Adding new version increments revision to 2
    r2 = client.post(f"{base}/{source_id}/versions", json={"code": v2_code})
    assert r2.status_code == 201
    assert r2.json()["revision"] == 2
    assert r2.json()["sha256"] == sha2

    # Re-uploading identical code is idempotent (keeps revision 2)
    r2_dup = client.post(
        f"{base}/{source_id}/versions",
        content=v2_code.encode("utf-8"),
        headers={"Content-Type": "text/x-python"},
    )
    assert r2_dup.status_code == 201
    assert r2_dup.json()["revision"] == 2
    assert r2_dup.json()["sha256"] == sha2

    # Invalid version upload does not advance revision
    bad_ver = client.post(
        f"{base}/{source_id}/versions",
        json={"code": "import subprocess\ndef compute(x): return x\n"},
    )
    assert bad_ver.status_code == 422

    # Adding third distinct version increments revision to 3
    r3 = client.post(f"{base}/{source_id}/versions", json={"code": v3_code})
    assert r3.status_code == 201
    assert r3.json()["revision"] == 3
    assert r3.json()["sha256"] == sha3

    versions = client.get(f"{base}/{source_id}/versions").json()
    assert [(v["revision"], v["sha256"]) for v in versions] == [
        (1, sha1),
        (2, sha2),
        (3, sha3),
    ]

    # Historical versions remain immutable
    ver1 = client.get(f"{base}/{source_id}/versions/1").json()
    ver2 = client.get(f"{base}/{source_id}/versions/2").json()
    ver3 = client.get(f"{base}/{source_id}/versions/3").json()
    assert ver1["code"] == v1_code and ver1["sha256"] == sha1
    assert ver2["code"] == v2_code and ver2["sha256"] == sha2
    assert ver3["code"] == v3_code and ver3["sha256"] == sha3
    assert client.get(f"{base}/{source_id}/versions/99").status_code == 404


# ---------------------------------------------------------------------------
# 2. CSV dataset preview, import, mapping & row selection boundaries (FR-CSV-001..006)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("csv_bytes", "expected_delimiter", "expected_headers"),
    [
        (
            b"task_id,function_name,expected_output\nT1,add,3\n",
            ",",
            ["task_id", "function_name", "expected_output"],
        ),
        (
            "\ufefftask_id;function_name;expected_output\r\nT1;add;3\r\n".encode(),
            ";",
            ["task_id", "function_name", "expected_output"],
        ),
    ],
)
def test_csv_preview_and_import_utf8_bom_and_delimiter_detection(
    boundary_api, csv_bytes, expected_delimiter, expected_headers
):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/datasets"

    preview = client.post(
        f"{base}/preview",
        content=csv_bytes,
        headers={"Content-Type": "text/csv; charset=utf-8"},
    )
    assert preview.status_code == 200
    preview_json = preview.json()
    assert preview_json["delimiter"] == expected_delimiter
    assert preview_json["headers"] == expected_headers
    assert preview_json["row_count"] == 1
    assert preview_json["preview_rows"] == [{"row_number": 2, "values": ["T1", "add", "3"]}]

    mapping = json.dumps(
        {
            "task_id": "task_id",
            "function_name": "function_name",
            "expected_output": "expected_output",
        }
    )
    imported = client.post(
        f"{base}/import",
        params={"mapping": mapping},
        content=csv_bytes,
        headers={"Content-Type": "text/csv"},
    )
    assert imported.status_code == 201
    row = imported.json()["rows"][0]
    assert row["row_number"] == 2
    assert row["task_id"] == "T1"
    assert row["function_name"] == "add"
    assert row["expected_output"] == 3
    assert row["status"] == "preview_only"


@pytest.mark.parametrize(
    ("bad_csv", "expected_field"),
    [
        (b"", "file"),
        (b"\xff\xfeinvalid", "file"),
        (b"function_name\nf\x00g\n", "file"),
        (b"function_name,task_id;extra\nf,T1;x\n", "delimiter"),
        (b"function_name\n", "rows"),
        (b"function_name,\nf,1\n", "headers"),
        (b"function_name, function_name \nf,g\n", "headers"),
        (b"function_name,task_id\nf\n", "rows.2"),
        (b'function_name,task_id\n"unclosed,T1\n', "rows.2"),
    ],
)
def test_csv_preview_and_import_reject_malformed_csv_with_422(
    boundary_api, bad_csv, expected_field
):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/datasets"
    params = {"mapping": json.dumps({"function_name": "function_name"})}

    for endpoint in ("preview", "import"):
        res = client.post(
            f"{base}/{endpoint}",
            params=params,
            content=bad_csv,
            headers={"Content-Type": "text/csv"},
        )
        assert res.status_code == 422
        detail = res.json()["detail"]
        assert detail["code"] == "CSV_SCHEMA"
        assert expected_field in detail["fields"]

    assert client.get(base).json() == []


@pytest.mark.parametrize(
    ("bad_mapping", "expected_field"),
    [
        (json.dumps({"task_id": "ID"}), "mapping.function_name"),
        (
            json.dumps({"function_name": "MISSING_COL"}),
            "mapping.function_name",
        ),
        (
            json.dumps({"function_name": "Fn", "unknown_canonical": "ID"}),
            "mapping",
        ),
        ('{"function_name": "Fn", "function_name": "ID"}', "mapping"),
    ],
)
def test_csv_import_rejects_missing_or_invalid_canonical_columns_with_422(
    boundary_api, bad_mapping, expected_field
):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/datasets"

    res = client.post(
        f"{base}/import",
        params={"mapping": bad_mapping},
        content=b"ID,Fn\nT1,solve\n",
        headers={"Content-Type": "text/csv"},
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "CSV_SCHEMA"
    assert expected_field in detail["fields"]
    assert client.get(base).json() == []


def test_csv_row_validation_physical_line_tracking_and_immutable_selection_snapshots(
    boundary_api,
):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    base = f"/api/v1/projects/{project_id}/datasets"

    # Physical lines:
    # Line 1: header
    # Line 2-3: T01 (valid, multiline source, expected_output=0, input_data=false) -> row_number=2
    # Line 4: empty physical line (skipped)
    # Line 5: T02 (valid, expected_output={"ok": true}) -> row_number=5
    # Line 6: T03 (preview_only, no embedded python_source) -> row_number=6
    # Line 7: T03 (invalid: duplicate task_id T03) -> row_number=7
    # Line 8: T05 (invalid: function_name is Python keyword 'class') -> row_number=8
    # Line 9: T06 (invalid: expected_output is not valid JSON) -> row_number=9
    # Line 10-12: T07 (invalid: embedded 3-line source has disallowed import os) -> row_number=10
    # Line 13: T08 (invalid: function missing in embedded source) -> row_number=13
    csv_text = (
        "ID,Fn,Code,Expected,Input\r\n"
        'T01,is_zero,"def is_zero(x):\r\n    return 0",0,false\r\n'
        "\r\n"
        'T02,make_flag,"def make_flag(): return True","{""ok"": true}","[1, 2]"\r\n'
        "T03,needs_ref,,42,\r\n"
        'T03,dup_task,"def dup_task(): return 1",1,\r\n'
        'T05,class,"def f(): return 1",1,\r\n'
        'T06,bad_json,"def bad_json(): return 1",{not_json},\r\n'
        'T07,evil,"import os\n\ndef evil(): return 1",1,\r\n'
        'T08,missing_fn,"def other_fn(): return 1",1,\r\n'
    )
    mapping = json.dumps(
        {
            "task_id": "ID",
            "function_name": "Fn",
            "python_source": "Code",
            "expected_output": "Expected",
            "input_data": "Input",
        }
    )

    imported = client.post(
        f"{base}/import",
        params={"mapping": mapping},
        content=csv_text.encode("utf-8"),
        headers={"Content-Type": "text/csv"},
    )
    assert imported.status_code == 201
    v1 = imported.json()
    dataset_id = v1["dataset_id"]
    assert v1["revision"] == 1
    assert v1["selected_rows"] == []
    sha_v1 = v1["sha256"]

    rows_by_num = {r["row_number"]: r for r in v1["rows"]}
    assert list(rows_by_num.keys()) == [2, 5, 6, 7, 8, 9, 10, 13]

    assert rows_by_num[2]["status"] == "valid"
    assert rows_by_num[2]["expected_output"] == 0
    assert rows_by_num[2]["input_data"] is False
    assert rows_by_num[2]["runtime_status"] == "N/A"
    assert rows_by_num[2]["execution_enabled"] is False
    assert rows_by_num[2]["source_sha256"] is not None

    assert rows_by_num[5]["status"] == "valid"
    assert rows_by_num[5]["expected_output"] == {"ok": True}
    assert rows_by_num[5]["input_data"] == [1, 2]

    assert rows_by_num[6]["status"] == "preview_only"
    assert rows_by_num[6]["reasons"] == ["Reference source is required"]
    assert rows_by_num[6]["source_sha256"] is None

    assert rows_by_num[7]["status"] == "invalid"
    assert any("Duplicate task_id T03" in reason for reason in rows_by_num[7]["reasons"])

    assert rows_by_num[8]["status"] == "invalid"
    assert any("Python identifier" in reason for reason in rows_by_num[8]["reasons"])

    assert rows_by_num[9]["status"] == "invalid"
    assert any("expected_output must be valid JSON" in reason for reason in rows_by_num[9]["reasons"])

    assert rows_by_num[10]["status"] == "invalid"
    assert any("Unsupported import 'os'" in reason for reason in rows_by_num[10]["reasons"])

    assert rows_by_num[13]["status"] == "invalid"
    assert any(
        "Function missing_fn not found in embedded source" in reason
        for reason in rows_by_num[13]["reasons"]
    )

    # Selecting preview_only (row 6) or invalid rows (7..11) or empty selection is rejected (422)
    for bad_selection in ([], [6], [7], [2, 8], [2, 2], [999]):
        bad_res = client.post(
            f"{base}/{dataset_id}/selection", json={"row_numbers": bad_selection}
        )
        assert bad_res.status_code == 422
        assert bad_res.json()["detail"]["code"] == "CSV_ROW_INVALID"

    # Selecting valid rows (5, 2) sorts row numbers and creates immutable revision 2
    sel_v2 = client.post(f"{base}/{dataset_id}/selection", json={"row_numbers": [5, 2]})
    assert sel_v2.status_code == 200
    v2 = sel_v2.json()
    assert v2["revision"] == 2
    assert v2["selected_rows"] == [2, 5]
    sha_v2 = v2["sha256"]
    assert sha_v2 != sha_v1

    # Narrowing selection to [2] creates immutable revision 3
    sel_v3 = client.post(f"{base}/{dataset_id}/selection", json={"row_numbers": [2]})
    assert sel_v3.status_code == 200
    v3 = sel_v3.json()
    assert v3["revision"] == 3
    assert v3["selected_rows"] == [2]
    sha_v3 = v3["sha256"]
    assert len({sha_v1, sha_v2, sha_v3}) == 3

    # Verify historical dataset snapshots remain immutable
    assert client.get(f"{base}/{dataset_id}/versions/1").json()["selected_rows"] == []
    assert client.get(f"{base}/{dataset_id}/versions/1").json()["sha256"] == sha_v1
    assert client.get(f"{base}/{dataset_id}/versions/2").json()["selected_rows"] == [2, 5]
    assert client.get(f"{base}/{dataset_id}/versions/2").json()["sha256"] == sha_v2
    assert client.get(f"{base}/{dataset_id}/versions/3").json()["selected_rows"] == [2]
    assert client.get(f"{base}/{dataset_id}/versions/3").json()["sha256"] == sha_v3


# ---------------------------------------------------------------------------
# 3. Python-to-CSV reference link & cross-owner isolation
# ---------------------------------------------------------------------------


def test_python_to_csv_reference_linking_revalidates_rows_and_preserves_history(
    boundary_api,
):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    sources_url = f"/api/v1/projects/{project_id}/sources"
    datasets_url = f"/api/v1/projects/{project_id}/datasets"

    # Create Python source revision 1 with alpha() and beta(), then revision 2 with only alpha()
    src_v1 = client.post(
        sources_url,
        json={"code": "def alpha(x):\n    return x + 1\n\ndef beta(x):\n    return x * 2\n"},
    )
    assert src_v1.status_code == 201
    source_id = src_v1.json()["source_id"]
    src_v1_sha = src_v1.json()["sha256"]

    src_v2 = client.post(
        f"{sources_url}/{source_id}/versions",
        json={"code": "def alpha(x):\n    return x + 10\n"},
    )
    assert src_v2.status_code == 201
    src_v2_sha = src_v2.json()["sha256"]

    # Create CSV dataset with 3 reference-dependent rows: alpha, beta, gamma
    created_ds = client.post(
        datasets_url,
        json={
            "rows": [
                {"row_number": 2, "task_id": "R1", "function_name": "alpha", "expected_output": "2"},
                {"row_number": 3, "task_id": "R2", "function_name": "beta", "expected_output": "4"},
                {"row_number": 4, "task_id": "R3", "function_name": "gamma", "expected_output": "6"},
            ]
        },
    )
    assert created_ds.status_code == 201
    dataset_id = created_ds.json()["dataset_id"]
    assert [r["status"] for r in created_ds.json()["rows"]] == [
        "preview_only",
        "preview_only",
        "preview_only",
    ]

    # Link dataset to Python source revision 1 -> alpha and beta become valid, gamma is invalid
    link_r1 = client.post(
        f"{datasets_url}/{dataset_id}/reference",
        json={"source_id": source_id, "revision": 1},
    )
    assert link_r1.status_code == 200
    ds_v2 = link_r1.json()
    assert ds_v2["revision"] == 2
    assert ds_v2["reference_source_id"] == source_id
    assert ds_v2["reference_revision"] == 1
    assert [r["status"] for r in ds_v2["rows"]] == ["valid", "valid", "invalid"]
    assert ds_v2["rows"][0]["source_sha256"] == src_v1_sha
    assert ds_v2["rows"][1]["source_sha256"] == src_v1_sha
    assert ds_v2["rows"][2]["source_sha256"] is None
    assert "Function gamma not found in reference source" in ds_v2["rows"][2]["reasons"]

    # Select rows 2 and 3 (both valid under source revision 1) -> dataset revision 3
    sel = client.post(
        f"{datasets_url}/{dataset_id}/selection",
        json={"row_numbers": [2, 3]},
    )
    assert sel.status_code == 200
    assert sel.json()["revision"] == 3
    assert sel.json()["selected_rows"] == [2, 3]

    # Relink dataset to Python source revision 2 (where beta was removed) -> dataset revision 4
    # Row 3 becomes invalid and is automatically dropped from selected_rows!
    link_r2 = client.post(
        f"{datasets_url}/{dataset_id}/reference",
        json={"source_id": source_id, "revision": 2},
    )
    assert link_r2.status_code == 200
    ds_v4 = link_r2.json()
    assert ds_v4["revision"] == 4
    assert ds_v4["reference_revision"] == 2
    assert [r["status"] for r in ds_v4["rows"]] == ["valid", "invalid", "invalid"]
    assert ds_v4["rows"][0]["source_sha256"] == src_v2_sha
    assert ds_v4["selected_rows"] == [2]

    # Revision 3 remains untouched with selected_rows == [2, 3] and reference_revision == 1
    ds_v3_historical = client.get(f"{datasets_url}/{dataset_id}/versions/3").json()
    assert ds_v3_historical["selected_rows"] == [2, 3]
    assert ds_v3_historical["reference_revision"] == 1


def test_reference_link_rejects_other_project_and_other_owner_sources_with_404(
    boundary_api,
):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    second_project_id = boundary_api["second_project_id"]
    other_project_id = boundary_api["other_project_id"]
    switch_user = boundary_api["switch_user"]

    # Owner creates a dataset and a source in project 1
    ds_res = client.post(
        f"/api/v1/projects/{project_id}/datasets",
        json={"rows": [{"row_number": 2, "function_name": "target_fn"}]},
    )
    assert ds_res.status_code == 201
    dataset_id = ds_res.json()["dataset_id"]

    p1_src = client.post(
        f"/api/v1/projects/{project_id}/sources",
        json={"code": "def target_fn():\n    return 1\n"},
    )
    assert p1_src.status_code == 201
    p1_source_id = p1_src.json()["source_id"]

    # Owner creates a source in their second project
    p2_src = client.post(
        f"/api/v1/projects/{second_project_id}/sources",
        json={"code": "def target_fn():\n    return 2\n"},
    )
    assert p2_src.status_code == 201
    p2_source_id = p2_src.json()["source_id"]

    # Other user creates a source in their own project
    switch_user("other")
    other_src = client.post(
        f"/api/v1/projects/{other_project_id}/sources",
        json={"code": "def target_fn():\n    return 3\n"},
    )
    assert other_src.status_code == 201
    other_source_id = other_src.json()["source_id"]

    # Switch back to owner and attempt cross-project & cross-user reference links
    switch_user("owner")
    ref_url = f"/api/v1/projects/{project_id}/datasets/{dataset_id}/reference"

    # Linking to owner's source from another project -> 404
    cross_project_res = client.post(
        ref_url, json={"source_id": p2_source_id, "revision": 1}
    )
    assert cross_project_res.status_code == 404

    # Linking to another user's source -> 404
    cross_owner_res = client.post(
        ref_url, json={"source_id": other_source_id, "revision": 1}
    )
    assert cross_owner_res.status_code == 404

    # Linking to non-existent revision of owned source -> 404
    missing_rev_res = client.post(
        ref_url, json={"source_id": p1_source_id, "revision": 99}
    )
    assert missing_rev_res.status_code == 404


def test_cross_user_ownership_isolation_across_all_source_and_dataset_endpoints(
    boundary_api,
):
    client: TestClient = boundary_api["client"]
    project_id = boundary_api["project_id"]
    other_project_id = boundary_api["other_project_id"]
    switch_user = boundary_api["switch_user"]

    sources_base = f"/api/v1/projects/{project_id}/sources"
    datasets_base = f"/api/v1/projects/{project_id}/datasets"

    src = client.post(sources_base, json={"code": "def owned_fn():\n    return 1\n"})
    assert src.status_code == 201
    source_id = src.json()["source_id"]

    ds = client.post(
        datasets_base,
        json={
            "rows": [
                {
                    "row_number": 2,
                    "function_name": "owned_fn",
                    "python_source": "def owned_fn():\n    return 1\n",
                }
            ]
        },
    )
    assert ds.status_code == 201
    dataset_id = ds.json()["dataset_id"]

    # Switch to other user: every source and dataset endpoint on owner's project must return 404
    switch_user("other")

    assert client.get(sources_base).status_code == 404
    assert client.post(sources_base, json={"code": "def f(): pass\n"}).status_code == 404
    assert client.get(f"{sources_base}/{source_id}/versions").status_code == 404
    assert client.get(f"{sources_base}/{source_id}/versions/1").status_code == 404
    assert (
        client.post(
            f"{sources_base}/{source_id}/versions", json={"code": "def f(): pass\n"}
        ).status_code
        == 404
    )

    assert client.get(datasets_base).status_code == 404
    assert (
        client.post(
            datasets_base, json={"rows": [{"row_number": 2, "function_name": "f"}]}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{datasets_base}/preview",
            content=b"function_name\nf\n",
            headers={"Content-Type": "text/csv"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{datasets_base}/import",
            params={"mapping": '{"function_name":"function_name"}'},
            content=b"function_name\nf\n",
            headers={"Content-Type": "text/csv"},
        ).status_code
        == 404
    )
    assert client.get(f"{datasets_base}/{dataset_id}").status_code == 404
    assert client.get(f"{datasets_base}/{dataset_id}/versions/1").status_code == 404
    assert (
        client.post(
            f"{datasets_base}/{dataset_id}/selection", json={"row_numbers": [2]}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{datasets_base}/{dataset_id}/reference",
            json={"source_id": source_id, "revision": 1},
        ).status_code
        == 404
    )

    # Also verify other user cannot access owner's source_id / dataset_id via their own project URL
    other_sources_base = f"/api/v1/projects/{other_project_id}/sources"
    other_datasets_base = f"/api/v1/projects/{other_project_id}/datasets"
    assert client.get(f"{other_sources_base}/{source_id}/versions").status_code == 404
    assert client.get(f"{other_datasets_base}/{dataset_id}").status_code == 404
