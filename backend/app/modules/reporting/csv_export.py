"""RFC 4180 CSV serializer with secret redaction, formula neutralization, and safe path checks."""

from __future__ import annotations

import csv
import io
import math
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from app.core.exceptions import AppError, ErrorCode
from app.core.logging import redact_secrets

DANGEROUS_STRIPPED_PREFIXES: tuple[str, ...] = ("=", "+", "-", "@")
DANGEROUS_RAW_PREFIXES: tuple[str, ...] = ("\t", "\r")
NON_NUMERIC_METRIC_STATES: frozenset[str] = frozenset({"N/A", "FAILED", "TIMEOUT"})


def format_metric_csv_cell(state: str, numeric_value: float | int | None) -> float | str:
    """Format metric state strictly preserving numeric 0.0 vs N/A, FAILED, and TIMEOUT."""
    normalized_state = state.strip().upper()
    if normalized_state == "MEASURED":
        if numeric_value is None or isinstance(numeric_value, bool):
            raise ValueError("MEASURED metric state requires a finite numeric value")
        as_float = float(numeric_value)
        if not math.isfinite(as_float):
            raise ValueError("MEASURED metric value must be finite")
        return 0.0 if as_float == 0.0 else round(as_float, 4)
    if normalized_state in NON_NUMERIC_METRIC_STATES:
        return normalized_state
    raise ValueError(f"Unsupported metric state: {state!r}")


def sanitize_csv_cell(
    value: Any,
    *,
    extra_secrets: Sequence[str] = (),
) -> str:
    """Sanitize a CSV cell: preserve genuine ints/floats, redact secrets, block formula injection."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return "N/A"
        normalized = 0.0 if value == 0.0 else value
        return str(normalized)

    cleaned = redact_secrets(str(value), extra_secrets=extra_secrets)
    if cleaned.startswith(DANGEROUS_RAW_PREFIXES) or cleaned.lstrip().startswith(
        DANGEROUS_STRIPPED_PREFIXES
    ):
        return f"'{cleaned}"
    return cleaned


def serialize_csv_rows(
    headers: Sequence[str],
    rows: Iterable[Sequence[Any]],
    *,
    extra_secrets: Sequence[str] = (),
) -> str:
    """Serialize headers and rows into RFC 4180 CSV with CRLF line endings."""
    buf = io.StringIO()
    writer = csv.writer(buf, dialect="excel", lineterminator="\r\n")
    writer.writerow([sanitize_csv_cell(col, extra_secrets=extra_secrets) for col in headers])
    for row in rows:
        writer.writerow([sanitize_csv_cell(cell, extra_secrets=extra_secrets) for cell in row])
    return buf.getvalue()


def resolve_safe_artifact_path(artifact_dir: str | Path, relpath: str) -> Path:
    """Resolve an artifact path strictly inside artifact_dir while rejecting symlinks & traversal."""
    if not relpath or not relpath.strip():
        raise AppError(ErrorCode.ACCESS_DENIED, "Invalid empty artifact path")
    raw_rel = Path(relpath)
    if raw_rel.is_absolute() or relpath.startswith(("/", "\\")):
        raise AppError(ErrorCode.ACCESS_DENIED, "Absolute artifact paths are forbidden")

    artifact_root = Path(artifact_dir).resolve()
    current = artifact_root
    for part in raw_rel.parts:
        if part in ("", ".", "..") or "/" in part or "\\" in part:
            raise AppError(ErrorCode.ACCESS_DENIED, "Artifact path traversal is forbidden")
        current = current / part
        if current.is_symlink():
            raise AppError(ErrorCode.ACCESS_DENIED, "Symlinked artifact path is forbidden")

    candidate = artifact_root / raw_rel
    if candidate.is_symlink():
        raise AppError(ErrorCode.ACCESS_DENIED, "Symlinked artifact file is forbidden")

    resolved = candidate.resolve()
    if not resolved.is_relative_to(artifact_root):
        raise AppError(ErrorCode.ACCESS_DENIED, "Artifact path escapes artifact_dir")
    return resolved
