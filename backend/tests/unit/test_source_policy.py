import pytest

from app.modules.sources.policy import SourcePolicyError, inspect_python


def test_discovers_top_level_functions_without_running_code():
    result = inspect_python("import math\n\ndef area(r):\n    return math.pi * r * r\n")
    assert [(item.name, item.line) for item in result] == [("area", 3)]


@pytest.mark.parametrize(
    "code,reason",
    [
        ("def broken(:\n", "syntax"),
        ("import os\ndef f(): pass\n", "Unsupported import"),
        ("from math import *\ndef f(): pass\n", "Wildcard import"),
        ("def f():\n    return eval('1')\n", "Unsupported call"),
        ("@decorator\ndef f(): pass\n", "Decorators"),
        ("async def f(): pass\n", "Async"),
        ("def f():\n    async def helper(): pass\n", "Async"),
        ("def f():\n    @decorate\n    def helper(): pass\n", "Decorators"),
        ("print('side effect')\ndef f(): pass\n", "Top-level"),
        ("import math\n", "No selectable functions"),
    ],
)
def test_rejects_unsupported_source_with_reason(code, reason):
    with pytest.raises(SourcePolicyError, match=reason):
        inspect_python(code)
