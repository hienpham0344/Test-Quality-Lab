import pytest

from app.core.exceptions import AppError, ErrorCode
from app.modules.prompts.renderer import (
    ALLOWED_PROMPT_VARIABLES,
    SafePromptRenderer,
    compute_template_sha256,
    extract_template_variables,
)


def test_extract_and_render_allowed_variables_deterministically() -> None:
    assert "function_name" in ALLOWED_PROMPT_VARIABLES
    assert "csv_cases" in ALLOWED_PROMPT_VARIABLES

    sys_tpl = "Target function: {function_name}\r\n"
    usr_tpl = "Inspect signature {function_signature}\r\nCode:\n{function_code}"
    variables = extract_template_variables(sys_tpl, usr_tpl)
    assert variables == ["function_code", "function_name", "function_signature"]

    tpl_hash = compute_template_sha256("L1", sys_tpl, usr_tpl)
    rendered = SafePromptRenderer.render(
        strategy="L1",
        version=1,
        template_sha256=tpl_hash,
        system_template=sys_tpl,
        user_template=usr_tpl,
        required_variables=variables,
        context={
            "function_name": "add",
            "function_signature": "add(a: int, b: int) -> int",
            "function_code": "def add(a: int, b: int) -> int:\r\n    return a + b",
        },
    )

    assert rendered.rendered_system == "Target function: add\n"
    assert "\r" not in rendered.rendered_user
    assert "def add(a: int, b: int) -> int:\n    return a + b" in rendered.rendered_user
    assert len(rendered.rendered_sha256) == 64


@pytest.mark.parametrize(
    "malicious_template",
    [
        "Leak class: {function_code.__class__}",
        "Leak item: {csv_cases[0]}",
        "Unknown var: {secret_env}",
        "Positional: {}",
        "Format spec not allowed: {function_name!r}",
    ],
)
def test_renderer_blocks_traversal_unknown_fields_and_conversions(malicious_template: str) -> None:
    with pytest.raises(AppError) as exc_info:
        extract_template_variables(None, malicious_template)
    assert exc_info.value.code == ErrorCode.INPUT_INVALID


def test_renderer_rejects_missing_required_variable() -> None:
    usr_tpl = "Generate tests for {function_name}:\n{function_code}"
    with pytest.raises(AppError) as exc_info:
        SafePromptRenderer.render(
            strategy="L2",
            version=1,
            template_sha256="a" * 64,
            system_template=None,
            user_template=usr_tpl,
            required_variables=["function_code", "function_name"],
            context={"function_name": "divide"},
        )
    assert exc_info.value.code == ErrorCode.INPUT_INVALID
    assert "function_code" in exc_info.value.fields


@pytest.mark.parametrize(
    "direct_bad_template",
    [
        "Direct traversal: {function_code.__class__}",
        "Direct unknown: {secret_env}",
        "Direct conversion: {function_name!r}",
        "Malformed brace: {function_name",
    ],
)
def test_render_directly_revalidates_templates_against_bypass(direct_bad_template: str) -> None:
    with pytest.raises(AppError) as exc_info:
        SafePromptRenderer.render(
            strategy="L1",
            version=1,
            template_sha256="a" * 64,
            system_template=None,
            user_template=direct_bad_template,
            required_variables=[],
            context={"function_name": "add", "function_code": "def add(): pass", "secret_env": "x"},
        )
    assert exc_info.value.code == ErrorCode.INPUT_INVALID
