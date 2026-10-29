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
