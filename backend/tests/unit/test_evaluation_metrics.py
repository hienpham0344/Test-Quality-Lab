from __future__ import annotations

import ast
import math
from pathlib import Path

import pytest

from app.modules.evaluation.assertions import (
    AssertionStrength,
    AssertionType,
    analyze_assertions,
    score_assertion_quality,
)
from app.modules.evaluation.eligibility import (
    SANDBOX_DISABLE_REASON,
    CoverageTracePayload,
    MetricOutcome,
    MetricState,
    RunLifecycleStatus,
    check_metric_eligibility,
    score_line_coverage,
)
from app.modules.evaluation.models import MetricName
from app.modules.evaluation.mutation import (
    MutantStatus,
    MutationOperator,
    infer_mutation_operator,
    parse_mutmut_report,
    score_mutation_results,
)
from app.modules.evaluation.validity import (
    extract_python_code,
    score_generation_success,
    score_syntax_validity,
    validate_generated_test_code,
)


class TestMetricOutcomeAndEligibility:
    def test_measured_zero_is_preserved_as_exact_float(self) -> None:
        outcome = MetricOutcome(
            metric_name=MetricName.MUTATION_SCORE,
            state=MetricState.MEASURED,
            numeric_value=0,
            numerator=0,
            denominator=5,
        )
        assert outcome.state == MetricState.MEASURED
        assert outcome.numeric_value == 0.0
        assert isinstance(outcome.numeric_value, float)
        assert outcome.numeric_value is not None

    @pytest.mark.parametrize("bad_value", [None, True, False, math.nan, math.inf, -math.inf])
    def test_measured_rejects_missing_boolean_or_non_finite_values(self, bad_value: object) -> None:
        with pytest.raises(ValueError):
            MetricOutcome(
                metric_name=MetricName.SYNTAX_VALIDITY,
                state=MetricState.MEASURED,
                numeric_value=bad_value,  # type: ignore[arg-type]
            )

    @pytest.mark.parametrize(
        "non_measured_state",
        [MetricState.NOT_APPLICABLE, MetricState.FAILED, MetricState.TIMEOUT],
    )
    def test_non_measured_states_require_none_numeric_value_and_reason(
        self, non_measured_state: MetricState
    ) -> None:
        with pytest.raises(ValueError):
            MetricOutcome(
                metric_name=MetricName.LINE_COVERAGE,
                state=non_measured_state,
                numeric_value=0.0,
                reason="Has reason",
            )
        with pytest.raises(ValueError):
            MetricOutcome(
                metric_name=MetricName.LINE_COVERAGE,
                state=non_measured_state,
                numeric_value=None,
                reason="   ",
            )

    @pytest.mark.parametrize(
        "status",
        [
            RunLifecycleStatus.QUEUED,
            RunLifecycleStatus.PENDING,
            RunLifecycleStatus.RUNNING,
            RunLifecycleStatus.CANCELLING,
            RunLifecycleStatus.CANCELLED,
        ],
    )
    def test_non_completed_active_or_cancelled_runs_return_not_applicable(
        self, status: RunLifecycleStatus
    ) -> None:
        gated = check_metric_eligibility(MetricName.SYNTAX_VALIDITY, status)
        assert gated is not None
        assert gated.state == MetricState.NOT_APPLICABLE
        assert gated.numeric_value is None
        assert gated.reason

    def test_timeout_and_failed_runs_propagate_terminal_states(self) -> None:
        timeout_gate = check_metric_eligibility(
            MetricName.ASSERTION_QUALITY, RunLifecycleStatus.TIMEOUT
        )
        assert timeout_gate is not None
        assert timeout_gate.state == MetricState.TIMEOUT
        assert timeout_gate.numeric_value is None

        failed_gate = check_metric_eligibility(
            MetricName.SYNTAX_VALIDITY,
            RunLifecycleStatus.FAILED,
            failure_reason="Upstream 401 gsk_secret_token_1234567890abcdef",
        )
        assert failed_gate is not None
        assert failed_gate.state == MetricState.FAILED
        assert failed_gate.numeric_value is None
        assert "gsk_secret_token" not in (failed_gate.reason or "")

    def test_completed_run_gates_dynamic_metrics_fail_closed_by_default(self) -> None:
        assert (
            check_metric_eligibility(MetricName.SYNTAX_VALIDITY, RunLifecycleStatus.COMPLETED)
            is None
        )
        assert (
            check_metric_eligibility(MetricName.ASSERTION_QUALITY, RunLifecycleStatus.COMPLETED)
            is None
        )

        for dynamic_metric in (MetricName.LINE_COVERAGE, MetricName.MUTATION_SCORE):
            blocked = check_metric_eligibility(dynamic_metric, RunLifecycleStatus.COMPLETED)
            assert blocked is not None
            assert blocked.state == MetricState.NOT_APPLICABLE
            assert blocked.numeric_value is None
            assert blocked.reason == SANDBOX_DISABLE_REASON

            allowed_with_trace = check_metric_eligibility(
                dynamic_metric,
                RunLifecycleStatus.COMPLETED,
                has_verified_runtime_trace=True,
            )
            assert allowed_with_trace is None

    def test_line_coverage_trace_scoring_distinguishes_zero_na_failed_timeout(self) -> None:
        default_na = score_line_coverage(RunLifecycleStatus.COMPLETED, None)
        assert default_na.state == MetricState.NOT_APPLICABLE
        assert default_na.reason == SANDBOX_DISABLE_REASON

        zero_cov = score_line_coverage(
            RunLifecycleStatus.COMPLETED,
            CoverageTracePayload(
                covered_lines=0,
                total_lines=12,
                covered_ranges=[],
                missed_ranges=["L1-L12"],
            ),
        )
        assert zero_cov.state == MetricState.MEASURED
        assert zero_cov.numeric_value == 0.0
        assert zero_cov.numerator == 0
        assert zero_cov.denominator == 12

        measured_cov = score_line_coverage(
            RunLifecycleStatus.COMPLETED,
            CoverageTracePayload(
                covered_lines=14,
                total_lines=20,
                covered_ranges=["L1-L8", "L11-L16"],
                missed_ranges=["L9-L10", "L17-L20"],
            ),
        )
        assert measured_cov.state == MetricState.MEASURED
        assert measured_cov.numeric_value == 70.0

        empty_src = score_line_coverage(
            RunLifecycleStatus.COMPLETED,
            CoverageTracePayload(covered_lines=0, total_lines=0),
        )
        assert empty_src.state == MetricState.NOT_APPLICABLE
        assert empty_src.numeric_value is None


