# User Guide, System Limitations, Release Acceptance Checks & Bug Triage Runbook

Covers Sprint 7 Issue #66 (`NFR-MNT` / `NFR-PRT`): end-to-end user workflows across `UC-01`–`UC-12`, system limitations and fail-closed security boundaries, pre-release acceptance verification checks, and bug triage / severity classification procedures.

---

## 1. End-to-End User Guide (`UC-01` – `UC-12`)

### 1.1 Account Registration, Email Verification, Sign-In & Session Recovery (`UC-01`, `UC-02`, `UC-12`)

1. **Register (`UC-01`, `FR-AUT-001`)**:
   - Navigate to `/register` or call `POST /api/v1/auth/register` with `email`, `password` (12–1024 characters), `confirm_password`, and optional `display_name`.
   - The server creates an unverified user account and enqueues a verification email via Celery (`201 Created`). Retrying registration with the same unverified email and password re-sends the verification email idempotently; duplicate registered emails return `409 AUTH_DUPLICATE_EMAIL`.
2. **Verify Email (`UC-01`, `FR-AUT-005`)**:
   - In local development, open Mailpit at `http://localhost:8025` to retrieve the verification link (`/verify-email#token=<opaque_token>`).
   - The frontend strips the URL fragment from the address bar and sends `POST /api/v1/auth/verify` with `{"token": "..."}`. Verification tokens are valid for **24 hours** and stored only as cryptographic hashes.
   - To request a fresh verification link, use `POST /api/v1/auth/verification/request` (invalidates prior verification links and returns a uniform `200 OK` response).
3. **Sign In & Sign Out (`UC-02`, `FR-AUT-002`, `FR-AUT-004`)**:
   - Authenticate via `/login` (`POST /api/v1/auth/login`). Unknown emails and wrong passwords return an identical `401 AUTH_INVALID_CREDENTIALS` with constant-time password hashing; unverified accounts return `403 AUTH_EMAIL_NOT_VERIFIED`.
   - Access tokens expire after **15 minutes**; refresh tokens expire after **1 day** and rotate via `POST /api/v1/auth/refresh`.
   - Sign out via `POST /api/v1/auth/logout` to revoke the active session immediately.
4. **Expired Session & Password Recovery (`UC-12`, `FR-AUT-003`, `FR-AUT-006`)**:
   - When an access token expires (`401 AUTH_SESSION_INVALID`), the UI preserves navigation intent and prompts re-authentication or token refresh.
   - Password recovery (`POST /api/v1/auth/password/forgot` -> `/reset-password#token=<token>` -> `POST /api/v1/auth/password/reset`) uses a **30-minute** single-use token and revokes all existing sessions for that user upon reset.

---

### 1.2 Project Creation, Workspace Dashboard & Revision History (`UC-03`, `FR-PRJ-001`–`003`)

1. **Create & Browse Projects (`FR-PRJ-001`, `FR-PRJ-003`)**:
   - From the Projects Dashboard (`/projects`), click **Create Project** (`POST /api/v1/projects`) and provide a trimmed `name` (`1..120` chars) and optional `description` (`<= 2000` chars).
   - Every new project starts at `current_revision = 1` with an initial entry in `project_history`.
   - The dashboard supports URL-backed search, sorting, pagination, and empty/retry states (`GET /api/v1/projects`).
2. **Edit Metadata & Inspect Revision History (`FR-PRJ-002`, `BR-03`)**:
   - Update `name` or `description` via the Project Details tab (`PATCH /api/v1/projects/{project_id}`).
   - Unsaved form edits trigger a discard confirmation dialog before tab switches or in-app navigation.
   - True metadata changes increment `current_revision` and append an immutable `ProjectHistory` snapshot (`GET /api/v1/projects/{project_id}/history`, newest-first, supporting inclusive `from` / `to` UTC date filters and `limit` / `offset` pagination).
   - **Immutability Rule (`BR-03`)**: Editing project metadata (`name`, `description`) **never** alters previously frozen `ExperimentSnapshot` records, their SHA-256 provenance hashes, or historical generation/evaluation results.
