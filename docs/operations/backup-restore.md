# Operational Runbook: Backup, Restore, Integrity Verification & Artifact Retention

Covers Sprint 7 Issue #63 (`NFR-DAT` / `NFR-OBS`): deterministic secret-free project backups, tamper-evident restore, SHA-256 integrity auditing, orphan artifact cleanup, and owner-scoped audit event inspection.

---

## 1. Security & Data-Protection Invariants

1. **Zero-Secret Exports**: Project backup bundles (`POST /api/v1/projects/{project_id}/audit/backup-export`) **strictly omit** the `provider_credentials` table (neither plaintext keys, encrypted ciphertexts, key IDs, nor vault envelopes are exported). Every string field in the exported JSON passes through `redact_secrets()`, replacing any accidental bearer tokens or provider token patterns with `[REDACTED]`.
2. **Fail-Closed Checksum Verification**: Restore (`POST /api/v1/audit/backup-restore`) recomputes the canonical outer `bundle_sha256` **and** every embedded `SourceVersion`, `DatasetVersion`, `PromptVersion`, and `ExperimentSnapshot` SHA-256 digest before opening a write transaction. Any mismatch, unknown placeholder, or Python source policy violation aborts with `422 INPUT_INVALID`.
3. **Path-Traversal & Symlink Defense**: Artifact verification, orphan cleanup, and run deletion resolve every candidate path under `settings.artifact_dir`, rejecting absolute paths, `..` traversal segments, symlinked directories, and symlinked files (`resolved.is_relative_to(artifact_root)` and `not candidate.is_symlink()`), failing closed with `403 ACCESS_DENIED`.
4. **Owner Isolation & Auditability**: All project operations enforce ownership (`404 NOT_FOUND` on unowned resources) and append immutable `AuditEvent` records (`report.result_deleted`, `system.artifact_cleanup`, `system.backup_exported`, `system.backup_restored`).

---

## 2. Application-Level Project Backup & Restore

### 2.1 Export a Project Backup Bundle

```bash
curl -sS -X POST \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "http://localhost:8000/api/v1/projects/<PROJECT_ID>/audit/backup-export" \
  -o project-backup.json
```

**Bundle structure (`schema_version: "1.0"`)**:
- `project` & `project_history`: Project metadata and append-only revision history.
- `sources`: All `Source` and `SourceVersion` rows with UTF-8 `code`, `byte_size`, and `sha256`.
- `datasets`: All `Dataset` and `DatasetVersion` rows (`input_rows`, `rows`, `selected_rows`, `sha256`).
- `prompts`: All `PromptTemplate` and `PromptVersion` rows (`strategy`, `system_template`, `user_template`, `required_variables`, `sha256`).
- `experiments` & `snapshots`: Draft configurations and immutable `ExperimentSnapshot` + `ExperimentSnapshotRun` matrices.
- `artifact_checksums`: Manifest of referenced run artifact relative paths, expected SHA-256 digests, and on-disk SHA-256 digests.
- `bundle_sha256`: Canonical SHA-256 over the entire JSON payload (sorted keys, compact `,` / `:` separators).

### 2.2 Restore a Project Backup Bundle

Restoring creates a **new** project owned by the authenticated user with freshly remapped entity UUIDs so it never collides with existing projects in the same database.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  --data-binary @project-backup.json \
  "http://localhost:8000/api/v1/audit/backup-restore"
