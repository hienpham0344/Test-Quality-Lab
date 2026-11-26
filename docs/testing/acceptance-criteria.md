# Release Acceptance Criteria Checklist (Sprints S0–S7)

Tracks release acceptance criteria from initial scaffold baseline through Sprint 1–Sprint 7 feature delivery, security isolation gates, and release regression checks (`SRS v1.2`).

---

## 1. Scaffold & Baseline Infrastructure (S0)

- [x] React starter renders and fetches `/health`.
- [x] FastAPI serves `/health`, `/ready`, `/docs`, and `/openapi.json`.
- [x] PostgreSQL 16 + Redis 7 start locally and `/ready` verifies both connections.
- [x] Celery worker and beat services boot cleanly.
- [x] All Alembic migrations (`20261029_0001` through `20261126_0011`) apply cleanly to head.
- [x] CI lint, unit test, build, dependency audit, and Compose smoke checks pass.
- [x] Sandbox fails closed (`sandbox/runner/main.py` exits with non-zero status) and provides **no** untrusted-code execution route.

---

## 2. Sprint 1 — Authentication, Sessions & Project Workspace (`AUT`, `PRJ`, `UC-01`–`03`, `UC-12`)

- [x] **Registration & Email Verification (`FR-AUT-001`, `FR-AUT-005`, `UC-01`)**:
  - `POST /api/v1/auth/register` validates email, 12–1024 char password, confirm password, and optional display name; hashes verification tokens; and enqueues verification emails without leaking tokens in responses or logs.
  - Duplicate active/verified email returns `409 AUTH_DUPLICATE_EMAIL`; retrying an unverified registration with the same password re-sends verification idempotently.
  - `POST /api/v1/auth/verify` consumes `#token=...` fragments from `/verify-email` within the 24h window.
- [x] **Sign-In, Refresh, Logout & Password Recovery (`FR-AUT-002`–`004`, `FR-AUT-006`, `UC-02`, `UC-12`)**:
  - `POST /api/v1/auth/login` uses constant-time password verification and returns uniform `401 AUTH_INVALID_CREDENTIALS` for unknown email or wrong password, and `403 AUTH_EMAIL_NOT_VERIFIED` for unverified accounts.
  - Opaque access tokens expire in 15 minutes; refresh tokens expire in 1 day; logout and password reset revoke active sessions immediately.
  - Expired session recovery (`UC-12`) redirects cleanly and restores user navigation after re-authentication.
- [x] **Owner-Scoped Projects & Append-Only Revision History (`FR-PRJ-001`–`003`, `UC-03`, `#82`, `#88`–`#91`)**:
  - `POST/GET /api/v1/projects`, `GET/PATCH /api/v1/projects/{id}`, and `GET /api/v1/projects/{id}/history` enforce strict owner isolation (`404 NOT_FOUND` on unowned resources).
  - Metadata edits increment `current_revision` and append immutable `ProjectHistory` snapshots (newest-first, inclusive UTC date filtering, offset pagination); no-op patches do not bump revisions.
  - Project Editor enforces discard confirmation on unsaved edits and renders the read-only History tab with field-level change markers.

---

## 3. Sprint 2 — Python Source AST Inspection & CSV Dataset Validation (`PYS`, `CSV`, `UC-04`–`05`, `#29`)

- [x] **Python Source Upload, Paste & Static AST Policy (`FR-PYS-001`–`004`, `UC-04`, `#23`, `#24`, `#27`, `#29`)**:
  - Accepts UTF-8 Python up to 1 MiB via paste or file upload, stores immutable SHA-256 `SourceVersion` rows, and discovers top-level synchronous functions via `ast.parse()`.
  - Rejects syntax errors (`422`), empty/whitespace code, decorators, `async def`, module-level statements, disallowed imports (only `math`, `cmath`, `decimal`, `fractions`, `itertools`, `statistics` permitted), and dangerous dynamic calls (`eval`, `exec`, `compile`, `open`, `__import__`, `os`, `subprocess`, `socket`).
  - Zero uploaded Python code is ever executed.
- [x] **CSV Preview, Mapping, Row Selection & Python Reference Linking (`FR-CSV-001`–`006`, `UC-05`, `#25`, `#26`, `#28`, `#29`)**:
  - Supports strict UTF-8 and UTF-8 with BOM (up to 25 MiB, 10,000 rows, 256 columns), comma/semicolon auto-detection, physical line number tracking (`row_number >= 2`), and canonical column mapping (`function_name` required).
  - Classifies rows into `valid`, `invalid`, or `preview_only` with per-row error reasons; creates immutable SHA-256 `DatasetVersion` snapshots on row selection (`POST /{dataset_id}/selection`, rejecting invalid rows with `422 CSV_ROW_INVALID`).
  - Links dataset versions to owned Python source versions (`POST /{dataset_id}/reference`), rejecting cross-project or cross-user references with `404 NOT_FOUND`.

---

