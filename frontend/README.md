# Frontend

React with JavaScript / JSX, Vite, React Router, TanStack Query and Tailwind CSS.

## Structure

- `src/main.jsx`: application bootstrap and providers.
- `src/App.jsx` and `src/routes/`: application routes.
- `src/features/`: page components grouped by feature.
- `src/components/<page>/`: components and assets used by a page, such as `login/` and `home/`.
- `src/components/auth/`: layouts and guards shared by authentication pages.
- `src/components/common/`: reusable UI components.
- `src/components/layout/`: shared header, footer and route layout.
- `src/services/api.js`: shared API implementation.
- `src/lib/api.js`: compatibility exports for existing consumers; do not duplicate API logic here.
- `src/hooks/`: shared hooks, including API health state.
- `src/config/`: public application configuration. Never place secrets here.
- `src/styles/`: global styles.
- `tests/`: page and flow tests grouped by feature.

The `@/` alias resolves to `src/` in Vite and editor configuration.

## Checks

```sh
npm ci
npm run lint
npm test -- --run
npm run build
```

The frontend no longer runs TypeScript type checking. ESLint checks JS/JSX;
Vitest covers behavior; Vite verifies production bundling. TypeScript remains
an ESLint parser dependency, not the application language.

The home route uses `MainLayout`. Existing `/verify-email` and `/reset-password`
routes retain their standalone screens and one-time fragment-token behavior.
Protected project routes under `/projects` and `/projects/:projectId` support owner-scoped project creation, listing, editing, loading/empty/error states, and revision history.
