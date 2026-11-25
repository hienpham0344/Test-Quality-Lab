import uuid

import pytest

from app.core.exceptions import AppError, ErrorCode
from app.infrastructure.llm import GenerationParameters, ProviderId
from app.modules.experiments.schemas import ExperimentConfigInput, ModelTargetInput
from app.modules.experiments.validation import (
    MAX_PLANNED_RUNS,
    extract_ast_function_map,
    normalize_experiment_config,
)
from app.modules.prompts.models import StrategyCode


def test_normalize_experiment_config_deduplicates_and_computes_run_count() -> None:
    src_id = uuid.uuid4()
    raw = ExperimentConfigInput(
        source_id=src_id,
        source_revision=1,
        function_names=["sub", "add", "sub"],
        models=[
            ModelTargetInput(provider=ProviderId.GROQ, model="llama-3.3-70b-versatile"),
            ModelTargetInput(provider=ProviderId.GROQ, model="llama-3.3-70b-versatile"),
            ModelTargetInput(provider=ProviderId.GEMINI, model="gemini-2.5-flash"),
        ],
        strategies=[StrategyCode.L3, StrategyCode.L1, StrategyCode.L3],
        repeats=3,
        parameters=GenerationParameters(temperature=0.2, max_tokens=1024, top_p=0.9),
    )

    normalized = normalize_experiment_config(raw, available_functions={"add": 1, "sub": 5})
    assert normalized.function_names == ["sub", "add"]
    assert len(normalized.models) == 2
    assert normalized.strategies == [StrategyCode.L1, StrategyCode.L3]
    assert normalized.run_count == 2 * 2 * 2 * 3


def test_normalize_experiment_config_enforces_1000_run_ceiling() -> None:
    assert MAX_PLANNED_RUNS == 1000
    raw = ExperimentConfigInput(
        source_id=uuid.uuid4(),
        source_revision=1,
        function_names=["f1", "f2"],
        models=[
            ModelTargetInput(provider=ProviderId.GROQ, model="llama-3.3-70b-versatile"),
            ModelTargetInput(provider=ProviderId.OPENROUTER, model="openai/gpt-4o-mini"),
        ],
        strategies=[StrategyCode.L1, StrategyCode.L2, StrategyCode.L3],
        repeats=100,  # 2 * 2 * 3 * 100 = 1200 > 1000
    )

    with pytest.raises(AppError) as exc_info:
        normalize_experiment_config(raw, available_functions={"f1": 1, "f2": 4})
    assert exc_info.value.code == ErrorCode.EXPERIMENT_RUN_LIMIT


def test_partial_dataset_reference_or_unknown_function_is_rejected() -> None:
    with pytest.raises(AppError) as partial_ds:
        normalize_experiment_config(
            ExperimentConfigInput(
                source_id=uuid.uuid4(),
                source_revision=1,
                function_names=["add"],
                dataset_id=uuid.uuid4(),
                dataset_revision=None,
                models=[ModelTargetInput(provider=ProviderId.GROQ, model="llama-3.3-70b-versatile")],
                strategies=[StrategyCode.L1],
                repeats=1,
            ),
            available_functions={"add": 1},
        )
    assert partial_ds.value.code == ErrorCode.INPUT_INVALID

    with pytest.raises(AppError) as missing_fn:
        normalize_experiment_config(
            ExperimentConfigInput(
                source_id=uuid.uuid4(),
                source_revision=1,
                function_names=["missing_fn"],
                models=[ModelTargetInput(provider=ProviderId.GROQ, model="llama-3.3-70b-versatile")],
                strategies=[StrategyCode.L1],
                repeats=1,
            ),
            available_functions={"add": 1},
        )
    assert missing_fn.value.code == ErrorCode.INPUT_INVALID


def test_extract_ast_function_map_captures_signature_docstring_and_code() -> None:
    code = (
        '"""Math helpers."""\n\n'
        "def add(a: int, b: int) -> int:\n"
        '    """Add two integers."""\n'
        "    return a + b\n"
    )
    extracted = extract_ast_function_map(code)
    assert "add" in extracted
    fn = extracted["add"]
    assert fn.line == 3
    assert fn.signature == "add(a: int, b: int) -> int"
    assert fn.docstring == "Add two integers."
    assert "return a + b" in fn.code


def test_extract_ast_function_map_supports_async_and_wraps_syntax_errors() -> None:
    async_code = "async def fetch_value(x: int) -> int:\n    return x\n"
    extracted = extract_ast_function_map(async_code)
    assert "fetch_value" in extracted
    assert extracted["fetch_value"].signature == "fetch_value(x: int) -> int"

    with pytest.raises(AppError) as bad_syntax:
        extract_ast_function_map("def broken(:\n    pass")
    assert bad_syntax.value.code == ErrorCode.INPUT_INVALID
