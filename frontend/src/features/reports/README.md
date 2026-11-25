# Reports & Results Feature (Sprint 7 / FR-RPT-001, FR-RPT-002, FR-RPT-003, UC-11)

The Reports feature delivers the Results Dashboard, History tracking, and multi-dimensional Filters for test generation and execution quality evaluation.

## Components & Modules

- **`ResultsDashboardPage.jsx`**: Main page integrating campaign progress overview, filters/sorting bar, and results history table with full drilldown inspection modal.
- **`ResultsProgressOverview.jsx`**: Real-time progress tracker and KPI summary cards:
  - Overall campaign completion progress bar ($$\frac{\text{Terminal Runs}}{\text{Total Runs}} \times 100\%$$)
  - Aggregate test case pass rate ($$\frac{\text{Passed Cases}}{\text{Completed Cases}} \times 100\%$$)
  - Average line coverage across evaluated runs ($$\text{Avg}(\text{Coverage})$$)
  - Average mutation score resistance ($$\text{Avg}(\text{Mutation Score})$$), strictly distinguishing numeric zero (0.0%) from N/A
  - Total test cases count and pass/fail distribution
  - Interactive status pill filters with run counts
- **`ResultsFiltersBar.jsx`**: Search, multi-dimensional filtering, sorting, and export controls:
  - Instant text search across suite name, run ID, dataset, source file, model, and strategy
  - Status filter: `All`, `Completed`, `Active` (`Running`, `Queued`, `Pending`), `Failed / Timeout`, `Cancelled`
  - Prompt strategy filter: `L1: Zero-shot`, `L2: Few-shot`, `L3: Chain-of-thought`, `L4: Self-consistency`, `L5: Hybrid`
  - LLM model filter: `GPT-4o`, `Claude 3.5 Sonnet`, `Gemini 1.5 Pro`, `Llama 3.3 70B`, etc.
  - Quality criteria filter: `All Quality Levels`, `100% Passing Only`, `Has Failures / Errors`, `High Coverage (≥ 80%)`
  - Sorting: Date, Pass Rate, Coverage, Mutation Score, Duration, Suite Name (Ascending / Descending)
  - Active filter badges with one-click dismiss and "Reset filters" action
  - Client-side sanitized CSV and JSON export
- **`ResultsHistoryTable.jsx`**: Detailed results table with status badges, model & strategy tags, pass/fail fraction with mini progress bars, metric badges, formatted duration, timestamp, and "Inspect" drilldown modal trigger.
- **`report-metrics.js`**: Core mathematical aggregation utilities, metric averaging with numeric zero preservation, filtering, sorting, and CSV/JSON export formatting.

## Requirement Traceability

- **FR-RPT-001**: Results dashboard summary, progress bar, KPI metric cards, and aggregate evaluation statistics.
- **FR-RPT-002**: Results history table, detailed run records, individual metric states, and drilldown inspection modal.
- **FR-RPT-003**: Search, multi-filter combinations (status, strategy, model, quality), column sorting, active filter chips, and CSV/JSON export.
- **UC-11**: View Results Dashboard, History & Reports.
