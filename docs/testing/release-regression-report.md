# Release Regression Report — Sprint 7 (Issue #71)

## 1. Executive Summary

This report records the evidence-backed release regression verification for **Test Quality Lab** across Sprints 1 through 7 (`S1 -> S7`). All multi-sprint backend integration tests, static lint checks, and frontend component/accessibility regression suites executed and passed with zero errors.

| Verification Suite | Command Executed | Result | Test Count | Duration |
| :--- | :--- | :--- | :--- | :--- |
| **Backend S7 Release Regression (`#71`)** | `cd backend && pytest -v tests/integration/test_release_regression_s7.py` | **PASSED** | `3 passed` (3 end-to-end multi-sprint suites) | `10.74s` |
| **Backend Ruff Lint (`#71`)** | `cd backend && ruff check tests/integration/test_release_regression_s7.py` | **PASSED** | `All checks passed!` (`0 errors`) | `< 1s` |
| **Frontend ESLint Check** | `cd frontend && npm run lint` | **PASSED** | `0 errors` (`14 warnings`) | `2.1s` |
| **Frontend Vitest Suite** | `cd frontend && LC_ALL=en_US.UTF-8 npm test -- --run` | **PASSED** | `34 test files passed`, `333 tests passed` | `21.03s` |

---

## 2. End-to-End Multi-Sprint Coverage Matrix (`S1 -> S7`)

Implemented in [`backend/tests/integration/test_release_regression_s7.py`](../../backend/tests/integration/test_release_regression_s7.py):

| Sprint / Scope | Requirement IDs | Verified Capabilities & Assertions | Test Class / Method | Status |
| :--- | :--- | :--- | :--- | :--- |
| **S1: Auth & Projects** | `FR-ACC-001..004`, `FR-PRJ-001..003` | User registration, email verification link delivery, JWT login (`access_token`), project creation (`POST /api/v1/projects`), metadata patching (`PATCH /api/v1/projects/{id}`), and revision history tracking (`GET /api/v1/projects/{id}/history`). | `TestEndToEndReleaseRegressionS1ToS7::test_full_s1_to_s7_pipeline_regression` | **PASS** |
| **S2: Python AST Sources & CSV Datasets** | `FR-PYS-001..004`, `FR-CSV-001..006` | UTF-8 Python upload (`POST /sources`), AST function discovery (`clamp`, `scale`), UTF-8 BOM CSV preview (`POST /datasets/preview`) and mapped import (`POST /datasets/import`), Python source reference linking (`POST /datasets/{id}/reference`) with `execution_enabled=False`, row selection (`POST /datasets/{id}/selection`), and immutable SHA-256 dataset versioning. | `TestEndToEndReleaseRegressionS1ToS7::test_full_s1_to_s7_pipeline_regression` | **PASS** |
| **S3: AI Credentials, L1–L5 Prompts & Frozen Snapshots** | `FR-AIC-001..004`, `FR-PRM-001..004`, `FR-EXP-001..005`, `BR-03` | Fernet-encrypted AI provider credential storage (`PUT /ai-configs/groq`) with masked `key_hint` (`••••••••...`), non-official L1–L5 prompt creation/approval and bundle finalization (`POST /prompts/bundles/finalize`, SRS TBD-04 compliant), experiment validation (`POST /experiments/validate`), experiment creation (`POST /experiments`), immutable SHA-256 snapshot freezing (`POST /experiments/{id}/snapshots`), and verification that post-freeze project metadata edits never alter frozen snapshot hashes. | `TestEndToEndReleaseRegressionS1ToS7::test_full_s1_to_s7_pipeline_regression` | **PASS** |
| **S4: Idempotent Generation & Redacted Artifacts** | `FR-GEN-001..005`, `NFR-REL-001`, `NFR-SEC-002` | Generation job dispatch (`POST /generation` -> `202 Accepted`), idempotent duplicate `request_id` deduplication, concurrent distinct `request_id` locking (`409 GENERATION_CONFLICT`), execution via `MockLLMAdapter` and `GenerationExecutionService`, secret scrubbing (`[REDACTED]`) before writing `.py` artifacts to disk, and SHA-256 artifact checksum verification. | `TestEndToEndReleaseRegressionS1ToS7::test_full_s1_to_s7_pipeline_regression` | **PASS** |
| **S5 / S6: Static & Runtime Evaluation + Rubric Review** | `FR-EVL-001..004`, `FR-AST-001..003`, `BR-01`, `BR-02` | AST syntax validity and assertion quality evaluation (`POST /evaluations/runs/{id}/evaluate`), fail-closed `N/A` coverage and mutation score when untrusted execution is disabled and no runtime trace is supplied, verified-trace `0.0%` vs `80.0%` line coverage and `50.0%` mutation score, human assertion rubric review (`PUT /assertion-reviews`) with secret redaction in review notes, and snapshot generation success rate (`POST /evaluations/snapshots/{id}/generation-success`). | `TestEndToEndReleaseRegressionS1ToS7::test_full_s1_to_s7_pipeline_regression` | **PASS** |
| **S7: Reporting, Comparability, CSV Export, Audit & Backup** | `FR-RPT-001..005`, `FR-AUD-001..003`, `NFR-REL-003` | Live summary (`GET /reports/summary`), filtered results (`GET /reports/results`), comparability status transitions (`COMPATIBLE` -> `CAUTION` -> `INCOMPARABLE` -> `COMPATIBLE` after `DELETE /reports/runs/{id}`), sanitized RFC 4180 CSV exports (`runs.csv`, `strategy-comparison.csv`), audit trail verification (`GET /audit-events`), SHA-256 integrity check (`GET /audit/integrity`), and secret-free backup export/restore round-trip (`POST /audit/backup-export` & `POST /audit/backup-restore`). | `TestEndToEndReleaseRegressionS1ToS7::test_full_s1_to_s7_pipeline_regression` | **PASS** |

