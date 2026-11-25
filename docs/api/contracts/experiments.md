# Experiment Configuration & Immutable Snapshots (`FR-EXP-001`–`004`, `FR-EXP-006`, `FR-EXP-007`)

Owner-scoped endpoints under `/api/v1/projects/{project_id}/experiments` validate experiment configurations, persist editable drafts, freeze immutable snapshots with cryptographic provenance hashes, and expose snapshot history.

## Validation & Matrix Rules

- **Inputs (`FR-EXP-001`, `FR-EXP-004`):** Requires an owned Python `source_id` + `source_revision` and `>= 1` AST-verified `function_names`. Optionally attaches an owned CSV `dataset_id` + `dataset_revision` and `selected_rows` (`422 CSV_ROW_INVALID` if any selected row has `status == "invalid"`).
- **Models & Strategies (`FR-EXP-002`):** `>= 1` distinct `(provider, model)` pairs (`groq`, `gemini`, `openrouter`) and `>= 1` distinct strategies in `L1`–`L5` (canonicalized in `L1..L5` order).
- **Run Limit (`FR-EXP-007`):** `run_count = len(functions) * len(models) * len(strategies) * repeats` must satisfy `1 <= run_count <= 1000` (`422 EXPERIMENT_RUN_LIMIT` if exceeded).

## Freezing & Immutability (`FR-EXP-003`, `FR-EXP-006`)

`POST /api/v1/projects/{project_id}/experiments/{experiment_id}/snapshots` (`201 Created`):
1. Verifies encrypted provider credentials exist for every selected provider (`409 CREDENTIAL_MISSING`); stores only `credential_key_id` and masked `credential_key_hint` (never raw secrets).
2. Verifies every selected strategy has an `APPROVED` `PromptVersion` (`409 PROMPT_NOT_APPROVED`).
3. Freezes Python code/AST functions, CSV rows/selection, model targets, generation parameters, prompt versions + rendered prompt SHA-256 hashes, `run_hash` per planned run (`experiment_snapshot_runs`), and overall `snapshot_sha256`.
4. `ExperimentSnapshot` and `ExperimentSnapshotRun` rows are strictly append-only (`409 SNAPSHOT_IMMUTABLE` on any update or delete attempt). Subsequent project renames, source/dataset uploads, prompt approvals, or draft edits never alter previously frozen snapshots.
