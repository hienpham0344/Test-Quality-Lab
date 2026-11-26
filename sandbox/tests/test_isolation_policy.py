"""Sandbox runner isolation & fail-closed policy verification tests (Issue #70, NFR-SEC-002)."""

from __future__ import annotations

import ast
import importlib.util
import re
import runpy
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SANDBOX_DIR = REPO_ROOT / "sandbox"
RUNNER_DIR = SANDBOX_DIR / "runner"
RUNNER_MAIN = RUNNER_DIR / "main.py"
RUNNER_POLICY = RUNNER_DIR / "policy.py"
RUNNER_PYTEST = RUNNER_DIR / "pytest_runner.py"
RUNNER_COLLECTOR = RUNNER_DIR / "result_collector.py"
SANDBOX_DOCKERFILE = SANDBOX_DIR / "Dockerfile"
SANDBOX_POLICY_DOC = REPO_ROOT / "infra" / "security" / "sandbox-policy.md"

HOST_SECRET_ENV_NAMES: frozenset[str] = frozenset(
    {
        "GROQ_API_KEY",
        "GEMINI_API_KEY",
        "OPENROUTER_API_KEY",
        "CREDENTIAL_ENCRYPTION_KEY",
        "JWT_SECRET_KEY",
    }
)

FORBIDDEN_RUNNER_IMPORTS: frozenset[str] = frozenset(
    {
        "socket",
        "http",
        "urllib",
        "requests",
        "httpx",
        "aiohttp",
        "ftplib",
        "smtplib",
        "ssl",
        "subprocess",
        "shutil",
        "ctypes",
        "multiprocessing",
        "pty",
        "docker",
    }
)

FORBIDDEN_RUNNER_CALLS: frozenset[str] = frozenset(
    {
        "eval",
        "exec",
        "compile",
        "__import__",
        "system",
        "popen",
        "spawn",
        "Popen",
    }
)


def _resolve_compose_file() -> Path:
    for candidate in ("docker-compose.yml", "docker-compose.yaml", "compose.yaml", "compose.yml"):
        path = REPO_ROOT / candidate
        if path.exists():
            return path
    raise FileNotFoundError("No Docker Compose configuration found in repository root")


