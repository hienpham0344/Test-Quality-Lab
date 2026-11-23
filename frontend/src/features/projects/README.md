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
  - Project editor screen for viewing and updating project metadata (FR-PRJ-002, Issue #90).
  - Displays project name, description, created/updated time, and current revision badge.
  - Multi-tab layout supporting Overview, History (F5), Experiments (F6), and Datasets (CSV).
  - In-place form validation matching F3: project name (1–120 characters, required) and description (up to 2000 characters) with live character counters.
  - Dirty checking: Save button is disabled until changes are made and inputs are valid; Cancel restores original values and resets dirty state.
  - Unsaved changes guard: warns before leaving with unsaved edits via beforeunload and accessible confirmation dialog when navigating or switching tabs.
  - Informative policy notice on screen: "Editing metadata does not change experiments already frozen (FR-PRJ-002)."
  - Save success updates the detail and list query cache (`queryClient`); failure retains user input and displays field error details.
  - 404 NOT_FOUND handling: renders identical "Project not found" screen with link back to `/projects` for both missing and other users' private projects.
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
