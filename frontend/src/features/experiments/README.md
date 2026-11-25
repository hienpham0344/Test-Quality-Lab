# experiments

Open **Set up experiment** from the project sidebar or Project details, or use
`/projects/:projectId/experiments/new`. Choose a saved Python source,
select target functions from the server's revision metadata, then enter
model identifiers, L1–L5 strategy IDs and a positive repeat count.

## Features

### Experiment Setup Wizard (#36, UC-06)
- **Step 0 (Source & Functions)**: Choose an immutable Python source version and select individual or all target functions.
- **Step 1 (Run Configuration)**: Enter model identifiers (one per line, up to 120 characters each), choose prompt strategies from the L1–L5 taxonomy, and specify repetitions per combination.
- **Step 2 (Matrix Preview & Review)**: Comprehensive preview of the Cartesian product run matrix prior to saving the draft.

### Experiment Matrix Preview (#69, Sprint 3 FE1/FE2)
Implemented in `ExperimentMatrixPreview.jsx` and backed by `matrix-calculator.js`:
- **KPI Summary Cards**: Live breakdown of Total Planned Runs, Target Functions, LLM Models, Prompt Strategies (L1–L5), and Repetitions per cell.
- **Prompt Strategy Taxonomy**:
  - `L1: Zero-shot`: Direct prompt instruction without demonstration examples
  - `L2: Few-shot`: In-context demonstration examples showing expected behavior
  - `L3: Chain-of-thought`: Step-by-step reasoning prompts breaking down complex logic
  - `L4: Self-consistency`: Multiple reasoning generation paths with majority vote consensus
  - `L5: Hybrid`: Combined iterative refinement and multi-prompt strategies
- **Dual View Modes**:
  - **Matrix Grid View**: 2D tabular representation mapping target functions and models across prompt strategies L1–L5 with cell multipliers (`×N`), row totals, and column sub-totals.
  - **Planned Runs List View**: Detailed itemized combinations table displaying Run #, Target Function, Line, Model, Strategy badge, Repetition index, and Planned status. Supports real-time text search, strategy filtering dropdown, and pagination.
- **Input Rejection & Validation**:
  - Rejects empty target function selections.
  - Rejects missing model identifiers or identifiers exceeding 120 characters.
  - Rejects empty prompt strategy selections.
  - Rejects invalid, 0, negative, or non-integer repeat counts.
  - Enforces the hard 1,000-run matrix limit ($F \times M \times S \times R \le 1000$). Displays prominent rejection alert with specific diagnostic reasons and quick-edit navigation links.
- **Export Capabilities**:
  - **Copy JSON**: One-click clipboard copy of the full execution plan payload.
  - **Export CSV**: Sanitized RFC 4180-compliant CSV download containing execution matrix metadata and itemized planned runs.

## Storage and Execution

Save draft keeps the selected source ID and revision, function names and lines, model and
strategy IDs, and repeats in the current browser tab (`sessionStorage`). The wizard uses the
existing sources API and contains no API key or prompt template fields.
Server-side experiment snapshots and execution remain outside this wizard.
