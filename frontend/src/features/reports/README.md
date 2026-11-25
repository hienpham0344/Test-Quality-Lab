# Reports & Results Feature (Sprint 7 / FR-RPT-001, FR-RPT-002, FR-RPT-003, FR-RPT-004, FR-RPT-005, UC-11)

The Reports feature delivers the Results Dashboard, History tracking, multi-dimensional Filters, Strategy Quality Comparison Charts, Scientific Comparability Engine, and Benchmark CSV Export for test generation and execution quality evaluation.

## Components & Modules

- **`ResultsDashboardPage.jsx`**: Main page integrating tab navigation between History & Runs and Strategy Comparison & Analytics, campaign progress overview, filters/sorting bar, and results history table with full drilldown inspection modal.
- **`StrategyComparisonView.jsx`**: Overarching container for prompt strategy benchmark analytics (FR-RPT-004/005), providing model isolation filters, baseline strategy selector, strategy inclusion toggles, comparability banner, comparison charts, performance matrix, and CSV export.
- **`StrategyComparisonCharts.jsx`**: Responsive SVG visualizations with metric switching:
  - Multi-metric grouped bar charts (Pass Rate, Line Coverage, Mutation Score, Assertion Quality) across prompt strategies (L1–L5)
  - Multi-axis radar spider charts evaluating geometric quality signatures
  - Strict DoD metric state semantics: explicit baseline bar for numeric zero (0.0%), diagonal hatched bars for N/A, and striped patterns for TIMEOUT and FAILED
  - Interactive tooltip callouts displaying exact values and sample size breakdowns
- **`StrategyComparabilityNotice.jsx`**: Scientific controls banner and collapsible audit drawer evaluating dataset uniformity, source code SHA-256 provenance, LLM model confounding factors, test case sample size balance, and execution completeness.
- **`StrategyComparisonMatrix.jsx`**: Benchmark data table calculating percentage point deltas ($\Delta pp$) against selected baseline (default L1: Zero-shot), gold award badges for top performers in each metric, and integrated CSV export button.
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
- **`report-metrics.js`**: Core mathematical aggregation utilities, metric averaging with numeric zero preservation, filtering, sorting, strategy comparison computation, baseline delta calculations, comparability assessment, and sanitized RFC 4180 CSV export.

## Requirement Traceability

- **FR-RPT-001**: Results dashboard summary, progress bar, KPI metric cards, and aggregate evaluation statistics.
- **FR-RPT-002**: Results history table, detailed run records, individual metric states, and drilldown inspection modal.
- **FR-RPT-003**: Search, multi-filter combinations (status, strategy, model, quality), column sorting, active filter chips, and CSV/JSON export.
- **FR-RPT-004**: Strategy comparison analytics, multi-metric bar charts, radar spider profiles, scientific comparability controls & warnings, and N/A handling.
- **FR-RPT-005**: Strategy comparison benchmark matrix and sanitized RFC 4180 CSV export UI with relative baseline deltas.
- **UC-11**: View Results Dashboard, History & Reports.
