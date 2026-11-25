from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from string import Formatter

from app.core.exceptions import AppError, ErrorCode

ALLOWED_PROMPT_VARIABLES: frozenset[str] = frozenset(
    {
        "function_name",
        "function_signature",
        "function_code",
        "module_code",
        "csv_cases",
        "docstring",
    }
)

_SIMPLE_IDENT_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_FORMATTER = Formatter()


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _scan_single_template(template: str, field_label: str) -> set[str]:
    found: set[str] = set()
    try:
        parsed = list(_FORMATTER.parse(template))
    except ValueError as exc:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            f"Malformed placeholder syntax in {field_label}",
            {field_label: str(exc)},
        ) from exc

    for _, field_name, format_spec, conversion in parsed:
        if field_name is None:
            continue
        if conversion is not None or format_spec:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Prompt placeholders cannot use conversions or format specifiers",
                {field_label: f"Disallowed placeholder formatting on {field_name!r}"},
            )
        if not _SIMPLE_IDENT_RE.match(field_name):
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Prompt placeholder traversal is forbidden",
                {field_label: f"Invalid placeholder identifier {field_name!r}"},
            )
        if field_name not in ALLOWED_PROMPT_VARIABLES:
            allowed_csv = ", ".join(sorted(ALLOWED_PROMPT_VARIABLES))
            raise AppError(
                ErrorCode.INPUT_INVALID,
                f"Unknown prompt placeholder '{field_name}'",
                {field_label: f"Allowed placeholders: {allowed_csv}"},
            )
        found.add(field_name)
    return found


def extract_template_variables(system_template: str | None, user_template: str) -> list[str]:
    cleaned_user = normalize_newlines(user_template).strip()
    if not cleaned_user:
        raise AppError(
            ErrorCode.INPUT_INVALID,
            "User prompt template cannot be empty",
            {"user_template": "Required"},
        )
    vars_found = _scan_single_template(cleaned_user, "user_template")
    if system_template is not None and system_template.strip():
        vars_found |= _scan_single_template(normalize_newlines(system_template), "system_template")
    return sorted(vars_found)


def compute_template_sha256(
    strategy: str, system_template: str | None, user_template: str
) -> str:
    canonical = json.dumps(
        {
            "strategy": strategy,
            "system_template": normalize_newlines(system_template) if system_template is not None else None,
            "user_template": normalize_newlines(user_template),
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _render_exact(template: str, normalized_ctx: dict[str, str]) -> str:
    pieces: list[str] = []
    for literal_text, field_name, _, _ in _FORMATTER.parse(template):
        pieces.append(literal_text)
        if field_name is not None:
            pieces.append(normalized_ctx[field_name])
    return "".join(pieces)


@dataclass(frozen=True)
class RenderedPrompt:
    strategy: str
    version: int
    template_sha256: str
    rendered_system: str | None
    rendered_user: str
    rendered_sha256: str


class SafePromptRenderer:
    """Deterministic template substitution blocking traversal and missing variables."""

    @staticmethod
    def render(
        *,
        strategy: str,
        version: int,
        template_sha256: str,
        system_template: str | None,
        user_template: str,
        required_variables: list[str],
        context: dict[str, str],
    ) -> RenderedPrompt:
        scanned_vars = extract_template_variables(system_template, user_template)
        effective_required = sorted(set(required_variables) | set(scanned_vars))
        missing = [var for var in effective_required if var not in context]
        if missing:
            raise AppError(
                ErrorCode.INPUT_INVALID,
                "Missing required prompt context variables",
                {name: "Required by prompt template" for name in missing},
            )
        normalized_ctx = {k: normalize_newlines(str(v)) for k, v in context.items()}
        norm_user = normalize_newlines(user_template)
        rendered_user = _render_exact(norm_user, normalized_ctx)

        rendered_system: str | None = None
        if system_template is not None:
            norm_sys = normalize_newlines(system_template)
            rendered_system = _render_exact(norm_sys, normalized_ctx)

        canonical_rendered = json.dumps(
            {
                "strategy": strategy,
                "version": version,
                "template_sha256": template_sha256,
                "rendered_system": rendered_system,
                "rendered_user": rendered_user,
            },
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
        rendered_sha = hashlib.sha256(canonical_rendered.encode("utf-8")).hexdigest()
        return RenderedPrompt(
            strategy=strategy,
            version=version,
            template_sha256=template_sha256,
            rendered_system=rendered_system,
            rendered_user=rendered_user,
            rendered_sha256=rendered_sha,
        )