3. **Owner Isolation**:
   - Every `/api/v1/projects/{project_id}/*` endpoint enforces `owner_id == current_user.id`. Unowned or missing project IDs return an identical `404 NOT_FOUND` response to prevent resource enumeration.

---

### 1.3 Python Source Upload & Static AST Function Discovery (`UC-04`, `FR-PYS-001`–`004`)

1. **Upload or Paste Python Code (`FR-PYS-001`, `FR-PYS-004`)**:
   - In the **Python Sources** tab, paste UTF-8 Python code (`application/json` with `{"code": "..."}`) or upload a `.py` file (`text/x-python` or `application/octet-stream`, up to **1 MiB**) to `POST /api/v1/projects/{project_id}/sources` (or `POST /sources/{source_id}/versions` for subsequent revisions).
   - Each distinct payload creates an immutable `SourceVersion` with a canonical `sha256` digest and incremented `revision` number (re-uploading identical bytes preserves the current revision).
2. **Static AST Inspection & Policy Feedback (`FR-PYS-002`, `FR-PYS-003`)**:
   - The backend parses code strictly via `ast.parse()`—**never executing uploaded code**—and discovers top-level synchronous `def` functions with their signatures and line ranges.
   - Rejects syntax errors (`422`), empty/whitespace-only files, module-level executable statements, decorators, `async def` functions, disallowed imports (only `math`, `cmath`, `decimal`, `fractions`, `itertools`, and `statistics` are allowed), and dangerous dynamic calls (`eval`, `exec`, `compile`, `open`, `__import__`, `os.*`, `subprocess.*`, `socket.*`).

---

### 1.4 CSV Dataset Preview, Mapping, Row Selection & Python Reference Linking (`UC-05`, `FR-CSV-001`–`006`)

1. **Preview & Column Mapping (`FR-CSV-001`, `FR-CSV-002`)**:
   - Upload a UTF-8 (or UTF-8 with BOM) CSV file (up to **25 MiB**, **10,000 data rows**, **256 columns**) to `POST /api/v1/projects/{project_id}/datasets/preview`.
   - The server detects `,` or `;` delimiters (or accepts an explicit `delimiter` query parameter), validates physical structure, and returns headers plus up to 20 preview rows with physical `row_number` line tracking.
   - Import the file via `POST /api/v1/projects/{project_id}/datasets/import?delimiter=...&mapping=...`, mapping CSV columns to canonical fields (`function_name` required; `task_id`, `python_source`, `expected_output`, `input_data`, `description`, `task_title`, `difficulty` optional).
2. **Row Validation, Selection & Python Reference Linking (`FR-CSV-003`–`006`)**:
   - Each imported row is classified as `valid`, `invalid`, or `preview_only` with explicit validation reasons while preserving physical CSV line numbers (`row_number >= 2`).
   - Select valid rows for experiments via `POST /api/v1/projects/{project_id}/datasets/{dataset_id}/selection` (`{"row_numbers": [...]}`), which creates a new immutable `DatasetVersion` with its own `sha256`. Selecting any `invalid` row is rejected with `422 CSV_ROW_INVALID`.
   - Link a dataset to an owned Python source revision via `POST /api/v1/projects/{project_id}/datasets/{dataset_id}/reference` (`{"source_id": "...", "revision": 1}`). Cross-project or cross-user source references are rejected with `404 NOT_FOUND`.

---

### 1.5 AI Provider Encrypted Vault & L1–L5 Prompt Bundle Approval (`FR-AIC-001`–`005`, `FR-PRM-001`–`004`)

1. **Configure Encrypted Provider Credentials (`FR-AIC-001`, `FR-AIC-002`, `FR-AIC-005`)**:
   - Supported providers (`GET /api/v1/projects/{project_id}/ai-configs/providers`):
     - `groq` (OpenAI-compatible chat completions)
     - `gemini` (Google Gemini `generateContent` using `x-goog-api-key` HTTP header only—never URL query parameters)
     - `openrouter` (OpenRouter chat completions)
   - Save credentials via `PUT /api/v1/projects/{project_id}/ai-configs/{provider}` with `{api_key, default_model, default_params}`.
   - Keys are encrypted at rest with **AES-256-GCM** (`v1:<key_id>:<nonce>:<ciphertext>`) using associated data bound to `"{project_id}:{provider}"`. API responses return only `key_id` and masked `key_hint` (`••••••••` + last 4 chars). Rotate envelopes across keyring updates via `POST .../rotate-encryption`.
