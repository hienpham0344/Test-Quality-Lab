MAX_ROWS = 10_000
MAX_REQUEST_BYTES = 25 * 1024 * 1024
CANONICAL_FIELDS = frozenset({
    "task_id", "function_name", "python_source", "expected_output", "input_data",
    "description", "task_title", "difficulty",
})