def _load_runner_main_module():
    spec = importlib.util.spec_from_file_location("sandbox_runner_main", RUNNER_MAIN)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestSandboxRunnerFailClosedGate:
    """Verify sandbox/runner/main.py fails closed under all invocation modes."""

    def test_runner_main_function_returns_nonzero_exit_code(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        module = _load_runner_main_module()
        exit_code = module.main()
        captured = capsys.readouterr()

        assert isinstance(exit_code, int)
        assert exit_code != 0
        assert exit_code == 78
        assert "disabled" in captured.err.lower()
        assert "security policy" in captured.err.lower()
        assert captured.out == ""

    def test_runner_main_raises_system_exit_when_executed_as_script(self) -> None:
        with pytest.raises(SystemExit) as exc_info:
            runpy.run_path(str(RUNNER_MAIN), run_name="__main__")

        assert exc_info.value.code is not None
        assert int(exc_info.value.code) != 0
        assert int(exc_info.value.code) == 78

    @pytest.mark.parametrize(
        "extra_args",
        [
            [],
            ["--help"],
            ["--run", "untrusted_test.py"],
            ["--enable", "--force"],
            ["-c", "import os; os.system('id')"],
        ],
    )
    def test_runner_subprocess_invocation_always_fails_closed(
        self, extra_args: list[str]
    ) -> None:
        proc = subprocess.run(
            [sys.executable, str(RUNNER_MAIN), *extra_args],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        assert proc.returncode != 0
        assert proc.returncode == 78
        assert "sandbox execution is disabled" in proc.stderr.lower()
        assert proc.stdout == ""


class TestSandboxRunnerModulesStaticSurface:
    """Verify runner modules expose no network, subprocess, or host escape surface."""

    def _all_runner_python_files(self) -> list[Path]:
        files = sorted(RUNNER_DIR.rglob("*.py"))
        assert files, "Expected runner Python files in sandbox/runner"
        return files

    def test_expected_runner_files_exist(self) -> None:
        for expected in (
            RUNNER_MAIN,
            RUNNER_POLICY,
            RUNNER_PYTEST,
            RUNNER_COLLECTOR,
            RUNNER_DIR / "metrics" / "coverage.py",
            RUNNER_DIR / "metrics" / "mutation.py",
            RUNNER_DIR / "metrics" / "validity.py",
        ):
            assert expected.is_file(), f"Missing expected sandbox runner file: {expected}"

    def test_runner_modules_do_not_import_network_subprocess_or_escape_packages(self) -> None:
        for py_file in self._all_runner_python_files():
            source = py_file.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(py_file))

            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        top_pkg = alias.name.split(".")[0]
                        assert top_pkg not in FORBIDDEN_RUNNER_IMPORTS, (
                            f"{py_file.name} imports forbidden module '{alias.name}'"
                        )
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        top_pkg = node.module.split(".")[0]
                        assert top_pkg not in FORBIDDEN_RUNNER_IMPORTS, (
                            f"{py_file.name} imports from forbidden module '{node.module}'"
                        )
                elif isinstance(node, ast.Call):
                    if isinstance(node.func, ast.Name):
                        assert node.func.id not in FORBIDDEN_RUNNER_CALLS, (
                            f"{py_file.name} calls forbidden primitive '{node.func.id}'"
                        )
                    elif isinstance(node.func, ast.Attribute):
                        assert node.func.attr not in FORBIDDEN_RUNNER_CALLS, (
                            f"{py_file.name} calls forbidden attribute '{node.func.attr}'"
                        )

    def test_policy_and_helper_modules_expose_no_executable_launcher(self) -> None:
        for module_path in (
            RUNNER_POLICY,
            RUNNER_PYTEST,
            RUNNER_COLLECTOR,
            RUNNER_DIR / "metrics" / "coverage.py",
            RUNNER_DIR / "metrics" / "mutation.py",
            RUNNER_DIR / "metrics" / "validity.py",
        ):
            spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
            assert spec is not None and spec.loader is not None
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

            public_callables = [
                name
                for name, val in vars(mod).items()
                if not name.startswith("_") and callable(val)
            ]
            assert public_callables == [], (
                f"{module_path.name} must remain fail-closed without active execution functions, "
                f"found: {public_callables}"
            )


class TestSandboxDockerfileIsolationPolicy:
    """Verify sandbox/Dockerfile enforces non-root user, no Docker CLI/socket, and fail-closed entrypoint."""

    def test_dockerfile_enforces_non_root_uid_and_nologin_shell(self) -> None:
        content = SANDBOX_DOCKERFILE.read_text(encoding="utf-8")
        lines = [
            line.strip()
            for line in content.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]

        user_directives = [line for line in lines if line.upper().startswith("USER ")]
        assert user_directives, "sandbox/Dockerfile must declare a non-root USER instruction"
        final_user = user_directives[-1].split(None, 1)[1].strip()
        assert final_user not in {"root", "0", "0:0"}, (
            f"sandbox/Dockerfile final USER must not be root (got {final_user!r})"
        )
        assert final_user == "65534:65534"
        assert "--no-create-home" in content
        assert "/usr/sbin/nologin" in content

    def test_dockerfile_does_not_install_docker_cli_or_mount_docker_socket(self) -> None:
        content = SANDBOX_DOCKERFILE.read_text(encoding="utf-8")
        lowered = content.lower()

        forbidden_tokens = (
            "docker.sock",
            "docker-ce",
            "docker-cli",
            "docker.io",
            "containerd",
            "podman",
            "sudo",
            "--privileged",
        )
        for token in forbidden_tokens:
            assert token not in lowered, (
                f"sandbox/Dockerfile must not reference or install '{token}'"
            )

    def test_dockerfile_sets_restricted_fail_closed_entrypoint_and_no_secret_envs(self) -> None:
        content = SANDBOX_DOCKERFILE.read_text(encoding="utf-8")
        assert 'ENTRYPOINT ["python", "/opt/runner/main.py"]' in content

        for secret_key in HOST_SECRET_ENV_NAMES:
            assert secret_key not in content, (
                f"sandbox/Dockerfile must not embed or reference secret env '{secret_key}'"
            )


def validate_compose_isolation_contract(compose_data: dict[str, Any]) -> None:
    """Validate compose services dictionary against NFR-SEC-002 container isolation rules."""
    services = compose_data.get("services")
    assert isinstance(services, dict) and services, "Compose file must define services"

    for svc_name in ("backend", "worker"):
        assert svc_name in services, f"Expected '{svc_name}' service in compose configuration"

    for svc_name, svc_cfg in services.items():
        assert isinstance(svc_cfg, dict)
        assert svc_cfg.get("privileged") is not True, (
            f"Service '{svc_name}' must never run with privileged: true"
        )
        assert svc_cfg.get("network_mode") != "host", (
            f"Service '{svc_name}' must not use host network_mode"
        )
        assert svc_cfg.get("pid") != "host", (
            f"Service '{svc_name}' must not share host PID namespace"
        )

        volumes = svc_cfg.get("volumes") or []
        for vol in volumes:
            vol_str = str(vol)
            assert "docker.sock" not in vol_str, (
                f"Service '{svc_name}' must never mount docker.sock ({vol_str})"
            )

    backend_volumes = [str(v) for v in (services["backend"].get("volumes") or [])]
    assert any(v.endswith(":ro") for v in backend_volumes), (
        "backend service must mount shared artifacts volume read-only (:ro)"
    )

    for sandbox_key in ("sandbox", "sandbox-runner", "sandbox_runner"):
        if sandbox_key in services:
            sb_cfg = services[sandbox_key]
            net_mode = sb_cfg.get("network_mode")
            profiles = sb_cfg.get("profiles") or []
            assert net_mode == "none" or "isolated" in profiles or "sandbox" in profiles, (
                f"'{sandbox_key}' must disable networking (network_mode: 'none') or use an isolated profile"
            )
            env_block = sb_cfg.get("environment") or {}
            env_keys = (
                set(env_block.keys())
                if isinstance(env_block, dict)
                else {str(item).split("=", 1)[0] for item in env_block}
            )
            leaked = env_keys & HOST_SECRET_ENV_NAMES
            assert not leaked, f"'{sandbox_key}' must not receive host secret env vars: {leaked}"


class TestDockerComposeIsolationPolicy:
    """Verify compose configuration enforces worker/backend isolation and secret separation."""

    def test_repository_compose_file_enforces_no_docker_sock_and_no_privileged_containers(
        self,
    ) -> None:
        compose_path = _resolve_compose_file()
        raw_text = compose_path.read_text(encoding="utf-8")
        compose_data = yaml.safe_load(raw_text)

        validate_compose_isolation_contract(compose_data)

    def test_compose_services_do_not_pass_host_llm_or_encryption_secrets_to_sandbox(
        self,
    ) -> None:
        compose_path = _resolve_compose_file()
        compose_data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
        services = compose_data.get("services", {})

        # By default, sandbox-runner is not automatically started by Docker Compose
        assert "sandbox-runner" not in services

        # Even if a sandbox-runner definition is added under an isolated profile, verify contract checks
        synthetic_with_sandbox = {
            "services": {
                **services,
                "sandbox-runner": {
                    "build": {"context": ".", "dockerfile": "sandbox/Dockerfile"},
                    "network_mode": "none",
                    "read_only": True,
                    "profiles": ["isolated"],
                    "environment": {"PYTHONDONTWRITEBYTECODE": "1"},
                },
            }
        }
        validate_compose_isolation_contract(synthetic_with_sandbox)

    def test_compose_validator_rejects_docker_sock_privileged_or_secret_leakage(self) -> None:
        compose_path = _resolve_compose_file()
        base_data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))

        # 1. Mounting /var/run/docker.sock in worker must be rejected
        bad_worker_sock = yaml.safe_load(yaml.dump(base_data))
        bad_worker_sock["services"]["worker"]["volumes"].append(
            "/var/run/docker.sock:/var/run/docker.sock"
        )
        with pytest.raises(AssertionError, match="docker.sock"):
            validate_compose_isolation_contract(bad_worker_sock)

        # 2. Running backend or worker with privileged: true must be rejected
        bad_priv = yaml.safe_load(yaml.dump(base_data))
        bad_priv["services"]["backend"]["privileged"] = True
        with pytest.raises(AssertionError, match="privileged"):
            validate_compose_isolation_contract(bad_priv)

        # 3. Sandbox runner with network enabled or host secrets must be rejected
        bad_sandbox_net = yaml.safe_load(yaml.dump(base_data))
        bad_sandbox_net["services"]["sandbox-runner"] = {
            "network_mode": "bridge",
            "environment": {"GROQ_API_KEY": "gsk_live_secret"},
        }
        with pytest.raises(AssertionError, match="network_mode"):
            validate_compose_isolation_contract(bad_sandbox_net)

        bad_sandbox_secret = yaml.safe_load(yaml.dump(base_data))
        bad_sandbox_secret["services"]["sandbox-runner"] = {
            "network_mode": "none",
            "environment": {"GEMINI_API_KEY": "AIzaSecret", "JWT_SECRET_KEY": "jwt-secret"},
        }
        with pytest.raises(AssertionError, match="host secret env vars"):
            validate_compose_isolation_contract(bad_sandbox_secret)


class TestSandboxPolicyDocumentationAlignment:
    """Verify infra/security/sandbox-policy.md preserves mandatory NFR-SEC-002 gate rules."""

    def test_sandbox_policy_doc_mandates_fail_closed_and_resource_targets(self) -> None:
        doc = SANDBOX_POLICY_DOC.read_text(encoding="utf-8")

        assert "NOT APPROVED FOR UNTRUSTED CODE" in doc
        assert "sandbox/runner/main.py" in doc
        assert "nonzero status" in doc
        assert "never mount the Docker socket" in doc
        assert "network disabled" in doc
        assert "non-root UID" in doc
        assert "read-only root filesystem" in doc
        assert "no host secrets" in doc
        assert "no-new-privileges" in doc

        assert re.search(r"\b1\s+CPU\b", doc) is not None
        assert re.search(r"\b1\s+GiB\s+memory\b", doc) is not None
        assert re.search(r"\b60\s+seconds\b", doc) is not None
