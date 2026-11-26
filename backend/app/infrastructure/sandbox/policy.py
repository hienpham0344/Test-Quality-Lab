"""Approved sandbox limits and the hardened `docker run` command (SRS NFR-SEC-002, FR-EXE-001) — #45, #46.

This module only *builds* the command. Nothing here starts a container; see ``launcher.py``.
Untrusted code must never run in the API or worker process, and neither may mount the Docker socket
(``infra/security/sandbox-policy.md``): the Docker launcher is meant for a separate, reviewed launcher
service and is disabled by default.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

_CONTAINER_NAME_RE = re.compile(r"^tql-exec-[0-9a-f]{32}$")
_IMAGE_RE = re.compile(r"^[a-z0-9][a-z0-9._/-]{0,127}(:[A-Za-z0-9._-]{1,128})?(@sha256:[0-9a-f]{64})?$")
WORKSPACE_MOUNT = "/workspace"


@dataclass(frozen=True)
class SandboxPolicy:
    """Pilot limits from SRS NFR-SEC-002: 1 CPU, 1 GiB memory, 60 seconds per suite, no network."""

    cpus: float = 1.0
    memory_bytes: int = 1024 * 1024 * 1024  # 1 GiB, swap disabled (memory-swap == memory)
    pids_limit: int = 128
    timeout_seconds: int = 60
    tmpfs_bytes: int = 64 * 1024 * 1024
    log_limit_bytes: int = 1024 * 1024  # FR-EXE-003: 1 MiB per run
    user: str = "65534:65534"
    network: str = "none"
    read_only_root: bool = True
    drop_capabilities: tuple[str, ...] = ("ALL",)
    security_opts: tuple[str, ...] = ("no-new-privileges:true",)
    ulimits: tuple[str, ...] = ("nofile=256:256", "nproc=128:128", "fsize=16777216:16777216")
    env: dict[str, str] = field(
        default_factory=lambda: {"PYTHONDONTWRITEBYTECODE": "1", "PYTHONHASHSEED": "0", "HOME": "/tmp"}
    )

    def __post_init__(self) -> None:
        if not 0 < self.cpus <= 1.0:
            raise ValueError("cpus must be in (0, 1]")
        if not 0 < self.memory_bytes <= 1024 * 1024 * 1024:
            raise ValueError("memory must be at most 1 GiB")
        if not 0 < self.timeout_seconds <= 60:
            raise ValueError("timeout must be at most 60 seconds")
        if self.network != "none":
            raise ValueError("network must be disabled")
        if self.user.split(":")[0] in {"0", "root"}:
            raise ValueError("sandbox must not run as root")
        if not self.read_only_root:
            raise ValueError("root filesystem must be read-only")
        if "ALL" not in self.drop_capabilities:
            raise ValueError("all Linux capabilities must be dropped")
        forbidden = {"KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "DATABASE_URL", "REDIS_URL"}
        leaked = [name for name in self.env if any(word in name.upper() for word in forbidden)]
        if leaked:
            raise ValueError(f"sandbox environment must not carry secrets: {leaked}")

    def describe(self) -> dict[str, Any]:
        """Policy summary stored with each execution (FE `sandbox_policy`)."""
        data = asdict(self)
        data["memory"] = "1 GiB" if self.memory_bytes == 1024**3 else f"{self.memory_bytes} bytes"
        data["drop_capabilities"] = list(self.drop_capabilities)
        data["security_opts"] = list(self.security_opts)
        data["ulimits"] = list(self.ulimits)
        return data


def build_docker_run_args(
    policy: SandboxPolicy,
    *,
    image: str,
    container_name: str,
    workspace_host_path: str,
    command: list[str],
) -> list[str]:
    """`docker run` argv for one isolated, ephemeral execution. The workspace is mounted read-only."""
    if not _CONTAINER_NAME_RE.match(container_name):
        raise ValueError("invalid container name")
    if not _IMAGE_RE.match(image):
        raise ValueError("invalid sandbox image reference")
    if "," in workspace_host_path or "\n" in workspace_host_path:
        raise ValueError("invalid workspace path")
    args = [
        "docker", "run", "--rm",
        "--name", container_name,
        "--network", policy.network,
        "--user", policy.user,
        "--read-only",
        "--cpus", f"{policy.cpus:g}",
        "--memory", str(policy.memory_bytes),
        "--memory-swap", str(policy.memory_bytes),
        "--pids-limit", str(policy.pids_limit),
        "--tmpfs", f"/tmp:rw,noexec,nosuid,nodev,size={policy.tmpfs_bytes}",
        "--mount", f"type=bind,source={workspace_host_path},target={WORKSPACE_MOUNT},readonly",
        "--workdir", WORKSPACE_MOUNT,
        "--ipc", "none",
        "--init",
    ]
    for cap in policy.drop_capabilities:
        args += ["--cap-drop", cap]
    for opt in policy.security_opts:
        args += ["--security-opt", opt]
    for limit in policy.ulimits:
        args += ["--ulimit", limit]
    for name, value in sorted(policy.env.items()):
        args += ["--env", f"{name}={value}"]
    return [*args, image, *command]


def pytest_command(test_file: str) -> list[str]:
    """Arguments for the runner entrypoint: JUnit XML to stdout, no cache, no plugins autoload."""
    if not re.match(r"^[A-Za-z0-9_]{1,64}\.py$", test_file):
        raise ValueError("invalid test file name")
    return ["--junit-xml", "/tmp/junit.xml", "--print-junit", "-p", "no:cacheprovider", "-q", test_file]
