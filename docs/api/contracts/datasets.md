# Normalized CSV row validation API

Issue #26 implements FR-CSV-003/004/005/006. It accepts canonical rows from
the CSV reading and column-mapping stage (#25); direct CSV upload is not part
of this contract. All endpoints require authentication and a project owned by
the current user. Other users' projects, datasets, and source versions return
404.

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