2. **Review & Approve L1–L5 Prompt Templates (`FR-PRM-001`–`004`, SRS `TBD-04`)**:
   - Per SRS `TBD-04`, official `L1`–`L5` prompt wording is not pre-approved. New projects initialize `L1`–`L5` slots with `current_version = 0`, `approved_version = null`, and `status = "UNAPPROVED"`.
   - Create individual prompt versions via `POST /api/v1/projects/{project_id}/prompts/{strategy}/versions` and approve them via `POST .../versions/{version}/approve`, **or** atomically finalize all five strategies (`L1`–`L5`) in one transaction via `POST /api/v1/projects/{project_id}/prompts/bundles/finalize` (requiring `review_notes` and `placeholder_verified: true`).
   - Only placeholders in `ALLOWED_PROMPT_VARIABLES` (`function_name`, `function_signature`, `function_code`, `module_code`, `csv_cases`, `docstring`) are accepted; format-string attribute or index traversal (e.g., `{function_name.__class__}`) is rejected with `422 INPUT_INVALID`.
   - Check approval readiness at any time via `GET /api/v1/projects/{project_id}/prompts/readiness`.

---

### 1.6 Experiment Configuration, Matrix Preview & Immutable Snapshot Freezing (`UC-06`, `FR-EXP-001`–`007`)

1. **Configure & Preview Experiment Matrix (`FR-EXP-001`, `FR-EXP-002`, `FR-EXP-004`, `FR-EXP-007`)**:
   - Select an owned Python `source_id` + `source_revision`, one or more AST-verified `function_names`, optional CSV `dataset_id` + `dataset_revision` (`selected_rows`), one or more `(provider, model)` targets, one or more prompt strategies (`L1`–`L5`), and `repeats`.
   - Total planned runs (`len(functions) * len(models) * len(strategies) * repeats`) must satisfy `1 <= run_count <= 1,000` (`422 EXPERIMENT_RUN_LIMIT` if exceeded).
   - Inspect the 2D Matrix Grid and itemized Planned Runs preview in the UI (exportable as RFC 4180 CSV or JSON), then save the experiment draft (`POST /api/v1/projects/{project_id}/experiments`).
2. **Freeze Immutable Snapshot (`FR-EXP-003`, `FR-EXP-006`)**:
   - Call `POST /api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots` (`201 Created`).
   - Pre-flight gates verify that every selected provider has a stored credential (`409 CREDENTIAL_MISSING`) and every selected strategy has an `APPROVED` prompt version (`409 PROMPT_NOT_APPROVED`).
   - Freezes `source_sha256`, `dataset_sha256`, `prompts_manifest` (with rendered prompt SHA-256 digests), `parameters_json`, masked credential metadata (`credential_key_id`, `credential_key_hint`—never raw keys), itemized `experiment_snapshot_runs` (`run_hash`), and overall `snapshot_sha256`.
   - Frozen snapshots are strictly append-only (`409 SNAPSHOT_IMMUTABLE` on any mutation attempt).

---

### 1.7 Queued Test Generation, Retries, Cancellation & Artifact Inspection (`UC-07`, `UC-08`, `UC-09`, `FR-GEN`)

1. **Idempotent Job Dispatch (`UC-07`)**:
   - Launch generation from a frozen snapshot via `POST /api/v1/projects/{project_id}/generation` (`202 Accepted`) with `{snapshot_id, request_id}`.
   - Repeating the same `(project_id, request_id)` for the same `snapshot_id` returns the existing `job_id` with `deduplicated: true` without creating duplicate runs. Launching a snapshot that already has an active `QUEUED` or `RUNNING` job returns `409 GENERATION_CONFLICT`.
