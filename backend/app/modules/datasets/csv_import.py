"""Read CSV bytes and map headers without evaluating any cell contents."""

import csv
import io
import json
from dataclasses import dataclass

from app.core.exceptions import AppError, ErrorCode
from app.modules.datasets.constants import CANONICAL_FIELDS, MAX_REQUEST_BYTES, MAX_ROWS

MAX_COLUMNS = 256
PREVIEW_ROWS = 20
# Set once, rather than changing csv's process-wide limit during concurrent requests.
csv.field_size_limit(MAX_REQUEST_BYTES)


@dataclass
class CsvRow:
    row_number: int
    values: list[str]


@dataclass
class ParsedCsv:
    headers: list[str]
    delimiter: str
    rows: list[CsvRow]


def _schema(message: str, field: str) -> AppError:
    return AppError(ErrorCode.CSV_SCHEMA, message, {field: message})


def _detect_delimiter(text: str) -> str:
    # Only separators outside quoted header cells count. Parsing the header twice
    # with different delimiters would misread quotes following the other separator.
    candidates: set[str] = set()
    quoted, field_start = False, True
    index = 0
    while index < len(text):
        char = text[index]
        if quoted:
            if char == '"':
                if index + 1 < len(text) and text[index + 1] == '"':
                    index += 2
                    continue
                quoted = False
        elif char in "\r\n":
            break
        elif char in {",", ";"}:
            candidates.add(char)
            field_start = True
        elif char == '"' and field_start:
            quoted, field_start = True, False
        else:
            field_start = False
        index += 1
    if len(candidates) > 1:
        raise _schema("Ambiguous CSV delimiter; choose comma or semicolon", "delimiter")
    return next(iter(candidates), ",")


def parse_csv(data: bytes, delimiter: str | None = None) -> ParsedCsv:
    if not data or len(data) > MAX_REQUEST_BYTES:
        raise _schema(f"CSV size must be 1 to {MAX_REQUEST_BYTES} bytes", "file")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise _schema("CSV must use UTF-8 encoding (BOM is supported)", "file") from exc
    if "\x00" in text:
        raise _schema("CSV must not contain NUL characters", "file")
    if delimiter is not None and delimiter not in {",", ";"}:
        raise _schema("Delimiter must be comma or semicolon", "delimiter")
    delimiter = delimiter or _detect_delimiter(text)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
    try:
        headers = [value.strip() for value in next(reader)]
    except StopIteration as exc:
        raise _schema("CSV must contain a header and data rows", "file") from exc
    except csv.Error as exc:
        raise _schema("Malformed CSV header", "headers") from exc
    if not headers or any(not header for header in headers):
        raise _schema("CSV headers must not be blank", "headers")
    if len(headers) > MAX_COLUMNS:
        raise _schema(f"CSV must contain at most {MAX_COLUMNS} columns", "headers")
    if len(headers) != len(set(headers)):
        raise _schema("CSV headers must be unique after trimming whitespace", "headers")

    rows: list[CsvRow] = []
    while True:
        number = reader.line_num + 1
        try:
            values = next(reader)
        except StopIteration:
            break
        except csv.Error as exc:
            raise _schema("Malformed CSV row", f"rows.{number}") from exc
        if not values:  # Empty physical lines do not become tasks.
            continue
        if len(values) != len(headers):
            raise _schema(
                f"CSV row must contain {len(headers)} columns", f"rows.{number}"
            )
        if len(rows) >= MAX_ROWS:
            raise _schema(f"CSV must contain at most {MAX_ROWS} rows", "rows")
        rows.append(CsvRow(number, values))
    if not rows:
        raise _schema("CSV must contain at least one data row", "rows")
    return ParsedCsv(headers, delimiter, rows)


def decode_mapping(value: str | None) -> dict:
    """Decode the query parameter, rejecting duplicate canonical keys as well."""
    def unique_pairs(pairs):
        result = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("Duplicate mapping key")
            result[key] = item
        return result

    try:
        mapping = json.loads(value, object_pairs_hook=unique_pairs) if value is not None else None
    except (ValueError, RecursionError) as exc:
        raise _schema("Mapping must be a JSON object with unique fields", "mapping") from exc
    if not isinstance(mapping, dict):
        raise _schema("Mapping must be a JSON object", "mapping")
    return mapping


def map_rows(parsed: ParsedCsv, mapping: dict) -> list[dict]:
    fields = {}
    if "function_name" not in mapping:
        fields["mapping.function_name"] = "Choose a CSV header for function_name"
    for target, header in mapping.items():
        if target not in CANONICAL_FIELDS:
            fields["mapping"] = "Unknown canonical field"
        elif not isinstance(header, str) or header not in parsed.headers:
            fields[f"mapping.{target}"] = "Choose an existing CSV header"
    if fields:
        raise AppError(ErrorCode.CSV_SCHEMA, "Invalid column mapping", fields)
    indices = {target: parsed.headers.index(header) for target, header in mapping.items()}
    rows: list[dict] = []
    for row in parsed.rows:
        canonical: dict = {"row_number": row.row_number}
        for target, index in indices.items():
            value = row.values[index]
            if target == "function_name" or value.strip():
                canonical[target] = value
        rows.append(canonical)
    return rows
