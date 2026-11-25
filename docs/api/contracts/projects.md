# Projects API contract — UC-03 (FR-PRJ-001, FR-PRJ-002, FR-PRJ-003)

Base URL: `/api/v1/projects` · Machine-readable schema: `GET /openapi.json` · Manual tests:
`docs/api/postman/` folder `projects` · SRS v1.2: FR-PRJ-001…003, UC-03, section 3.15.

## Conventions

- All routes require `Authorization: Bearer <access_token>`. Refresh tokens and revoked or expired
  sessions return `401 AUTH_SESSION_INVALID`.
- Request bodies use JSON (`snake_case` fields) with `extra="forbid"`. Unknown fields are rejected
  with `422 INPUT_INVALID`.
- **Owner isolation**: every lookup is scoped to `owner_id == current_user.id`. Both nonexistent
  and unowned `project_id` values return identical `404` (`{"detail": "Project not found"}`) to
  avoid resource enumeration.
- **Immutable history**: `ProjectHistory` rows are strictly append-only. Any ORM update or delete
  raises `AppError(ErrorCode.ACCESS_DENIED, "Project history is append-only")` (`403`).
- Timestamps (`created_at`, `updated_at`, `changed_at`) are persisted and returned in UTC.

---

## Endpoints

### POST /api/v1/projects — FR-PRJ-001

Creates a new project at `current_revision = 1` and appends revision `1` to `project_history`.

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | yes | Trimmed; `1..120` characters |
| `description` | `string \| null` | no | Optional; `<= 2000` characters |

**201 Created**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "HumanEval Campaign",
  "description": "Sprint 1 project baseline",
  "current_revision": 1,
  "created_at": "2026-11-25T09:00:00",
  "updated_at": "2026-11-25T09:00:00"
}
```

Errors: `401 AUTH_SESSION_INVALID`, `422` (blank/oversized `name`, oversized `description`, or extra fields).

---

### GET /api/v1/projects — FR-PRJ-003

Returns all projects owned by the authenticated user ordered by `created_at` descending (`200 OK`,
`list[ProjectOutput]`).

---

### GET /api/v1/projects/{project_id} — FR-PRJ-002

Returns a single owned project (`200 OK`, `ProjectOutput`) or `404` (`{"detail": "Project not found"}`).

---

### PATCH /api/v1/projects/{project_id} — FR-PRJ-002

Updates `name` and/or `description` under a row lock (`SELECT ... FOR UPDATE`).

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | no | Cannot be `null` if provided; trimmed `1..120` characters |
| `description` | `string \| null` | no | `<= 2000` characters or `null` |

- When trimmed values match the persisted state (e.g. `{}` or unchanged values), no revision bump or
  `project_history` insert occurs (`200 OK`).
- When metadata changes, `current_revision` increments by `1` and an immutable `ProjectHistory`
  snapshot is appended atomically (`200 OK`).
- Errors: `401 AUTH_SESSION_INVALID`, `404` (missing or unowned), `422` (invalid metadata or unknown fields).

---

### GET /api/v1/projects/{project_id}/history — UC-03 (Issue #82)

Returns the immutable metadata revision history of an owned project ordered **newest first**
(`revision` descending), with optional inclusive date-range filtering and offset pagination.

#### Query Parameters

| Parameter | Type | Default | Rules |
|---|---|---|---|
| `from` | `string` | `null` | Inclusive lower bound on `changed_at`. Accepts `YYYY-MM-DD` (expanded to `00:00:00` UTC) or ISO 8601 `datetime` (timezone-aware values normalized to naive UTC). |
| `to` | `string` | `null` | Inclusive upper bound on `changed_at`. Accepts `YYYY-MM-DD` (expanded to `23:59:59.999999` UTC) or ISO 8601 `datetime` (timezone-aware values normalized to naive UTC). |
| `limit` | `integer` | `100` | Page size (`1 <= limit <= 200`). |
| `offset` | `integer` | `0` | Zero-based row offset (`offset >= 0`). |

#### Responses

**200 OK** (`[]` when the project has no revisions within the requested date/pagination window)
```json
[
  {
    "revision": 2,
    "name": "Renamed Project",
    "description": "Updated experiment scope",
    "changed_at": "2026-11-25T14:30:00"
  },
  {
    "revision": 1,
    "name": "Initial Project",
    "description": null,
    "changed_at": "2026-11-24T09:00:00"
  }
]
```

**422 Unprocessable Entity** — malformed `from`/`to`, `from > to`, or out-of-bounds `limit`/`offset`:
```json
{
  "detail": {
    "code": "INPUT_INVALID",
    "message": "Invalid date range",
    "fields": {
      "from": "Must be <= to"
    }
  }
}
```

**404 Not Found** — missing or unowned project:
```json
{
  "detail": "Project not found"
}
```
