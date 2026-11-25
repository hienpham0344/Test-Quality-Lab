# Results Dashboard, History & Reports API — UC-11 / FR-RPT-001, FR-RPT-002, FR-RPT-003 (Sprint 7)

Issue #64 implements the Results Dashboard, History tracking, and multi-dimensional Filters for test campaign quality evaluation.
All endpoints require an authenticated user with ownership of the target project context.

## Overview & Metric Specifications

The Results Dashboard and History views provide aggregated visibility across past test generation and evaluation executions.

### Definition of Done (DoD) Metric Conventions
- **Numeric zero** (`0.0%` / `0`): Preserved as a distinct valid value (e.g. executed code with 0 statements covered or 0 mutants killed), never omitted, replaced by null, or conflated with missing data.
- **N/A**: Not available or not evaluated yet (e.g. mutation testing skipped or pending execution).
- **FAILED**: Metric evaluation failed due to syntax errors or unexpected runner termination.
- **TIMEOUT**: Execution exceeded sandbox runtime limit (60s).
- **Non-fabricated provenance**: All summary statistics and aggregates are calculated strictly from verifiable test run traces without synthetic placeholder scores.

### Aggregate Mathematical Formulas (FR-RPT-001)
- **Campaign Execution Progress**:
  $$\text{Progress} = \frac{\text{Completed Runs} + \text{Failed Runs} + \text{Timeout Runs} + \text{Cancelled Runs}}{\text{Total Runs}} \times 100\%$$
- **Overall Test Pass Rate**:
  $$\text{Pass Rate} = \frac{\sum \text{Passed Cases}}{\sum \text{Completed Cases}} \times 100\%$$
- **Average Line Coverage**:
  $$\text{Avg Coverage} = \frac{\sum_{i \in \text{Evaluated}} \text{Coverage}_i}{|\text{Evaluated Runs}|}$$
- **Average Mutation Score**:
  $$\text{Avg Mutation Score} = \frac{\sum_{i \in \text{Evaluated}} \text{Mutation Score}_i}{|\text{Evaluated Runs}|}$$

---

## Endpoints

Base path: `/api/v1/projects/{project_id}/reports`

### 1. Get Results Report Summary & History
`GET /api/v1/projects/{project_id}/reports/results`

- Headers: `Authorization: Bearer <token>`
- Response: `200 OK`
```json
{
  "project_id": "proj-123",
  "total_runs": 6,
  "runs": [
    {
      "id": "exec-run-101",
      "project_id": "proj-123",
      "suite_name": "Regression Suite - Prompt L1",
      "dataset_id": "ds-sample-1",
      "dataset_name": "HumanEval Python Benchmarks",
      "source_id": "src-sample-1",
      "source_name": "solution_v1.py",
      "status": "RUNNING",
      "model": "GPT-4o",
      "strategy": "L1: Zero-shot",
      "duration_ms": 30000,
      "total_cases": 20,
      "completed_cases": 12,
      "passed_cases": 10,
      "failed_cases": 2,
      "timeout_cases": 0,
      "metrics": {
        "coverage": 68.5,
        "mutation_score": 75.0,
        "validity": "PASSED"
      },
      "created_at": "2026-11-25T07:20:00Z"
    }
  ]
}
```

---

## Filters & Search Matrix (FR-RPT-003)

| Dimension | Supported Options | Description |
|---|---|---|
| **Status** | `ALL`, `COMPLETED`, `ACTIVE`, `FAILED`, `CANCELLED` | Filter by execution lifecycle state |
| **Strategy** | `ALL`, `L1`, `L2`, `L3`, `L4`, `L5` | Filter by prompt engineering strategy taxonomy (Zero-shot, Few-shot, CoT, Self-consistency, Hybrid) |
| **Model** | `ALL`, `GPT-4o`, `Claude 3.5 Sonnet`, `Gemini 1.5 Pro`, `Llama 3.3 70B` | Filter by LLM provider model |
| **Quality Criteria** | `ALL`, `ONLY_PASSING`, `HAS_FAILURES`, `HIGH_COVERAGE` | Filter runs by performance threshold (100% pass, error detection, ≥ 80% coverage) |
| **Sort By** | `date`, `pass_rate`, `coverage`, `mutation`, `duration`, `suite_name` | Sort runs with asc/desc direction toggling |
| **Search Query** | String text match | Substring matching across suite name, run ID, dataset name, source filename, and model |

---

## Export Capabilities (FR-RPT-003)

- **CSV Export**: Sanitized RFC 4180-compliant comma-separated spreadsheet with quoted cell escaping.
- **JSON Export**: Structured array of run summaries with breakdown objects for external CI/CD ingestion.
