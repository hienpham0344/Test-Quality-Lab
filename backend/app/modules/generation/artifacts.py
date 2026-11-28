"""Parse and validate generated pytest artifacts (SRS v1.2 FR-GEN-003/004, BR-07, BR-11) — issue #40.

Stages are recorded separately and never merged: Generated → Parsed → Syntax valid → Structure valid →
Target linked → Collected → Executable. Collection is static (AST, pytest's default discovery rules)
because importing generated code would execute it; ``executable`` stays ``NOT_VERIFIED`` until the
sandbox runner (FR-EXE) has run the artifact. Nothing here imports or executes generated code.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from app.modules.evaluation.validity import (
    extract_python_code,
    is_non_empty_test_body,
    validate_generated_test_code,
)

SCHEMA_VERSION = "pytest-module/v1"
COLLECTION_MODE = "static-ast"
MAX_ARTIFACT_CHARS = 200_000


class StageState(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"  # an earlier stage failed
    NOT_VERIFIED = "NOT_VERIFIED"  # needs the sandbox runner


STAGES = ("generated", "parsed", "syntax_valid", "structure_valid", "target_linked", "collected", "executable")


@dataclass
class ArtifactCheck:
    parsed_code: str | None
    stages: dict[str, StageState]
    collected_tests: list[str] = field(default_factory=list)
    failed_stage: str | None = None
    reason: str | None = None
    extracted_from_fence: bool = False

    @property
    def parsed(self) -> bool:
        return self.stages["parsed"] == StageState.PASSED

    @property
    def eligible(self) -> bool:
        """Eligible for the runner: every static stage passed (execution is the runner's job)."""
        return all(self.stages[name] == StageState.PASSED for name in STAGES[:-1])

    def to_json(self) -> dict[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "collection_mode": COLLECTION_MODE,
            "stages": {name: self.stages[name].value for name in STAGES},
            "collected_tests": list(self.collected_tests),
            "eligible": self.eligible,
            "failed_stage": self.failed_stage,
            "reason": self.reason,
            "extracted_from_fence": self.extracted_from_fence,
        }


def static_collect(tree: ast.Module) -> list[str]:
    """Test node IDs pytest would collect by default: module `test*` functions and `Test*` classes
    without `__init__` holding `test*` methods. Decorators and fixtures are not evaluated."""
    collected: list[str] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test"):
            collected.append(node.name)
        elif isinstance(node, ast.ClassDef) and node.name.startswith("Test"):
            methods = [n for n in node.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
            if any(m.name == "__init__" for m in methods):
                continue
            collected.extend(f"{node.name}::{m.name}" for m in methods if m.name.startswith("test"))
    return collected


def _fail(stages: dict[str, StageState], stage: str, reason: str, **kwargs: Any) -> ArtifactCheck:
    index = STAGES.index(stage)
    stages[stage] = StageState.FAILED
    for later in STAGES[index + 1 :]:
        stages[later] = StageState.SKIPPED
    return ArtifactCheck(stages=stages, failed_stage=stage, reason=reason, **kwargs)


def check_generated_output(raw_response: str, target_function: str | None) -> ArtifactCheck:
    """Runs every static stage on one raw model response. Never raises for bad model output."""
    stages = {name: StageState.SKIPPED for name in STAGES}
    stages["generated"] = StageState.PASSED
    stages["executable"] = StageState.NOT_VERIFIED

    extracted = extract_python_code(raw_response)
    code = extracted.code.strip()
    fence = extracted.extracted_from_fence
    if not code:
        return _fail(stages, "parsed", "Parsing failed: the response contains no Python code",
                     parsed_code=None, extracted_from_fence=fence)
    if len(code) > MAX_ARTIFACT_CHARS:
        return _fail(stages, "parsed", f"Parsing failed: code exceeds {MAX_ARTIFACT_CHARS} characters",
                     parsed_code=None, extracted_from_fence=fence)
    parsed_code = code + "\n"
    stages["parsed"] = StageState.PASSED

    try:
        tree = ast.parse(parsed_code)
    except SyntaxError as exc:
        return _fail(stages, "syntax_valid", f"Python syntax error (Line {exc.lineno}: {exc.msg})",
                     parsed_code=parsed_code, extracted_from_fence=fence)
    stages["syntax_valid"] = StageState.PASSED

    analysis = validate_generated_test_code(parsed_code, target_function=None)
    if not analysis.structure_valid:
        return _fail(stages, "structure_valid", analysis.reason or "Invalid test structure",
                     parsed_code=parsed_code, extracted_from_fence=fence)
    stages["structure_valid"] = StageState.PASSED

    if target_function:
        linked = validate_generated_test_code(parsed_code, target_function=target_function)
        if linked.target_referenced is False:
            return _fail(stages, "target_linked", linked.reason or "Tests do not call the target function",
                         parsed_code=parsed_code, extracted_from_fence=fence)
    stages["target_linked"] = StageState.PASSED

    collected = static_collect(tree)
    runnable = [
        name for name in collected
        if any(
            isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name.split("::")[-1]
            and is_non_empty_test_body(n)
            for n in ast.walk(tree)
        )
    ]
    if not runnable:
        return _fail(stages, "collected", "pytest would collect no tests (static discovery)",
                     parsed_code=parsed_code, collected_tests=collected, extracted_from_fence=fence)
    stages["collected"] = StageState.PASSED
    return ArtifactCheck(parsed_code=parsed_code, stages=stages, collected_tests=collected,
                         extracted_from_fence=fence)
