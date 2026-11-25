"""Static AST assertion analyzer and composite assertion quality scorer (FR-EVL-007, Issue #56)."""

from __future__ import annotations

import ast
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from app.modules.evaluation.eligibility import (
    MetricOutcome,
    MetricState,
    RunLifecycleStatus,
    check_metric_eligibility,
)
from app.modules.evaluation.models import MetricName
from app.modules.evaluation.validity import (
    extract_python_code,
    is_non_empty_test_body,
    iter_test_functions,
)


class AssertionType(StrEnum):
    EQUALITY = "EQUALITY"
    RELATIONAL = "RELATIONAL"
    TYPE = "TYPE"
    IDENTITY = "IDENTITY"
    INVARIANT = "INVARIANT"
    EXCEPTION = "EXCEPTION"
    TRIVIAL = "TRIVIAL"


class AssertionStrength(StrEnum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


@dataclass(frozen=True)
class ExtractedAssertion:
    id: str
    test_case: str
    statement: str
    type: AssertionType
    line: int
    status: str
    strength: AssertionStrength
    explanation: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "test_case": self.test_case,
            "statement": self.statement,
            "type": self.type.value,
            "line": self.line,
            "status": self.status,
            "strength": self.strength.value,
            "explanation": self.explanation,
        }


@dataclass(frozen=True)
class AssertionAnalysis:
    score: float | None
    summary: dict[str, Any]
    assertions: list[ExtractedAssertion]
    unavailable_reason: str | None
    numerator: int | None = None
    denominator: int | None = None

    def to_details(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "summary": dict(self.summary),
            "assertions": [a.to_dict() for a in self.assertions],
            "unavailable_reason": self.unavailable_reason,
        }


def _is_constant_expr(expr: ast.expr) -> bool:
    if isinstance(expr, ast.Constant):
        return True
    if isinstance(expr, (ast.List, ast.Tuple, ast.Set)):
        return all(_is_constant_expr(elt) for elt in expr.elts)
    if isinstance(expr, ast.Dict):
        return all(
            (k is None or _is_constant_expr(k)) and _is_constant_expr(v)
            for k, v in zip(expr.keys, expr.values, strict=False)
        )
    if isinstance(expr, ast.UnaryOp) and isinstance(expr.op, (ast.Not, ast.UAdd, ast.USub, ast.Invert)):
        return _is_constant_expr(expr.operand)
    if isinstance(expr, ast.BinOp):
        return _is_constant_expr(expr.left) and _is_constant_expr(expr.right)
    return False


def _is_type_call(expr: ast.expr) -> bool:
    if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name):
        return expr.func.id in {"isinstance", "issubclass"}
    if isinstance(expr, ast.UnaryOp) and isinstance(expr.op, ast.Not):
        return _is_type_call(expr.operand)
    return False


def _is_type_constructor_call(expr: ast.expr) -> bool:
    return (
        isinstance(expr, ast.Call)
        and isinstance(expr.func, ast.Name)
        and expr.func.id == "type"
    )


def _is_approx_or_close_call(expr: ast.expr) -> bool:
    if not isinstance(expr, ast.Call):
        return False
    if isinstance(expr.func, ast.Name):
        return expr.func.id in {"isclose", "approx"}
    if isinstance(expr.func, ast.Attribute):
        return expr.func.attr in {"isclose", "approx"}
    return False


def _classify_assert_expr(expr: ast.expr) -> tuple[AssertionType, AssertionStrength, str]:
    # 1. Constant literals / tautologies
    if _is_constant_expr(expr):
        return (
            AssertionType.TRIVIAL,
            AssertionStrength.LOW,
            "Trivial constant literal assertion does not exercise runtime behavior.",
        )

    if isinstance(expr, ast.BoolOp) and isinstance(expr.op, ast.Or):
        if any(isinstance(v, ast.Constant) and bool(v.value) is True for v in expr.values):
            return (
                AssertionType.TRIVIAL,
                AssertionStrength.LOW,
                "Disjunction with constant True is a tautology.",
            )

    # 2. Type checks
    if _is_type_call(expr):
        return (
            AssertionType.TYPE,
            AssertionStrength.MEDIUM,
            "Validates runtime type contract via isinstance/issubclass.",
        )

    # 3. Comparisons
    if isinstance(expr, ast.Compare):
        operands = [expr.left, *expr.comparators]
        if all(_is_constant_expr(op) for op in operands):
            return (
                AssertionType.TRIVIAL,
                AssertionStrength.LOW,
                "Comparison between constant literals is a static tautology/contradiction.",
            )
        for left_op, right_op in zip(operands, operands[1:], strict=False):
            if ast.dump(left_op) == ast.dump(right_op):
                return (
                    AssertionType.TRIVIAL,
                    AssertionStrength.LOW,
                    "Self-comparison (x == x) is a trivial tautology.",
                )

        if any(_is_type_constructor_call(op) for op in operands):
            return (
                AssertionType.TYPE,
                AssertionStrength.MEDIUM,
                "Validates exact runtime type equivalence.",
            )

        ops = expr.ops
        if all(isinstance(op, (ast.Is, ast.IsNot)) for op in ops):
            return (
                AssertionType.IDENTITY,
                AssertionStrength.MEDIUM,
                "Validates object identity or singleton sentinel (e.g. None).",
            )
        if all(isinstance(op, (ast.Eq, ast.NotEq)) for op in ops):
            return (
                AssertionType.EQUALITY,
                AssertionStrength.HIGH,
                "Validates exact value equality/inequality against expected output.",
            )
        if any(isinstance(op, (ast.Lt, ast.LtE, ast.Gt, ast.GtE)) for op in ops):
            return (
                AssertionType.RELATIONAL,
                AssertionStrength.MEDIUM,
                "Validates relational ordering or numeric boundary constraint.",
            )
        if any(isinstance(op, (ast.In, ast.NotIn)) for op in ops):
            return (
                AssertionType.INVARIANT,
                AssertionStrength.MEDIUM,
                "Validates collection membership invariant.",
            )

    # 4. Approximate numeric equality
    if _is_approx_or_close_call(expr):
        return (
            AssertionType.EQUALITY,
            AssertionStrength.HIGH,
            "Validates approximate numeric equivalence within tolerance.",
        )

    # 5. General boolean invariants (predicates, BoolOp, all/any, property checks)
    return (
        AssertionType.INVARIANT,
        AssertionStrength.MEDIUM,
        "Validates boolean state or domain invariant.",
    )