class TestStaticPythonValidityAndGenerationSuccess:
    def test_extracts_fenced_python_with_surrounding_prose(self) -> None:
        fenced = (
            "Here is the pytest suite:\n"
            "```python\n"
            "import pytest\n\n"
            "async def test_add_async():\n"
            "    assert add(2, 3) == 5\n"
            "```\n"
            "Explanation follows."
        )
        extracted = extract_python_code(fenced)
        assert extracted.extracted_from_fence is True
        assert "async def test_add_async" in extracted.code

        outcome = score_syntax_validity(
            RunLifecycleStatus.COMPLETED, fenced, target_function="add"
        )
        assert outcome.state == MetricState.MEASURED
        assert outcome.numeric_value == 100.0
        assert outcome.numerator == 1
        assert outcome.denominator == 1

    def test_raw_python_with_embedded_backticks_in_string_is_preserved(self) -> None:
        raw = (
            'def test_markdown_string():\n'
            '    sample = "```python\\nnot valid syntax ???\\n```"\n'
            '    assert format_md(sample).startswith("```")\n'
        )
        analysis = validate_generated_test_code(raw, target_function="format_md")
        assert analysis.is_valid is True
        assert analysis.extracted_from_fence is False

    @pytest.mark.parametrize(
        "invalid_code",
        [
            "",
            "def test_broken(:\n    assert 1 == 1\n",
            "def helper_only(x):\n    return x + 1\n",
            "def test_pass_stub():\n    pass\n",
            "def test_ellipsis_stub():\n    '''Docstring only plus ellipsis.'''\n    ...\n",
            "def test_ok():\n    assert add(1, 2) == 3\n\ndef test_todo():\n    pass\n",
        ],
    )
    def test_invalid_syntax_or_placeholder_test_bodies_score_zero(self, invalid_code: str) -> None:
        outcome = score_syntax_validity(RunLifecycleStatus.COMPLETED, invalid_code)
        assert outcome.state == MetricState.MEASURED
        assert outcome.numeric_value == 0.0
        assert outcome.numerator == 0
        assert outcome.denominator == 1
        assert outcome.reason

    def test_target_function_call_verification(self) -> None:
        import_only = (
            "from target_module import calculate_tax\n\n"
            "def test_unrelated():\n"
            "    assert 2 + 2 == 4\n"
        )
        outcome_missing = score_syntax_validity(
            RunLifecycleStatus.COMPLETED, import_only, target_function="calculate_tax"
        )
        assert outcome_missing.state == MetricState.MEASURED
        assert outcome_missing.numeric_value == 0.0
        assert "calculate_tax" in (outcome_missing.reason or "")

        attr_call = (
            "import target_module\n\n"
            "def test_tax():\n"
            "    assert target_module.calculate_tax(100) == 10\n"
        )
        outcome_valid = score_syntax_validity(
            RunLifecycleStatus.COMPLETED, attr_call, target_function="calculate_tax"
        )
        assert outcome_valid.state == MetricState.MEASURED
        assert outcome_valid.numeric_value == 100.0

    def test_generation_success_batch_metric_preserves_zero_and_na(self) -> None:
        na_none_evaluated = score_generation_success(
            valid_runs=0, evaluated_runs=0, total_planned_runs=8
        )
        assert na_none_evaluated.state == MetricState.NOT_APPLICABLE
        assert na_none_evaluated.numeric_value is None

        zero_pct = score_generation_success(
            valid_runs=0, evaluated_runs=4, total_planned_runs=8
        )
        assert zero_pct.state == MetricState.MEASURED
        assert zero_pct.numeric_value == 0.0
        assert zero_pct.numerator == 0
        assert zero_pct.denominator == 8

        partial_pct = score_generation_success(
            valid_runs=3, evaluated_runs=4, total_planned_runs=4
        )
        assert partial_pct.state == MetricState.MEASURED
        assert partial_pct.numeric_value == 75.0
        assert partial_pct.numerator == 3
        assert partial_pct.denominator == 4