2. **Worker Execution, Retries & Mid-Batch Cancellation (`UC-08`)**:
   - The Celery task `generation.execute_job` renders prompts strictly from the frozen snapshot payload, calls the configured provider adapter, and writes secret-scrubbed `.py` artifacts to `{artifact_dir}/{project_id}/{job_id}/{run_id}.py` after verifying path containment (`resolved.is_relative_to(artifact_root)`) and rejecting symlinks.
   - Transient upstream errors (`429`, `502`, `503`, `504`) retry up to `max_attempts`; timeouts transition to `TIMEOUT` (`PROVIDER_TIMEOUT`); permanent errors transition to `FAILED` with all reflected keys scrubbed via `redact_secrets()`.
   - Cancel an active job mid-batch via `POST /api/v1/projects/{project_id}/generation/jobs/{job_id}/cancel` (`200 OK`), which marks remaining `QUEUED` runs `CANCELLED` while preserving already completed runs.
3. **Inspect Generated Artifacts & Execution Logs (`UC-09`)**:
   - View per-run generated Python test code, raw LLM responses, execution logs (`stdout`/`stderr`/`system`), and failure diagnostics in the Artifacts and Execution Details drawers. All streams pass through content sanitization and secret redaction.

---

### 1.8 Quality Evaluation & Human Assertion Rubric Review (`UC-09`, `UC-10`, `FR-EVL-001`–`007`)

1. **Metric State Fidelity (`FR-EVL-001`)**:
   - Every metric (`syntax_validity`, `generation_success`, `line_coverage`, `mutation_score`, `assertion_quality`) is stored as a `MetricRecord` with an explicit `state`:
     - `MEASURED`: Finite numeric float where **`0.0` (`0.0%`) is preserved as a genuine measured zero** (e.g., 0% syntax validity, 0 killed mutants out of 10, or 0 effective assertions) and is **never** coerced to `null`, `N/A`, or `false`.
     - `N/A`: `numeric_value: null` with a non-empty `reason` (e.g., `"Untrusted execution is disabled by sandbox security policy"`, `denominator == 0`, or run not completed).
     - `FAILED`: `numeric_value: null` when the run or trace parser failed before measurement.
     - `TIMEOUT`: `numeric_value: null` when generation or trace execution timed out.
2. **Static AST & Verified Trace Evaluation (`FR-EVL-004`, `FR-EVL-005`, `FR-EVL-007`)**:
   - Evaluate a run via `POST /api/v1/projects/{project_id}/evaluations/runs/{run_id}/evaluate`:
     - **`syntax_validity`**: Extracts Python code via `ast.parse()`, verifies `>= 1` non-placeholder `def test_*` / `async def test_*` function, and scores `100.0` or `0.0`.
     - **`generation_success`**: Snapshot-level ratio `(valid_runs / total_planned_runs) * 100%` via `POST /evaluations/snapshots/{snapshot_id}/generation-success`.
     - **`line_coverage` & `mutation_score`**: Fail closed to `N/A` while the sandbox is disabled unless verified structured traces are supplied. When verified `mutmut` traces are scored, operators `AOR`, `ROR`, `LCR`, `SDL`, and `UOI` are classified and `INVALID`, `SKIPPED`, `EQUIVALENT`, `TIMEOUT`, and `SUSPICIOUS` mutants are excluded from `denominator = killed + survived`.
     - **`assertion_quality`**: Static AST analyzer classifies assertions (`AST-01`, `AST-02`, ...) into `EQUALITY`, `RELATIONAL`, `TYPE`, `IDENTITY`, `INVARIANT`, `EXCEPTION`, or `TRIVIAL` (`assert True`, self-comparison `x == x`, empty `pytest.raises`).
3. **Human Assertion Rubric Review (`FR-EVL-007`)**:
   - Record human qualitative assessments per assertion via `PUT /api/v1/projects/{project_id}/evaluations/runs/{run_id}/assertion-reviews` using rubric labels `EFFECTIVE`, `WEAK`, `TRIVIAL`, `INCORRECT`, or `N/A` with secret-redacted notes (`AuditEvent("evaluation.assertion_reviewed")`).

---

### 1.9 Results Dashboard, Strategy Comparability, CSV Exports, Audit & Backup (`UC-11`, `FR-RPT-001`–`006`, `NFR-OBS`, `NFR-DAT`)

