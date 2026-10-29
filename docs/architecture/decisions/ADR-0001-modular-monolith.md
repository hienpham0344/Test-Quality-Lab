# ADR-0001 — Modular monolith

Status: Accepted (application scaffold)

Use FastAPI with domain modules and shared infrastructure adapters, React
feature modules, PostgreSQL and Celery/Redis. Keep a separate sandbox image.
Reason: four-person team (two frontend, two backend), clear feature ownership,
minimal distributed operational complexity. Reassess only with measured needs.
