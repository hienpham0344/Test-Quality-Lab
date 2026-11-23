import pytest

from app.core.exceptions import AppError, ErrorCode
from app.modules.datasets.csv_import import decode_mapping, map_rows, parse_csv


@pytest.mark.parametrize("delimiter", [",", ";"])
@pytest.mark.parametrize("bom", [b"", b"\xef\xbb\xbf"])
def test_utf8_bom_and_supported_delimiters(delimiter, bom):
    data = f" name {delimiter}note\r\nsquare{delimiter}Tiếng Việt\r\n".encode()
    parsed = parse_csv(bom + data)
    assert parsed.headers == ["name", "note"]
    assert parsed.delimiter == delimiter
    assert parsed.rows[0].values == ["square", "Tiếng Việt"]
    assert parsed.rows[0].row_number == 2


def test_quoted_delimiters_escaped_quotes_and_multiline_preserve_physical_lines():
    parsed = parse_csv(
        b'"name;alias",code,note\r\n'
        b'f,"def f():\r\n    return 0","comma, semicolon; and ""quotes"""\r\n'
        b'\r\ng,def g(): pass,ok\r\n'
    )
    assert parsed.delimiter == ","
    assert parsed.headers == ["name;alias", "code", "note"]
    assert [row.row_number for row in parsed.rows] == [2, 5]
    assert parsed.rows[0].values[1] == "def f():\r\n    return 0"
    assert parsed.rows[0].values[2] == 'comma, semicolon; and "quotes"'


def test_ambiguous_header_requires_explicit_delimiter():
    data = b"name,note;extra\nf,value;other\n"
    with pytest.raises(AppError) as error:
        parse_csv(data)
    assert "delimiter" in error.value.fields
    parsed = parse_csv(data, ",")
    assert parsed.headers == ["name", "note;extra"]


@pytest.mark.parametrize(("data", "delimiter"), [
    (b'name,"note;alias"\nf,value\n', ","),
    (b'name;"note,alias"\nf;value\n', ";"),
    (b'name;"note,""alias"""\nf;value\n', ";"),
])
def test_delimiter_in_later_quoted_header_is_ignored(data, delimiter):
    parsed = parse_csv(data)
    assert parsed.delimiter == delimiter
    assert len(parsed.headers) == 2


def test_single_column_csv_and_multiline_header():
    parsed = parse_csv(b'"function\nname"\nf\n\ng\n')
    assert parsed.headers == ["function\nname"]
    assert [row.row_number for row in parsed.rows] == [3, 5]


@pytest.mark.parametrize("data", [b"\xff", "name\nf\n".encode("utf-16"), b"name\nf\x00\n"])
def test_invalid_encoding_and_nul_are_rejected(data):
    with pytest.raises(AppError) as error:
        parse_csv(data)
    assert error.value.code == ErrorCode.CSV_SCHEMA
    assert "file" in error.value.fields


@pytest.mark.parametrize(("data", "field"), [
    (b"", "file"),
    (b"\xef\xbb\xbf", "file"),
    (b"\n", "headers"),
    (b"name\n\n", "rows"),
    (b"name,\nf,x\n", "headers"),
    (b"name, name \nf,g\n", "headers"),
    (b'"unclosed\n', "headers"),
    (b'name,note\nf,"unclosed\n', "rows.2"),
    (b'name,note\nf,"closed"garbage\n', "rows.2"),
    (b"name,note\nf\n", "rows.2"),
    (b"name,note\nf,x,extra\n", "rows.2"),
])
def test_structurally_invalid_csv_has_field_errors(data, field):
    with pytest.raises(AppError) as error:
        parse_csv(data, ",")
    assert error.value.code == ErrorCode.CSV_SCHEMA
    assert field in error.value.fields


@pytest.mark.parametrize("delimiter", ["", "\t", "|", ",;"])
def test_unsupported_delimiters_are_rejected(delimiter):
    with pytest.raises(AppError) as error:
        parse_csv(b"name\nf\n", delimiter)
    assert "delimiter" in error.value.fields


def test_parser_limits_bytes_rows_and_columns(monkeypatch):
    import app.modules.datasets.csv_import as importer

    monkeypatch.setattr(importer, "MAX_REQUEST_BYTES", 9)
    assert len(parse_csv(b"name\nf\ng\n").rows) == 2
    with pytest.raises(AppError, match="size"):
        parse_csv(b"name\nf\ng\nh\n")
    monkeypatch.setattr(importer, "MAX_REQUEST_BYTES", 100)
    monkeypatch.setattr(importer, "MAX_ROWS", 2)
    with pytest.raises(AppError, match="at most 2 rows"):
        parse_csv(b"name\nf\ng\nh\n")
    monkeypatch.setattr(importer, "MAX_COLUMNS", 2)
    with pytest.raises(AppError, match="at most 2 columns"):
        parse_csv(b"name,code,note\nf,code,note\n")


def test_large_quoted_python_cell_is_supported():
    parsed = parse_csv(b'name,code\nf,"' + b"# comment\n" * 20_000 + b'"\n')
    assert len(parsed.rows[0].values[1]) == 200_000


def test_mapping_preserves_values_and_omits_only_blank_optional_cells():
    parsed = parse_csv(b"name,expected,input,code\nf,0,false,def f(): return 0\ng,null,[],\nh, , ,\n")
    rows = map_rows(parsed, {
        "function_name": "name", "task_id": "name", "expected_output": "expected",
        "input_data": "input", "python_source": "code",
    })
    assert rows[0] == {
        "row_number": 2, "function_name": "f", "task_id": "f", "expected_output": "0",
        "input_data": "false", "python_source": "def f(): return 0",
    }
    assert rows[1]["expected_output"] == "null"
    assert "python_source" not in rows[1]
    assert rows[2] == {"row_number": 4, "function_name": "h", "task_id": "h"}


def test_missing_function_cell_is_kept_for_row_validation():
    parsed = parse_csv(b"name,note\n,keep this row\n")
    assert map_rows(parsed, {"function_name": "name"}) == [
        {"row_number": 2, "function_name": ""}
    ]


@pytest.mark.parametrize("mapping", [
    {}, {"task_id": "name"}, {"function_name": "absent"}, {"function_name": None},
    {"function_name": ["name"]}, {"function_name": "name", "unknown": "name"},
])
def test_invalid_mapping_is_rejected_before_creating_rows(mapping):
    with pytest.raises(AppError) as error:
        map_rows(parse_csv(b"name\nf\n"), mapping)
    assert error.value.code == ErrorCode.CSV_SCHEMA
    assert error.value.fields


@pytest.mark.parametrize("value", [
    None, "", "not JSON", "[]", "null", "1", '"name"',
    '{"function_name":"a","function_name":"b"}',
])
def test_mapping_parameter_must_be_a_json_object_with_unique_keys(value):
    with pytest.raises(AppError) as error:
        decode_mapping(value)
    assert error.value.code == ErrorCode.CSV_SCHEMA
    assert "mapping" in error.value.fields


def test_mapping_parameter_decodes_canonical_to_original_headers():
    assert decode_mapping('{"function_name":"Tên hàm"}') == {"function_name": "Tên hàm"}