---

## 3. Metric State & Zero-vs-NA Regression Verification

Verified in `TestMetricStateAndZeroVsNaRegression::test_zero_vs_na_failed_and_timeout_across_evaluation_reporting_and_csv`:

1. **Snapshot Generation Success (`0` evaluated runs vs `0.0%` valid runs)**:
   - Before any planned runs are evaluated, `POST /evaluations/snapshots/{id}/generation-success` returns `state="N/A"` and `numeric_value=None` (never `0.0`).
2. **Finite Numeric Zero (`0.0`) Preservation**:
   - A completed run containing only trivial assertions (`assert True`) and a verified 0-line coverage trace produces `assertion_quality = 0.0` (`state="MEASURED"`) and `line_coverage = 0.0` (`state="MEASURED"`), while `mutation_score` without a runtime report remains `state="N/A"`, `numeric_value=None`.
   - In Python/JSON responses, `0.0` is strictly a `float` (`isinstance(val, float) and not isinstance(val, bool) and val == 0.0`), never coerced to `"N/A"`, `None`, or `False`.
3. **Strict Distinction Across `0.0`, `N/A`, `FAILED`, and `TIMEOUT`**:
   - Evaluation endpoints (`/evaluations/runs/{id}`), reporting summary (`/reports/summary`), reporting results (`/reports/results`), and both CSV exports (`/reports/exports/runs.csv` and `/reports/exports/strategy-comparison.csv`) preserve exact state tokens:
     - `L1` (measured zero coverage & assertion quality, unmeasured mutation): `line_coverage="0.0"`, `assertion_quality="0.0"`, `mutation_score="N/A"`.
     - `L2` (provider failure): `line_coverage="FAILED"`, `mutation_score="FAILED"`, `assertion_quality="FAILED"`.
     - `L3` (provider timeout): `line_coverage="TIMEOUT"`, `mutation_score="TIMEOUT"`, `assertion_quality="TIMEOUT"`.

---

## 4. Security, Privacy & Cross-Tenant Isolation Regression

Verified in `TestSecurityAndCrossTenantIsolationRegression::test_cross_tenant_404_isolation_secret_redaction_csv_formulas_and_tampered_backup`:

- **Cross-Tenant `404` Isolation**:
  - Authenticated `User B` (`tenant-b-sec@example.com`) receives `404 Not Found` across all `User A` endpoints: project detail/patch/history, source list/detail, dataset list/detail/versions, AI config list, prompt list/detail, experiment list/detail/snapshots, generation dashboard/start/cancel, evaluation detail/evaluate/assertion-reviews, reporting summary/results/CSV exports/delete, and project audit integrity/backup-export.
  - `GET /api/v1/audit-events` returns strictly caller-owned audit records (`all(ev["user_id"] == user_b_id)`).
