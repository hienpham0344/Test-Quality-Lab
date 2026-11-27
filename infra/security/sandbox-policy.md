# Sandbox Security Gate — NOT APPROVED FOR UNTRUSTED CODE

The sandbox **must not** be exposed as an executable feature until verified.
The `sandbox/runner/main.py` intentionally exits with nonzero status.

Before enabling, implement an isolated launcher owned by a privileged service
outside the API/worker, with narrow authenticated controls and an allowlist of
images and inputs. Worker/API may never mount the Docker socket.

Verify at minimum: network disabled, non-root UID, read-only root filesystem,
strict read-only source mounts, ephemeral tmpfs, no host secrets, disabled Linux
capabilities, no-new-privileges, custom seccomp/AppArmor policy as appropriate,
pid/memory/CPU/time limits, termination cleanup, no host file access,
path traversal and symlink defenses, archive decompression limits, and
separate artifact extraction/validation.

Resource targets from SRS pilot: 1 CPU, 1 GiB memory and 60 seconds per suite.
These are **targets, not proof of enforcement**. Container isolation alone is
not a security guarantee; review the threat model before implementing runtime.

## Implementation status (#45-#49)

What exists now (backend, all disabled by default):
- `backend/app/infrastructure/sandbox/policy.py`: `SandboxPolicy` refuses anything weaker than the targets
  (CPU at most 1, memory at most 1 GiB with swap disabled, timeout at most 60 seconds, network `none`, non-root UID 65534,
  read-only root filesystem, `--cap-drop ALL`, `no-new-privileges`, pids/nofile/fsize ulimits, `noexec` tmpfs,
  read-only workspace bind mount, no secret-looking environment variables). `build_docker_run_args` builds the argv only.
- `backend/app/infrastructure/sandbox/launcher.py`: `DisabledLauncher` (default) refuses every run. With it, the
  execution worker ends the run `BLOCKED` before creating a workspace, so generated code is never written to the host.
  `DockerSandboxLauncher` is returned only when `SANDBOX_EXECUTION_ENABLED=true` **and** `SANDBOX_SECURITY_REVIEW_ID`
  is set; it kills and removes the container on timeout or cancel and caps output at 1 MiB. It must run in a
  separate launcher service: the API and worker still never mount the Docker socket.
- `sandbox/runner/main.py` is unchanged and still exits with nonzero status 78; the backend records that as `BLOCKED`.

Still required before enabling: the security review itself (threat model, seccomp/AppArmor profile, image allowlist
and digest pinning, launcher service authentication), a reviewed runner that prints the JUnit report between the
`<<<TQL-JUNIT-BEGIN>>>`/`<<<TQL-JUNIT-END>>>` markers, and live escape tests (network, filesystem, fork bomb,
memory, timeout) recorded as evidence.

