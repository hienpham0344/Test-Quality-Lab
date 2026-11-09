# Projects

Project management views and editor screens for Sprint 1 (FR-PRJ-001 / FR-PRJ-002, UC-03).

## Pages & Routes

- `/projects` (`ProjectsPage.jsx`):
  - Project dashboard displaying all owner-scoped projects.
  - Interactive search bar to filter projects by title or description.
  - "+ New project" action and "Create your first project" empty state CTA.
  - Handles loading (`Checking access to your projects…`), empty (`You don’t have any projects yet.`), and error states with manual retry.
  - Integrates `ProjectCreateModal` for inline project creation.
  - Session termination handling: Automatically triggers `onExpire` on 401 unauthorized responses.
- `/projects/:projectId` (`ProjectEditorPage.jsx`):
  - Project editor screen for viewing and updating project metadata.
  - Pre-fills project name (1–120 characters) and description (up to 2000 characters) with live character counters.
  - In-place form validation and dirty checking (disables saving when inputs are untouched or invalid).
  - Handles 404 (project not found / unauthorized) gracefully without disclosing private resources.
  - Revision history timeline (`ProjectHistoryList.jsx`): Displays an immutable audit trail of past project revisions with revision badges and timestamps.
- `/projects/new` (`ProjectEditorPage.jsx` in `create` mode):
  - Standalone project creation screen.

## Shared Components (`src/components/projects/`)

- `ProjectCard.jsx`: Dashboard project card showing title, revision badge (`v{revision}`), description, updated date, and edit link.
- `ProjectCreateModal.jsx`: Accessible modal dialog for creating a project with keyboard escape support and field validation.
- `ProjectHistoryList.jsx`: Timeline of revisions showing revision numbers, snapshot name/description, and formatted timestamps.

## API Integration (`src/services/api.js`)

- `listProjects(accessToken, signal)`: Fetches owner-scoped projects.
- `getProject(accessToken, projectId, signal)`: Retrieves project details.
- `createProject(accessToken, { name, description }, signal)`: Creates a new project with trimmed fields.
- `updateProject(accessToken, projectId, { name, description }, signal)`: Updates metadata and increments revision.
- `getProjectHistory(accessToken, projectId, signal)`: Retrieves immutable project revision history.