1. **Results Dashboard & Multi-Dimensional Filtering (`FR-RPT-001`–`003`)**:
   - `GET /api/v1/projects/{project_id}/reports/summary` and `GET /reports/results` compute live campaign progress, overall pass rate, and arithmetic mean coverage, mutation score, and assertion quality (preserving `0.0` vs `N/A` / `FAILED` / `TIMEOUT`).
   - Filter results by `status`, prompt `strategy` (`L1`–`L5`), `model`, `quality` criteria (`ONLY_PASSING`, `HAS_FAILURES`, `HIGH_COVERAGE`), free-text `search`, and column sort (`date`, `pass_rate`, `coverage`, `mutation`, `duration`, `suite_name`).
2. **Scientific Strategy Comparability (`FR-RPT-004`)**:
   - Compares `L1`–`L5` performance and computes `comparability.status`:
     - `COMPATIBLE`: Single `source_sha256`, single `dataset_sha256`, single model, balanced sample counts, and all runs completed.
     - `CAUTION`: Consistent source and dataset hashes, but mixed models, unbalanced sample counts, or incomplete runs.
     - `INCOMPARABLE`: Runs span different `source_sha256` or `dataset_sha256` versions.
3. **Formula-Safe & Secret-Redacted RFC 4180 CSV Exports (`FR-RPT-005`)**:
   - Download `GET /api/v1/projects/{project_id}/reports/exports/runs.csv` and `GET /exports/strategy-comparison.csv`.
   - Exports include full cryptographic provenance (`snapshot_sha256`, `source_sha256`, `dataset_sha256`, `prompt_version`, `prompt_sha256`), scrub secrets via `redact_secrets()`, preserve numeric `0.0` distinctly from `N/A`/`FAILED`/`TIMEOUT`, and neutralize spreadsheet formula injection by prefixing `'` to string cells starting with `=`, `+`, `-`, `@` (after leading-space strip) or raw `\t`, `\r`.
4. **Safe Run Deletion, Audit Trail, Integrity & Backup/Restore (`FR-RPT-006`, `NFR-OBS`, `NFR-DAT`)**:
   - Delete a run and its on-disk artifact safely via `DELETE /api/v1/projects/{project_id}/reports/runs/{run_id}` (enforces symlink/traversal checks and records `report.result_deleted`).
   - Query owner-scoped audit events via `GET /api/v1/audit-events`, verify SHA-256 provenance and artifact integrity via `GET /api/v1/projects/{project_id}/audit/integrity`, clean up unreferenced artifacts via `POST .../audit/cleanup-orphans?dry_run=true|false`, and perform zero-secret project backup/restore via `POST .../audit/backup-export` and `POST /api/v1/audit/backup-restore` (see [`docs/operations/backup-restore.md`](backup-restore.md)).

---

## 2. System Limitations & Enforced Security Boundaries

1. **Application-Only Scope**:
   - This repository implements the **Test Quality Lab web application only**. Offline statistical studies, Jupyter notebooks, and the separate NCKH research repository are out of scope (`AGENTS.md`, `docs/requirements/srs-notes.md`).
2. **SRS `TBD-04` Prompt Template Policy**:
   - Official `L1`–`L5` prompt template wording remains unresolved in SRS v1.2 (`TBD-04`). The system **never** invents, seeds, or pre-approves default prompt text. All `L1`–`L5` slots start as `UNAPPROVED` (`current_version = 0`) and require explicit human authoring, placeholder validation, and approval before any experiment snapshot can be frozen or executed.
3. **Untrusted Python Execution DISABLED (Fail-Closed Sandbox Gate)**:
   - Per `AGENTS.md` and [`infra/security/sandbox-policy.md`](../../infra/security/sandbox-policy.md), executing untrusted uploaded or LLM-generated Python code is **strictly disabled** until an isolated external launcher passes security review:
     - `sandbox/runner/main.py` exits immediately with a non-zero status code (`SystemExit(1)`).
     - Neither the FastAPI backend nor the Celery worker mounts `/var/run/docker.sock` or runs in `privileged` mode.
     - No backend endpoint or worker task invokes `subprocess`, `pytest`, `mutmut`, `eval`, `exec`, or `compile` on user/LLM code.
     - Dynamic runtime metrics (`line_coverage`, `mutation_score`) fail closed to `N/A` with explicit sandbox policy reasons unless pre-verified structured trace data is provided.
