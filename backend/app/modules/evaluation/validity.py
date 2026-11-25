"""Static Python code extractor, AST test structure validator, and generation success (FR-EVL-005, Issue #55)."""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass

from app.modules.evaluation.eligibility import (
    MetricOutcome,
    MetricState,
    RunLifecycleStatus,
    check_metric_eligibility,
)
from app.modules.evaluation.models import MetricName

_FENCED_PYTHON_RE = re.compile(r"```(?:python|py)[ \t]*\r?\n(.*?)```", re.IGNORECASE | re.DOTALL)
_FENCED_GENERIC_RE = re.compile(r"```[ \t]*\r?\n(.*?)```", re.DOTALL)


@dataclass(frozen=True)
class ExtractedPythonCode:
    code: str
    extracted_from_fence: bool


@dataclass(frozen=True)
class ValidityAnalysis:
    is_valid: bool
    syntax_valid: bool
    structure_valid: bool
    target_referenced: bool | None
    extracted_code: str
    extracted_from_fence: bool
    test_functions: list[str]
    empty_test_functions: list[str]
    syntax_error: str | None
    reason: str | None


def extract_python_code(raw_output: str | None) -> ExtractedPythonCode:
    """Statically extract Python test code from markdown fences or raw text."""
    if raw_output is None:
        return ExtractedPythonCode(code="", extracted_from_fence=False)

    stripped = raw_output.strip()
    if not stripped:
        return ExtractedPythonCode(code="", extracted_from_fence=False)

    # If the text does not start with a markdown fence and already parses as valid Python AST,
    # preserve it as raw Python so embedded backticks inside string literals are untouched.
    if not stripped.startswith("```"):
        try:
            ast.parse(stripped)
            return ExtractedPythonCode(code=stripped, extracted_from_fence=False)
        except SyntaxError:
            pass

    py_blocks = [match.group(1).strip() for match in _FENCED_PYTHON_RE.finditer(raw_output)]
    py_blocks = [block for block in py_blocks if block]
    if py_blocks:
        return ExtractedPythonCode(code="\n\n".join(py_blocks), extracted_from_fence=True)

    generic_blocks = [match.group(1).strip() for match in _FENCED_GENERIC_RE.finditer(raw_output)]
    generic_blocks = [block for block in generic_blocks if block]
    if generic_blocks:
        return ExtractedPythonCode(code="\n\n".join(generic_blocks), extracted_from_fence=True)

    # Unclosed leading fence fallback (e.g. truncated LLM completion)
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        body_lines = lines[1:]
        if body_lines and body_lines[-1].strip() == "```":
            body_lines = body_lines[:-1]
        return ExtractedPythonCode(code="\n".join(body_lines).strip(), extracted_from_fence=True)

    return ExtractedPythonCode(code=stripped, extracted_from_fence=False)


def iter_test_functions(tree: ast.Module) -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    """Return top-level and Test*-class test_* function definitions in source order."""
    found: list[ast.FunctionDef | ast.AsyncFunctionDef] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith(
            "test_"
        ):
            found.append(node)
        elif isinstance(node, ast.ClassDef):
            for member in node.body:
                if isinstance(
                    member, (ast.FunctionDef, ast.AsyncFunctionDef)
                ) and member.name.startswith("test_"):
                    found.append(member)
    return found


def _is_placeholder_stmt(stmt: ast.stmt) -> bool:
    if isinstance(stmt, ast.Pass):
        return True
    if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
        if stmt.value.value is Ellipsis:
            return True
    return False


