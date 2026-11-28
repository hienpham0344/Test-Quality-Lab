# Projects

Project management views and editor screens for Sprint 1 (FR-PRJ-001 / FR-PRJ-002, UC-03).

## Pages & Routes

- `/projects` (`ProjectsPage.jsx`):
  - Project dashboard displaying all owner-scoped projects.
  - Search by name or description, sorting, pagination, and Cards/Table selection share URL state.
  - Total experiments uses counts reported by the API and labels incomplete or unavailable data.
  - Project actions open settings or copy metadata into the create form. Delete is unavailable until the project API supports it.
  - "+ New project" action and "Create your first project" empty state CTA.
  - Handles loading (`Checking access to your projects…`), empty (`You don’t have any projects yet.`), and error states with manual retry.
  - Creates projects through `ProjectCreateModal`. Validation keeps server field errors beside the inputs and preserves edits after a failed request.
  - A successful create updates the list and opens Project details with a success toast.
  - Session termination handling: Automatically triggers `onExpire` on 401 unauthorized responses.
- `/projects/:projectId` (`ProjectEditorPage.jsx`):
  - Project editor screen for viewing and updating project metadata.
  - Pre-fills project name (1–120 characters) and description (up to 2000 characters) with live character counters.
  - `?edit=description` focuses the description field from the registry.
  - In-place form validation and dirty checking (disables saving when inputs are untouched or invalid).
  - Handles 404 (project not found / unauthorized) gracefully without disclosing private resources.
  - **Project settings** displays the edit form and the existing revision history timeline together.
  - Pending edits prompt for confirmation before switching project tabs or following same-origin navigation links. Reloading or closing the document uses the browser warning.
- `/projects/new` (`ProjectEditorPage.jsx` in `create` mode):
  - Standalone project creation screen.

## Shared Components (`src/components/projects/`)

- `ProjectCard.jsx`: Project card and table views with shared links, description action, and overflow menu.
- `ProjectCreateModal.jsx`: Native modal dialog with a live trimmed-name count, keyboard focus containment, Escape dismissal, and focus restoration.
- `ProjectHistoryList.jsx`: Read-only History tab in Edit project. Revisions appear newest first, five per page. Inclusive date filters use the browser time zone. Changed markers compare each field with the preceding revision before filtering or pagination.

## API Integration (`src/services/api.js`, #87)

All functions go through `request()`, so failures are always `ApiError(status, code, fields, message)`
with the SRS §3.15 body (`docs/api/contracts/projects.md`).

- `listProjects(accessToken, { q, sort, order, limit, offset }, signal)` → `{ items, total }`. Empty params are omitted; `total` comes from `X-Total-Count`.
- `listAllProjects(accessToken, { q, sort, order }, signal)` → every owned project, fetched in pages of 100 (API maximum). The dashboard uses it because its summary tiles count all projects.
- `getProject(accessToken, projectId, signal)`, `createProject(accessToken, { name, description }, signal)`, `updateProject(accessToken, projectId, { name, description }, signal)`.
- `getProjectHistory(accessToken, projectId, { from, to, limit, offset }, signal)`.
- `withSessionRefresh(session, onRefresh, call)`: on `401` asks `onRefresh` once for a new session and retries; a second `401` reaches the page, which calls `onExpire`.
  `App.jsx` keeps the refresh token **in memory only** (sessionStorage stores just the access token); concurrent 401s share one `/auth/refresh` call.

## Query hooks (`queries.js`) and messages (`messages.js`)

- `projectKeys`: `all()` (full list), `page(params)`, `detail(id)`, `history(id, params)`, `historyAll(id)`.
- `useAllProjects(auth)`, `useProjects(auth, params)` (`{ items, total }`), `useProject(auth, id)`, `useProjectHistory(auth, id, params)`,
  `useCreateProject(auth)`, `useUpdateProject(auth, id)`. `auth = { session, onRefresh }`. Mutations update the detail cache and invalidate the list, detail and history keys.
- `projectErrorMessage(error)` / `projectErrorKey(error)` map by status + code (`INPUT_INVALID`, `NOT_FOUND`, `AUTH_SESSION_INVALID`, `SERVICE_UNAVAILABLE`, network). `projectFieldErrors(error)` returns `fields` for inline errors (`aria-invalid` + `aria-describedby`).

Tests: `tests/projects/projectsApiClient.test.jsx`, `src/services/api.test.js`, `tests/auth/AuthPage.test.jsx` (refresh flow), `tests/projects/ProjectEditorPage.test.jsx` (server field errors).
