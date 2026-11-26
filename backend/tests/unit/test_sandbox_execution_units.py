"""Sandbox policy, launcher gate, runner result parsing, safe logs and oracle rules (#45–#49).
No container is started and no generated code is executed by these tests."""

from __future__ import annotations

import subprocess

import pytest

from app.infrastructure.sandbox.launcher import (
    DisabledLauncher,
    DockerSandboxLauncher,
    LaunchRequest,
    SandboxDisabledError,
    get_launcher,
)
from app.infrastructure.sandbox.policy import SandboxPolicy, build_docker_run_args, pytest_command
from app.infrastructure.sandbox.results import (
    JUNIT_BEGIN,
    JUNIT_END,
    JUnitError,
    extract_junit,
    parse_junit_xml,
    reconcile_with_collected,
    sanitize_logs,
)
from app.modules.execution.oracle import ReferenceObservation, outputs_match, resolve_rows

NAME = "tql-exec-" + "a" * 32


# ------------------------------------------------------------------ #45/#46 policy and command

def test_docker_args_enforce_every_isolation_control():
    args = build_docker_run_args(SandboxPolicy(), image="tql-sandbox:reviewed", container_name=NAME,
                                 workspace_host_path="/srv/work/abc", command=pytest_command("test_generated.py"))
    joined = " ".join(args)
    for expected in ("--network none", "--user 65534:65534", "--read-only", "--cpus 1",
                     f"--memory {1024**3}", f"--memory-swap {1024**3}", "--pids-limit 128",
                     "--cap-drop ALL", "--security-opt no-new-privileges:true", "--ipc none", "--rm", "--init",
                     "type=bind,source=/srv/work/abc,target=/workspace,readonly"):
        assert expected in joined
    assert "noexec" in joined and "docker.sock" not in joined and "--privileged" not in joined
    env_values = [args[i + 1] for i, a in enumerate(args) if a == "--env"]
    assert all(not any(w in e.upper() for w in ("KEY", "TOKEN", "SECRET", "PASSWORD")) for e in env_values)
    command = pytest_command("test_generated.py")
    assert args[-(len(command) + 1):] == ["tql-sandbox:reviewed", *command]


@pytest.mark.parametrize("kwargs", [
    {"cpus": 2.0}, {"memory_bytes": 2 * 1024**3}, {"timeout_seconds": 61}, {"network": "bridge"},
    {"user": "0:0"}, {"user": "root"}, {"read_only_root": False}, {"drop_capabilities": ("NET_RAW",)},
    {"env": {"GROQ_API_KEY": "x"}}, {"env": {"DATABASE_URL": "postgres://"}},
])
def test_policy_refuses_weaker_limits(kwargs):
    with pytest.raises(ValueError):
        SandboxPolicy(**kwargs)


@pytest.mark.parametrize(("field", "value"), [
    ("container_name", "evil; rm -rf /"), ("image", "Bad Image"), ("workspace_host_path", "/a,b"),
])
def test_command_builder_rejects_unsafe_values(field, value):
    params = {"image": "tql-sandbox:reviewed", "container_name": NAME, "workspace_host_path": "/w", "command": []}
    params[field] = value
    with pytest.raises(ValueError):
        build_docker_run_args(SandboxPolicy(), **params)
    with pytest.raises(ValueError):
        pytest_command("../x.py")


def test_launcher_is_disabled_unless_flag_and_review_id_are_both_set():
    assert isinstance(get_launcher(enabled=False, security_review_id="SR-1", image="i"), DisabledLauncher)
    assert isinstance(get_launcher(enabled=True, security_review_id=None, image="i"), DisabledLauncher)
    assert isinstance(get_launcher(enabled=True, security_review_id="  ", image="i"), DisabledLauncher)
    assert isinstance(get_launcher(enabled=True, security_review_id="SR-1", image="i"), DockerSandboxLauncher)
    with pytest.raises(SandboxDisabledError):
        DisabledLauncher().run(LaunchRequest(NAME, "/w", []), lambda: False)