4. **Zero-Secret Leakage Guarantee**:
   - Raw API keys are encrypted at rest via AES-256-GCM (`CREDENTIAL_ENCRYPTION_KEYS`), transmitted to Gemini strictly via the `x-goog-api-key` header, excluded completely from project backups (`provider_credentials` omitted), and scrubbed across logs, error payloads, audit notes, and CSV exports via `redact_secrets()`.

---

## 3. Release Acceptance Checklist (Definition of Done)

Run all verification gates below before tagging or deploying a release candidate. Every check must pass with **zero failures and zero lint errors**.

### 3.1 Automated Test & Lint Suite

```bash
# 1. Backend unit + integration suite and Ruff linter
cd backend && pytest && ruff check app tests

# 2. Sandbox fail-closed & isolation policy verification suite
cd .. && pytest sandbox/tests

# 3. Frontend ESLint + Vitest unit/component/accessibility suite
cd frontend && npm run lint && npm test -- --run
```

### 3.2 Container Stack, Database Migrations & Readiness Check

```bash
# 1. Start or rebuild the Compose stack
docker compose up --build -d

# 2. Apply Alembic migrations to head (20261127_0014_executions) and verify current revision
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current

# 3. Verify health and database/Redis readiness endpoints
curl -fsS http://localhost:8000/health
curl -fsS http://localhost:8000/ready
```

### 3.3 Security, Isolation & Data Integrity Release Gate Checklist

- [ ] **No Committed Secrets**: `git status` and `git diff` contain no `.env` files or real provider keys (`gsk_`, `AIza`, `sk-or-v1-`, `Bearer `). `.env.example` contains only placeholder development values.
- [ ] **Fail-Closed Sandbox Verified**: `python3 sandbox/runner/main.py` exits with non-zero status (`1`), and neither `backend` nor `worker` mounts `/var/run/docker.sock`.
- [ ] **Cross-Tenant `404` Isolation Verified**: Accessing another user's project, source, dataset, prompt, AI credential, experiment, snapshot, generation job, evaluation, report, CSV export, or integrity check returns `404 NOT_FOUND`.
- [ ] **Metric State Fidelity (`0.0` vs `N/A` vs `FAILED` vs `TIMEOUT`) Verified**: Finite numeric zero (`0.0` / `0.0%`) is preserved in JSON responses, UI badges/tables, and CSV exports without coercion to `N/A` or `null`.
- [ ] **CSV Formula Injection & Secret Scrubbing Verified**: Exported CSV cells beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` are prefixed with `'`, and any secret patterns are replaced with `[REDACTED]`.
- [ ] **SHA-256 Integrity & Backup Round-Trip Verified**: `GET /api/v1/projects/{id}/audit/integrity` returns `"ok": true`, `violations: []`; backup export excludes `provider_credentials`; tampered backup bundles fail restore with `422 INPUT_INVALID`.

---

## 4. Bug Triage & Severity Classification SOP

### 4.1 Severity Classification Matrix

