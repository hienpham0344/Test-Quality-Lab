# Datasets & CSV Input (UC-05 / S2)

Implements CSV upload, header preview, column mapping configuration, client pre-validation, and row selection snapshot management (#28).

## Components

- `DatasetsManager.jsx`: Main container component integrating the CSV upload wizard and existing project datasets list.
- `CsvUploadCard.jsx`: Step 1 – Drag-and-drop CSV file upload, raw CSV text paste mode, sample benchmark dataset loader, and file metadata display.
- `HeaderPreviewCard.jsx`: Step 2 – Discovered CSV headers preview, raw sample data inspection table, and column/row counts.
- `ColumnMappingCard.jsx`: Step 3 – Interactive column mapping for canonical target fields (`function_name`, `task_id`, `python_source`, `expected_output`, `input_data`, `description`, `task_title`, `difficulty`), auto-detection heuristics, and live first-row sample preview.
- `MappingValidationCard.jsx`: Step 4 – Canonical schema transformation, client pre-checks (Python identifier syntax, JSON verification), error breakdown, and API submission to `POST /api/v1/projects/:id/datasets`.
- `DatasetResultsView.jsx`: Inspection view for backend-validated dataset snapshots: summary metrics (Valid, Invalid, Preview Only), security sandbox notices, row status filtering, valid row selection checkboxes, and selection snapshot saving (`POST .../selection`).

## Utilities

- `csv-parser.js`: RFC 4180 compliant CSV parser supporting delimiters (comma, tab, semicolon), quoted strings, escaped quotes, multiline fields, and BOM stripping.
- `column-mapping.js`: Canonical target fields definition, identifier validation, alias auto-detection, and payload transformation.
