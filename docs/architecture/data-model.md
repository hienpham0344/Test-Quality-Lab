# Data model (early draft)

Current implementation: only the `users` schema migration exists; authentication
and email verification are not implemented.

Planned entities: users, projects, sources/source_versions, datasets/row_versions,
experiments/snapshots, runs, prompt_versions, provider_configs, artifacts,
metric_records, audit_events.

Use foreign keys and owner checks; snapshots must be immutable. Exact schemas
must be approved feature by feature against SRS 1.2.
