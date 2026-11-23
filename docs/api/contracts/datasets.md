# CSV import and dataset validation API

Issue #25 implements CSV reading and column mapping (FR-CSV-001/002).
Issue #26 implements canonical row validation (FR-CSV-003/004/005/006).
All endpoints require authentication and a project owned by the current user.
Other users' projects, datasets, and source versions return 404.

## Upload, preview and map a CSV file (#25)

Base path: `/api/v1/projects/{project_id}/datasets`.

- `POST /preview` accepts raw file bytes with `Content-Type: text/csv` or
  `application/octet-stream`. It validates the entire CSV structure and returns
  `headers`, `delimiter`, `row_count`, and at most 20 `preview_rows`, each containing
  `row_number` and `values` in header order. It does not save a dataset.
- `POST /import` accepts the same raw file bytes and a required `mapping` query
  parameter containing a JSON object: canonical field → CSV header. It validates
  the mapping, runs the existing row checks, and saves dataset revision 1. The
  response has the same shape as `POST /datasets` below, including per-row errors.
- Both endpoints accept an optional `delimiter` query parameter (`","` or `";"`).
  Omit it to detect the separator from the header, respecting quoted fields.
  Ambiguous headers require an explicit separator. Single-column CSV defaults to
  comma. Use the delimiter returned by preview when importing.

Files must use strict UTF-8; a UTF-8 BOM is accepted. Limits are 25 MiB per request,
10,000 data records, and 256 columns. CRLF, quoted separators, escaped double quotes
and multiline quoted cells are supported. Header whitespace is trimmed; empty or
duplicate headers after trimming are rejected. Every data record must have the
same column count as the header. Empty physical records are skipped. `row_number`
is the starting physical line of a record, including any preceding multiline cells
or empty lines; it is not the preview array index.

Mapping requires `function_name`. Optional targets are `task_id`, `python_source`,
`expected_output`, `input_data`, `description`, `task_title`, and `difficulty`.
Every target must be recognized and every mapped header must exist. Omit unmapped
optional fields. Multiple targets may use the same header. Duplicate target keys
in the mapping JSON are rejected. Blank optional cells are omitted; nonblank
values are preserved, including Python indentation and JSON `0`, `false`, and
`null`. A blank function cell remains an invalid row, rather than disappearing.

Example browser integration (same file sent again after preview):

```javascript
const base = `${apiUrl}/api/v1/projects/${projectId}/datasets`
const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'text/csv' }
const previewResponse = await fetch(`${base}/preview`, { method: 'POST', headers, body: file })
if (!previewResponse.ok) throw await previewResponse.json()
const preview = await previewResponse.json()
// Let the user choose headers from preview.headers before importing.
const params = new URLSearchParams({
  delimiter: preview.delimiter,
  mapping: JSON.stringify({ task_id: 'task_id', function_name: 'func_name', python_source: 'python_solution' }),
})
const imported = await fetch(`${base}/import?${params}`, { method: 'POST', headers, body: file })
if (!imported.ok) throw await imported.json()
const dataset = await imported.json()
```

Use the server preview/import for file ingestion; sending client-parsed canonical
rows alone does not validate the original file's encoding or CSV structure.

Malformed encoding/CSV and mapping failures return `422 CSV_SCHEMA` with a
`fields` dictionary (`file`, `headers`, `rows.<physical-line>`, `delimiter`, or
`mapping.<canonical-field>`). No dataset is saved on those failures. Unsupported
media types return `415 CSV_SCHEMA`; oversized bodies return `413 CSV_SCHEMA`.
Semantic row errors remain visible in a successful import, as described below.

## Canonical rows, selections and references (#26)

`POST /api/v1/projects/{project_id}/datasets` accepts JSON:

```json
{"rows": [{"row_number": 2, "task_id": "P01", "function_name": "square", "python_source": "def square(x): return x*x", "expected_output": "0"}]}
```

`row_number` is the original CSV line (starting at 2). Rows must have unique
line numbers; there may be 1–10,000 rows. Supported canonical fields are
`task_id`, `function_name`, `python_source`, `expected_output`, `input_data`,
`description`, `task_title`, and `difficulty`. Complex input and expected
values must be valid JSON strings. The response gives each row's original
number, metadata, status (`valid`, `invalid`, or `preview_only`), reasons,
expected-output provenance (`csv` when supplied), and source hash when valid.
Parsed `input_data` is included when provided.
It does not return embedded Python source. Invalid rows remain visible and do
not prevent valid rows from being selected.
Schema errors use `CSV_SCHEMA`; rejected selections use `CSV_ROW_INVALID` in
the API's structured error body.

`GET /api/v1/projects/{project_id}/datasets` lists datasets. `GET
/api/v1/projects/{project_id}/datasets/{dataset_id}` returns the current
preview. `GET .../{dataset_id}/versions/{revision}` returns an immutable
earlier snapshot.

`POST .../{dataset_id}/selection` takes `{"row_numbers": [2, 3]}`. The
selection must be nonempty, unique, and contain only valid rows. It creates a
new immutable dataset revision. `POST .../{dataset_id}/reference` takes
`{"source_id": "<UUID>", "revision": 1}` referencing an existing owned Python
source version. It revalidates every row against that source, preserves only
still-valid selections, and creates another immutable revision. Embedded code
takes precedence over the linked source for its row.

For rows without embedded or linked reference code, `status` is
`preview_only`, `runtime_status` is `N/A`, and selection is refused. No
runtime pass/fail, coverage, or mutation value is produced. Even a valid
reference cannot be run yet: `execution_enabled` is always false until the
separate sandbox security review approves untrusted execution.