- **Secret Redaction (`[REDACTED]`)**:
  - Reflected provider API keys in HTTP `401` and timeout error payloads, LLM-generated `.py` test artifacts, assertion review notes, and exported CSV error columns are scrubbed via `redact_secrets` before persistence or serialization.
- **CSV Formula Injection Neutralization (RFC 4180)**:
  - All dangerous leading characters (`=`, `+`, `-`, `@`, `\t`, `\r`) in exported CSV cells (e.g. `=CMD|' /C calc'!A0`, `+SUM(1,1)`, `-2+3+cmd`, `@SUM(A1:A2)`, `\t=1+1`, `\r=1+1`) are prefixed with a leading single quote (`'`) while CRLF (`\r\n`) line endings are enforced.
- **Backup Credential Exclusion & Tamper Rejection**:
  - `POST /api/v1/projects/{id}/audit/backup-export` omits `provider_credentials`, `ai_configs`, plaintext keys, and Fernet envelopes (`v1:k1:...`).
  - `POST /api/v1/audit/backup-restore` rejects tampered `bundle_sha256`, modified source code payloads, or injected `provider_credentials` keys with `422 INPUT_INVALID`.

---

## 5. Command Output Evidence

### 5.1 Backend Release Regression & Ruff Check

```text
$ cd /home/hien/Project/Test-Quality-Lab/backend && pytest -v tests/integration/test_release_regression_s7.py && ruff check tests/integration/test_release_regression_s7.py
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-8.3.5, pluggy-1.7.0 -- /home/hien/Project/Test-Quality-Lab/backend/.venv/bin/python
cachedir: .pytest_cache
rootdir: /home/hien/Project/Test-Quality-Lab/backend
configfile: pyproject.toml
plugins: anyio-4.15.1, platformdirs-4.14.0, cov-6.1.1
collected 3 items

tests/integration/test_release_regression_s7.py::TestEndToEndReleaseRegressionS1ToS7::test_full_s1_to_s7_pipeline_regression PASSED [ 33%]
tests/integration/test_release_regression_s7.py::TestMetricStateAndZeroVsNaRegression::test_zero_vs_na_failed_and_timeout_across_evaluation_reporting_and_csv PASSED [ 66%]
tests/integration/test_release_regression_s7.py::TestSecurityAndCrossTenantIsolationRegression::test_cross_tenant_404_isolation_secret_redaction_csv_formulas_and_tampered_backup PASSED [100%]

======================== 3 passed, 1 warning in 10.74s =========================
All checks passed!
```

### 5.2 Frontend Lint & Vitest Regression Suite (Including Accessibility Checks)

```text
$ cd /home/hien/Project/Test-Quality-Lab/frontend && LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 npm run lint && LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 npm test -- --run --testTimeout=15000

> test-quality-lab-frontend@0.1.0 lint
> eslint .

✖ 14 problems (0 errors, 14 warnings)

> test-quality-lab-frontend@0.1.0 test
> vitest --run --testTimeout=15000

 RUN  v3.2.7 /home/hien/Project/Test-Quality-Lab/frontend

 Test Files  34 passed (34)
      Tests  333 passed (333)
   Start at  15:03:13
   Duration  21.03s
```

Key frontend & accessibility regression suites verified within the 34 test files (`333 passed`):
- **Keyboard Focus Trap, Escape Dismissal & ARIA Roles**: `ProjectsDashboard.test.jsx`, `ExecutionDetailModal.test.jsx`, `ResultsDashboardPage.test.jsx`, `ExperimentSetupPage.test.jsx`.
- **Metric State Rendering (`0.0%` vs `N/A` vs `FAILED` vs `TIMEOUT`)**: `report-metrics.test.js`, `ResultsProgressOverview.test.jsx`, `StrategyComparisonCharts.test.jsx`, `StrategyComparisonTable.test.jsx`, `QualityEvaluationView.test.jsx`.
- **Secret Redaction & Log Sanitization in UI**: `log-sanitizer.test.js`, `GenerationProgressPage.test.jsx`, `SourceAndProviderPages.test.jsx`.