```

**Post-Restore Checklist**:
1. Record the returned `project_id` (`201 Created`).
2. Re-configure LLM provider API keys for the restored project via `PUT /api/v1/projects/{new_project_id}/ai-configs/{provider}` (since credentials are intentionally omitted from backups).
3. Run an immediate integrity check (`GET /api/v1/projects/{new_project_id}/audit/integrity`) and confirm `"ok": true`.

---

## 3. Infrastructure-Level PostgreSQL + Artifact Volume Backup

When performing full-instance disaster-recovery backups, snapshot PostgreSQL and `ARTIFACT_DIR` together in maintenance/quiesced order:

### 3.1 Consistent Instance Backup

```bash
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/var/backups/tql/${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

# 1. Dump PostgreSQL with transactional snapshot consistency
pg_dump --format=custom --no-owner --no-privileges \
  --file="${BACKUP_DIR}/postgres.dump" "${DATABASE_URL}"

# 2. Archive on-disk artifact directory without dereferencing symlinks
tar --no-dereference -czf "${BACKUP_DIR}/artifacts.tar.gz" -C /app artifacts

# 3. Record SHA-256 manifest of both archives
(cd "${BACKUP_DIR}" && sha256sum postgres.dump artifacts.tar.gz > SHA256SUMS)
```

### 3.2 Instance Restore Procedure

1. Verify archive checksums before unpacking:
   ```bash
   (cd "${BACKUP_DIR}" && sha256sum --check SHA256SUMS)
   ```
2. Stop API and Celery worker containers so no concurrent writes occur.
3. Restore PostgreSQL database and verify Alembic schema head:
   ```bash
   pg_restore --clean --if-exists --no-owner --dbname="${DATABASE_URL}" "${BACKUP_DIR}/postgres.dump"
   cd backend && alembic current && alembic upgrade head
   ```
4. Restore `/app/artifacts` with strict ownership and permissions (`0750`), verifying zero symlinks exist:
   ```bash
   find /app/artifacts -type l -print # Must output nothing
   ```
5. Start services and run project integrity checks (`/api/v1/projects/{project_id}/audit/integrity`).

---

## 4. Integrity Verification & Tamper Detection

```bash
curl -sS \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "http://localhost:8000/api/v1/projects/<PROJECT_ID>/audit/integrity"
```

**Response**:
```json
{
  "project_id": "550e8400-e29b-41d4-a716-446655440000",
  "ok": true,
  "checked_records": 12,
  "checked_artifacts": 4,
  "violations": []
}
```

**Violation Categories & Remediation**:
- `hash_mismatch` (`source_version`, `dataset_version`, `prompt_version`, `experiment_snapshot`): Database content was altered outside application immutability guards. Quarantine the environment, audit database access logs, and restore from the last verified backup.
- `artifact_missing` / `artifact_hash_mismatch`: Artifact storage volume is out of sync or corrupted. Restore `/app/artifacts` from the matching timestamped archive or delete invalid run results (`DELETE /api/v1/projects/{project_id}/reports/runs/{run_id}`).
- `artifact_unsafe_path`: A stored `artifact_relpath` attempted traversal or pointed to a symlink. Investigate database integrity immediately; do not manually unlink symlink targets.

---

## 5. Orphan Artifact Cleanup & Audit Trail Inspection

### 5.1 Safe Two-Step Orphan Cleanup

Always preview unreferenced files with `dry_run=true` before deleting with `dry_run=false`:

```bash
# Step 1: Preview unreferenced files under <artifact_dir>/<project_id>
curl -sS -X POST \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "http://localhost:8000/api/v1/projects/<PROJECT_ID>/audit/cleanup-orphans?dry_run=true"

# Step 2: Delete verified orphan files and record system.artifact_cleanup audit event
curl -sS -X POST \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "http://localhost:8000/api/v1/projects/<PROJECT_ID>/audit/cleanup-orphans?dry_run=false"
```

### 5.2 Query Owner-Scoped Audit Events

```bash
curl -sS \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "http://localhost:8000/api/v1/audit-events?action=system.backup_exported&from=2026-11-01&to=2026-11-30&limit=50&offset=0"
```

- Returns **only** the authenticated user's own `AuditEvent` rows ordered newest-first (`created_at DESC`).
- Supports `action`, inclusive `from` / `to` (`YYYY-MM-DD` or ISO 8601 UTC datetime; `422 INPUT_INVALID` if `from > to`), `limit` (`1..200`), and `offset` (`>= 0`).
