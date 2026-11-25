# Postman

- `test-quality-lab.postman_collection.json` - one folder per module, one request per endpoint,
  plus error/lifecycle checks and status/schema assertions.
- `local.postman_environment.json` - local values and empty placeholder IDs only; token and API
  credential variables are empty secrets.

## Folders

- `auth` - registration, email verification via Mailpit, sign-in/sign-out, token refresh, and
  password reset (`docs/api/contracts/auth.md`).
- `ai-configs` - Sprint 3 LLM provider catalog (`groq`, `gemini`, `openrouter`), encrypted
  credential upsert, KEK envelope rotation, masked listing, and deletion
  (`docs/api/contracts/ai-config.md`).
- `prompts` - Sprint 3/4 `L1`-`L5` strategy listing, readiness check, atomic `L1`-`L5` bundle
  finalization, immutable version registration (using clearly labeled non-official test examples
  because official `L1`-`L5` wording remains unapproved under SRS `TBD-04`), version history,
  approval, and deterministic rendering (`docs/api/contracts/prompts.md`).
- `experiments` - Sprint 3 matrix validation (`<= 1000` planned runs), draft creation/listing/patch,
  and append-only immutable snapshot freezing and retrieval (`docs/api/contracts/experiments.md`).
- `generation` - Sprint 4 dashboard inspection, idempotent snapshot generation queue launch (`202`),
  and active job cancellation (`docs/api/contracts/generation.md`).
- `evaluations` - Sprint 6 static AST + verified trace evaluation (`0.0` vs `N/A`/`FAILED`/`TIMEOUT`),
  snapshot generation-success calculation, and human assertion rubric reviews
  (`docs/api/contracts/evaluations.md`).
- `reports` - Sprint 7 live summary & filtered results, sanitized RFC 4180 CSV exports (`runs.csv`
  and `strategy-comparison.csv`), and safe run result deletion (`docs/api/contracts/reports.md`).
- `audit` - Sprint 7 owner-scoped audit trail (`GET /audit-events`), project SHA-256 integrity
  verification, orphan artifact cleanup, and secret-free backup export/restore
  (`docs/operations/backup-restore.md`).

## Usage

1. Start the local stack (`docker compose up -d`), import both JSON files into Postman, and select
   the **Test Quality Lab - local** environment.
2. Run `auth` to populate `accessToken` (inherited via collection-level Bearer auth). The register
   request creates a fresh email each run, and the Mailpit helper requests copy verification/reset
   tokens into the environment. Public auth routes are rate limited per IP: wait a minute between
   full runs.
3. Before running the Sprint 3 folders (`ai-configs`, `prompts`, `experiments`), set `project_id`,
   `source_id`, `dataset_id`, and `provider_api_key_placeholder` in your local Postman environment
   current values. Creating an experiment and freezing a snapshot automatically populate
   `experiment_id` and `snapshot_id`. Note that `DELETE /projects/{{project_id}}/ai-configs/groq`
   removes the stored credential, so re-run `PUT /projects/{{project_id}}/ai-configs/groq` before
   freezing an experiment snapshot that targets `groq`.

Command line (`auth` flow):
`npx newman run docs/api/postman/test-quality-lab.postman_collection.json --folder auth -e docs/api/postman/local.postman_environment.json`

Never commit real API keys, tokens, or passwords: keep secret placeholders empty and clear current
values before exporting.
