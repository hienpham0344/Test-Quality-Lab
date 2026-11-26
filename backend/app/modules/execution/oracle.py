"""Expected-output (oracle) resolution with provenance (SRS v1.2 FR-EVL-002, §3.15 ORACLE_UNAVAILABLE) — #48.

Rules:
- dataset expected + reference run agrees      -> DATASET_VERIFIED (ground truth from the dataset, verified)
- dataset expected + reference disagrees/errors -> QUARANTINED (row isolated, needs attention; no guessing)
- dataset expected + no reference run yet       -> DATASET_UNVERIFIED (traceable, not yet verified)
- no expected      + reference observed         -> REFERENCE_OBSERVED (labelled; never called ground truth)
- no expected      + no usable reference        -> UNAVAILABLE (ORACLE_UNAVAILABLE: no pass/mutation from it)
Nothing here executes code. Reference observations come from the sandbox runner (FR-EXE) when enabled.
"""

from __future__ import annotations

import ast
import json
import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class OracleSource(StrEnum):
    DATASET_VERIFIED = "DATASET_VERIFIED"
    DATASET_UNVERIFIED = "DATASET_UNVERIFIED"
    REFERENCE_OBSERVED = "REFERENCE_OBSERVED"
    QUARANTINED = "QUARANTINED"
    UNAVAILABLE = "UNAVAILABLE"


USABLE_SOURCES = frozenset(
    {OracleSource.DATASET_VERIFIED, OracleSource.DATASET_UNVERIFIED, OracleSource.REFERENCE_OBSERVED}
)


@dataclass(frozen=True)
class ReferenceObservation:
    """Output of running the reference function on one input inside the sandbox."""

    output: str | None = None
    error: str | None = None


@dataclass(frozen=True)
class OracleProvenance:
    dataset_id: str | None
    dataset_revision: int | None
    dataset_sha256: str | None
    row_number: int | None
    reference_source_sha256: str | None


def _literal(text: str) -> Any:
    try:
        return ast.literal_eval(text.strip())
    except (ValueError, SyntaxError, TypeError, MemoryError, RecursionError):
        return text.strip()


def outputs_match(expected: str, observed: str) -> bool:
    """Compares Python literals (1 == 1.0, '3' != 3, floats with a 1e-9 relative tolerance)."""
    left, right = _literal(expected), _literal(observed)

    def numeric(value: Any) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    if numeric(left) and numeric(right):
        return math.isclose(float(left), float(right), rel_tol=1e-9, abs_tol=1e-12)
    return bool(type(left) is type(right) and left == right)


def _expected_text(raw: Any) -> str | None:
    """Dataset rows keep expected_output as parsed JSON; None or blank means no expected value."""
    if raw is None:
        return None
    if isinstance(raw, str):
        return raw.strip() or None
    return json.dumps(raw, ensure_ascii=False, sort_keys=True)


def resolve_oracle(
    row: Mapping[str, Any],
    *,
    reference: ReferenceObservation | None,
    provenance: OracleProvenance,
) -> dict[str, Any]:
    """One row's expected value with its source; QUARANTINED/UNAVAILABLE rows have no usable expected."""
    expected = _expected_text(row.get("expected_output"))
    observed = reference.output if reference is not None and reference.error is None else None

    if expected is not None:
        if reference is None:
            source, value, reason = OracleSource.DATASET_UNVERIFIED, expected, (
                "Expected output comes from the dataset; the reference function has not been run yet"
            )
        elif reference.error is not None:
            source, value, reason = OracleSource.QUARANTINED, None, (
                "Reference function failed on this input; the row needs attention"
            )
        elif observed is not None and outputs_match(expected, observed):
            source, value, reason = OracleSource.DATASET_VERIFIED, expected, None
        else:
            source, value, reason = OracleSource.QUARANTINED, None, (
                "Dataset expected output conflicts with the reference function; the row is isolated"
            )
    elif observed is not None:
        source, value, reason = OracleSource.REFERENCE_OBSERVED, observed, (
            "Observed from the reference implementation; not an independent ground truth"
        )
    else:
        source, value, reason = OracleSource.UNAVAILABLE, None, (
            "ORACLE_UNAVAILABLE: no traceable expected output for this input"
        )

    return {
        "row_number": row.get("row_number"),
        "task_id": row.get("task_id"),
        "function_name": row.get("function_name"),
        "input_data": row.get("input_data"),
        "expected_output": value,
        "dataset_expected_output": expected,
        "reference_observed_output": observed,
        "source": source.value,
        "usable": source in USABLE_SOURCES,
        "is_ground_truth": source in (OracleSource.DATASET_VERIFIED, OracleSource.DATASET_UNVERIFIED),
        "verified": source == OracleSource.DATASET_VERIFIED,
        "reason": reason,
        "provenance": {
            "expected_from": row.get("expected_output_provenance") if expected is not None else None,
            "dataset_id": provenance.dataset_id,
            "dataset_revision": provenance.dataset_revision,
            "dataset_sha256": provenance.dataset_sha256,
            "row_number": provenance.row_number,
            "reference_source_sha256": provenance.reference_source_sha256,
        },
    }


def resolve_rows(
    rows: Iterable[Mapping[str, Any]],
    *,
    references: Mapping[int, ReferenceObservation] | None,
    dataset_id: str | None,
    dataset_revision: int | None,
    dataset_sha256: str | None,
    reference_source_sha256: str | None,
) -> dict[str, Any]:
    """Resolves every row and summarises counts per source (stored on the execution as `oracle`)."""
    resolved = []
    for row in rows:
        number = row.get("row_number")
        reference = references.get(number) if references is not None and isinstance(number, int) else None
        resolved.append(resolve_oracle(
            row,
            reference=reference,
            provenance=OracleProvenance(dataset_id, dataset_revision, dataset_sha256,
                                        number if isinstance(number, int) else None, reference_source_sha256),
        ))
    summary = {source.value: 0 for source in OracleSource}
    for item in resolved:
        summary[item["source"]] += 1
    return {"rows": resolved, "summary": summary, "reference_run": references is not None}
