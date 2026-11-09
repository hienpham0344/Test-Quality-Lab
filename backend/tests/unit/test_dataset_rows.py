import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.infrastructure.database.base import Base
from app.modules.auth.models import User
from app.modules.datasets.models import Dataset  # noqa: F401 - register tables
from app.modules.datasets.service import DatasetService, validate_rows
from app.modules.projects.service import ProjectService
from app.modules.sources.models import Source  # noqa: F401 - register tables
from app.modules.sources.service import SourceService


def test_validation_preserves_valid_rows_and_reports_each_invalid_row():
    rows = [
        {"row_number": 2, "task_id": "P01", "function_name": "square", "python_source": "def square(x):\n    return x*x\n", "expected_output": "0"},
        {"row_number": 3, "task_id": "P02", "function_name": "", "python_source": "def f(): pass"},
        {"row_number": 4, "task_id": "P03", "function_name": "bad", "python_source": "def bad(:"},
        {"row_number": 5, "task_id": "P01", "function_name": "other", "python_source": "def other(): pass"},
        {"row_number": 6, "task_id": "P06", "function_name": "missing"},
    ]
    result = validate_rows(rows)
    assert [r["status"] for r in result] == ["valid", "invalid", "invalid", "invalid", "preview_only"]
    assert result[0]["expected_output"] == 0
    assert result[0]["expected_output_provenance"] == "csv"
    assert "function_name is required" in result[1]["reasons"]
    assert any("syntax" in reason.lower() for reason in result[2]["reasons"])
    assert "Duplicate task_id P01" in result[3]["reasons"]
    assert result[4]["runtime_status"] == "N/A"
    assert result[4]["source_sha256"] is None
    assert all(r["execution_enabled"] is False for r in result)


@pytest.mark.parametrize("value", ['not json', '{"a":}', '', 'NaN', 'Infinity', '-Infinity', '1e999', '{"x": NaN}'])
def test_invalid_expected_output_is_not_guessed(value):
    result = validate_rows([{"row_number": 2, "function_name": "f", "python_source": "def f(): pass", "expected_output": value}])
    assert result[0]["status"] == "invalid"
    assert "expected_output must be valid JSON" in result[0]["reasons"]
    assert result[0]["expected_output"] is None


def test_oversized_json_number_is_reported_per_row():
    row = validate_rows([{"row_number": 2, "function_name": "f", "python_source": "def f(): pass", "expected_output": "9" * 5000}])[0]
    assert row["status"] == "invalid"
    assert "expected_output must be valid JSON" in row["reasons"]


def test_nonfinite_input_data_is_reported_per_row():
    row = validate_rows([{"row_number": 2, "function_name": "f", "python_source": "def f(): pass", "input_data": "[1e999]"}])[0]
    assert row["status"] == "invalid"
    assert "input_data must be valid JSON" in row["reasons"]


def test_linked_reference_must_contain_matching_function_and_pass_policy():
    rows = [{"row_number": 2, "function_name": "f"}]
    assert validate_rows(rows, reference_code="def f(): return 1")[0]["status"] == "valid"
    result = validate_rows(rows, reference_code="def g(): return 1")
    assert result[0]["status"] == "invalid"
    assert "Function f not found in reference source" in result[0]["reasons"]


def test_shared_reference_is_parsed_once_for_multiple_rows(monkeypatch):
    import app.modules.datasets.service as dataset_service

    inspect = dataset_service.inspect_python
    calls = []

    def counted(code):
        calls.append(code)
        return inspect(code)

    monkeypatch.setattr(dataset_service, "inspect_python", counted)
    rows = [{"row_number": number, "function_name": "f"} for number in range(2, 22)]
    result = validate_rows(rows, reference_code="def f(): pass")
    assert all(row["status"] == "valid" for row in result)
    assert len(calls) == 1


def test_row_type_policy_and_identifier_failures_are_isolated():
    result = validate_rows([
        {"row_number": 2, "function_name": 42, "python_source": "def f(): pass"},
        {"row_number": 3, "function_name": "f", "python_source": "import os\ndef f(): pass"},
        {"row_number": 4, "function_name": "for"},
        {"row_number": 5, "function_name": "f", "python_source": "def f(): pass", "input_data": "{broken}"},
        {"row_number": 6, "function_name": "f", "python_source": "def f(): pass"},
    ])
    assert [row["status"] for row in result] == ["invalid", "invalid", "invalid", "invalid", "valid"]
    assert any("Unsupported import" in reason for reason in result[1]["reasons"])
    assert "function_name must be a Python identifier" in result[2]["reasons"]
    assert "input_data must be valid JSON" in result[3]["reasons"]


