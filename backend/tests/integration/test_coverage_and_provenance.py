"""Statement + branch coverage (#53, FR-EVL-003) and metric provenance (#57, NFR-REP-001)."""

from __future__ import annotations

import copy
import uuid

import pytest

from app.modules.evaluation.coverage import (
    line_ranges,
    parse_coverage_report,
    score_branch_coverage,
)
from app.modules.evaluation.eligibility import MetricState
from app.modules.evaluation.provenance import EVALUATOR_VERSION, FORMULAS
from tests.integration.test_evaluations_api import eval_env  # noqa: F401 — fixture reuse

REPORT = {
    "meta": {"version": "7.8.0", "branch_coverage": True},
    "files": {
        "/workspace/target.py": {
            "executed_lines": [1, 2, 3, 5],
            "missing_lines": [4, 6],
            "missing_branches": [[3, 4], [5, -1]],
            "summary": {"num_statements": 6, "covered_lines": 4, "num_branches": 4, "covered_branches": 2},
        },
        "/workspace/test_generated.py": {
            "executed_lines": [1], "missing_lines": [],
            "summary": {"num_statements": 1, "covered_lines": 1},
        },
    },
}
CODE = "def test_add():\n    assert add(2, 3) == 5\n"


# ------------------------------------------------------------------ unit

def test_parse_report_keeps_numerators_denominators_and_lines():
    m = parse_coverage_report(REPORT)
    assert (m.statements.covered_lines, m.statements.total_lines) == (4, 6)
    assert m.statements.covered_ranges == ["L1-L3", "L5"] and m.statements.missed_ranges == ["L4", "L6"]
    assert (m.branches.covered, m.branches.total) == (2, 4)
    assert m.branches.missing_arcs == ["L3->L4", "L5->exit"] and m.branches.partial_lines == [3, 5]
    assert m.tool_version == "7.8.0"


def test_branch_score_states_keep_zero_distinct_from_na_failed_timeout():
    measured = score_branch_coverage("COMPLETED", parse_coverage_report(REPORT))
    assert (measured.state, measured.numeric_value, measured.numerator, measured.denominator) == (
        MetricState.MEASURED, 50.0, 2, 4)

    zero = copy.deepcopy(REPORT)
    zero["files"]["/workspace/target.py"]["summary"]["covered_branches"] = 0
    zero["files"]["/workspace/target.py"]["missing_branches"] = [[3, 4], [3, 5], [5, 6], [5, -1]]
    zero_outcome = score_branch_coverage("COMPLETED", parse_coverage_report(zero))
    assert zero_outcome.state == MetricState.MEASURED and zero_outcome.numeric_value == 0.0

    no_branches = copy.deepcopy(REPORT)
    no_branches["files"]["/workspace/target.py"]["summary"].update(num_branches=0, covered_branches=0)
    no_branches["files"]["/workspace/target.py"]["missing_branches"] = []
    assert score_branch_coverage("COMPLETED", parse_coverage_report(no_branches)).state == MetricState.NOT_APPLICABLE

    statements_only = copy.deepcopy(REPORT)
    for key in ("num_branches", "covered_branches"):
        statements_only["files"]["/workspace/target.py"]["summary"].pop(key)
    assert score_branch_coverage("COMPLETED", parse_coverage_report(statements_only)).state == MetricState.NOT_APPLICABLE

    timeout = parse_coverage_report(REPORT, runner_status="TIMEOUT")
    assert score_branch_coverage("COMPLETED", timeout).state == MetricState.TIMEOUT
    assert score_branch_coverage("COMPLETED", parse_coverage_report(REPORT, runner_status="ERROR")).state == MetricState.FAILED
    assert score_branch_coverage("TIMEOUT", None).state == MetricState.TIMEOUT
    assert score_branch_coverage("FAILED", None).state == MetricState.FAILED
    disabled = score_branch_coverage("COMPLETED", None)
    assert disabled.state == MetricState.NOT_APPLICABLE and "disabled" in disabled.reason.lower()


@pytest.mark.parametrize("mutate", [
    lambda r: r.pop("files"),
    lambda r: r["files"].pop("/workspace/target.py"),
    lambda r: r["files"]["/workspace/target.py"]["summary"].update(covered_lines=5),
    lambda r: r["files"]["/workspace/target.py"]["summary"].update(num_statements=9),
    lambda r: r["files"]["/workspace/target.py"]["summary"].update(covered_branches=9),
    lambda r: r["files"]["/workspace/target.py"].update(missing_branches=[[3, 4]]),
    lambda r: r["files"]["/workspace/target.py"].update(executed_lines=[0, 2]),
    lambda r: r["files"]["/workspace/target.py"].update(missing_branches=[[3, "x"], [5, -1]]),
    lambda r: r["files"].update({"/other/target.py": r["files"]["/workspace/target.py"]}),
])
def test_inconsistent_reports_are_rejected(mutate):
    report = copy.deepcopy(REPORT)
    mutate(report)
    with pytest.raises(ValueError):
        parse_coverage_report(report)