def is_non_empty_test_body(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    """Return False when a test body contains only a docstring, pass, or ellipsis."""
    stmts = list(fn.body)
    if (
        stmts
        and isinstance(stmts[0], ast.Expr)
        and isinstance(stmts[0].value, ast.Constant)
        and isinstance(stmts[0].value.value, str)
    ):
        stmts = stmts[1:]
    if not stmts:
        return False
    return any(not _is_placeholder_stmt(stmt) for stmt in stmts)


def _references_target_function(tree: ast.Module, target_function: str) -> bool:
    """Check whether any Call or callable reference outside imports invokes target_function."""
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        for sub in ast.walk(node):
            if isinstance(sub, (ast.Import, ast.ImportFrom)):
                continue
            if isinstance(sub, ast.Call):
                if isinstance(sub.func, ast.Name) and sub.func.id == target_function:
                    return True
                if isinstance(sub.func, ast.Attribute) and sub.func.attr == target_function:
                    return True
                for arg in sub.args:
                    if isinstance(arg, ast.Name) and arg.id == target_function:
                        return True
                    if isinstance(arg, ast.Attribute) and arg.attr == target_function:
                        return True
    return False


def validate_generated_test_code(
    raw_output: str | None,
    *,
    target_function: str | None = None,
) -> ValidityAnalysis:
    """Statically parse and validate generated Python pytest code using ast.parse()."""
    extracted = extract_python_code(raw_output)
    if not extracted.code:
        return ValidityAnalysis(
            is_valid=False,
            syntax_valid=False,
            structure_valid=False,
            target_referenced=False if target_function else None,
            extracted_code="",
            extracted_from_fence=extracted.extracted_from_fence,
            test_functions=[],
            empty_test_functions=[],
            syntax_error=None,
            reason="Generated output is empty",
        )

    try:
        tree = ast.parse(extracted.code)
    except SyntaxError as exc:
        err_detail = f"Line {exc.lineno}: {exc.msg}"
        return ValidityAnalysis(
            is_valid=False,
            syntax_valid=False,
            structure_valid=False,
            target_referenced=False if target_function else None,
            extracted_code=extracted.code,
            extracted_from_fence=extracted.extracted_from_fence,
            test_functions=[],
            empty_test_functions=[],
            syntax_error=err_detail,
            reason=f"Python syntax error ({err_detail})",
        )

    test_nodes = iter_test_functions(tree)
    valid_tests: list[str] = []
    empty_tests: list[str] = []
    for fn in test_nodes:
        if is_non_empty_test_body(fn):
            valid_tests.append(fn.name)
        else:
            empty_tests.append(fn.name)

    if not test_nodes:
        return ValidityAnalysis(
            is_valid=False,
            syntax_valid=True,
            structure_valid=False,
            target_referenced=None,
            extracted_code=extracted.code,
            extracted_from_fence=extracted.extracted_from_fence,
            test_functions=[],
            empty_test_functions=[],
            syntax_error=None,
            reason="Generated code contains no 'def test_*' functions",
        )

    if empty_tests:
        names = ", ".join(empty_tests)
        return ValidityAnalysis(
            is_valid=False,
            syntax_valid=True,
            structure_valid=False,
            target_referenced=None,
            extracted_code=extracted.code,
            extracted_from_fence=extracted.extracted_from_fence,
            test_functions=valid_tests,
            empty_test_functions=empty_tests,
            syntax_error=None,
            reason=f"Placeholder pass/... test bodies are structurally invalid: {names}",
        )

    cleaned_target = target_function.strip() if target_function else None
    target_ref: bool | None = None
    if cleaned_target:
        target_ref = _references_target_function(tree, cleaned_target)
        if not target_ref:
            return ValidityAnalysis(
                is_valid=False,
                syntax_valid=True,
                structure_valid=True,
                target_referenced=False,
                extracted_code=extracted.code,
                extracted_from_fence=extracted.extracted_from_fence,
                test_functions=valid_tests,
                empty_test_functions=[],
                syntax_error=None,
                reason=f"Generated tests do not call target function '{cleaned_target}'",
            )

    return ValidityAnalysis(
        is_valid=True,
        syntax_valid=True,
        structure_valid=True,
        target_referenced=target_ref,
        extracted_code=extracted.code,
        extracted_from_fence=extracted.extracted_from_fence,
        test_functions=valid_tests,
        empty_test_functions=[],
        syntax_error=None,
        reason=None,
    )


def score_syntax_validity(
    run_status: RunLifecycleStatus | str,
    raw_output: str | None,
    *,
    target_function: str | None = None,
    failure_reason: str | None = None,
) -> MetricOutcome:
    """Compute per-run syntax_validity (100.0 valid vs 0.0 invalid syntax/structure)."""
    gated = check_metric_eligibility(
        MetricName.SYNTAX_VALIDITY,
        run_status,
        failure_reason=failure_reason,
    )
    if gated is not None:
        return gated

    analysis = validate_generated_test_code(raw_output, target_function=target_function)
    details = {
        "syntax_valid": analysis.syntax_valid,
        "structure_valid": analysis.structure_valid,
        "target_referenced": analysis.target_referenced,
        "extracted_from_fence": analysis.extracted_from_fence,
        "test_functions": analysis.test_functions,
        "empty_test_functions": analysis.empty_test_functions,
        "syntax_error": analysis.syntax_error,
    }
    if analysis.is_valid:
        return MetricOutcome(
            metric_name=MetricName.SYNTAX_VALIDITY,
            state=MetricState.MEASURED,
            numeric_value=100.0,
            numerator=1,
            denominator=1,
            details=details,
        )

    return MetricOutcome(
        metric_name=MetricName.SYNTAX_VALIDITY,
        state=MetricState.MEASURED,
        numeric_value=0.0,
        numerator=0,
        denominator=1,
        reason=analysis.reason or "Generated test code is invalid",
        details=details,
    )


def score_generation_success(
    *,
    valid_runs: int,
    evaluated_runs: int,
    total_planned_runs: int,
) -> MetricOutcome:
    """Compute snapshot/batch generation_success (valid_runs / total_planned_runs * 100.0)."""
    if valid_runs < 0 or evaluated_runs < 0 or total_planned_runs < 0:
        raise ValueError("Generation success run counts must be non-negative")
    if valid_runs > evaluated_runs or valid_runs > total_planned_runs:
        raise ValueError("valid_runs cannot exceed evaluated_runs or total_planned_runs")

    details = {
        "valid_runs": valid_runs,
        "evaluated_runs": evaluated_runs,
        "total_planned_runs": total_planned_runs,
    }

    if total_planned_runs == 0 or evaluated_runs == 0:
        return MetricOutcome(
            metric_name=MetricName.GENERATION_SUCCESS,
            state=MetricState.NOT_APPLICABLE,
            numeric_value=None,
            numerator=None,
            denominator=total_planned_runs if total_planned_runs > 0 else None,
            reason="No runs have been evaluated for this snapshot",
            details=details,
        )

    pct = round((valid_runs / total_planned_runs) * 100.0, 2)
    return MetricOutcome(
        metric_name=MetricName.GENERATION_SUCCESS,
        state=MetricState.MEASURED,
        numeric_value=pct,
        numerator=valid_runs,
        denominator=total_planned_runs,
        details=details,
    )
