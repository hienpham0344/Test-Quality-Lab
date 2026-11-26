"""Unit verification tests for sandbox fail-closed gating, static AST policy, and NFR-SEC-002 contract (Issue #70)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import pytest

from app.modules.evaluation.eligibility import (
    DYNAMIC_RUNTIME_METRICS,
    SANDBOX_DISABLE_REASON,
    STATIC_METRICS,
    CoverageTracePayload,
    MetricOutcome,
    MetricState,
    RunLifecycleStatus,
    check_metric_eligibility,
    score_line_coverage,
)
from app.modules.evaluation.models import MetricName
from app.modules.evaluation.mutation import (
    MutantRecord,
    MutantStatus,
    MutationOperator,
    MutationReport,
    parse_mutmut_report,
    score_mutation_results,
)
from app.modules.sources.policy import (
    ALLOWED_IMPORTS,
    UNSUPPORTED_CALLS,
    SourcePolicyError,
    inspect_python,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class SandboxIsolationPolicyContract:
    """Target resource and isolation contract aligned with infra/security/sandbox-policy.md."""

    sandbox_approved: bool = False
    cpu_cores_limit: int = 1
    memory_gib_limit: int = 1
    memory_bytes_limit: int = 1024 * 1024 * 1024
    timeout_seconds_limit: int = 60
    network_disabled: bool = True
    read_only_rootfs: bool = True
    ephemeral_tmpfs: bool = True
    non_root_uid: int = 65534
    non_root_gid: int = 65534
    no_new_privileges: bool = True
    drop_all_linux_capabilities: bool = True
    mount_docker_socket_in_api_or_worker: bool = False
    expose_host_secrets: bool = False
    forbidden_secret_env_vars: frozenset[str] = frozenset(
        {
            "GROQ_API_KEY",
            "GEMINI_API_KEY",
            "OPENROUTER_API_KEY",
            "CREDENTIAL_ENCRYPTION_KEY",
            "JWT_SECRET_KEY",
        }
    )


DEFAULT_SANDBOX_CONTRACT = SandboxIsolationPolicyContract()


class TestDynamicMetricFailClosedEligibility:
    """Verify dynamic metrics fail closed when sandbox_approved / execution_enabled is False."""

    def test_static_and_dynamic_metric_partition_is_disjoint_and_complete(self) -> None:
        assert DYNAMIC_RUNTIME_METRICS == frozenset(
            {MetricName.LINE_COVERAGE, MetricName.MUTATION_SCORE}
        )
        assert STATIC_METRICS == frozenset(
            {
                MetricName.SYNTAX_VALIDITY,
                MetricName.ASSERTION_QUALITY,
                MetricName.GENERATION_SUCCESS,
            }
        )
        assert DYNAMIC_RUNTIME_METRICS.isdisjoint(STATIC_METRICS)

    @pytest.mark.parametrize(
        "dynamic_metric",
        [MetricName.LINE_COVERAGE, MetricName.MUTATION_SCORE],
    )
    def test_dynamic_metrics_fail_closed_by_default_when_sandbox_not_approved(
        self, dynamic_metric: MetricName
    ) -> None:
        sandbox_approved = DEFAULT_SANDBOX_CONTRACT.sandbox_approved
        assert sandbox_approved is False

        gated = check_metric_eligibility(
            dynamic_metric,
            RunLifecycleStatus.COMPLETED,
            execution_enabled=sandbox_approved,
            has_verified_runtime_trace=False,
        )
        assert gated is not None
        assert gated.metric_name == dynamic_metric
        assert gated.state == MetricState.NOT_APPLICABLE
        assert gated.state.value == "N/A"
        assert gated.numeric_value is None
        assert gated.reason == SANDBOX_DISABLE_REASON

    @pytest.mark.parametrize(
        "static_metric",
        [
            MetricName.SYNTAX_VALIDITY,
            MetricName.ASSERTION_QUALITY,
            MetricName.GENERATION_SUCCESS,
        ],
    )
    def test_static_metrics_remain_eligible_on_completed_runs_with_sandbox_disabled(
        self, static_metric: MetricName
    ) -> None:
        gated = check_metric_eligibility(
            static_metric,
            RunLifecycleStatus.COMPLETED,
            execution_enabled=False,
            has_verified_runtime_trace=False,
        )
        assert gated is None

    def test_unverified_coverage_and_mutation_claims_are_rejected_fail_closed(self) -> None:
        unverified_coverage = CoverageTracePayload(
            covered_lines=10,
            total_lines=10,
            covered_ranges=["1-10"],
            missed_ranges=[],
            verified=False,
        )
        cov_outcome = score_line_coverage(
            RunLifecycleStatus.COMPLETED,
            unverified_coverage,
            execution_enabled=False,
        )
        assert cov_outcome.state == MetricState.NOT_APPLICABLE
        assert cov_outcome.numeric_value is None
        assert cov_outcome.reason == SANDBOX_DISABLE_REASON

        unverified_mutation = parse_mutmut_report(
            {
                "verified": False,
                "mutants": [
                    {
                        "id": "MUT-01",
                        "operator": "AOR",
                        "line": 3,
                        "original": "a + b",
                        "mutated": "a - b",
                        "status": "KILLED",
                        "killed_by": "test_add",
                    }
                ],
            }
        )
        mut_outcome = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            unverified_mutation,
            execution_enabled=False,
        )
        assert mut_outcome.state == MetricState.NOT_APPLICABLE
        assert mut_outcome.numeric_value is None
        assert mut_outcome.reason == SANDBOX_DISABLE_REASON

    def test_missing_traces_with_sandbox_disabled_return_sandbox_disable_reason(self) -> None:
        cov_outcome = score_line_coverage(
            RunLifecycleStatus.COMPLETED,
            None,
            execution_enabled=False,
        )
        assert cov_outcome.state == MetricState.NOT_APPLICABLE
        assert cov_outcome.numeric_value is None
        assert cov_outcome.reason == SANDBOX_DISABLE_REASON

        mut_outcome = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            None,
            execution_enabled=False,
        )
        assert mut_outcome.state == MetricState.NOT_APPLICABLE
        assert mut_outcome.numeric_value is None
        assert mut_outcome.reason == SANDBOX_DISABLE_REASON

    def test_verified_traces_strictly_distinguish_zero_na_failed_and_timeout(self) -> None:
        # 1. Numeric 0.0 (MEASURED) must never be coerced to N/A, None, or False
        zero_cov = score_line_coverage(
            RunLifecycleStatus.COMPLETED,
            CoverageTracePayload(
                covered_lines=0,
                total_lines=20,
                covered_ranges=[],
                missed_ranges=["1-20"],
                verified=True,
            ),
            execution_enabled=False,
        )
        assert zero_cov.state == MetricState.MEASURED
        assert zero_cov.numeric_value == 0.0
        assert isinstance(zero_cov.numeric_value, float)
        assert zero_cov.numeric_value is not None
        assert zero_cov.numerator == 0
        assert zero_cov.denominator == 20

        zero_mut = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            MutationReport(
                mutants=[
                    MutantRecord(
                        id="MUT-01",
                        operator=MutationOperator.ROR,
                        line=4,
                        original="x > 0",
                        mutated="x >= 0",
                        status=MutantStatus.SURVIVED,
                    )
                ],
                verified=True,
            ),
            execution_enabled=False,
        )
        assert zero_mut.state == MetricState.MEASURED
        assert zero_mut.numeric_value == 0.0
        assert isinstance(zero_mut.numeric_value, float)
        assert zero_mut.numerator == 0
        assert zero_mut.denominator == 1

        # 2. N/A (NOT_APPLICABLE) when denominator is 0 even with verified trace
        na_cov = score_line_coverage(
            RunLifecycleStatus.COMPLETED,
            CoverageTracePayload(covered_lines=0, total_lines=0, verified=True),
            execution_enabled=False,
        )
        assert na_cov.state == MetricState.NOT_APPLICABLE
        assert na_cov.numeric_value is None
        assert na_cov.reason == "No executable statements in target source"

        na_mut = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            MutationReport(
                mutants=[
                    MutantRecord(
                        id="MUT-EQ",
                        operator=MutationOperator.SDL,
                        line=2,
                        original="pass",
                        mutated="...",
                        status=MutantStatus.EQUIVALENT,
                    )
                ],
                verified=True,
            ),
            execution_enabled=False,
        )
        assert na_mut.state == MetricState.NOT_APPLICABLE
        assert na_mut.numeric_value is None
        assert na_mut.reason == "No eligible non-equivalent mutants to score"

        # 3. FAILED (runner or lifecycle failure)
        failed_cov = score_line_coverage(
            RunLifecycleStatus.COMPLETED,
            CoverageTracePayload(
                covered_lines=0,
                total_lines=10,
                runner_status="FAILED",
                error_message="Pytest collection error",
                verified=True,
            ),
            execution_enabled=False,
        )
        assert failed_cov.state == MetricState.FAILED
        assert failed_cov.numeric_value is None
        assert failed_cov.reason == "Pytest collection error"

        failed_mut = score_mutation_results(
            RunLifecycleStatus.FAILED,
            failure_reason="Runner process crashed",
            execution_enabled=False,
        )
        assert failed_mut.state == MetricState.FAILED
        assert failed_mut.numeric_value is None
        assert failed_mut.reason == "Runner process crashed"

        # 4. TIMEOUT (runner or lifecycle timeout)
        timeout_cov = score_line_coverage(
            RunLifecycleStatus.TIMEOUT,
            failure_reason="Suite exceeded 60s sandbox limit",
            execution_enabled=False,
        )
        assert timeout_cov.state == MetricState.TIMEOUT
        assert timeout_cov.numeric_value is None
        assert timeout_cov.reason == "Suite exceeded 60s sandbox limit"

        timeout_mut = score_mutation_results(
            RunLifecycleStatus.COMPLETED,
            MutationReport(
                mutants=[],
                runner_status="TIMEOUT",
                error_message="Mutmut timed out after 60s",
                verified=True,
            ),
            execution_enabled=False,
        )
        assert timeout_mut.state == MetricState.TIMEOUT
        assert timeout_mut.numeric_value is None
        assert timeout_mut.reason == "Mutmut timed out after 60s"

    def test_metric_outcome_redacts_secrets_in_failure_reasons(self) -> None:
        outcome = MetricOutcome(
            metric_name=MetricName.LINE_COVERAGE,
            state=MetricState.FAILED,
            numeric_value=None,
            reason="Runner failed with key gsk_abcdefghijklmnopqrstuvwxyz123456",
        )
        assert outcome.reason is not None
        assert "gsk_abcdefghijklmnopqrstuvwxyz123456" not in outcome.reason


class TestStaticAstPolicyEscapeBlocking:
    """Verify backend/app/modules/sources/policy.py blocks network, filesystem, and process escapes."""

    def test_allowed_imports_whitelist_excludes_all_io_network_and_system_modules(self) -> None:
        assert ALLOWED_IMPORTS == frozenset(
            {"math", "cmath", "decimal", "fractions", "itertools", "statistics"}
        )

    @pytest.mark.parametrize(
        "forbidden_import",
        [
            "socket",
            "http",
            "http.client",
            "urllib",
            "urllib.request",
            "requests",
            "httpx",
            "subprocess",
            "os",
            "sys",
            "shutil",
            "pathlib",
            "ctypes",
            "importlib",
            "builtins",
            "pickle",
            "marshal",
            "multiprocessing",
            "threading",
            "pty",
            "resource",
            "signal",
            "tempfile",
            "glob",
            "io",
            "inspect",
            "runpy",
            "code",
        ],
    )
    def test_blocks_forbidden_direct_and_from_imports(self, forbidden_import: str) -> None:
        direct_code = f"import {forbidden_import}\n\ndef target(x):\n    return x\n"
        with pytest.raises(SourcePolicyError, match="Unsupported import"):
            inspect_python(direct_code)

        from_code = f"from {forbidden_import} import something\n\ndef target(x):\n    return x\n"
        with pytest.raises(SourcePolicyError, match="Unsupported import"):
            inspect_python(from_code)

        in_fn_code = f"def target(x):\n    import {forbidden_import}\n    return x\n"
        with pytest.raises(SourcePolicyError, match="Unsupported import"):
            inspect_python(in_fn_code)

    @pytest.mark.parametrize(
        "forbidden_call_expr",
        [
            "eval('1 + 1')",
            "exec('import os')",
            "compile('1', '<string>', 'eval')",
            "open('/etc/passwd')",
            "__import__('os')",
            "input('prompt')",
            "breakpoint()",
            "globals()",
            "locals()",
            "vars()",
            "getattr(x, '__class__')",
            "setattr(x, 'a', 1)",
            "delattr(x, 'a')",
        ],
    )
    def test_blocks_dangerous_builtin_calls(self, forbidden_call_expr: str) -> None:
        call_name = forbidden_call_expr.split("(", 1)[0]
        assert call_name in UNSUPPORTED_CALLS

        code = f"def target(x):\n    return {forbidden_call_expr}\n"
        with pytest.raises(SourcePolicyError, match=f"Unsupported call '{call_name}'"):
            inspect_python(code)

    @pytest.mark.parametrize(
        "escape_snippet,expected_match",
        [
            ("from . import secret\ndef f(x):\n    return x\n", "Unsupported import"),
            ("from ..app import main\ndef f(x):\n    return x\n", "Unsupported import"),
            ("from math import *\ndef f(x):\n    return x\n", "Wildcard import"),
            ("os_mod = 1\ndef f(x):\n    return x\n", "Top-level behavior is unsupported"),
            ("def f(x):\n    yield x\n", "Unsupported behavior"),
            ("def f(x):\n    yield from x\n", "Unsupported behavior"),
            ("async def f(x):\n    return x\n", "Async functions are unsupported"),
            ("@decorator\ndef f(x):\n    return x\n", "Decorators are unsupported"),
        ],
    )
    def test_blocks_relative_wildcard_and_structural_escapes(
        self, escape_snippet: str, expected_match: str
    ) -> None:
        with pytest.raises(SourcePolicyError, match=expected_match):
            inspect_python(escape_snippet)


class TestSandboxResourceAndIsolationContractAlignment:
    """Verify resource limits and security controls match infra/security/sandbox-policy.md."""

    def test_policy_contract_matches_documented_srs_pilot_resource_targets(self) -> None:
        policy_path = REPO_ROOT / "infra" / "security" / "sandbox-policy.md"
        policy_text = policy_path.read_text(encoding="utf-8")

        cpu_match = re.search(r"(\d+)\s+CPU", policy_text)
        mem_match = re.search(r"(\d+)\s+GiB\s+memory", policy_text)
        time_match = re.search(r"(\d+)\s+seconds\s+per\s+suite", policy_text)

        assert cpu_match is not None
        assert mem_match is not None
        assert time_match is not None

        assert int(cpu_match.group(1)) == DEFAULT_SANDBOX_CONTRACT.cpu_cores_limit == 1
        assert int(mem_match.group(1)) == DEFAULT_SANDBOX_CONTRACT.memory_gib_limit == 1
        assert DEFAULT_SANDBOX_CONTRACT.memory_bytes_limit == 1_073_741_824
        assert int(time_match.group(1)) == DEFAULT_SANDBOX_CONTRACT.timeout_seconds_limit == 60

    def test_policy_contract_enforces_mandatory_isolation_invariants(self) -> None:
        policy_path = REPO_ROOT / "infra" / "security" / "sandbox-policy.md"
        policy_text = policy_path.read_text(encoding="utf-8")
        dockerfile_text = (REPO_ROOT / "sandbox" / "Dockerfile").read_text(encoding="utf-8")

        assert DEFAULT_SANDBOX_CONTRACT.sandbox_approved is False
        assert DEFAULT_SANDBOX_CONTRACT.network_disabled is True
        assert DEFAULT_SANDBOX_CONTRACT.read_only_rootfs is True
        assert DEFAULT_SANDBOX_CONTRACT.ephemeral_tmpfs is True
        assert DEFAULT_SANDBOX_CONTRACT.no_new_privileges is True
        assert DEFAULT_SANDBOX_CONTRACT.drop_all_linux_capabilities is True
        assert DEFAULT_SANDBOX_CONTRACT.mount_docker_socket_in_api_or_worker is False
        assert DEFAULT_SANDBOX_CONTRACT.expose_host_secrets is False

        assert f"USER {DEFAULT_SANDBOX_CONTRACT.non_root_uid}:{DEFAULT_SANDBOX_CONTRACT.non_root_gid}" in dockerfile_text
        assert "network disabled" in policy_text
        assert "read-only root filesystem" in policy_text
        assert "ephemeral tmpfs" in policy_text
        assert "no host secrets" in policy_text
        assert "disabled Linux\ncapabilities" in policy_text or "disabled Linux capabilities" in policy_text.replace("\n", " ")
        assert "no-new-privileges" in policy_text
        assert "Worker/API may never mount the Docker socket" in policy_text