def _is_pytest_raises_call(expr: ast.expr) -> bool:
    if not isinstance(expr, ast.Call):
        return False
    if isinstance(expr.func, ast.Attribute) and expr.func.attr == "raises":
        if isinstance(expr.func.value, ast.Name) and expr.func.value.id == "pytest":
            return True
    if isinstance(expr.func, ast.Name) and expr.func.id == "raises":
        return True
    return False


def _has_meaningful_raises_body(body: list[ast.stmt]) -> bool:
    for stmt in body:
        if isinstance(stmt, ast.Pass):
            continue
        if isinstance(stmt, ast.Expr) and _is_constant_expr(stmt.value):
            continue
        return True
    return False


def _format_statement(node: ast.AST, source_lines: list[str]) -> str:
    lineno = getattr(node, "lineno", None)
    if isinstance(lineno, int) and 1 <= lineno <= len(source_lines):
        raw_line = source_lines[lineno - 1].strip()
        if raw_line:
            return raw_line
    return ast.unparse(node)


def _collect_assertions_in_block(
    stmts: list[ast.stmt],
    test_name: str,
    source_lines: list[str],
    out: list[tuple[int, str, str, AssertionType, AssertionStrength, str]],
) -> None:
    """Recursively traverse statements in source order extracting assert and pytest.raises."""
    for stmt in stmts:
        if isinstance(stmt, ast.Assert):
            a_type, strength, explanation = _classify_assert_expr(stmt.test)
            out.append(
                (
                    stmt.lineno,
                    test_name,
                    _format_statement(stmt, source_lines),
                    a_type,
                    strength,
                    explanation,
                )
            )
        elif isinstance(stmt, (ast.With, ast.AsyncWith)):
            is_raises = any(_is_pytest_raises_call(item.context_expr) for item in stmt.items)
            if is_raises:
                if _has_meaningful_raises_body(stmt.body):
                    out.append(
                        (
                            stmt.lineno,
                            test_name,
                            _format_statement(stmt, source_lines),
                            AssertionType.EXCEPTION,
                            AssertionStrength.HIGH,
                            "Validates expected exception raising under invalid/edge inputs.",
                        )
                    )
                else:
                    out.append(
                        (
                            stmt.lineno,
                            test_name,
                            _format_statement(stmt, source_lines),
                            AssertionType.TRIVIAL,
                            AssertionStrength.LOW,
                            "Empty pytest.raises context executes no target behavior.",
                        )
                    )
            _collect_assertions_in_block(stmt.body, test_name, source_lines, out)
        elif isinstance(stmt, ast.Expr) and _is_pytest_raises_call(stmt.value):
            # Functional form: pytest.raises(ValueError, divide, 1, 0)
            if len(stmt.value.args) >= 2:  # type: ignore[attr-defined]
                out.append(
                    (
                        stmt.lineno,
                        test_name,
                        _format_statement(stmt, source_lines),
                        AssertionType.EXCEPTION,
                        AssertionStrength.HIGH,
                        "Validates expected exception raising via callable invocation.",
                    )
                )
            else:
                out.append(
                    (
                        stmt.lineno,
                        test_name,
                        _format_statement(stmt, source_lines),
                        AssertionType.TRIVIAL,
                        AssertionStrength.LOW,
                        "Standalone pytest.raises call without target callable.",
                    )
                )
        elif isinstance(stmt, (ast.For, ast.AsyncFor, ast.While, ast.If)):
            _collect_assertions_in_block(stmt.body, test_name, source_lines, out)
            _collect_assertions_in_block(stmt.orelse, test_name, source_lines, out)
        elif isinstance(stmt, ast.Try):
            _collect_assertions_in_block(stmt.body, test_name, source_lines, out)
            for handler in stmt.handlers:
                _collect_assertions_in_block(handler.body, test_name, source_lines, out)
            _collect_assertions_in_block(stmt.orelse, test_name, source_lines, out)
            _collect_assertions_in_block(stmt.finalbody, test_name, source_lines, out)