def test_json_zero_and_null_keep_csv_provenance_without_inference():
    rows = validate_rows([
        {"row_number": 2, "function_name": "f", "python_source": "def f(): pass", "expected_output": "0", "input_data": "[1, 2]"},
        {"row_number": 3, "function_name": "g", "python_source": "def g(): pass", "expected_output": "null"},
        {"row_number": 4, "function_name": "h", "python_source": "def h(): pass"},
    ])
    assert rows[0]["expected_output"] == 0
    assert rows[0]["input_data"] == [1, 2]
    assert rows[0]["expected_output_provenance"] == "csv"
    assert rows[1]["expected_output"] is None
    assert rows[1]["expected_output_provenance"] == "csv"
    assert rows[2]["expected_output"] is None
    assert rows[2]["expected_output_provenance"] is None


def test_oversized_embedded_source_is_invalid_without_execution():
    code = "def f():\n    return '" + "x" * (1024 * 1024) + "'\n"
    row = validate_rows([{"row_number": 2, "function_name": "f", "python_source": code}])[0]
    assert row["status"] == "invalid"
    assert any("exceeds" in reason for reason in row["reasons"])
    assert row["execution_enabled"] is False


@pytest.fixture
def services():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        owner_id, other_id = uuid.uuid4(), uuid.uuid4()
        db.add_all([User(id=owner_id, email="owner@example.com", password_digest="unused"), User(id=other_id, email="other@example.com", password_digest="unused")])
        db.commit()
        project_id = ProjectService(db).create(owner_id, "Project", None).id
        yield DatasetService(db), SourceService(db), owner_id, other_id, project_id
    engine.dispose()


def test_selection_and_reference_link_make_immutable_owner_scoped_revisions(services):
    datasets, sources, owner_id, other_id, project_id = services
    initial = datasets.create(owner_id, project_id, [
        {"row_number": 2, "task_id": "P01", "function_name": "f"},
        {"row_number": 3, "task_id": "P02", "function_name": "g", "python_source": "def g(): return 1"},
        {"row_number": 4, "task_id": "P03", "function_name": "bad", "python_source": "def bad(:"},
    ])
    assert initial.revision == 1
    assert datasets.get(other_id, project_id, initial.dataset_id, 1) is None
    assert [row["status"] for row in initial.rows] == ["preview_only", "valid", "invalid"]
    with pytest.raises(ValueError, match="not selectable"):
        datasets.select(owner_id, project_id, initial.dataset_id, [2])
    with pytest.raises(ValueError, match="not selectable"):
        datasets.select(owner_id, project_id, initial.dataset_id, [4])
    with pytest.raises(ValueError, match="at least one"):
        datasets.select(owner_id, project_id, initial.dataset_id, [])
    selected = datasets.select(owner_id, project_id, initial.dataset_id, [3])
    assert selected.revision == 2
    assert selected.selected_rows == [3]
    assert initial.selected_rows == []
    source = sources.create(owner_id, project_id, b"def f(): return 2\n")
    linked = datasets.link_reference(owner_id, project_id, initial.dataset_id, source.source_id, 1)
    assert linked.revision == 3
    assert linked.rows[0]["status"] == "valid"
    assert linked.rows[0]["source_sha256"] == source.sha256
    assert linked.selected_rows == [3]
    assert datasets.get(owner_id, project_id, initial.dataset_id, 1).rows[0]["status"] == "preview_only"
    assert datasets.link_reference(other_id, project_id, initial.dataset_id, source.source_id, 1) is None


def test_duplicate_row_numbers_and_invalid_source_owner_are_rejected(services):
    datasets, sources, owner_id, other_id, project_id = services
    with pytest.raises(ValueError, match="row_number"):
        datasets.create(owner_id, project_id, [{"row_number": 2}, {"row_number": 2}])
    dataset = datasets.create(owner_id, project_id, [{"row_number": 2, "function_name": "f"}])
    source = sources.create(owner_id, project_id, b"def f(): pass\n")
    assert datasets.link_reference(other_id, project_id, dataset.dataset_id, source.source_id, 1) is None
    assert datasets.link_reference(owner_id, project_id, dataset.dataset_id, uuid.uuid4(), 1) is None


def test_link_to_different_reference_drops_no_longer_valid_selection(services):
    datasets, sources, owner_id, _, project_id = services
    dataset = datasets.create(owner_id, project_id, [
        {"row_number": 2, "function_name": "f"},
        {"row_number": 3, "function_name": "g"},
    ])
    first = sources.create(owner_id, project_id, b"def f(): pass\ndef g(): pass\n")
    linked = datasets.link_reference(owner_id, project_id, dataset.dataset_id, first.source_id, 1)
    selected = datasets.select(owner_id, project_id, dataset.dataset_id, [2, 3])
    second = sources.create(owner_id, project_id, b"def f(): pass\n")
    relinked = datasets.link_reference(owner_id, project_id, dataset.dataset_id, second.source_id, 1)
    assert linked.rows[1]["status"] == "valid"
    assert selected.selected_rows == [2, 3]
    assert relinked.rows[1]["status"] == "invalid"
    assert relinked.selected_rows == [2]
