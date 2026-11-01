# Data model (early draft)

Current implementation: `users`, one-time `auth_tokens`, revocable `auth_sessions`,
`projects`, and immutable `project_history` revisions have Alembic migrations.
`users.auth_epoch` invalidates old sessions after password reset, even when
session creation overlaps the reset.
Apply Alembic revision `20261101_0002` in each environment before using the
authentication and project APIs.

Remaining planned entities: sources/source_versions, datasets/row_versions,
experiments/snapshots, runs, prompt_versions, provider_configs, artifacts,
metric_records, audit_events.

Project history records metadata changes only. Experiment snapshots remain outside
this feature. Use foreign keys and owner checks; snapshots must be immutable.
Exact schemas must be approved feature by feature against SRS 1.2.
