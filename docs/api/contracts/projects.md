# Projects API contract — UC-03 (FR-PRJ-001, FR-PRJ-002, FR-PRJ-003)

Base URL: `/api/v1/projects` · Machine-readable schema: `GET /openapi.json` · Manual tests:
`docs/api/postman/` folder `projects` → "UC-03 Projects" · SRS v1.2: FR-PRJ-001…003, UC-03, Bảng 6
(PRJ row), §3.14, §3.15 · Issues: #19, #81, #82.

## Conventions

- All routes require `Authorization: Bearer <access_token>`. Missing, refresh, revoked or expired
  tokens return `401 AUTH_SESSION_INVALID` (with `WWW-Authenticate: Bearer`).
- Request bodies use JSON (`snake_case` fields) with `extra="forbid"`. Unknown fields, wrong types and
  invalid query parameters return `422 INPUT_INVALID`.
- **Error body** (SRS §3.15) for every error:
  ```json
  { "detail": { "code": "INPUT_INVALID",
                "message": "Project name must contain 1 to 120 characters",
                "fields": { "name": "Project name must contain 1 to 120 characters" } } }
  ```
  Map errors by `status` + `code`; show `fields[<field>]` next to the matching input. `message` is a
  human-readable summary (for metadata errors it repeats the field messages); never parse it.
- **Owner isolation** (FR-AUT-004, §3.14): every lookup is scoped to `owner_id == current_user.id`.
  Missing and unowned `project_id` values return the **identical** `404 NOT_FOUND` body, so nothing
  about another user's project is revealed. List filters can only narrow the owner's own projects.
- **Invalid input keeps the old data** (Bảng 6, FR-PRJ-001/002): a `422` never creates a project,
  changes metadata or adds a history revision.
- **Immutable history**: `project_history` rows are append-only.
- Timestamps (`created_at`, `updated_at`, `changed_at`) are UTC, returned as ISO-8601 without an offset.
  IDs are UUID strings.

### Field limits

| Field | Rule | Source |
|---|---|---|
| `name` | required; trimmed; `1..120` characters after trimming | SRS Bảng 6 |
| `description` | optional; `null` allowed; `<= 2000` characters | implementation limit (SRS sets none) |
| `q` (list search) | optional; trimmed; `<= 120` characters; blank = no filter | #81 |

### Common errors

| Status | `code` | When | Frontend should |
|---|---|---|---|
| 401 | `AUTH_SESSION_INVALID` | missing/expired/revoked token | refresh once via `/auth/refresh`, retry, else go to login |
| 404 | `NOT_FOUND` | project missing or not owned | show "Project not found or you don't have access to it" |
| 422 | `INPUT_INVALID` | invalid body field or query parameter | show `fields` beside inputs; keep the user's edits |

---

## Endpoints

### POST /api/v1/projects — FR-PRJ-001

Creates a project owned by the caller at `current_revision = 1` and appends revision `1` to
`project_history`.

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | yes | trimmed `1..120` characters |
| `description` | `string \| null` | no | `<= 2000` characters |

**201 Created** (`ProjectOutput`)
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

**422** — every invalid field is reported together; nothing is created:
```json
{ "detail": { "code": "INPUT_INVALID",
              "message": "Project name must contain 1 to 120 characters Project description must not exceed 2000 characters",
              "fields": { "name": "Project name must contain 1 to 120 characters",
                          "description": "Project description must not exceed 2000 characters" } } }
```
Errors: 401, 422 (see Common errors).

```bash
curl -X POST "$BASE/api/v1/projects" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"HumanEval Campaign","description":null}'
```

---

### GET /api/v1/projects — FR-PRJ-003 (#81)

Lists the caller's projects with a summary, filtered, sorted and paged.

#### Query parameters

