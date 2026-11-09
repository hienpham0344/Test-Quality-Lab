"""Validate normalized CSV rows and preserve immutable selection snapshots.

This module inspects Python syntax and policy only. It never executes CSV code.
"""

import hashlib
import json
import keyword
import math
import uuid

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.modules.datasets.models import Dataset, DatasetVersion
from app.modules.datasets.repository import DatasetRepository
from app.modules.sources.policy import SourcePolicyError, inspect_python
from app.modules.sources.repository import SourceRepository
from app.modules.sources.service import MAX_SOURCE_BYTES

MAX_ROWS = 10_000


def _strict_json(value: str):
    def reject_constant(_: str):
        raise ValueError("Non-finite JSON number")

    parsed = json.loads(value, parse_constant=reject_constant)
    pending = [parsed]
    while pending:
        item = pending.pop()
        if isinstance(item, float) and not math.isfinite(item):
            raise ValueError("Non-finite JSON number")
        if isinstance(item, list):
            pending.extend(item)
        elif isinstance(item, dict):
            pending.extend(item.values())
    return parsed


def _snapshot_hash(rows: list[dict], selected: list[int], source_id: uuid.UUID | None, revision: int | None) -> str:
    payload = {"rows": rows, "selected": selected, "source_id": str(source_id) if source_id else None, "revision": revision}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()


def validate_rows(input_rows: list[dict], *, reference_code: str | None = None, reference_sha256: str | None = None) -> list[dict]:
    """Validate canonical rows from the CSV mapping stage; keep every source row."""
    seen_ids: set[str] = set()
    validated: list[dict] = []
    reference_names: set[str] | None = None
    reference_error: str | None = None
    reference_checked = False
    for raw in input_rows:
        number = raw["row_number"]
        reasons: list[str] = []
        function_name = raw.get("function_name")
        task_id = raw.get("task_id")
        code = raw.get("python_source")
        expected = None
        expected_provenance = None
        input_data = None
        if not isinstance(function_name, str) or not function_name.strip():
            reasons.append("function_name is required")
            function_name = None
        else:
            function_name = function_name.strip()
            if not function_name.isidentifier() or keyword.iskeyword(function_name):
                reasons.append("function_name must be a Python identifier")
        if task_id is not None:
            if not isinstance(task_id, str):
                reasons.append("task_id must be a string")
            elif task_id.strip():
                task_id = task_id.strip()
                if task_id in seen_ids:
                    reasons.append(f"Duplicate task_id {task_id}")
                seen_ids.add(task_id)
            else:
                task_id = None
        for field in ("description", "task_title", "difficulty"):
            if field in raw and raw[field] is not None and not isinstance(raw[field], str):
                reasons.append(f"{field} must be a string")
        for field in ("expected_output", "input_data"):
            if field in raw and raw[field] is not None:
                if not isinstance(raw[field], str):
                    reasons.append(f"{field} must be a JSON string")
                else:
                    try:
                        value = _strict_json(raw[field])
                    except (ValueError, RecursionError):
                        reasons.append(f"{field} must be valid JSON")
                    else:
                        if field == "expected_output":
                            expected = value
                            expected_provenance = "csv"
                        else:
                            input_data = value
        if code is not None and not isinstance(code, str):
            reasons.append("python_source must be a string")
            code = None
        code = code if code and code.strip() else None
        oversized_code = bool(code and len(code.encode("utf-8")) > MAX_SOURCE_BYTES)
        if oversized_code:
            reasons.append(f"python_source exceeds {MAX_SOURCE_BYTES} bytes")
        source = code or reference_code
        source_sha256 = hashlib.sha256(code.encode("utf-8")).hexdigest() if code and not oversized_code else reference_sha256
        if source and not oversized_code:
            source_error = False
            if code:
                try:
                    names = {item.name for item in inspect_python(code)}
                except SourcePolicyError as exc:
                    reasons.append(str(exc))
                    names = set()
                    source_error = True
            else:
                if not reference_checked:
                    try:
                        reference_names = {item.name for item in inspect_python(source)}
                    except SourcePolicyError as exc:
                        reference_error = str(exc)
                    reference_checked = True
                names = reference_names or set()
                if reference_error:
                    reasons.append(reference_error)
                    source_error = True
            if function_name and function_name not in names and not source_error:
                origin = "embedded" if code else "reference"
                reasons.append(f"Function {function_name} not found in {origin} source")
        status = "invalid" if reasons else "valid" if source else "preview_only"
        validated.append({
            "row_number": number,
            "task_id": task_id,
            "function_name": function_name,
            "description": raw.get("description"),
            "task_title": raw.get("task_title"),
            "difficulty": raw.get("difficulty"),
            "expected_output": expected,
            "expected_output_provenance": expected_provenance,
            "input_data": input_data,
            "status": status,
            "reasons": reasons if reasons else (["Reference source is required"] if not source else []),
            "source_sha256": source_sha256 if status == "valid" else None,
            "runtime_status": "N/A",
            "runtime_reason": "Row is invalid" if reasons else "Untrusted execution is disabled" if source else "Reference source is required",
            "execution_enabled": False,
        })
    return validated