class FakeProc:
    def __init__(self, finish_after: int | None, returncode: int = 0, out: bytes = b"", err: bytes = b""):
        self.polls = 0
        self.finish_after = finish_after
        self.returncode = returncode
        self.out, self.err = out, err
        self.killed = False

    def poll(self):
        self.polls += 1
        if self.finish_after is not None and self.polls > self.finish_after:
            return self.returncode
        return None

    def kill(self):
        self.killed = True

    def communicate(self, timeout=None):
        return self.out, self.err


class FakeClock:
    def __init__(self, step: float):
        self.now, self.step = 0.0, step

    def __call__(self):
        self.now += self.step
        return self.now


def _launcher(proc: FakeProc, step: float, removed: list):
    def run_cmd(argv, **_):
        removed.append(argv)
        return subprocess.CompletedProcess(argv, 0)

    return DockerSandboxLauncher(SandboxPolicy(), image="tql-sandbox:reviewed", poll_seconds=0,
                                 popen=lambda *a, **k: proc, run_cmd=run_cmd, clock=FakeClock(step))


def test_docker_launcher_collects_output_and_caps_logs():
    proc = FakeProc(finish_after=1, returncode=1, out=b"x" * (2 * 1024 * 1024), err=b"boom")
    removed: list = []
    result = _launcher(proc, 0.1, removed).run(LaunchRequest(NAME, "/w", []), lambda: False)
    assert result.exit_code == 1 and not result.timed_out and not result.cancelled
    assert len(result.stdout) == 1024 * 1024 and result.stderr == "boom"
    assert removed == []


def test_docker_launcher_kills_and_removes_container_on_timeout():
    proc = FakeProc(finish_after=None)
    removed: list = []
    result = _launcher(proc, 30.0, removed).run(LaunchRequest(NAME, "/w", []), lambda: False)
    assert result.timed_out and result.exit_code is None and proc.killed
    assert removed == [["docker", "rm", "-f", NAME]]


def test_docker_launcher_stops_on_cancel():
    proc = FakeProc(finish_after=None)
    removed: list = []
    result = _launcher(proc, 0.1, removed).run(LaunchRequest(NAME, "/w", []), lambda: True)
    assert result.cancelled and proc.killed and removed


# ------------------------------------------------------------------ #47 results, #49 logs

JUNIT = """<?xml version="1.0" encoding="utf-8"?>
<testsuites><testsuite name="pytest" tests="4">
<testcase classname="test_generated" name="test_ok" time="0.012"/>
<testcase classname="test_generated" name="test_bad" time="0.020"><failure message="assert 1 == 2">E   assert 1 == 2</failure></testcase>
<testcase classname="test_generated" name="test_err" time="0.001"><error message="fixture missing"/></testcase>
<testcase classname="test_generated" name="test_skip" time="0"><skipped message="needs data"/></testcase>
</testsuite></testsuites>"""


def test_parse_junit_records_each_status_from_runner_evidence():
    stdout = f"collected 4 items\n{JUNIT_BEGIN}\n{JUNIT}\n{JUNIT_END}\n"
    suite = parse_junit_xml(extract_junit(stdout))
    assert [c["status"] for c in suite.cases] == ["PASSED", "FAILED", "ERROR", "SKIPPED"]
    assert suite.counts() == {"PASSED": 1, "FAILED": 1, "ERROR": 1, "SKIPPED": 1, "TIMEOUT": 0}
    assert suite.cases[0]["duration_ms"] == 12 and suite.cases[1]["traceback"].startswith("assert 1 == 2")
    reconcile_with_collected(suite, ["a", "b", "c", "d"])
    assert suite.problem is None
    reconcile_with_collected(suite, ["a"])
    assert "collected" in suite.problem


@pytest.mark.parametrize("xml", [
    '<!DOCTYPE x [<!ENTITY a "aaaa">]><testsuite><testcase name="t"/></testsuite>',
    "<testsuite><testcase",
    "<testsuite>" + "<testcase name='t'/>" * 200_000 + "</testsuite>",
])
def test_parse_junit_rejects_unsafe_or_broken_reports(xml):
    with pytest.raises(JUnitError):
        parse_junit_xml(xml)


