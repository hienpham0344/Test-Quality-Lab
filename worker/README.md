# Trusted worker
Consumes Celery tasks. Does not run Python supplied by users or LLMs and never
has access to `/var/run/docker.sock`. Only the harmless `system.ping` job exists.
The sandbox launcher requires an independently reviewed privileged boundary.