class DatasetService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = DatasetRepository(db)
        self.sources = SourceRepository(db)

    def create(self, owner_id: uuid.UUID, project_id: uuid.UUID, rows: list[dict]) -> DatasetVersion | None:
        if not self.repo.owned_project_exists(owner_id, project_id):
            return None
        if not rows or len(rows) > MAX_ROWS:
            raise ValueError(f"Dataset must contain 1 to {MAX_ROWS} rows")
        numbers = [row.get("row_number") for row in rows]
        if any(type(number) is not int or number < 2 for number in numbers) or len(numbers) != len(set(numbers)):
            raise ValueError("row_number must be a unique integer >= 2")
        allowed = {"row_number", "task_id", "function_name", "python_source", "expected_output", "input_data", "description", "task_title", "difficulty"}
        if any(set(row) - allowed for row in rows):
            raise ValueError("Unknown CSV row field")
        normalized = json.loads(json.dumps(rows, ensure_ascii=False, allow_nan=False))
        validated = validate_rows(normalized)
        now = utcnow()
        dataset = Dataset(id=uuid.uuid4(), project_id=project_id, current_revision=1, created_at=now, updated_at=now)
        version = DatasetVersion(id=uuid.uuid4(), dataset_id=dataset.id, revision=1, sha256=_snapshot_hash(normalized, [], None, None), input_rows=normalized, rows=validated, selected_rows=[], created_at=now)
        self.db.add(dataset)
        self.db.flush()
        self.db.add(version)
        self.db.commit()
        return version

    def get(self, owner_id: uuid.UUID, project_id: uuid.UUID, dataset_id: uuid.UUID, revision: int | None = None) -> DatasetVersion | None:
        dataset = self.repo.dataset(owner_id, project_id, dataset_id)
        return self.repo.version(dataset_id, revision if revision is not None else dataset.current_revision) if dataset else None

    def list_owned(self, owner_id: uuid.UUID, project_id: uuid.UUID) -> list[Dataset] | None:
        return self.repo.list_owned(owner_id, project_id) if self.repo.owned_project_exists(owner_id, project_id) else None

    def _next(self, dataset: Dataset, previous: DatasetVersion, *, rows: list[dict] | None = None, selected: list[int] | None = None, source_id: uuid.UUID | None = None, source_revision: int | None = None) -> DatasetVersion:
        now = utcnow()
        next_rows = rows if rows is not None else previous.rows
        next_selected = selected if selected is not None else previous.selected_rows
        next_source_id = source_id if source_id is not None else previous.reference_source_id
        next_source_revision = source_revision if source_revision is not None else previous.reference_revision
        dataset.current_revision += 1
        dataset.updated_at = now
        version = DatasetVersion(id=uuid.uuid4(), dataset_id=dataset.id, revision=dataset.current_revision, sha256=_snapshot_hash(previous.input_rows, next_selected, next_source_id, next_source_revision), input_rows=previous.input_rows, rows=next_rows, selected_rows=next_selected, reference_source_id=next_source_id, reference_revision=next_source_revision, created_at=now)
        self.db.add(version)
        self.db.commit()
        return version

    def select(self, owner_id: uuid.UUID, project_id: uuid.UUID, dataset_id: uuid.UUID, row_numbers: list[int]) -> DatasetVersion | None:
        dataset = self.repo.dataset(owner_id, project_id, dataset_id, lock=True)
        if dataset is None:
            return None
        if not row_numbers:
            raise ValueError("Select at least one row")
        if len(row_numbers) != len(set(row_numbers)):
            raise ValueError("Duplicate selected row")
        previous = self.repo.version(dataset_id, dataset.current_revision)
        if previous is None:
            raise RuntimeError("Current dataset revision is missing")
        selectable = {row["row_number"] for row in previous.rows if row["status"] == "valid"}
        if not set(row_numbers) <= selectable:
            raise ValueError("One or more rows are not selectable")
        return self._next(dataset, previous, selected=sorted(row_numbers))

    def link_reference(self, owner_id: uuid.UUID, project_id: uuid.UUID, dataset_id: uuid.UUID, source_id: uuid.UUID, revision: int) -> DatasetVersion | None:
        dataset = self.repo.dataset(owner_id, project_id, dataset_id, lock=True)
        if dataset is None or self.sources.source(owner_id, project_id, source_id) is None:
            return None
        source = self.sources.version(source_id, revision)
        if source is None:
            return None
        previous = self.repo.version(dataset_id, dataset.current_revision)
        if previous is None:
            raise RuntimeError("Current dataset revision is missing")
        rows = validate_rows(previous.input_rows, reference_code=source.code, reference_sha256=source.sha256)
        valid = {row["row_number"] for row in rows if row["status"] == "valid"}
        selected = [number for number in previous.selected_rows if number in valid]
        return self._next(dataset, previous, rows=rows, selected=selected, source_id=source_id, source_revision=revision)
