import subprocess
import sys
from pathlib import Path


def test_placeholder_runner_fails_closed():
    runner = Path(__file__).parents[1] / "runner" / "main.py"
    output = subprocess.run([sys.executable, str(runner)], capture_output=True, text=True, check=False)
    assert output.returncode != 0
    assert "disabled" in output.stderr.lower()
