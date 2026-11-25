from __future__ import annotations

import ast
from dataclasses import dataclass

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.llm import ProviderId, validate_model_id
from app.modules.experiments.schemas import ExperimentConfigInput, ModelTargetInput
from app.modules.prompts.models import StrategyCode

MAX_PLANNED_RUNS = 1000
_STRATEGY_ORDER = {code: idx for idx, code in enumerate(StrategyCode)}


@dataclass(frozen=True)
class ExtractedFunction:
    name: str
    line: int
    signature: str
    docstring: str
    code: str


@dataclass(frozen=True)
class NormalizedExperimentConfig:
    config: ExperimentConfigInput
    function_names: list[str]
    models: list[ModelTargetInput]
    strategies: list[StrategyCode]
    run_count: int


def extract_ast_function_map(source_code: str) -> dict[str, ExtractedFunction]:
    """Statically parse top-level functions without executing untrusted code."""
    try:
        tree = ast.parse(source_code)
    except SyntaxError as exc:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            f"Invalid Python syntax at line {exc.lineno}",
            {"source": exc.msg or "SyntaxError"},
        ) from exc
    extracted: dict[str, ExtractedFunction] = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            args_str = ast.unparse(node.args)
            ret_str = f" -> {ast.unparse(node.returns)}" if node.returns is not None else ""
            signature = f"{node.name}({args_str}){ret_str}"
            segment = ast.get_source_segment(source_code, node) or ast.unparse(node)
            doc = ast.get_docstring(node) or ""
            extracted[node.name] = ExtractedFunction(
                name=node.name,
                line=node.lineno,
                signature=signature,
                docstring=doc,
                code=segment,
            )
    return extracted


def normalize_experiment_config(
    raw: ExperimentConfigInput,
    *,
    available_functions: dict[str, int],
) -> NormalizedExperimentConfig:
    if (raw.dataset_id is None) != (raw.dataset_revision is None):
        raise AppError(
            ErrorCode.INPUT_INVALID,
            "Both dataset_id and dataset_revision must be provided together",
            {"dataset_id": "Pair dataset_id with dataset_revision"},
        )
    if raw.dataset_id is None and raw.selected_rows is not None:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            "selected_rows requires dataset_id and dataset_revision",
            {"selected_rows": "Attach a dataset before selecting rows"},
        )

    dedup_functions: list[str] = []
    seen_fn: set[str] = set()
    for fn_raw in raw.function_names:
        fn = fn_raw.strip()
        if not fn:
            continue
        if fn not in available_functions:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                f"Function '{fn}' does not exist in selected Python source revision",
                {"function_names": f"Unknown function '{fn}'"},
            )
        if fn not in seen_fn:
            seen_fn.add(fn)
            dedup_functions.append(fn)

    if not dedup_functions:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            "Select at least one target Python function",
            {"function_names": "At least one valid function is required"},
        )

    dedup_models: list[ModelTargetInput] = []
    seen_models: set[tuple[ProviderId, str]] = set()
    for target in raw.models:
        model_id = validate_model_id(target.model)
        if target.provider == ProviderId.GEMINI and ("/" in model_id or ":" in model_id):
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Invalid Gemini model identifier",
                {"models": "Gemini model slugs cannot contain slashes or colons"},
            )
        key = (target.provider, model_id)
        if key not in seen_models:
            seen_models.add(key)
            dedup_models.append(ModelTargetInput(provider=target.provider, model=model_id))

    dedup_strategies = sorted(set(raw.strategies), key=lambda c: _STRATEGY_ORDER[c])

    dedup_rows: list[int] | None = None
    if raw.selected_rows is not None:
        dedup_rows = sorted(set(raw.selected_rows))
        if not dedup_rows or any(r <= 0 for r in dedup_rows):
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "selected_rows must contain at least one positive row number",
                {"selected_rows": "Select at least one valid CSV row"},
            )

    run_count = len(dedup_functions) * len(dedup_models) * len(dedup_strategies) * raw.repeats
    if run_count > MAX_PLANNED_RUNS:
        raise AppError(
            ErrorCode.EXPERIMENT_RUN_LIMIT,
            f"Planned run count ({run_count}) exceeds limit of {MAX_PLANNED_RUNS}",
            {"repeats": f"Maximum {MAX_PLANNED_RUNS} planned runs per experiment"},
        )

    normalized_input = ExperimentConfigInput(
        source_id=raw.source_id,
        source_revision=raw.source_revision,
        function_names=dedup_functions,
        dataset_id=raw.dataset_id,
        dataset_revision=raw.dataset_revision,
        selected_rows=dedup_rows,
        models=dedup_models,
        strategies=dedup_strategies,
        repeats=raw.repeats,
        parameters=raw.parameters,
    )
    return NormalizedExperimentConfig(
        config=normalized_input,
        function_names=dedup_functions,
        models=dedup_models,
        strategies=dedup_strategies,
        run_count=run_count,
    )
