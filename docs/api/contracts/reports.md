# Results Dashboard, History & Reports API — UC-11 / FR-RPT-001, FR-RPT-002, FR-RPT-003, FR-RPT-004, FR-RPT-005 (Sprint 7)

Issue #64 and Issue #65 implement the Results Dashboard, History tracking, multi-dimensional Filters, Strategy Comparison Analytics & Visualizations, and CSV Export for test campaign quality evaluation.
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

## Export Capabilities (FR-RPT-003, FR-RPT-005)

- **Execution Runs CSV Export (FR-RPT-003)**: Sanitized RFC 4180-compliant comma-separated spreadsheet with quoted cell escaping containing run records, statuses, case counts, and individual quality scores.
- **Strategy Comparison Benchmark CSV Export (FR-RPT-005)**: Standardized tabular benchmark export detailing prompt levels (L1–L5), evaluated models, completed runs, test case counts, pass rates, average line coverage, average mutation scores, average assertion quality, baseline improvement deltas, comparability status, and experimental control audit checks.
- **JSON Export (FR-RPT-003)**: Structured array of run summaries with breakdown objects for external CI/CD ingestion.

---

## Strategy Comparison & Analytics (FR-RPT-004)

### Prompt Engineering Strategy Taxonomy
- **L1: Zero-shot**: Baseline prompt containing function signature and docstring only.
- **L2: Few-shot**: Prompt enriched with selected canonical test case demonstrations.
- **L3: Chain-of-thought (CoT)**: Step-by-step reasoning prompt eliciting boundary conditions and edge cases prior to code synthesis.
- **L4: Self-consistency**: Multi-sample generation with consensus clustering across independent generations.
- **L5: Hybrid**: Multi-agent ensemble combining Few-shot, CoT, and self-consistency techniques.

### Visual Comparison Charts & State Semantics
- **Grouped Multi-Metric Bar Chart**: Side-by-side visualization comparing Pass Rate, Line Coverage, Mutation Score, and Assertion Quality across L1–L5.
- **Multi-Axis Radar Spider Profile**: Geometric profile plotting multi-dimensional quality signatures across 5 normalized axes.
- **Strict Metric State Conventions (DoD)**:
  - **Numeric zero (`0.0%`)**: Rendered distinctly on the baseline axis with an explicit numeric label, never omitted, replaced by null, or conflated with missing data.
  - **N/A**: Rendered with diagonal hatched/striped bars and muted indicators denoting unmeasured/unevaluated dimensions.
  - **TIMEOUT**: Rendered with amber striped patterns denoting sandbox 60s hard limit exhaustion.
  - **FAILED**: Rendered with rose striped patterns denoting syntax or runner termination exceptions.
- **Scientific Comparability Engine**:
  - Automatically assesses 5 experimental controls:
    1. *Benchmark Dataset Consistency*: Verifies identical dataset and snapshot ID.
    2. *Source Code Provenance*: Verifies matching SHA-256 commit hash.
    3. *LLM Model Confounding Factor*: Flags multi-model mixing and recommends model filtering.
    4. *Sample Size Disparity*: Flags case volume imbalance (> 2.5x ratio).
    5. *Execution Health*: Flags incomplete, running, failed, or timed out runs.
  - Generates overall status banner: `COMPATIBLE` (green), `CAUTION` (amber), or `INCOMPARABLE` (rose) with collapsible audit drawer.