def test_line_ranges():
    assert line_ranges([]) == []
    assert line_ranges([7, 1, 2, 3, 9, 10]) == ["L1-L3", "L7", "L9-L10"]


# ------------------------------------------------------------------ API

def _evaluate(env, run_id, **extra):
    payload = {"run_status": "COMPLETED", "snapshot_id": str(env["snapshot_id"]), "target_function": "add",
               "generated_code": CODE, **extra}
    return env["client"].post(f"/api/v1/projects/{env['project_id']}/evaluations/runs/{run_id}/evaluate", json=payload)


def test_api_persists_statement_and_branch_coverage_with_provenance(eval_env):  # noqa: F811
    run_id = uuid.uuid4()
    res = _evaluate(eval_env, run_id, coverage_report=REPORT,
                    mutation_report={"tool_version": "3.3.1", "mutants": [
                        {"id": "MUT-01", "operator": "AOR", "line": 2, "original": "a + b", "mutated": "a - b",
                         "status": "KILLED", "killed_by": "test_add"}]})
    assert res.status_code == 200, res.text
    body = res.json()
    by_name = {m["metric_name"]: m for m in body["metric_records"]}
    assert [m["metric_name"] for m in body["metric_records"]] == [
        "syntax_validity", "assertion_quality", "line_coverage", "branch_coverage", "mutation_score"]
    line, branch = by_name["line_coverage"], by_name["branch_coverage"]
    assert (line["numeric_value"], line["numerator"], line["denominator"]) == (66.67, 4, 6)
    assert (branch["numeric_value"], branch["numerator"], branch["denominator"]) == (50.0, 2, 4)
    assert body["coverage_details"]["missing_arcs"] == ["L3->L4", "L5->exit"]
    assert body["coverage_details"]["total_branches"] == 4

    for metric in body["metric_records"]:
        prov = metric["provenance"]
        assert prov["evaluator_version"] == EVALUATOR_VERSION
        assert prov["formula"] == FORMULAS[metric["metric_name"]]
        assert prov["inputs"]["source_sha256"] == eval_env["source_sha256"]
        assert prov["inputs"]["run_id"] == str(run_id) and len(prov["inputs"]["generated_code_sha256"]) == 64
    assert by_name["line_coverage"]["provenance"]["tool"] == {"name": "coverage.py", "version": "7.8.0"}
    assert by_name["branch_coverage"]["provenance"]["parameters"] == {"report": "coverage-json", "branch": True}
    assert by_name["mutation_score"]["provenance"]["tool"] == {"name": "mutmut", "version": "3.3.1"}
    assert by_name["syntax_validity"]["provenance"]["tool"]["name"] == "python-ast"

    fetched = eval_env["client"].get(f"/api/v1/projects/{eval_env['project_id']}/evaluations/runs/{run_id}").json()
    assert {m["metric_name"]: m["provenance"] for m in fetched["metric_records"]} == {
        m["metric_name"]: m["provenance"] for m in body["metric_records"]}


def test_na_failed_and_timeout_metrics_still_carry_provenance(eval_env):  # noqa: F811
    for status, expected in [("COMPLETED", "N/A"), ("FAILED", "FAILED"), ("TIMEOUT", "TIMEOUT")]:
        extra = {} if status == "COMPLETED" else {"run_status": status, "failure_reason": f"run {status.lower()}"}
        body = _evaluate(eval_env, uuid.uuid4(), **extra).json()
        branch = next(m for m in body["metric_records"] if m["metric_name"] == "branch_coverage")
        assert branch["state"] == expected and branch["numeric_value"] is None
        assert branch["provenance"]["formula"] == FORMULAS["branch_coverage"]
        assert branch["provenance"]["tool"] == {"name": "coverage.py", "version": None}


def test_invalid_coverage_report_is_rejected_with_field_error(eval_env):  # noqa: F811
    bad = copy.deepcopy(REPORT)
    bad["files"]["/workspace/target.py"]["summary"]["covered_lines"] = 99
    res = _evaluate(eval_env, uuid.uuid4(), coverage_report=bad)
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "INPUT_INVALID" and "coverage_report" in res.json()["detail"]["fields"]