## 4. Sprint 3 — AI Provider Vault, L1–L5 Prompt Registry & Frozen Experiment Snapshots (`AIC`, `PRM`, `EXP`, `UC-06`, `#85`)

- [x] **AES-256-GCM Provider Credential Vault & Adapters (`FR-AIC-001`, `FR-AIC-002`, `FR-AIC-005`, `#30`, `#31`, `#35`)**:
  - Supports `groq`, `gemini` (`x-goog-api-key` header only—never URL query parameters), and `openrouter`.
  - Encrypts API keys at rest with AES-256-GCM (`v1:<key_id>:<nonce>:<ciphertext>`, AAD `"{project_id}:{provider}"`), supports key rotation, returns only masked hints (`••••••••`), and scrubs secrets from all logs and error payloads.
- [x] **Versioned L1–L5 Prompt Registry & Bundle Finalization (`FR-PRM-001`–`004`, SRS `TBD-04`, `#32`, `#38`)**:
  - Respects SRS `TBD-04`: default `L1`–`L5` strategy slots initialize as `UNAPPROVED` (`current_version = 0`, `approved_version = null`) with **no** invented official prompt wording.
  - Enforces `ALLOWED_PROMPT_VARIABLES` (`function_name`, `function_signature`, `function_code`, `module_code`, `csv_cases`, `docstring`), blocks format traversal (`422`), exposes `GET /prompts/readiness`, and atomically approves all five `L1`–`L5` templates via `POST /prompts/bundles/finalize`.
- [x] **Experiment Matrix & Immutable Frozen Snapshots (`FR-EXP-001`–`007`, `BR-03`, `UC-06`, `#33`, `#34`, `#36`, `#69`, `#85`)**:
  - Validates experiment configurations (`1 <= len(functions) * len(models) * len(strategies) * repeats <= 1,000`) and previews the 2D Matrix Grid and Planned Runs list.
  - Freezing an `ExperimentSnapshot` verifies provider credentials (`409 CREDENTIAL_MISSING`) and prompt approvals (`409 PROMPT_NOT_APPROVED`), recording immutable `snapshot_sha256`, `source_sha256`, `dataset_sha256`, `prompts_manifest`, `parameters_json`, and per-run `run_hash`.
  - Subsequent project metadata edits (`PATCH /api/v1/projects/{id}`) or draft updates **never** mutate frozen snapshots (`BR-03`, verified by `test_project_edit_frozen_snapshots.py`).

---

## 5. Sprint 4 — Idempotent Generation Queue, Retries, Cancellation & Artifact Viewer (`GEN`, `UC-07`–`09`)

- [x] **Idempotent Dispatch & Conflict Locking (`FR-GEN`, `UC-07`, `#37`, `#42`, `#44`)**:
  - `POST /api/v1/projects/{id}/generation` (`202 Accepted`) deduplicates `(project_id, request_id)` idempotently and rejects concurrent jobs on the same active snapshot or conflicting request IDs (`409 GENERATION_CONFLICT`).
- [x] **Worker Execution, Retries, Cancellation & Redacted Artifacts (`UC-08`, `UC-09`, `#37`, `#43`, `#44`)**:
  - Celery worker renders prompts exclusively from frozen snapshot payloads, retries transient `429/502/503/504` failures up to `max_attempts`, classifies timeouts as `TIMEOUT` (`PROVIDER_TIMEOUT`), and scrubs reflected credentials on failure.
  - Persists generated `.py` test files under `{artifact_dir}/{project_id}/{job_id}/{run_id}.py` with path-containment (`is_relative_to`) and symlink rejection.
  - Supports mid-batch job cancellation (`POST /generation/jobs/{job_id}/cancel`) preserving terminal runs and recording `generation.cancelled` audit events.

---

## 6. Sprint 5 — Execution Status, Safe Log Viewer & Fail-Closed Sandbox Isolation (`EXE`, `NFR-SEC-002`, `UC-08`–`09`, `#70`)

- [x] **Execution Lifecycle, Cancellation & Safe Log Inspection (`UC-08`, `UC-09`, `#50`, `#51`)**:
  - Displays execution progress across `QUEUED`, `PENDING`, `RUNNING`, `CANCELLING`, `CANCELLED`, `COMPLETED`, `FAILED`, and `TIMEOUT`, with per-case inputs/outputs comparison, tracebacks, stream-filtered log viewer (`stdout`/`stderr`/`system`), and secret redaction.
- [x] **Runner Isolation & Fail-Closed Security Gate (`NFR-SEC-002`, `infra/security/sandbox-policy.md`, `#70`)**:
  - `sandbox/runner/main.py` and `sandbox/runner/policy.py` enforce fail-closed termination (`SystemExit` / non-zero exit code) with no active network, subprocess, or host filesystem escape surface.
  - `sandbox/Dockerfile` uses a non-root `USER`, installs no Docker CLI/socket, and defines target isolation limits (1 CPU, 1 GiB RAM, 60s timeout, network disabled, read-only rootfs, no host secrets).
  - Verified by `sandbox/tests/test_isolation_policy.py` and `backend/tests/unit/test_sandbox_isolation_verification.py`.