def test_extract_junit_absent_returns_none():
    assert extract_junit("no markers here") is None


def test_logs_are_redacted_masked_and_capped():
    secret = "gsk_live_super_secret_value_123456"
    logs = sanitize_logs(f"PASSED test_ok\n/srv/work/abc/test_generated.py:3\x07\nkey={secret}\n", "Traceback Error",
                         host_paths=["/srv/work/abc"], secrets=[secret])
    text = str(logs)
    assert secret not in text and "/srv/work/abc" not in text and "\x07" not in text
    assert "/workspace/test_generated.py:3" in text
    assert logs[0]["level"] == "PASS" and logs[-1] == {"stream": "stderr", "level": "FAIL", "message": "Traceback Error"}
    capped = sanitize_logs("y" * 100 + "\n" + "z" * 100, "", limit_bytes=150)
    assert capped[-1]["message"] == "[log truncated at 1 MiB]" and len(capped) == 2


# ------------------------------------------------------------------ #48 oracle

ROWS = [
    {"row_number": 2, "task_id": "t1", "function_name": "divide", "input_data": "[6, 2]", "expected_output": "3.0"},
    {"row_number": 3, "task_id": "t2", "function_name": "divide", "input_data": "[1, 4]", "expected_output": "9"},
    {"row_number": 4, "task_id": "t3", "function_name": "divide", "input_data": "[1, 0]", "expected_output": "0"},
    {"row_number": 5, "task_id": "t4", "function_name": "divide", "input_data": "[8, 2]", "expected_output": ""},
    {"row_number": 6, "task_id": "t5", "function_name": "divide", "input_data": "[9, 3]", "expected_output": None},
]


def _resolve(references):
    return resolve_rows(ROWS, references=references, dataset_id="ds", dataset_revision=3,
                        dataset_sha256="d" * 64, reference_source_sha256="s" * 64)


def test_oracle_with_reference_run_verifies_quarantines_and_labels():
    result = _resolve({
        2: ReferenceObservation(output="3"),             # 3.0 == 3 -> verified
        3: ReferenceObservation(output="0.25"),          # conflicts with 9 -> quarantined
        4: ReferenceObservation(error="ZeroDivisionError"),  # reference failed -> quarantined
        5: ReferenceObservation(output="4.0"),           # no expected -> reference-observed
    })
    by_row = {r["row_number"]: r for r in result["rows"]}
    assert by_row[2]["source"] == "DATASET_VERIFIED" and by_row[2]["verified"] and by_row[2]["is_ground_truth"]
    assert by_row[3]["source"] == "QUARANTINED" and by_row[3]["expected_output"] is None and not by_row[3]["usable"]
    assert by_row[4]["source"] == "QUARANTINED"
    assert by_row[5]["source"] == "REFERENCE_OBSERVED" and by_row[5]["is_ground_truth"] is False
    assert by_row[5]["expected_output"] == "4.0" and by_row[5]["usable"]
    assert by_row[6]["source"] == "UNAVAILABLE" and "ORACLE_UNAVAILABLE" in by_row[6]["reason"]
    assert by_row[2]["provenance"] == {"expected_from": None, "dataset_id": "ds", "dataset_revision": 3, "dataset_sha256": "d" * 64,
                                       "row_number": 2, "reference_source_sha256": "s" * 64}
    assert result["summary"]["QUARANTINED"] == 2 and result["reference_run"] is True


def test_oracle_without_reference_run_never_invents_expected_values():
    result = _resolve(None)
    sources = [r["source"] for r in result["rows"]]
    assert sources == ["DATASET_UNVERIFIED"] * 3 + ["UNAVAILABLE"] * 2
    assert all(not r["verified"] for r in result["rows"])
    assert result["reference_run"] is False


@pytest.mark.parametrize(("a", "b", "same"), [
    ("3", "3.0", True), ("0.1 + 0.2", "0.30000000000000004", False), ("0.30000000000000004", "0.3", True),
    ("'3'", "3", False), ("[1, 2]", "[1, 2]", True), ("True", "1", False), ("hello", "hello", True),
])
def test_outputs_match(a, b, same):
    assert outputs_match(a, b) is same
