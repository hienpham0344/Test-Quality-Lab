"""Lab 3: 28 Lab 2 validation cases and one backend audit regression.

Run the Lab 3 cases only:
    PYTHONPATH=backend backend/.venv/bin/python -m pytest -q Lab3_AuthService_Automation.py

Run the backend suite and these cases, with JUnit and branch coverage:
    PYTHONPATH=backend backend/.venv/bin/python Lab3_AuthService_Automation.py \
        --output-dir outputs/backend-labs

The full run excludes tests marked ``live`` because they require isolated external
services. No application configuration, database or authentication policy changes.
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

import pytest
from starlette.responses import JSONResponse

from app.core.exceptions import AppError, ErrorCode
from app.modules.auth.validation import normalize_email, validate_password
from app.modules.datasets.service import validate_rows


@pytest.mark.parametrize(
    "email,expected,error_type",
    [
        pytest.param("User@Example.COM", "user@example.com", None, id="EM-01"),
        pytest.param("\t USER@Example.com \n", "user@example.com", None, id="EM-02"),
        pytest.param(
            "First.Last+tag@Sub.Example.COM",
            "first.last+tag@sub.example.com",
            None,
            id="EM-03",
        ),
        pytest.param("a@b.c", "a@b.c", None, id="EM-04"),
        pytest.param("a" * 315 + "@b.c", "a" * 315 + "@b.c", None, id="EM-05"),
        pytest.param("a" * 316 + "@b.c", "a" * 316 + "@b.c", None, id="EM-06"),
        pytest.param("a" * 317 + "@b.c", None, AppError, id="EM-07"),
        pytest.param("\t" + "a" * 316 + "@b.c" + "\n", "a" * 316 + "@b.c", None, id="EM-08"),
        pytest.param("", None, AppError, id="EM-09"),
        pytest.param(" \t\n ", None, AppError, id="EM-10"),
        pytest.param("user.example.com", None, AppError, id="EM-11"),
        pytest.param("u@example", None, AppError, id="EM-12"),
        pytest.param("u@@example.com", None, AppError, id="EM-13"),
        pytest.param("u s@example.com", None, AppError, id="EM-14"),
        pytest.param(None, None, AttributeError, id="EM-15"),
    ],
)
def test_normalize_email_lab3(email, expected, error_type):
    if error_type is None:
        assert normalize_email(email) == expected
        return
    with pytest.raises(error_type) as caught:
        normalize_email(email)
    assert type(caught.value) is error_type
    if error_type is AppError:
        assert caught.value.code == ErrorCode.AUTH_INVALID_INPUT
        assert str(caught.value) == "Invalid input"
        assert caught.value.fields == {"email": "Enter a valid email address"}


@pytest.mark.parametrize(
    "password,field,error_type",
    [
        pytest.param("StrongPass123!", "password", None, id="PW-01"),
        pytest.param("abcdefghijk", "password", AppError, id="PW-02"),
        pytest.param("abcdefghijkl", "password", None, id="PW-03"),
        pytest.param("abcdefghijklm", "password", None, id="PW-04"),
        pytest.param("p" * 1023, "password", None, id="PW-05"),
        pytest.param("p" * 1024, "password", None, id="PW-06"),
        pytest.param("p" * 1025, "password", AppError, id="PW-07"),
        pytest.param("", "password", AppError, id="PW-08"),
        pytest.param(" " * 20, "password", None, id="PW-09"),
        pytest.param("é" * 20, "password", None, id="PW-10"),
        pytest.param(None, "password", TypeError, id="PW-11"),
        pytest.param(123456789012, "password", TypeError, id="PW-12"),
        pytest.param("abcdefghijk", "new_password", AppError, id="PW-13"),
    ],
)
def test_password_lab3(password, field, error_type):
    if error_type is None:
        assert validate_password(password, field=field) is None
        return
    with pytest.raises(error_type) as caught:
        validate_password(password, field=field)
    assert type(caught.value) is error_type
    if error_type is AppError:
        assert caught.value.code == ErrorCode.AUTH_INVALID_INPUT
        assert str(caught.value) == "Invalid input"
        assert caught.value.fields == {field: "Password must contain 12 to 1024 characters"}


def test_dataset_json_surrogate_is_rejected_before_serialization():
    """AUD-CSV-01: invalid Unicode in nested JSON must remain a row-level error."""
    rows = validate_rows([{
        "row_number": 2,
        "function_name": "f",
        "python_source": "def f(): return 0",
        "expected_output": r'"\ud800"',
        "input_data": r'"\ud800"',
    }])
    assert rows[0]["status"] == "invalid", "Reject lone surrogate before HTTP serialization"
    JSONResponse(content=rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run backend tests and export Lab 3 evidence.")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/backend-labs"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    test_env = os.environ.copy()
    test_env["COVERAGE_FILE"] = str(output_dir / ".coverage")
    return subprocess.run([
        sys.executable, "-m", "pytest",
        "-c", str(root / "backend/pyproject.toml"),
        str(root / "backend/tests"), str(Path(__file__).resolve()),
        "-q", "-m", "not live", "--tb=short",
        f"--junitxml={output_dir / 'junit.xml'}",
        "--cov=app", "--cov-branch",
        f"--cov-report=json:{output_dir / 'coverage.json'}",
        f"--cov-report=xml:{output_dir / 'coverage.xml'}",
        "--cov-report=term",
    ], cwd=root, env=test_env, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