---

## 7. Sprint 6 — Static AST Quality Evaluation, Mutmut Scorer & Assertion Rubric (`EVL`, `UC-09`–`10`)

- [x] **Strict Metric State Separation (`FR-EVL-001`, `#52`)**:
  - `MetricRecord` enforces `MEASURED | N/A | FAILED | TIMEOUT`, preserving finite numeric zero (`0.0` / `0.0%`) distinctly from `N/A` (`null` with mandatory reason), `FAILED`, and `TIMEOUT`.
  - Dynamic runtime metrics (`line_coverage`, `mutation_score`) fail closed to `N/A` while sandbox execution is disabled unless verified structured traces are supplied.
- [x] **Static AST Syntax Validity & Snapshot Generation Success (`FR-EVL-005`, `#55`)**:
  - Validates generated test code via `ast.parse()` without execution, requiring `>= 1` non-placeholder test function, and computes snapshot-level `generation_success`.
- [x] **Denominator-Filtered Mutmut Scorer & Coverage Visualization (`FR-EVL-004`, `#54`, `#58`)**:
  - Scores structured `mutmut` results across operators `AOR`, `ROR`, `LCR`, `SDL`, and `UOI`, excluding `INVALID`, `SKIPPED`, `EQUIVALENT`, `TIMEOUT`, and `SUSPICIOUS` mutants from `denominator = killed + survived`.
- [x] **Assertion Quality Analyzer & Human Rubric Reviews (`FR-EVL-007`, `#56`, `#59`)**:
  - Classifies AST assertions into `EQUALITY`, `RELATIONAL`, `TYPE`, `IDENTITY`, `INVARIANT`, `EXCEPTION`, and `TRIVIAL`, computes composite assertion quality scores, and persists human rubric reviews (`EFFECTIVE | WEAK | TRIVIAL | INCORRECT | N/A`).

---

## 8. Sprint 7 — Reporting, Strategy Comparability, CSV Security, Audit/Backup, Docs & Regression (`RPT`, `NFR-OBS`, `NFR-DAT`, `NFR-MNT/PRT`, `UC-11`, `#62`–`#66`, `#71`)

- [x] **Results Dashboard, Multi-Dimensional Filters & Safe Delete (`FR-RPT-001`–`003`, `FR-RPT-006`, `#62`, `#64`)**:
  - Live project summary (`GET /reports/summary`), filtered results history (`GET /reports/results`), and symlink/traversal-safe run deletion (`DELETE /reports/runs/{run_id}` recording `report.result_deleted`).
- [x] **Scientific Strategy Comparability & Formula-Safe RFC 4180 CSV Exports (`FR-RPT-004`, `FR-RPT-005`, `#62`, `#65`)**:
  - Evaluates `L1`–`L5` comparability (`COMPATIBLE | CAUTION | INCOMPARABLE`) across `source_sha256`, `dataset_sha256`, model consistency, sample balance, and completion status.
  - `GET /reports/exports/runs.csv` and `GET /reports/exports/strategy-comparison.csv` include full SHA-256 provenance columns, preserve `0.0` vs `N/A`/`FAILED`/`TIMEOUT`, apply `redact_secrets()`, and neutralize spreadsheet formulas (`=`, `+`, `-`, `@`, `\t`, `\r` prefixed with `'`).
- [x] **Audit Trail, SHA-256 Integrity, Orphan Cleanup & Zero-Secret Backup/Restore (`NFR-OBS`, `NFR-DAT`, `#63`)**:
  - Owner-scoped `GET /api/v1/audit-events`, `GET /projects/{id}/audit/integrity`, two-step `POST /projects/{id}/audit/cleanup-orphans`, and deterministic v1.0 JSON `backup-export` / `backup-restore` (omitting `provider_credentials` and rejecting tampered hashes with `422`).
- [x] **User Documentation, Setup Guide, Release Checks & Bug Triage SOP (`NFR-MNT`, `NFR-PRT`, `#66`)**:
  - Documented in [`docs/operations/user-guide-and-release-checks.md`](../operations/user-guide-and-release-checks.md), [`docs/development/setup.md`](../development/setup.md), [`docs/operations/backup-restore.md`](../operations/backup-restore.md), and [`docs/requirements/traceability.md`](../requirements/traceability.md).
- [x] **End-to-End S1–S7 Release Regression Suite (`#71`)**:
  - Full pipeline regression, `0.0` vs `N/A`/`FAILED`/`TIMEOUT` fidelity, cross-tenant `404` isolation, secret redaction, CSV formula neutralization, and backup/integrity verification executed and recorded in `backend/tests/integration/test_release_regression_s7.py` and `docs/testing/release-regression-report.md`.
