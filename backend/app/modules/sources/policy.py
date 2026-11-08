"""Static source inspection for function selection, not a security sandbox."""

import ast
from dataclasses import dataclass

ALLOWED_IMPORTS = frozenset({"math", "cmath", "decimal", "fractions", "itertools", "statistics"})
UNSUPPORTED_CALLS = frozenset(
    {
        "eval",
        "exec",
        "compile",
        "open",
        "__import__",
        "input",
        "breakpoint",
        "globals",
        "locals",
        "vars",
        "getattr",
        "setattr",
        "delattr",
    }
)


class SourcePolicyError(ValueError):
    pass


@dataclass(frozen=True)
class FunctionSummary:
    name: str
    line: int


def inspect_python(code: str) -> list[FunctionSummary]:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise SourcePolicyError(f"Invalid Python syntax at line {exc.lineno}: {exc.msg}") from exc

    functions: list[FunctionSummary] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            if node.decorator_list:
                raise SourcePolicyError(f"Decorators are unsupported at line {node.lineno}")
            functions.append(FunctionSummary(node.name, node.lineno))
        elif isinstance(node, ast.AsyncFunctionDef):
            raise SourcePolicyError(f"Async functions are unsupported at line {node.lineno}")
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            pass
        elif (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            pass  # Module docstring.
        else:
            raise SourcePolicyError(f"Top-level behavior is unsupported at line {node.lineno}")

    for item in ast.walk(tree):
        if isinstance(item, ast.AsyncFunctionDef):
            raise SourcePolicyError(f"Async functions are unsupported at line {item.lineno}")
        elif isinstance(item, ast.FunctionDef) and item.decorator_list:
            raise SourcePolicyError(f"Decorators are unsupported at line {item.lineno}")
        elif isinstance(item, ast.Import):
            for alias in item.names:
                if alias.name not in ALLOWED_IMPORTS:
                    raise SourcePolicyError(
                        f"Unsupported import '{alias.name}' at line {item.lineno}"
                    )
        elif isinstance(item, ast.ImportFrom):
            if any(alias.name == "*" for alias in item.names):
                raise SourcePolicyError(f"Wildcard import is unsupported at line {item.lineno}")
            if item.level or item.module not in ALLOWED_IMPORTS:
                raise SourcePolicyError(f"Unsupported import '{item.module}' at line {item.lineno}")
        elif isinstance(item, ast.Call) and isinstance(item.func, ast.Name):
            if item.func.id in UNSUPPORTED_CALLS:
                raise SourcePolicyError(f"Unsupported call '{item.func.id}' at line {item.lineno}")
        elif isinstance(item, (ast.Yield, ast.YieldFrom, ast.Await)):
            raise SourcePolicyError(f"Unsupported behavior at line {item.lineno}")

    if not functions:
        raise SourcePolicyError("No selectable functions found")
    return functions