def _unavailable_analysis(reason: str) -> AssertionAnalysis:
    return AssertionAnalysis(
        score=None,
        summary={
            "total": 0,
            "verified": 0,
            "failed": 0,
            "ineffective": 0,
            "unchecked": 0,
            "pass_rate": None,
            "density": None,
            "assertion_less_cases": 0,
            "coverage_factor": None,
        },
        assertions=[],
        unavailable_reason=reason,
    )


def analyze_assertions(raw_output: str | None) -> AssertionAnalysis:
    """Extract and score static AST assertions across generated pytest functions."""
    extracted = extract_python_code(raw_output)
    if not extracted.code:
        return _unavailable_analysis("Generated output is empty")

    try:
        tree = ast.parse(extracted.code)
    except SyntaxError as exc:
        return _unavailable_analysis(f"Python syntax error at line {exc.lineno}: {exc.msg}")

    test_nodes = iter_test_functions(tree)
    if not test_nodes:
        return _unavailable_analysis("Generated code contains no 'def test_*' functions")

    if any(not is_non_empty_test_body(fn) for fn in test_nodes):
        return _unavailable_analysis(
            "Generated code contains placeholder pass/... test bodies"
        )

    source_lines = extracted.code.splitlines()
    raw_items: list[tuple[int, str, str, AssertionType, AssertionStrength, str]] = []
    assertion_less_cases = 0

    for fn in test_nodes:
        before_count = len(raw_items)
        _collect_assertions_in_block(fn.body, fn.name, source_lines, raw_items)
        if len(raw_items) == before_count:
            assertion_less_cases += 1

    raw_items.sort(key=lambda item: item[0])

    assertions: list[ExtractedAssertion] = []
    trivial_count = 0
    effective_non_trivial = 0

    for idx, (lineno, test_name, stmt_text, a_type, strength, explanation) in enumerate(
        raw_items, start=1
    ):
        is_trivial = a_type == AssertionType.TRIVIAL
        if is_trivial:
            trivial_count += 1
            status = "INEFFECTIVE"
        else:
            effective_non_trivial += 1
            status = "UNCHECKED"

        assertions.append(
            ExtractedAssertion(
                id=f"AST-{idx:02d}",
                test_case=test_name,
                statement=stmt_text,
                type=a_type,
                line=lineno,
                status=status,
                strength=strength,
                explanation=explanation,
            )
        )

    total_test_cases = len(test_nodes)
    total_assertions = len(assertions)
    density = round(total_assertions / total_test_cases, 2)
    cases_with_assertions = total_test_cases - assertion_less_cases
    coverage_factor = cases_with_assertions / total_test_cases

    if total_assertions == 0:
        score = 0.0
    else:
        score = round((effective_non_trivial / total_assertions) * coverage_factor * 100.0, 2)

    summary = {
        "total": total_assertions,
        "effective": effective_non_trivial,
        "verified": 0,
        "failed": 0,
        "ineffective": trivial_count,
        "unchecked": effective_non_trivial,
        "pass_rate": None,
        "density": density,
        "assertion_less_cases": assertion_less_cases,
        "total_test_cases": total_test_cases,
        "coverage_factor": round(coverage_factor, 4),
    }

    return AssertionAnalysis(
        score=score,
        summary=summary,
        assertions=assertions,
        unavailable_reason=None,
        numerator=effective_non_trivial,
        denominator=total_assertions,
    )


def score_assertion_quality(
    run_status: RunLifecycleStatus | str,
    raw_output: str | None,
    *,
    failure_reason: str | None = None,
) -> MetricOutcome:
    """Compute per-run assertion_quality preserving 0.0 for valid assertion-less tests vs N/A."""
    gated = check_metric_eligibility(
        MetricName.ASSERTION_QUALITY,
        run_status,
        failure_reason=failure_reason,
    )
    if gated is not None:
        reason = gated.reason or "Run is not eligible for assertion analysis"
        return MetricOutcome(
            metric_name=MetricName.ASSERTION_QUALITY,
            state=gated.state,
            numeric_value=None,
            reason=reason,
            details=_unavailable_analysis(reason).to_details(),
        )

    analysis = analyze_assertions(raw_output)
    details = analysis.to_details()
    if analysis.score is None:
        reason = analysis.unavailable_reason or "Generated code is ineligible for assertion analysis"
        return MetricOutcome(
            metric_name=MetricName.ASSERTION_QUALITY,
            state=MetricState.NOT_APPLICABLE,
            numeric_value=None,
            reason=reason,
            details=details,
        )

    reason_zero = (
        "Valid test suite contains zero assertions"
        if analysis.denominator == 0
        else None
    )
    return MetricOutcome(
        metric_name=MetricName.ASSERTION_QUALITY,
        state=MetricState.MEASURED,
        numeric_value=analysis.score,
        numerator=analysis.numerator,
        denominator=analysis.denominator,
        reason=reason_zero,
        details=details,
    )
