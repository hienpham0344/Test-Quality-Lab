# Conventions

Python: Ruff, mypy, pytest, snake_case, typed public interfaces.
TypeScript: strict TS, feature-local components, no private API key in client.
Backend dependencies: router -> service -> repository; avoid route-to-DB shortcuts.
Keep module interfaces small; no speculative abstractions or large empty trees.
