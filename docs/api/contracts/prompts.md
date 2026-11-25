# Versioned Prompt Registry, Readiness & Bundle Finalization (`FR-PRM-001`, `FR-PRM-002`, `FR-PRM-003`)

Manages owner-scoped `L1`–`L5` prompt strategy versions, approval states, bundle review finalization, and deterministic rendering under `/api/v1/projects/{project_id}/prompts` (`404 NOT_FOUND` if the project does not exist or belongs to another user).

## SRS `TBD-04` Policy

Official `L1`–`L5` prompt text remains unapproved (`TBD-04`). On first access for a project, `PromptRegistryService.ensure_default_strategies(project_id)` seeds metadata slots for `L1`–`L5` with `current_version = 0`, `approved_version = null`, and `status = "UNAPPROVED"`. No official template wording is invented, seeded, or pre-approved anywhere.

## Endpoints

- `GET /api/v1/projects/{project_id}/prompts` — Lists `L1`–`L5` strategy summaries (`id`, `strategy`, `title`, `current_version`, `approved_version`, `status`, `updated_at`).
- `GET /api/v1/projects/{project_id}/prompts/readiness` — Returns `{project_id, all_approved, approved_strategies, missing_strategies}` across `L1`–`L5`.
- `POST /api/v1/projects/{project_id}/prompts/bundles/finalize` — Accepts `PromptBundleFinalizeInput` (`strategies` containing the exact set `L1`–`L5`, each with `system_template`, `user_template`, non-empty `review_notes`, and `placeholder_verified: true`). Validates all placeholders via `extract_template_variables` before mutating state, atomically creates and approves all 5 versions in a single transaction (deprecating any previously approved versions without mutating historical hashes or text), records `AuditEvent("prompt_bundle.finalized")`, and returns `{project_id, bundle_sha256, versions}`.
- `GET /api/v1/projects/{project_id}/prompts/{strategy}/versions` — Lists immutable `PromptVersion` history newest-first.
- `POST /api/v1/projects/{project_id}/prompts/{strategy}/versions` — Registers a new immutable `UNAPPROVED` version (`201 Created`). Validates placeholders against `ALLOWED_PROMPT_VARIABLES` (`function_name`, `function_signature`, `function_code`, `module_code`, `csv_cases`, `docstring`), blocks attribute/index format traversal (`422 INPUT_INVALID`), computes canonical `sha256`, and records `AuditEvent("prompt_version.created")`.
- `POST /api/v1/projects/{project_id}/prompts/{strategy}/versions/{version}/approve` — Marks `version` as `APPROVED`, transitions any prior approved version to `DEPRECATED` without mutating historical template text or hashes, and records `AuditEvent("prompt_version.approved")`.
- `POST /api/v1/projects/{project_id}/prompts/{strategy}/render` — Renders the active `APPROVED` version deterministically (`template_sha256`, `rendered_sha256`, `rendered_system`, `rendered_user`). Blocks unapproved strategies with `409 PROMPT_NOT_APPROVED`.
