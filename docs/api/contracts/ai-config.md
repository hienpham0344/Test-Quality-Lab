# AI Provider Configuration & Adapters (`FR-AIC-001`, `FR-AIC-002`, `FR-AIC-005`)

Owner-scoped endpoints under `/api/v1/projects/{project_id}/ai-configs` store encrypted LLM provider credentials and default generation parameters. Raw API keys are encrypted at rest with AES-256-GCM (`CredentialVault`, envelope `v1:<key_id>:<nonce>:<ciphertext>`, AAD bound to `"{project_id}:{provider}"`) and are never returned in API responses, logs, audit rows, or error messages.

## Supported Providers (`GET /api/v1/projects/{project_id}/ai-configs/providers`)

Returns `200 OK` with supported provider descriptors:
- `groq` — OpenAI-compatible chat completions (`Authorization: Bearer ...`)
- `gemini` — Google Gemini `generateContent` (`x-goog-api-key` header only; never URL query string)
- `openrouter` — OpenRouter chat completions (`Authorization: Bearer ...`, `HTTP-Referer`, `X-Title`)

## List Configured Credentials (`GET /api/v1/projects/{project_id}/ai-configs`)

Returns `200 OK` array of masked configurations for an owned project (`404 NOT_FOUND` if project does not exist or belongs to another user):
- `id`, `project_id`, `provider`, `default_model`
- `key_id` (active KEK identifier when encrypted), `key_hint` (`"••••••••"` or `"••••••••" + last4`), `needs_rotation` (`bool`)
- `default_params`: `{temperature, max_tokens, top_p, seed, timeout_seconds}`
- `created_at`, `updated_at`

## Save or Update Credential (`PUT /api/v1/projects/{project_id}/ai-configs/{provider}`)

Accepts `{api_key, default_model, default_params?}`, validates `provider` (`422 PROVIDER_UNSUPPORTED`), model identifier (`422 INPUT_INVALID`), encrypts `api_key` (`503 SERVICE_UNAVAILABLE` if `CREDENTIAL_ENCRYPTION_KEYS` is not configured), records `AuditEvent("ai_credential.saved")`, and returns `ProviderCredentialOutput`.

## Rotate Encryption Envelope (`POST /api/v1/projects/{project_id}/ai-configs/{provider}/rotate-encryption`)

Re-wraps an existing credential from a legacy KEK in `CREDENTIAL_ENCRYPTION_KEYS` to the primary KEK (`AuditEvent("ai_credential.rotated")`).

## Delete Credential (`DELETE /api/v1/projects/{project_id}/ai-configs/{provider}`)

Hard-deletes the stored credential (`204 No Content`) and records `AuditEvent("ai_credential.deleted")`.