| Parameter | Type | Default | Rules |
|---|---|---|---|
| `q` | `string` | — | case-insensitive "name contains"; `%`, `_` and `\` are matched literally; `<= 120` chars |
| `sort` | `created_at` \| `updated_at` \| `name` | `created_at` | `name` sorts case-insensitively |
| `order` | `desc` \| `asc` | `desc` | ties are broken by `id` in the same direction, so pages are stable |
| `limit` | `integer` | `100` | `1..100` |
| `offset` | `integer` | `0` | `>= 0` |

#### Response

**200 OK** — JSON array of `ProjectListItem`. An empty result is `200 []`, **not an error**
(FR-PRJ-003). Response header **`X-Total-Count`** holds the total number of owned projects that match
`q`, ignoring `limit`/`offset`. It is exposed to browsers through CORS.
```http
X-Total-Count: 4
```
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "HumanEval Campaign",
    "description": "Sprint 1 project baseline",
    "current_revision": 2,
    "created_at": "2026-11-25T09:00:00",
    "updated_at": "2026-11-26T10:15:00",
    "experiment_count": 3
  }
]
```
`experiment_count` = number of experiments in the project (`0` when none).

Errors: 401; 422 `INPUT_INVALID` with `fields.limit` / `fields.offset` / `fields.sort` / `fields.order` / `fields.q`.

Pagination: `pages = ceil(X-Total-Count / limit)`; next page `offset += limit`. Keep `q`, `sort` and
`order` in the URL so refresh and back keep the view.

```bash
curl "$BASE/api/v1/projects?q=payment&sort=updated_at&order=desc&limit=20&offset=0" \
  -H "Authorization: Bearer $TOKEN" -i
```

---

### GET /api/v1/projects/{project_id} — FR-PRJ-002

Returns one owned project. **200 OK** `ProjectOutput` (same shape as the POST response).
Errors: 401, 404 `NOT_FOUND`, 422 if `project_id` is not a UUID.

---

### PATCH /api/v1/projects/{project_id} — FR-PRJ-002

Updates `name` and/or `description` under a row lock (`SELECT ... FOR UPDATE`).

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | `string` | no | cannot be `null` if provided; trimmed `1..120` characters |
| `description` | `string \| null` | no | `<= 2000` characters or `null` |

- Omitted fields keep their value. When the trimmed values equal the stored ones (including `{}`),
  nothing changes: no revision bump and no history row (`200 OK`).
- When metadata changes, `current_revision` increments by `1` and a history revision is appended in the
  same transaction (`200 OK`, `ProjectOutput`).
- Editing metadata never changes frozen experiment snapshots (FR-PRJ-002, BR-03).
- Errors: 401, 404 `NOT_FOUND`, 422 `INPUT_INVALID` (old metadata and history are kept).

---

### GET /api/v1/projects/{project_id}/history — UC-03 alternate flow (#82)

Returns the immutable metadata revisions of an owned project, **newest first** (`revision` descending),
with optional inclusive date-range filtering and offset pagination.

#### Query parameters

| Parameter | Type | Default | Rules |
|---|---|---|---|
| `from` | `string` | `null` | Inclusive lower bound on `changed_at`. `YYYY-MM-DD` (expanded to `00:00:00` UTC) or ISO 8601 datetime (timezone-aware values normalized to UTC) |
| `to` | `string` | `null` | Inclusive upper bound. `YYYY-MM-DD` (expanded to `23:59:59.999999` UTC) or ISO 8601 datetime |
| `limit` | `integer` | `100` | `1..200` |
| `offset` | `integer` | `0` | `>= 0` |

**200 OK** (`[]` when no revision falls in the window)
```json
[
  { "revision": 2, "name": "Renamed Project", "description": "Updated experiment scope",
    "changed_at": "2026-11-25T14:30:00" },
  { "revision": 1, "name": "Initial Project", "description": null,
    "changed_at": "2026-11-24T09:00:00" }
]
```

**422** — malformed `from`/`to`, `from > to`, or out-of-range `limit`/`offset`:
```json
{ "detail": { "code": "INPUT_INVALID", "message": "Invalid date range",
              "fields": { "from": "Must be <= to" } } }
```

**404** — missing or unowned project:
```json
{ "detail": { "code": "NOT_FOUND", "message": "Project not found", "fields": {} } }
```

---

## Changelog

| Date | Issue | Change | Breaking |
|---|---|---|---|
| 2026-11-27 | #81 | 404/422 business errors use the §3.15 body (`NOT_FOUND`, `INPUT_INVALID` + `fields`) instead of a string `detail`; list adds `q`, `sort`, `order`, `limit` (max 100), `offset`, `experiment_count`, `X-Total-Count` | No for clients that branch on HTTP status. Clients that read `detail` as a string must read `detail.message`. The list is capped at 100 per request (previously unbounded). |
| 2026-11-25 | #82 | history date filter and pagination | No |
