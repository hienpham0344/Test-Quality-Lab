"""Structured pytest results and safe logs from runner output (FR-EXE-002/003) — #47, #49.

Runner output is untrusted: XML is size-capped, DOCTYPE/ENTITY declarations are rejected, logs are
redacted, host paths masked, control characters stripped and the total capped at 1 MiB with a marker.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET  # noqa: S405 — DTD/entities rejected before parsing
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from app.core.logging import redact_secrets

MAX_JUNIT_BYTES = 2 * 1024 * 1024
MAX_CASES = 5000
JUNIT_BEGIN = "<<<TQL-JUNIT-BEGIN>>>"
JUNIT_END = "<<<TQL-JUNIT-END>>>"
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_TRUNCATED = "[log truncated at 1 MiB]"


class CaseStatus(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    ERROR = "ERROR"
    SKIPPED = "SKIPPED"
    TIMEOUT = "TIMEOUT"


@dataclass
class SuiteResult:
    cases: list[dict[str, Any]] = field(default_factory=list)
    problem: str | None = None  # why the counts may not match the collected tests

    def counts(self) -> dict[str, int]:
        totals = {status.value: 0 for status in CaseStatus}
        for case in self.cases:
            totals[case["status"]] += 1
        return totals


class JUnitError(ValueError):
    pass


def extract_junit(stdout: str) -> str | None:
    """The runner prints the JUnit XML between markers; returns None when absent."""
    start = stdout.find(JUNIT_BEGIN)
    end = stdout.find(JUNIT_END, start + 1)
    if start == -1 or end == -1:
        return None
    return stdout[start + len(JUNIT_BEGIN) : end].strip()


def _text(node: ET.Element | None, limit: int = 4000) -> str | None:
    if node is None:
        return None
    raw = (node.get("message") or "") + ("\n" + node.text if node.text else "")
    return redact_secrets(_CONTROL_RE.sub("", raw.strip()))[:limit] or None


def parse_junit_xml(xml_text: str, *, timed_out: bool = False) -> SuiteResult:
    """One case per <testcase>: PASSED, FAILED, ERROR or SKIPPED from the runner's evidence."""
    if len(xml_text.encode("utf-8")) > MAX_JUNIT_BYTES:
        raise JUnitError("JUnit report exceeds 2 MiB")
    upper = xml_text.upper()
    if "<!DOCTYPE" in upper or "<!ENTITY" in upper:
        raise JUnitError("JUnit report must not declare a DOCTYPE or entities")
    try:
        root = ET.fromstring(xml_text)  # noqa: S314 — size-capped, no DTD
    except ET.ParseError as exc:
        raise JUnitError(f"Malformed JUnit report: {exc}") from exc

    result = SuiteResult()
    for index, case in enumerate(root.iter("testcase")):
        if index >= MAX_CASES:
            result.problem = f"Only the first {MAX_CASES} test cases were recorded"
            break
        failure, error, skipped = case.find("failure"), case.find("error"), case.find("skipped")
        if error is not None:
            status, detail = CaseStatus.ERROR, _text(error)
        elif failure is not None:
            status, detail = CaseStatus.FAILED, _text(failure)
        elif skipped is not None:
            status, detail = CaseStatus.SKIPPED, _text(skipped)
        else:
            status, detail = CaseStatus.PASSED, None
        try:
            duration_ms: int | None = int(float(case.get("time", "")) * 1000)
        except ValueError:
            duration_ms = None
        classname = case.get("classname") or ""
        name = case.get("name") or f"case-{index + 1}"
        result.cases.append({
            "id": f"case-{index + 1}",
            "name": name[:200],
            "node_id": f"{classname}::{name}"[:300] if classname else name[:300],
            "status": status.value,
            "duration_ms": duration_ms,
            "traceback": detail,
        })
    if timed_out:
        # The suite was stopped: results are incomplete, never reported as a clean pass.
        result.problem = result.problem or "Runner timed out; results are incomplete"
    return result


def reconcile_with_collected(result: SuiteResult, collected: Sequence[str]) -> None:
    """FR-EXE-002: totals must match the collected tests, or the mismatch is explained."""
    if collected and len(result.cases) != len(collected) and result.problem is None:
        result.problem = f"Runner reported {len(result.cases)} test(s) but {len(collected)} were collected"


def sanitize_logs(
    stdout: str,
    stderr: str,
    *,
    host_paths: Sequence[str] = (),
    secrets: Sequence[str] = (),
    limit_bytes: int = 1024 * 1024,
) -> list[dict[str, str]]:
    """Safe log entries `{stream, level, message}`; redacted, path-masked, capped with a marker."""
    entries: list[dict[str, str]] = []
    used = 0
    for stream, text in (("stdout", stdout), ("stderr", stderr)):
        for line in text.splitlines():
            if JUNIT_BEGIN in line or JUNIT_END in line or line.lstrip().startswith(("<?xml", "<testsuite", "<testcase", "</")):
                continue
            clean = _CONTROL_RE.sub("", line)
            for path in host_paths:
                if path:
                    clean = clean.replace(path, "/workspace")
            clean = redact_secrets(clean, extra_secrets=list(secrets))
            size = len(clean.encode("utf-8")) + 1
            if used + size > limit_bytes:
                entries.append({"stream": "system", "level": "WARN", "message": _TRUNCATED})
                return entries
            used += size
            level = "FAIL" if ("FAILED" in clean or "Error" in clean) else ("PASS" if "PASSED" in clean else "INFO")
            entries.append({"stream": stream, "level": level, "message": clean})
    return entries
