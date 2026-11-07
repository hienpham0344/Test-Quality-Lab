# Trusted worker
Consumes Celery tasks. Does not run Python supplied by users or LLMs and never
has access to `/var/run/docker.sock`. Jobs: `system.ping`, `auth.request_link` (email links) and
`auth.cleanup_expired` (daily, run by `beat`).
The sandbox launcher requires an independently reviewed privileged boundary.
