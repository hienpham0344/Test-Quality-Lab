# Auth API contract — UC-01, UC-02 (and UC-12)

Base URL: `/api/v1/auth` · Machine-readable schema: `GET /openapi.json` · Manual tests:
`docs/api/postman/` · SRS v1.2: FR-AUT-001…006, NFR-SEC-001, sections 3.15 and 4.8.

## Conventions

- JSON bodies, `snake_case` fields. Unknown request fields are rejected.
- Authenticated routes need `Authorization: Bearer <access_token>`.
- Tokens are opaque random strings, not JWTs. Do not decode them.
- Lifetimes: access token **15 min**, refresh token **1 day**, verification link **24 h**,
  reset link **30 min**.
- Public routes are rate limited per IP (and per email where the request has one):

  | Route | Limit per IP | Limit per email |
  |---|---|---|
  | register | 5/min | 3/hour |
  | login | 20/min | 10/15 min |
  | verification/request | 5/min | 3/hour |
  | password/forgot | 5/min | 3/hour |
  | verify | 20/min | — |
  | password/reset | 10/min | — |
  | refresh | 30/min | — |

  Over the limit → `429 AUTH_RATE_LIMITED`. If Redis is down → `503 SERVICE_UNAVAILABLE`.

### Error body (every error)

```json
{ "detail": { "code": "AUTH_INVALID_INPUT", "message": "Invalid input",
              "fields": { "email": "Enter a valid email address" } } }
```

`fields` is `{}` when the error is not about a specific field. Map UI text from `code`, never from
`message`. A missing or malformed request body on any `/auth` route returns
`400 AUTH_INVALID_INPUT` with `fields`.

| Status | code | Meaning |
|---|---|---|
| 400 | `AUTH_INVALID_INPUT` | Invalid field(s); see `fields` (SRS 3.15) |
| 400 | `AUTH_INVALID_TOKEN` | Verification/reset link invalid, used or expired |
| 401 | `AUTH_INVALID_CREDENTIALS` | Wrong email or password (one message for both) |
| 401 | `AUTH_SESSION_INVALID` | Missing, expired, revoked or rotated token |
| 403 | `AUTH_EMAIL_NOT_VERIFIED` | Correct password but email not verified |
| 409 | `AUTH_DUPLICATE_EMAIL` | Email already registered (SRS 3.15) |
| 429 | `AUTH_RATE_LIMITED` | Too many attempts |
| 503 | `SERVICE_UNAVAILABLE` | Email queue or rate-limit store unavailable |

401 responses also carry the `WWW-Authenticate: Bearer` header.

---

## UC-01 — register and verify email

### POST /register — FR-AUT-001

| Field | Type | Required | Rules |
|---|---|---|---|
| email | string | yes | valid address, ≤ 320 chars; trimmed and lower-cased |
| password | string | yes | 12–1024 characters |
| confirm_password | string | yes | must equal `password` |
| display_name | string \| null | no | trimmed, ≤ 100 chars; blank → `null` |

**201**
```json
{ "status": "verification_requested", "message": "Check your email to verify your account" }
```
Creates an **unverified** account and queues a verification email (sent by the worker).
All invalid fields are reported together.

| Error | When | Frontend should |
|---|---|---|
| 400 AUTH_INVALID_INPUT | invalid fields | show `fields` under the inputs |
| 409 AUTH_DUPLICATE_EMAIL | email taken | show error on email, link to sign in |
| 503 SERVICE_UNAVAILABLE | email queue down | "try again"; the account stays inactive |

Retry rule: registering again with the **same email and password** while unverified only re-sends
the link (no duplicate account). Another password → 409.

### POST /verification/request — UC-01 A1 (resend)

Body `{ "email": "user@example.com" }` → **200**
`{ "status": "request_accepted", "message": "…" }`.
Same answer for unknown, verified and unverified emails (no account disclosure). A new link
**invalidates all older verification links**. Errors: 400 (bad email), 429, 503.

### POST /verify — FR-AUT-005

Body `{ "token": "<from the email link fragment>" }` → **200**
`{ "status": "verified", "message": "Email verified. You can now sign in" }`.

The link is `https://<app>/verify-email#token=<token>`. The page reads the fragment, removes it
from the address bar and POSTs it. Errors: `400 AUTH_INVALID_TOKEN`; show a resend form.

---

## UC-02 — sign in and sign out

### POST /login — FR-AUT-002

Body `{ "email": "user@example.com", "password": "…" }` → **200**
```json
{ "access_token": "…", "refresh_token": "…", "token_type": "bearer", "expires_in": 900 }
```

| Error | When | Frontend should |
|---|---|---|
| 400 AUTH_INVALID_INPUT | malformed email | show field error |
| 401 AUTH_INVALID_CREDENTIALS | unknown email **or** wrong password | one generic message, clear password |
| 403 AUTH_EMAIL_NOT_VERIFIED | right password, not verified | ask to verify, offer resend |
| 429 / 503 | rate limit / outage | retry later |

Every success and failure is written to `audit_events` (no email or secret stored).

### GET /me

Bearer access token → **200** `{ "id": "uuid", "email": "…", "display_name": "…" | null }`.
`401 AUTH_SESSION_INVALID` when the token is missing, expired, revoked or rotated.

### POST /refresh — FR-AUT-003

Body `{ "token": "<refresh_token>" }` → **200** new token pair (same shape as login).
The old access **and** refresh tokens stop working immediately (rotation).
`401 AUTH_SESSION_INVALID` when the refresh token is unknown, used, expired or revoked.

Frontend rule: on a `401` from an authenticated call, call `/refresh` **once** and retry;
if refresh fails, clear the local session and go to sign in ("session expired").

### POST /logout — FR-AUT-003

Bearer access token (an **expired** access token is accepted) → **200**
`{ "status": "logged_out", "message": "Signed out" }`.
Revokes the session and its refresh token. Repeating it, or using an unknown token, still returns
200. Without a token → `401 AUTH_SESSION_INVALID`. The frontend always clears its local session.

---

## UC-12 — password reset (unchanged behaviour)

- `POST /password/forgot` `{ "email" }` → 200 `request_accepted` (same for unknown emails).
- `POST /password/reset` `{ "token", "new_password" }` → 200 `password_reset`. Revokes every
  session. Errors: `400 AUTH_INVALID_INPUT` (`fields.new_password`), `400 AUTH_INVALID_TOKEN`.
  Only the newest reset link works.

## Change log

- 2026-11-08 — UC-01/UC-02 completed. **Breaking:** error bodies use the standard shape;
  register requires `confirm_password`; duplicate email is 409 (was 422); invalid input is 400
  (was 422); unverified login is 403 (was 401); refresh token lifetime 1 day (was 7); added
  `GET /me`, `display_name`, `expires_in`, `message`.