class TestMutmutParserAndScorer:
    def test_operator_inference_covers_taxonomy(self) -> None:
        assert infer_mutation_operator("a + b", "a - b") == MutationOperator.AOR
        assert infer_mutation_operator("x >= 0", "x > 0") == MutationOperator.ROR
        assert infer_mutation_operator("ok and ready", "ok or ready") == MutationOperator.LCR
        assert infer_mutation_operator("return total", "return None") == MutationOperator.SDL
        assert infer_mutation_operator("not flag", "flag") == MutationOperator.UOI

    def test_parses_all_mutmut_statuses_and_excludes_non_eligible_from_denominator(self) -> None:
        raw_payload = {
            "runner_status": "COMPLETED",
            "verified": True,
            "mutants": [
                {
                    "id": "MUT-01",
                    "operator": "AOR",
                    "line": 4,
                    "original": "a + b",
                    "mutated": "a - b",
                    "status": "killed",
                    "killed_by": "test_add",
                },
                {
                    "id": "MUT-02",
                    "operator": "ROR",
                    "line": 6,
                    "original": "a > 0",
                    "mutated": "a >= 0",
                    "status": "KILLED",
                    "killed_by": "test_boundary",
                },
                {
                    "id": "MUT-03",
                    "operator": "LCR",
                    "line": 9,
                    "original": "x and y",
                    "mutated": "x or y",
                    "status": "survived",
                    "killed_by": None,
                },
                {
                    "operator": "SDL",
                    "line": 11,
                    "original": "cache[k] = v",
                    "mutated": "pass",
                    "status": "TIMEOUT",
                },
                {
                    "operator": "UOI",
                    "line": 12,
                    "original": "-val",
                    "mutated": "val",
                    "status": "SUSPICIOUS",
                },
                {
                    "operator": "AOR",
                    "line": 14,
                    "original": "i * 1",
                    "mutated": "i / 1",
                    "status": "EQUIVALENT",
                },
                {
                    "operator": "SDL",
                    "line": 16,
                    "original": "log(msg)",
                    "mutated": "pass",
                    "status": "SKIPPED",
                },
                {
                    "operator": "ROR",
                    "line": 18,
                    "original": "a == b",
                    "mutated": "a === b",
                    "status": "INVALID",
                },
            ],
        }
        parsed = parse_mutmut_report(raw_payload)
        assert len(parsed.mutants) == 8
        assert parsed.mutants[3].id == "MUT-04"
        assert parsed.mutants[0].status == MutantStatus.KILLED

        # Denominator = killed (2) + survived (1) = 3 -> 2 / 3 * 100 = 66.67
        outcome = score_mutation_results(RunLifecycleStatus.COMPLETED, parsed)
        assert outcome.state == MetricState.MEASURED
        assert outcome.numeric_value == 66.67
        assert outcome.numerator == 2
        assert outcome.denominator == 3
        summary = outcome.details["summary"]
        assert summary["killed"] == 2
        assert summary["survived"] == 1
        assert summary["timeout"] == 1
        assert summary["suspicious"] == 1
        assert summary["equivalent"] == 1
        assert summary["skipped"] == 1
        assert summary["invalid"] == 1

    def test_zero_killed_with_survivors_preserves_zero_float(self) -> None:
        outcome = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            {
                "verified": True,
                "mutants": [
                    {
                        "id": "MUT-01",
                        "operator": "AOR",
                        "line": 2,
                        "original": "a + b",
                        "mutated": "a - b",
                        "status": "SURVIVED",
                    }
                ],
            },
        )
        assert outcome.state == MetricState.MEASURED
        assert outcome.numeric_value == 0.0
        assert outcome.numerator == 0
        assert outcome.denominator == 1

    def test_zero_denominator_and_disabled_execution_and_runner_errors(self) -> None:
        disabled = score_mutation_results(RunLifecycleStatus.COMPLETED, None, execution_enabled=False)
        assert disabled.state == MetricState.NOT_APPLICABLE
        assert disabled.reason == SANDBOX_DISABLE_REASON

        unverified = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            {"verified": False, "mutants": []},
            execution_enabled=False,
        )
        assert unverified.state == MetricState.NOT_APPLICABLE
        assert unverified.reason == SANDBOX_DISABLE_REASON

        only_equiv = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            {
                "verified": True,
                "mutants": [
                    {
                        "operator": "AOR",
                        "line": 2,
                        "original": "x + 0",
                        "mutated": "x - 0",
                        "status": "EQUIVALENT",
                    },
                    {
                        "operator": "SDL",
                        "line": 3,
                        "original": "loop()",
                        "mutated": "while True: pass",
                        "status": "TIMEOUT",
                    },
                ],
            },
        )
        assert only_equiv.state == MetricState.NOT_APPLICABLE
        assert only_equiv.numeric_value is None

        runner_timeout = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            {"verified": True, "runner_status": "TIMEOUT", "mutants": []},
        )
        assert runner_timeout.state == MetricState.TIMEOUT
        assert runner_timeout.numeric_value is None

        runner_failed = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            {
                "verified": True,
                "runner_status": "FAILED",
                "error_message": "mutmut internal error",
                "mutants": [],
            },
        )
        assert runner_failed.state == MetricState.FAILED
        assert runner_failed.numeric_value is None


