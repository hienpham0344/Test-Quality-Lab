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
- `ProjectHistoryList.jsx`: Timeline of revisions showing revision numbers, snapshot name/description, and formatted timestamps.

## API Integration (`src/services/api.js`)

- `listProjects(accessToken, signal)`: Fetches owner-scoped projects.
- `getProject(accessToken, projectId, signal)`: Retrieves project details.
- `createProject(accessToken, { name, description }, signal)`: Creates a new project with trimmed fields.
- `updateProject(accessToken, projectId, { name, description }, signal)`: Updates metadata and increments revision.
- `getProjectHistory(accessToken, projectId, signal)`: Retrieves immutable project revision history.
