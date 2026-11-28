"""Sandbox launchers (FR-EXE-001/004, NFR-SEC-002) — #45, #46, #49.

``DisabledLauncher`` is the default and never runs code. ``DockerSandboxLauncher`` is only returned by
``get_launcher`` when BOTH ``SANDBOX_EXECUTION_ENABLED=true`` and a ``SANDBOX_SECURITY_REVIEW_ID`` are set,
and it must run inside a dedicated launcher service — never in the API or worker containers, which must
not mount the Docker socket. Even then the in-image runner (``sandbox/runner/main.py``) fails closed
(exit 78) until the security sign-off replaces it, so no untrusted code runs from this branch.
"""

from __future__ import annotations

import subprocess  # noqa: S404 — only argv lists built by policy.build_docker_run_args
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from app.infrastructure.sandbox.policy import SandboxPolicy, build_docker_run_args

RUNNER_DISABLED_EXIT_CODE = 78  # sandbox/runner/main.py fail-closed gate


class SandboxDisabledError(Exception):
    """Execution is disabled until the sandbox security review passes (AGENTS.md)."""


@dataclass(frozen=True)
class LaunchRequest:
    container_name: str
    workspace_host_path: str
    command: list[str]


@dataclass(frozen=True)
class LaunchResult:
    exit_code: int | None
    stdout: str
    stderr: str
    duration_ms: int | None
    timed_out: bool = False
    cancelled: bool = False
    cleanup_error: str | None = None


class SandboxLauncher(Protocol):
    policy: SandboxPolicy

    def run(self, request: LaunchRequest, should_cancel: Callable[[], bool]) -> LaunchResult: ...


class DisabledLauncher:
    """Fail-closed default: refuses every request without touching the host."""

    def __init__(self, policy: SandboxPolicy | None = None) -> None:
        self.policy = policy or SandboxPolicy()

    def run(self, request: LaunchRequest, should_cancel: Callable[[], bool]) -> LaunchResult:
        raise SandboxDisabledError(
            "Sandbox execution is disabled until the sandbox security review passes"
        )


def _truncate(data: bytes, limit: int) -> str:
    return data[:limit].decode("utf-8", errors="replace")


class DockerSandboxLauncher:
    """Runs one ephemeral container with the approved policy; kills and removes it on timeout/cancel."""

    def __init__(
        self,
        policy: SandboxPolicy,
        *,
        image: str,
        poll_seconds: float = 0.25,
        popen: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen,
        run_cmd: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.policy = policy
        self.image = image
        self.poll_seconds = poll_seconds
        self._popen = popen
        self._run = run_cmd
        self._clock = clock

    def _remove_container(self, name: str) -> str | None:
        try:
            done = self._run(["docker", "rm", "-f", name], capture_output=True, timeout=30, check=False)
        except (OSError, subprocess.SubprocessError) as exc:
            return f"container cleanup failed: {type(exc).__name__}"
        if done.returncode not in (0, 1):  # 1: already removed by --rm
            return f"container cleanup exited {done.returncode}"
        return None

    def run(self, request: LaunchRequest, should_cancel: Callable[[], bool]) -> LaunchResult:
        argv = build_docker_run_args(
            self.policy,
            image=self.image,
            container_name=request.container_name,
            workspace_host_path=request.workspace_host_path,
            command=request.command,
        )
        started = self._clock()
        proc = self._popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
        timed_out = cancelled = False
        try:
            while proc.poll() is None:
                if self._clock() - started > self.policy.timeout_seconds:
                    timed_out = True
                    break
                if should_cancel():
                    cancelled = True
                    break
                time.sleep(self.poll_seconds)
        finally:
            cleanup_error = None
            if timed_out or cancelled:
                cleanup_error = self._remove_container(request.container_name)
                proc.kill()
            out, err = proc.communicate(timeout=30)
        limit = self.policy.log_limit_bytes
        return LaunchResult(
            exit_code=None if (timed_out or cancelled) else proc.returncode,
            stdout=_truncate(out or b"", limit),
            stderr=_truncate(err or b"", limit),
            duration_ms=int((self._clock() - started) * 1000),
            timed_out=timed_out,
            cancelled=cancelled,
            cleanup_error=cleanup_error,
        )


def get_launcher(
    *, enabled: bool, security_review_id: str | None, image: str, policy: SandboxPolicy | None = None
) -> SandboxLauncher:
    """Double gate: execution needs the flag AND a recorded security review ID."""
    active_policy = policy or SandboxPolicy()
    if enabled and security_review_id and security_review_id.strip():
        return DockerSandboxLauncher(active_policy, image=image)
    return DisabledLauncher(active_policy)