class TestStaticAssertionQualityAnalyzer:
    def test_classifies_all_seven_assertion_categories_and_scores_density(self) -> None:
        code = (
            "import pytest\n\n"
            "def test_comprehensive():\n"
            "    res = compute(4)\n"
            "    assert res == 16\n"
            "    assert res > 0\n"
            "    assert isinstance(res, int)\n"
            "    assert res is not None\n"
            "    assert res in {16, 32}\n"
            "    with pytest.raises(ValueError):\n"
            "        compute(-1)\n\n"
            "def test_trivial_and_tautologies():\n"
            "    x = compute(2)\n"
            "    assert True\n"
            "    assert 1 == 1\n"
            "    assert x == x\n\n"
            "def test_no_assertions():\n"
            "    compute(0)\n"
        )
        analysis = analyze_assertions(code)
        types = [item.type for item in analysis.assertions]
        assert types == [
            AssertionType.EQUALITY,
            AssertionType.RELATIONAL,
            AssertionType.TYPE,
            AssertionType.IDENTITY,
            AssertionType.INVARIANT,
            AssertionType.EXCEPTION,
            AssertionType.TRIVIAL,
            AssertionType.TRIVIAL,
            AssertionType.TRIVIAL,
        ]
        assert [a.id for a in analysis.assertions] == [f"AST-0{i}" for i in range(1, 10)]
        assert analysis.assertions[0].strength == AssertionStrength.HIGH
        assert analysis.assertions[-1].strength == AssertionStrength.LOW

        # 9 total assertions across 3 test cases -> density = 3.0
        # 1 assertion-less case -> coverage_factor = 2 / 3
        # 6 non-trivial / 9 total * (2 / 3) * 100 = 44.44
        assert analysis.summary["total"] == 9
        assert analysis.summary["ineffective"] == 3
        assert analysis.summary["density"] == 3.0
        assert analysis.summary["assertion_less_cases"] == 1
        assert analysis.score == 44.44

        outcome = score_assertion_quality(RunLifecycleStatus.COMPLETED, code)
        assert outcome.state == MetricState.MEASURED
        assert outcome.numeric_value == 44.44
        assert outcome.numerator == 6
        assert outcome.denominator == 9

    def test_valid_test_file_with_zero_assertions_scores_numeric_zero(self) -> None:
        code = "def test_smoke_only():\n    result = add(1, 2)\n    return result\n"
        outcome = score_assertion_quality(RunLifecycleStatus.COMPLETED, code)
        assert outcome.state == MetricState.MEASURED
        assert outcome.numeric_value == 0.0
        assert outcome.numerator == 0
        assert outcome.denominator == 0
        assert outcome.details["summary"]["assertion_less_cases"] == 1

    def test_syntax_invalid_file_returns_not_applicable(self) -> None:
        outcome = score_assertion_quality(RunLifecycleStatus.COMPLETED, "def test_broken(:\n")
        assert outcome.state == MetricState.NOT_APPLICABLE
        assert outcome.numeric_value is None
        assert outcome.details["unavailable_reason"]


def test_evaluation_module_contains_zero_untrusted_execution_primitives() -> None:
    eval_dir = Path(__file__).resolve().parents[2] / "app" / "modules" / "evaluation"
    forbidden_modules = {"subprocess", "pty", "shlex", "pytest", "mutmut"}
    forbidden_calls = {"eval", "exec", "compile", "system", "popen", "Popen", "run"}

    py_files = sorted(eval_dir.glob("*.py"))
    assert len(py_files) >= 6

    for py_file in py_files:
        tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert alias.name.split(".")[0] not in forbidden_modules, py_file.name
            elif isinstance(node, ast.ImportFrom) and node.module:
                assert node.module.split(".")[0] not in forbidden_modules, py_file.name
            elif isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    assert node.func.id not in {"eval", "exec", "compile"}, py_file.name
                elif isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                    if node.func.value.id in {"os", "subprocess"}:
                        assert node.func.attr not in forbidden_calls, py_file.name
