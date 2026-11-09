# Postman

- `test-quality-lab.postman_collection.json` - one folder per module, one request per endpoint,
  plus the main error cases. Each request has status/code tests.
- `local.postman_environment.json` - local values only; token variables are empty secrets.

Usage: `docker compose up -d`, import both files, select **Test Quality Lab - local**, run the
`auth` folder top to bottom (or *Run collection*). The register request creates a fresh email each
run, and the "Mailpit - read newest ... link" requests copy the email token into the environment.
Public auth routes are rate limited per IP: wait a minute between full runs.

Command line (same checks): `npx newman run docs/api/postman/test-quality-lab.postman_collection.json -e docs/api/postman/local.postman_environment.json`

Never commit real tokens or passwords: clear current values before exporting.