| Severity | Category | Qualifying Criteria & Examples | Target Response / Resolution Gate |
|---|---|---|---|
| **P0 — Critical / Security** | Security boundary breach, credential exposure, or total service outage | • Any path enabling untrusted Python code execution while sandbox gate is unapproved<br>• Raw API key, password, or session token leaked in API responses, logs, CSV exports, or backup bundles<br>• Cross-tenant data access (User B reading/mutating User A's project)<br>• Path traversal or symlink escape outside `ARTIFACT_DIR`<br>• API `/ready` or database migration failure blocking startup | **Immediate release blocker.** Halt deployment, quarantine affected credentials/artifacts, patch and verify before any release. |
| **P1 — High / Data Integrity & Core Flow** | Provenance corruption, metric distortion, or broken UC-01..UC-12 core path | • Mutation of a frozen `ExperimentSnapshot`, `SourceVersion`, `DatasetVersion`, or `PromptVersion` (violation of `BR-03` or SHA-256 mismatch)<br>• Coercing numeric zero (`0.0` / `0.0%`) to `N/A`, `null`, or `FAILED` (or vice versa)<br>• Pre-approving or inventing `TBD-04` prompt templates without human approval<br>• Broken idempotency on `POST /generation` creating duplicate jobs for the same `(project_id, request_id)`<br>• Valid backup bundle failing restore or corrupting entity references | **Release blocker.** Must be fixed and covered by an automated integration regression test before release sign-off. |
| **P2 — Medium / UX, Filtering & Edge Cases** | Non-critical functional defect with a safe workaround | • Incorrect filter chip state, pagination offset, or sort order on the Projects or Results dashboard<br>• Misformatted validation field error on malformed CSV header or prompt variable syntax<br>• UI discard confirmation modal not triggering on a secondary navigation link | Fix in current sprint if low-risk, or document workaround in release notes and schedule for the next patch cycle. |
| **P3 — Low / Cosmetic & Documentation** | Minor visual polish, copy, or documentation gap | • Minor alignment, spacing, or tooltip wording mismatch with no impact on data accuracy or accessibility<br>• Typo in developer documentation or Postman example description | Batch into routine maintenance PRs. |

---

### 4.2 Bug Report & Reproduction Requirements

Every bug report must include:
1. **Severity & Component**: `P0`–`P3`, affected module (`auth`, `projects`, `sources`, `datasets`, `ai_config`, `prompts`, `experiments`, `generation`, `evaluation`, `reporting`, `audit`, `sandbox`, or `frontend/features/<module>`), and requirement/use-case ID (`UC-01`–`UC-12`, `FR-*`, `NFR-*`).
2. **Environment & Schema State**: Output of `git rev-parse --short HEAD` and `docker compose exec backend alembic current`.
3. **Cryptographic Provenance Context (for Experiment/Run bugs)**: `project_id`, `snapshot_id`, `snapshot_sha256`, `source_sha256`, `dataset_sha256`, `prompt_sha256`, and `request_id` / `run_id`.
4. **Deterministic Reproduction Steps**: Exact HTTP request (`method`, `path`, sanitized payload) or UI sequence, expected status/error code (e.g., `409 PROMPT_NOT_APPROVED`, `422 INPUT_INVALID`), and actual observed output.

---

### 4.3 Secret-Free Diagnostic & Log Collection

When collecting logs or database diagnostics for triage:
- **Never** attach `.env`, `CREDENTIAL_ENCRYPTION_KEYS`, `Authorization: Bearer ...` headers, `x-goog-api-key` headers, or raw LLM provider keys (`gsk_*`, `AIza*`, `sk-or-v1-*`).
- Use application audit and integrity endpoints (`GET /api/v1/audit-events`, `GET /api/v1/projects/{id}/audit/integrity`) or `POST /api/v1/projects/{id}/audit/backup-export` (which automatically strips `provider_credentials` and runs `redact_secrets()` across all fields) to export a safe diagnostic reproduction bundle.
- Scrub container logs before sharing:
  ```bash
  docker compose logs --no-color --tail=200 backend worker | \
    sed -E 's/(Bearer |gsk_|AIza|sk-or-v1-)[A-Za-z0-9._-]+/[REDACTED]/g'
  ```

---

### 4.4 Mandatory Regression Test Policy

No `P0`, `P1`, or `P2` issue may be marked resolved without:
1. A dedicated automated unit or integration test (`backend/tests/`, `sandbox/tests/`, or `frontend/tests/`) that reproduces the failure mode and passes with the fix applied.
2. Full green execution of `cd backend && pytest && ruff check app tests`, `pytest sandbox/tests`, and `cd frontend && npm run lint && npm test -- --run`.
3. An update to [`docs/requirements/traceability.md`](../requirements/traceability.md) and [`docs/testing/acceptance-criteria.md`](../testing/acceptance-criteria.md) if a requirement contract or edge-case boundary changed.
