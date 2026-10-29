"""Static smoke check; does not start containers or execute user code."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
required = ["frontend/package.json", "backend/app/main.py", "compose.yaml", "sandbox/runner/main.py", "AGENTS.md"]
for name in required:
    assert (ROOT / name).is_file(), name
assert "- /var/run/docker.sock:" not in (ROOT / "compose.yaml").read_text(), "Docker socket mount is prohibited"
print("Static scaffold file checks: OK")
