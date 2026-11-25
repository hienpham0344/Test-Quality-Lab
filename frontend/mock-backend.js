/**
 * Lightweight mock backend server for frontend-only development and testing.
 * Runs on http://localhost:8000 with zero external dependencies (Node.js built-in http).
 *
 * Usage:
 *   node mock-backend.js
 */

import http from 'node:http'
import crypto from 'node:crypto'

const PORT = 8000

const store = {
  datasets: [],
  executions: [
    {
      id: 'exec-run-101',
      project_id: 'demo-project',
      suite_name: 'Regression Suite - Prompt L1',
      dataset_id: 'ds-sample-1',
      dataset_name: 'HumanEval Python Benchmarks',
      source_id: 'src-sample-1',
      source_name: 'solution_v1.py',
      status: 'RUNNING',
      model: 'GPT-4o',
      strategy: 'L1: Zero-shot',
      duration_ms: 30000,
      can_cancel: true,
      created_at: new Date(Date.now() - 35000).toISOString(),
      started_at: new Date(Date.now() - 30000).toISOString(),
      completed_at: null,
      cancelled_at: null,
      cancel_reason: null,
      source_sha256: 'a9f24c3e80bd2e650d4b68f9ef94cb9d83df75796bfa8f16104bc1b519c5c2a1',
      dataset_snapshot_id: 'snap-he-python-v1',
      total_cases: 20,
      completed_cases: 12,
      passed_cases: 10,
      failed_cases: 2,
      timeout_cases: 0,
      metrics: {
        coverage: 68.5,
        mutation_score: 75.0,
        assertion_score: 85.0,
        validity: 'PASSED',
      },
      coverage_details: {
        covered_lines: 14,
        total_lines: 20,
        covered_ranges: ['L1-L8', 'L11-L16'],
        missed_ranges: ['L9-L10', 'L17-L20'],
      },
      mutation_details: {
        mutants: [
          { id: 'MUT-01', operator: 'AOR', line: 12, original: 'a + b', mutated: 'a - b', status: 'KILLED', killed_by: 'test_add' },
          { id: 'MUT-02', operator: 'AOR', line: 14, original: 'a * b', mutated: 'a / b', status: 'KILLED', killed_by: 'test_multiply' },
          { id: 'MUT-03', operator: 'ROR', line: 18, original: 'x > 0', mutated: 'x >= 0', status: 'KILLED', killed_by: 'test_fibonacci' },
          { id: 'MUT-04', operator: 'LCR', line: 22, original: 'mode and edge', mutated: 'mode or edge', status: 'SURVIVED', killed_by: null },
        ],
        summary: {
          killed: 3,
          survived: 1,
          timeout: 0,
          error: 0,
        },
      },
      assertion_details: {
        score: 85.0,
        summary: {
          total: 6,
          verified: 5,
          failed: 1,
          ineffective: 0,
          pass_rate: 83.3,
          density: 1.2,
          assertion_less_cases: 0,
        },
        assertions: [
          { id: 'AST-01', test_case: 'test_add', statement: 'assert add(2, 3) == 5', type: 'EQUALITY', line: 12, status: 'VERIFIED', strength: 'HIGH', explanation: 'Validates exact arithmetic return value.' },
          { id: 'AST-02', test_case: 'test_add', statement: 'assert isinstance(add(2, 3), int)', type: 'TYPE_INSTANCE', line: 13, status: 'VERIFIED', strength: 'MEDIUM', explanation: 'Ensures type constraint is satisfied.' },
          { id: 'AST-03', test_case: 'test_multiply', statement: 'assert multiply(4, 5) == 20', type: 'EQUALITY', line: 20, status: 'VERIFIED', strength: 'HIGH', explanation: 'Validates multiplication product.' },
          { id: 'AST-04', test_case: 'test_edge_cases', statement: 'assert result == 1', type: 'EQUALITY', line: 28, status: 'FAILED', strength: 'HIGH', explanation: 'Expected 1 but got 0 due to edge case failure.' },
          { id: 'AST-05', test_case: 'test_fibonacci', statement: 'assert fibonacci(5) == 5', type: 'EQUALITY', line: 35, status: 'VERIFIED', strength: 'HIGH', explanation: 'Validates recursive sequence value.' },
          { id: 'AST-06', test_case: 'test_fibonacci', statement: 'assert fibonacci(0) == 0', type: 'RELATIONAL', line: 36, status: 'VERIFIED', strength: 'HIGH', explanation: 'Validates base case invariant.' },
        ],
        unavailable_reason: null,
      },
      sandbox_policy: {
        untrusted_execution_enabled: false,
        isolation_status: 'policy_simulation',
        network: 'disabled',
        root_fs: 'read_only',
        timeout_seconds: 60,
      },
      logs: [
        '[17:00:01] Sandbox initialized with policy: read-only rootfs, network disabled, timeout 60s.',
        '[17:00:02] [SECURITY] Outbound network socket creation blocked by sandbox policy.',
        '[17:00:03] Loading dataset HumanEval Python Benchmarks (20 cases)...',
        '[17:00:05] Case #1 (test_add): PASSED (12ms)',
        '[17:00:08] Case #2 (test_multiply): PASSED (15ms)',
        '[17:00:15] Case #3 (test_edge_cases): FAILED (AssertionError: 0 != 1)',
        '[17:00:22] Case #4 (test_fibonacci): PASSED (28ms)',
        '[17:00:25] Case #5 (test_timeout_recursion): TIMEOUT (Exceeded per-case time limit of 5000ms)',
      ],
      cases: [
        {
          id: 'case-1',
          name: 'test_add',
          status: 'PASSED',
          duration_ms: 12,
          coverage: 100,
          covered_lines: ['L1-L8', 'L11-L12'],
          mutation_score: 85.0,
          killed_mutants: ['MUT-01: AOR (L12) a + b -> a - b'],
          input: { a: 2, b: 3 },
          expected_output: 5,
          actual_output: 5,
        },
        {
          id: 'case-2',
          name: 'test_multiply',
          status: 'PASSED',
          duration_ms: 15,
          coverage: 92.5,
          covered_lines: ['L1-L8', 'L13-L14'],
          mutation_score: 90.0,
          killed_mutants: ['MUT-02: AOR (L14) a * b -> a / b'],
          input: { a: 4, b: 5 },
          expected_output: 20,
          actual_output: 20,
        },
        {
          id: 'case-3',
          name: 'test_edge_cases',
          status: 'FAILED',
          duration_ms: 45,
          coverage: 0,
          covered_lines: [],
          mutation_score: 0,
          killed_mutants: [],
          error: 'AssertionError: expected 1 got 0',
          input: { a: 0, b: 1, edge_mode: true },
          expected_output: 1,
          actual_output: 0,
          traceback: 'Traceback (most recent call last):\n  File "/sandbox/workspace/solution_v1.py", line 18, in test_edge_cases\n    assert solution(0, 1) == 1\nAssertionError: expected 1 got 0',
        },
        {
          id: 'case-4',
          name: 'test_fibonacci',
          status: 'PASSED',
          duration_ms: 28,
          coverage: 80.0,
          covered_lines: ['L15-L20'],
          mutation_score: 75.0,
          killed_mutants: ['MUT-03: ROR (L18) x > 0 -> x >= 0'],
          input: { n: 6 },
          expected_output: 8,
          actual_output: 8,
        },
        {
          id: 'case-5',
          name: 'test_timeout_recursion',
          status: 'TIMEOUT',
          duration_ms: 5000,
          coverage: 40.0,
          covered_lines: ['L15-L16'],
          mutation_score: 'TIMEOUT',
          killed_mutants: [],
          error: 'TimeoutExpired: Execution exceeded 5000ms threshold without terminating',
          input: { n: 1000000 },
          expected_output: 'Terminated',
          actual_output: 'TimeoutExpired',
          traceback: 'TimeoutExpired: Call to ackermann(4, 2) did not complete within 5000ms sandbox time limit.',
        },
      ],
    },
    {
      id: 'exec-run-102',
      project_id: 'demo-project',
      suite_name: 'Sanity Suite - MBPP Subset',
      dataset_id: 'ds-sample-2',
      dataset_name: 'MBPP Sanitized',
      source_id: 'src-sample-1',
      source_name: 'solution_v1.py',
      status: 'QUEUED',
      model: 'Claude 3.5 Sonnet',
      strategy: 'L2: Few-shot',
      duration_ms: null,
      can_cancel: true,
      created_at: new Date(Date.now() - 10000).toISOString(),
      started_at: null,
      completed_at: null,
      cancelled_at: null,
      cancel_reason: null,
      total_cases: 15,
      completed_cases: 0,
      passed_cases: 0,
      failed_cases: 0,
      timeout_cases: 0,
      metrics: {
        coverage: 'N/A',
        mutation_score: 'N/A',
        assertion_score: 'N/A',
        validity: 'N/A',
      },
      assertion_details: null,
      sandbox_policy: {
        untrusted_execution_enabled: false,
        isolation_status: 'policy_simulation',
        network: 'disabled',
        root_fs: 'read_only',
        timeout_seconds: 60,
      },
      logs: ['[17:05:00] Run queued. Awaiting available sandbox executor container.'],
      cases: [],
    },
    {
      id: 'exec-run-103',
      project_id: 'demo-project',
      suite_name: 'Full Benchmark Suite - Baseline',
      dataset_id: 'ds-sample-1',
      dataset_name: 'HumanEval Python Benchmarks',
      source_id: 'src-sample-1',
      source_name: 'solution_v1.py',
      status: 'COMPLETED',
      model: 'GPT-4o',
      strategy: 'L3: Chain-of-thought',
      duration_ms: 50000,
      can_cancel: false,
      created_at: new Date(Date.now() - 3600000).toISOString(),
      started_at: new Date(Date.now() - 3590000).toISOString(),
      completed_at: new Date(Date.now() - 3540000).toISOString(),
      cancelled_at: null,
      cancel_reason: null,
      source_sha256: 'b1e8473e80bd2e650d4b68f9ef94cb9d83df75796bfa8f16104bc1b519c5c2d3',
      dataset_snapshot_id: 'snap-he-baseline-v2',
      total_cases: 10,
      completed_cases: 10,
      passed_cases: 9,
      failed_cases: 1,
      timeout_cases: 0,
      metrics: {
        coverage: 91.2,
        mutation_score: 0,
        assertion_score: 0,
        validity: 'PASSED',
      },
      coverage_details: {
        covered_lines: 22,
        total_lines: 24,
        covered_ranges: ['L1-L22'],
        missed_ranges: ['L23-L24'],
      },
      mutation_details: {
        mutants: [
          { id: 'MUT-101', operator: 'AOR', line: 10, original: 'x + 1', mutated: 'x - 1', status: 'SURVIVED', killed_by: null },
          { id: 'MUT-102', operator: 'ROR', line: 15, original: 'len(s) > 0', mutated: 'len(s) >= 0', status: 'SURVIVED', killed_by: null },
        ],
        summary: {
          killed: 0,
          survived: 2,
          timeout: 0,
          error: 0,
        },
      },
      assertion_details: {
        score: 0,
        summary: {
          total: 2,
          verified: 0,
          failed: 1,
          ineffective: 1,
          pass_rate: 0,
          density: 0.2,
          assertion_less_cases: 1,
        },
        assertions: [
          { id: 'AST-101', test_case: 'test_core_logic', statement: 'assert True', type: 'IDENTITY_BOOLEAN', line: 11, status: 'INEFFECTIVE', strength: 'LOW', explanation: 'Trivial assertion provides zero behavioral verification.' },
          { id: 'AST-102', test_case: 'test_boundary', statement: 'assert len(res) > 5', type: 'INVARIANT', line: 19, status: 'FAILED', strength: 'MEDIUM', explanation: 'Boundary invariant check failed.' },
        ],
        unavailable_reason: 'Test suite contains trivial and failing assertions resulting in 0.0% assertion quality score.',
      },
      sandbox_policy: {
        untrusted_execution_enabled: false,
        isolation_status: 'policy_simulation',
        network: 'disabled',
        root_fs: 'read_only',
        timeout_seconds: 60,
      },
      logs: [
        '[16:00:00] Sandbox initialized.',
        '[16:00:02] Running test suite...',
        '[16:00:50] Execution completed successfully.',
      ],
      cases: [
        {
          id: 'case-101',
          name: 'test_core_logic',
          status: 'PASSED',
          duration_ms: 18,
          coverage: 95.0,
          mutation_score: 0,
          input: { text: 'hello world' },
          expected_output: 'HELLO WORLD',
          actual_output: 'HELLO WORLD',
        },
        {
          id: 'case-102',
          name: 'test_boundary',
          status: 'FAILED',
          duration_ms: 32,
          coverage: 0,
          mutation_score: 0,
          error: 'AssertionError: expected non-empty string got ""',
          input: { text: '' },
          expected_output: 'DEFAULT',
          actual_output: '',
          traceback: 'Traceback (most recent call last):\n  File "/sandbox/workspace/solution_v1.py", line 42, in test_boundary\n    assert process_string("") == "DEFAULT"\nAssertionError: expected non-empty string got ""',
        },
      ],
    },
    {
      id: 'exec-run-104',
      project_id: 'demo-project',
      suite_name: 'Nightly Stress Suite',
      dataset_id: 'ds-sample-2',
      dataset_name: 'MBPP Sanitized',
      source_id: 'src-sample-1',
      source_name: 'solution_v1.py',
      status: 'CANCELLED',
      model: 'Gemini 1.5 Pro',
      strategy: 'L1: Zero-shot',
      duration_ms: 40000,
      can_cancel: false,
      created_at: new Date(Date.now() - 7200000).toISOString(),
      started_at: new Date(Date.now() - 7190000).toISOString(),
      completed_at: null,
      cancelled_at: new Date(Date.now() - 7150000).toISOString(),
      cancel_reason: 'User aborted: incorrect source version selected',
      total_cases: 50,
      completed_cases: 14,
      passed_cases: 14,
      failed_cases: 0,
      timeout_cases: 0,
      metrics: {
        coverage: 'N/A',
        mutation_score: 'N/A',
        assertion_score: 'N/A',
        validity: 'N/A',
      },
      assertion_details: null,
      sandbox_policy: {
        untrusted_execution_enabled: false,
        isolation_status: 'policy_simulation',
        network: 'disabled',
        root_fs: 'read_only',
        timeout_seconds: 60,
      },
      logs: [
        '[15:00:00] Sandbox initialized.',
        '[15:00:10] Execution started.',
        '[15:00:40] Cancellation requested: User aborted: incorrect source version selected.',
        '[15:00:41] Sandbox container terminated safely.',
      ],
      cases: [],
    },
    {
      id: 'exec-run-105',
      project_id: 'demo-project',
      suite_name: 'Long Running Infinite Loop Test',
      dataset_id: 'ds-sample-3',
      dataset_name: 'Edge Cases',
      source_id: 'src-sample-1',
      source_name: 'solution_v1.py',
      status: 'TIMEOUT',
      model: 'Llama 3.3 70B',
      strategy: 'L4: Self-consistency',
      duration_ms: 60000,
      can_cancel: false,
      created_at: new Date(Date.now() - 10800000).toISOString(),
      started_at: new Date(Date.now() - 10790000).toISOString(),
      completed_at: new Date(Date.now() - 10730000).toISOString(),
      cancelled_at: null,
      cancel_reason: null,
      total_cases: 5,
      completed_cases: 1,
      passed_cases: 1,
      failed_cases: 0,
      timeout_cases: 1,
      metrics: {
        coverage: 'TIMEOUT',
        mutation_score: 'TIMEOUT',
        assertion_score: 'TIMEOUT',
        validity: 'TIMEOUT',
      },
      assertion_details: {
        score: 'TIMEOUT',
        summary: {
          total: 0,
          verified: 0,
          failed: 0,
          ineffective: 0,
          pass_rate: 'N/A',
          density: 'N/A',
          assertion_less_cases: 0,
        },
        assertions: [],
        unavailable_reason: 'Exceeded sandbox hard limit (60s) before AST assertion extraction finished.',
      },
      sandbox_policy: {
        untrusted_execution_enabled: false,
        isolation_status: 'policy_simulation',
        network: 'disabled',
        root_fs: 'read_only',
        timeout_seconds: 60,
      },
      logs: [
        '[14:00:00] Sandbox initialized.',
        '[14:00:05] Case #1 (test_quick): PASSED (8ms)',
        '[14:00:06] Case #2 (test_infinite_loop): Running...',
        '[14:01:06] ERROR: Sandbox hard limit 60s exceeded. Process SIGKILL sent.',
      ],
      cases: [
        { id: 'case-201', name: 'test_quick', status: 'PASSED', duration_ms: 8, coverage: 100, mutation_score: 90 },
        { id: 'case-202', name: 'test_infinite_loop', status: 'TIMEOUT', duration_ms: 60000, coverage: 'TIMEOUT', mutation_score: 'TIMEOUT', error: 'Exceeded sandbox timeout (60s)' },
      ],
    },
    {
      id: 'exec-run-106',
      project_id: 'demo-project',
      suite_name: 'Edge Condition Tests - L5 Hybrid',
      dataset_id: 'ds-sample-1',
      dataset_name: 'HumanEval Python Benchmarks',
      source_id: 'src-sample-1',
      source_name: 'solution_v1.py',
      status: 'COMPLETED',
      model: 'Claude 3.5 Sonnet',
      strategy: 'L5: Hybrid',
      duration_ms: 18500,
      can_cancel: false,
      created_at: new Date(Date.now() - 14400000).toISOString(),
      started_at: new Date(Date.now() - 14390000).toISOString(),
      completed_at: new Date(Date.now() - 14371500).toISOString(),
      cancelled_at: null,
      cancel_reason: null,
      source_sha256: 'c3f9104e80bd2e650d4b68f9ef94cb9d83df75796bfa8f16104bc1b519c5c999',
      total_cases: 8,
      completed_cases: 8,
      passed_cases: 8,
      failed_cases: 0,
      timeout_cases: 0,
      metrics: {
        coverage: 95.0,
        mutation_score: 90.0,
        validity: 'PASSED',
      },
      coverage_details: {
        covered_lines: 19,
        total_lines: 20,
        covered_ranges: ['L1-L19'],
        missed_ranges: ['L20'],
      },
      mutation_details: {
        mutants: [
          { id: 'MUT-01', operator: 'AOR', line: 12, original: 'a + b', mutated: 'a - b', status: 'KILLED', killed_by: 'test_edge' },
        ],
        summary: { killed: 1, survived: 0, timeout: 0, error: 0 },
      },
      sandbox_policy: {
        untrusted_execution_enabled: false,
        isolation_status: 'policy_simulation',
        network: 'disabled',
        root_fs: 'read_only',
        timeout_seconds: 60,
      },
      logs: [
        '[13:00:00] Sandbox initialized.',
        '[13:00:18] Execution completed successfully with 100% test pass rate.',
      ],
      cases: [
        { id: 'case-301', name: 'test_edge_1', status: 'PASSED', duration_ms: 10, coverage: 95, mutation_score: 90 },
      ],
      assertion_details: {
        score: 92.0,
        summary: { total: 4, verified: 4, failed: 0, ineffective: 0, pass_rate: 100, density: 1.0, assertion_less_cases: 0 },
        assertions: [
          { id: 'AST-301', test_case: 'test_edge_1', statement: 'assert edge_func() == True', type: 'EQUALITY', line: 10, status: 'VERIFIED', strength: 'HIGH', explanation: 'Validates edge behavior.' }
        ]
      }
    },
    {
      id: 'exec-run-107',
      project_id: 'demo-project',
      suite_name: 'Few-shot Quality Suite - L2',
      dataset_id: 'ds-sample-1',
      dataset_name: 'HumanEval Python Benchmarks',
      source_id: 'src-sample-1',
      source_name: 'solution_v1.py',
      status: 'COMPLETED',
      model: 'GPT-4o',
      strategy: 'L2: Few-shot',
      duration_ms: 24000,
      can_cancel: false,
      created_at: new Date(Date.now() - 18000000).toISOString(),
      started_at: new Date(Date.now() - 17990000).toISOString(),
      completed_at: new Date(Date.now() - 17966000).toISOString(),
      cancelled_at: null,
      cancel_reason: null,
      source_sha256: 'a9f24c3e80bd2e650d4b68f9ef94cb9d83df75796bfa8f16104bc1b519c5c2a1',
      dataset_snapshot_id: 'snap-he-python-v1',
      total_cases: 15,
      completed_cases: 15,
      passed_cases: 13,
      failed_cases: 2,
      timeout_cases: 0,
      metrics: {
        coverage: 82.5,
        mutation_score: 80.0,
        assertion_score: 86.5,
        validity: 'PASSED',
      },
      coverage_details: {
        covered_lines: 16,
        total_lines: 20,
        covered_ranges: ['L1-L16'],
        missed_ranges: ['L17-L20'],
      },
      mutation_details: {
        mutants: [
          { id: 'MUT-201', operator: 'AOR', line: 8, original: 'x * y', mutated: 'x + y', status: 'KILLED', killed_by: 'test_case_1' },
          { id: 'MUT-202', operator: 'ROR', line: 11, original: 'a < b', mutated: 'a <= b', status: 'SURVIVED', killed_by: null },
        ],
        summary: { killed: 4, survived: 1, timeout: 0, error: 0 },
      },
      assertion_details: {
        score: 86.5,
        summary: { total: 8, verified: 7, failed: 1, ineffective: 0, pass_rate: 87.5, density: 1.1, assertion_less_cases: 0 },
        assertions: [
          { id: 'AST-201', test_case: 'test_case_1', statement: 'assert result == 42', type: 'EQUALITY', line: 8, status: 'VERIFIED', strength: 'HIGH', explanation: 'Validates arithmetic equality.' },
        ],
      },
      sandbox_policy: {
        untrusted_execution_enabled: false,
        isolation_status: 'policy_simulation',
        network: 'disabled',
        root_fs: 'read_only',
        timeout_seconds: 60,
      },
      logs: ['[12:00:00] Sandbox initialized.', '[12:00:24] Execution completed successfully.'],
      cases: [
        { id: 'case-401', name: 'test_case_1', status: 'PASSED', duration_ms: 14, coverage: 85, mutation_score: 80 },
      ],
    },
    {
      id: 'exec-run-108',
      project_id: 'demo-project',
      suite_name: 'Self-consistency Rigor Suite - L4',
      dataset_id: 'ds-sample-1',
      dataset_name: 'HumanEval Python Benchmarks',
      source_id: 'src-sample-1',
      source_name: 'solution_v1.py',
      status: 'COMPLETED',
      model: 'GPT-4o',
      strategy: 'L4: Self-consistency',
      duration_ms: 38000,
      can_cancel: false,
      created_at: new Date(Date.now() - 21600000).toISOString(),
      started_at: new Date(Date.now() - 21590000).toISOString(),
      completed_at: new Date(Date.now() - 21552000).toISOString(),
      cancelled_at: null,
      cancel_reason: null,
      source_sha256: 'a9f24c3e80bd2e650d4b68f9ef94cb9d83df75796bfa8f16104bc1b519c5c2a1',
      dataset_snapshot_id: 'snap-he-python-v1',
      total_cases: 16,
      completed_cases: 16,
      passed_cases: 15,
      failed_cases: 1,
      timeout_cases: 0,
      metrics: {
        coverage: 92.0,
        mutation_score: 88.0,
        assertion_score: 93.0,
        validity: 'PASSED',
      },
      coverage_details: {
        covered_lines: 18,
        total_lines: 20,
        covered_ranges: ['L1-L18'],
        missed_ranges: ['L19-L20'],
      },
      mutation_details: {
        mutants: [
          { id: 'MUT-301', operator: 'ROR', line: 12, original: 'a == b', mutated: 'a != b', status: 'KILLED', killed_by: 'test_sc_1' },
        ],
        summary: { killed: 7, survived: 1, timeout: 0, error: 0 },
      },
      assertion_details: {
        score: 93.0,
        summary: { total: 10, verified: 9, failed: 1, ineffective: 0, pass_rate: 90.0, density: 1.3, assertion_less_cases: 0 },
        assertions: [
          { id: 'AST-301', test_case: 'test_sc_1', statement: 'assert solve(10) == 55', type: 'EQUALITY', line: 14, status: 'VERIFIED', strength: 'HIGH', explanation: 'Validates algorithmic accuracy.' },
        ],
      },
      sandbox_policy: {
        untrusted_execution_enabled: false,
        isolation_status: 'policy_simulation',
        network: 'disabled',
        root_fs: 'read_only',
        timeout_seconds: 60,
      },
      logs: ['[11:00:00] Sandbox initialized.', '[11:00:38] Execution completed successfully.'],
      cases: [
        { id: 'case-501', name: 'test_sc_1', status: 'PASSED', duration_ms: 22, coverage: 92, mutation_score: 88 },
      ],
    },
  ],
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        resolve({})
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname

  // Health check
  if (path === '/health') {
    sendJson(res, 200, { status: 'ok', version: '0.1.0-mock' })
    return
  }

  // Auth: Login
  if (path === '/api/v1/auth/login' && req.method === 'POST') {
    sendJson(res, 200, {
      access_token: 'mock-access-token-123',
      accessToken: 'mock-access-token-123',
      refresh_token: 'mock-refresh-token-123',
      refreshToken: 'mock-refresh-token-123',
      token_type: 'bearer',
    })
    return
  }

  // Auth: Me
  if (path === '/api/v1/auth/me') {
    sendJson(res, 200, {
      id: 'mock-user-uuid',
      email: 'tester@example.com',
      display_name: 'Tester',
    })
    return
  }

  // Projects list
  if (path === '/api/v1/projects' && req.method === 'GET') {
    sendJson(res, 200, [
      {
        id: 'demo-project',
        name: 'LLM Benchmark Evaluator',
        description: 'Workspace for testing Python benchmarks and CSV datasets.',
        current_revision: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
    return
  }

  // Single project details
  if (path === '/api/v1/projects/demo-project' && req.method === 'GET') {
    sendJson(res, 200, {
      id: 'demo-project',
      name: 'LLM Benchmark Evaluator',
      description: 'Workspace for testing Python benchmarks and CSV datasets.',
      current_revision: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return
  }

  // Project history
  if (path === '/api/v1/projects/demo-project/history') {
    sendJson(res, 200, [
      {
        revision: 1,
        name: 'LLM Benchmark Evaluator',
        description: 'Workspace for testing Python benchmarks and CSV datasets.',
        changed_at: new Date().toISOString(),
      },
    ])
    return
  }

  // Datasets: List
  if (path === '/api/v1/projects/demo-project/datasets' && req.method === 'GET') {
    const list = store.datasets.map((d) => ({
      id: d.dataset_id,
      project_id: d.project_id,
      current_revision: d.revision,
      created_at: d.created_at,
      updated_at: d.created_at,
    }))
    sendJson(res, 200, list)
    return
  }

  // Datasets: Create (POST /api/v1/projects/demo-project/datasets)
  if (path === '/api/v1/projects/demo-project/datasets' && req.method === 'POST') {
    const body = await readBody(req)
    const rows = body.rows || []

    const validatedRows = rows.map((r) => {
      const fn = r.function_name
      const isValidFn = fn && /^[A-Za-z_][A-Za-z0-9_]*$/.test(fn)
      const hasCode = Boolean(r.python_source && r.python_source.trim())
      const isInvalid = !isValidFn
      const status = isInvalid ? 'invalid' : hasCode ? 'valid' : 'preview_only'

      let parsedExpected = null
      if (r.expected_output) {
        try {
          parsedExpected = JSON.parse(r.expected_output)
        } catch {
          // invalid JSON
        }
      }

      return {
        row_number: r.row_number,
        task_id: r.task_id || null,
        function_name: fn || null,
        description: r.description || null,
        task_title: r.task_title || null,
        difficulty: r.difficulty || null,
        expected_output: parsedExpected,
        expected_output_provenance: parsedExpected !== null ? 'csv' : null,
        input_data: r.input_data ? JSON.parse(r.input_data) : null,
        status,
        reasons: isInvalid
          ? ['function_name must be a valid Python identifier']
          : !hasCode
            ? ['Reference source is required']
            : [],
        source_sha256: hasCode ? crypto.createHash('sha256').update(r.python_source).digest('hex') : null,
        runtime_status: 'N/A',
        runtime_reason: isInvalid ? 'Row is invalid' : hasCode ? 'Untrusted execution is disabled' : 'Reference source is required',
        execution_enabled: false,
      }
    })

    const datasetId = crypto.randomUUID()
    const versionOutput = {
      dataset_id: datasetId,
      project_id: 'demo-project',
      revision: 1,
      sha256: crypto.createHash('sha256').update(JSON.stringify(validatedRows)).digest('hex'),
      rows: validatedRows,
      selected_rows: [],
      reference_source_id: null,
      reference_revision: null,
      created_at: new Date().toISOString(),
    }

    store.datasets.unshift(versionOutput)
    sendJson(res, 201, versionOutput)
    return
  }

  // Datasets: Get single dataset preview
  const singleMatch = path.match(/^\/api\/v1\/projects\/demo-project\/datasets\/([^/]+)$/)
  if (singleMatch && req.method === 'GET') {
    const dsId = singleMatch[1]
    const ds = store.datasets.find((d) => d.dataset_id === dsId)
    if (!ds) {
      sendJson(res, 404, { detail: { message: 'Dataset not found' } })
      return
    }
    sendJson(res, 200, ds)
    return
  }

  // Datasets: Row selection snapshot
  const selectionMatch = path.match(/^\/api\/v1\/projects\/demo-project\/datasets\/([^/]+)\/selection$/)
  if (selectionMatch && req.method === 'POST') {
    const dsId = selectionMatch[1]
    const ds = store.datasets.find((d) => d.dataset_id === dsId)
    if (!ds) {
      sendJson(res, 404, { detail: { message: 'Dataset not found' } })
      return
    }
    const body = await readBody(req)
    const rowNumbers = body.row_numbers || []
    if (rowNumbers.length === 0) {
      sendJson(res, 422, {
        detail: { code: 'CSV_ROW_INVALID', message: 'Selection must be nonempty' },
      })
      return
    }
    const invalidRows = rowNumbers.filter((num) => {
      const row = ds.rows.find((r) => r.row_number === num)
      return !row || row.status !== 'valid'
    })
    if (invalidRows.length > 0) {
      sendJson(res, 422, {
        detail: {
          code: 'CSV_ROW_INVALID',
          message: `Rows cannot be selected: ${invalidRows.join(', ')}`,
        },
      })
      return
    }
    ds.revision += 1
    ds.selected_rows = rowNumbers
    sendJson(res, 200, ds)
    return
  }

  // Datasets: Link reference
  const refMatch = path.match(/^\/api\/v1\/projects\/demo-project\/datasets\/([^/]+)\/reference$/)
  if (refMatch && req.method === 'POST') {
    const dsId = refMatch[1]
    const ds = store.datasets.find((d) => d.dataset_id === dsId)
    if (!ds) {
      sendJson(res, 404, { detail: { message: 'Dataset not found' } })
      return
    }
    const body = await readBody(req)
    ds.revision += 1
    ds.reference_source_id = body.source_id
    ds.reference_revision = body.revision
    // Update preview_only rows to valid
    ds.rows.forEach((r) => {
      if (r.status === 'preview_only') {
        r.status = 'valid'
        r.reasons = []
      }
    })
    sendJson(res, 200, ds)
    return
  }

  // Reports: Results dashboard and history (FR-RPT-001/002/003, UC-11)
  const reportResultsMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/reports\/results$/)
  if (reportResultsMatch && req.method === 'GET') {
    const projId = reportResultsMatch[1]
    const list = store.executions.filter((e) => e.project_id === projId)
    sendJson(res, 200, {
      project_id: projId,
      total_runs: list.length,
      runs: list,
    })
    return
  }

  // Executions: List
  const execListMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/executions$/)
  if (execListMatch && req.method === 'GET') {
    const projId = execListMatch[1]
    const list = store.executions.filter((e) => e.project_id === projId)
    sendJson(res, 200, list)
    return
  }

  // Executions: Trigger new execution
  if (execListMatch && req.method === 'POST') {
    const projId = execListMatch[1]
    const body = await readBody(req)
    const newExec = {
      id: `exec-${crypto.randomUUID().slice(0, 8)}`,
      project_id: projId,
      suite_name: body.suite_name || 'Automated Suite Run',
      dataset_id: body.dataset_id || null,
      dataset_name: body.dataset_name || 'Standard Dataset',
      source_id: body.source_id || null,
      source_name: body.source_name || 'Active Source',
      status: 'QUEUED',
      can_cancel: true,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      cancelled_at: null,
      cancel_reason: null,
      total_cases: 10,
      completed_cases: 0,
      passed_cases: 0,
      failed_cases: 0,
      timeout_cases: 0,
      metrics: {
        coverage: 'N/A',
        mutation_score: 'N/A',
        assertion_score: 'N/A',
        validity: 'N/A',
      },
      assertion_details: null,
      sandbox_policy: {
        untrusted_execution_enabled: false,
        isolation_status: 'policy_simulation',
        network: 'disabled',
        root_fs: 'read_only',
        timeout_seconds: 60,
      },
      logs: ['[Just now] Run submitted. Waiting in sandbox execution queue.'],
      cases: [],
    }
    store.executions.unshift(newExec)
    sendJson(res, 201, newExec)
    return
  }

  // Executions: Get single execution
  const singleExecMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/executions\/([^/]+)$/)
  if (singleExecMatch && req.method === 'GET') {
    const projId = singleExecMatch[1]
    const execId = singleExecMatch[2]
    const exec = store.executions.find((e) => e.project_id === projId && e.id === execId)
    if (!exec) {
      sendJson(res, 404, { detail: { message: 'Execution run not found' } })
      return
    }
    sendJson(res, 200, exec)
    return
  }

  // Executions: Cancel run
  const cancelExecMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/executions\/([^/]+)\/cancel$/)
  if (cancelExecMatch && req.method === 'POST') {
    const projId = cancelExecMatch[1]
    const execId = cancelExecMatch[2]
    const exec = store.executions.find((e) => e.project_id === projId && e.id === execId)
    if (!exec) {
      sendJson(res, 404, { detail: { message: 'Execution run not found' } })
      return
    }
    if (!['QUEUED', 'RUNNING', 'PENDING'].includes(exec.status)) {
      sendJson(res, 409, {
        detail: {
          code: 'EXECUTION_CANNOT_BE_CANCELLED',
          message: `Execution run cannot be cancelled because it is already in state '${exec.status}'.`,
        },
      })
      return
    }
    const body = await readBody(req)
    exec.status = 'CANCELLED'
    exec.can_cancel = false
    exec.cancelled_at = new Date().toISOString()
    exec.cancel_reason = body.reason || 'User requested cancellation'
    exec.logs.push(`[${new Date().toISOString()}] Cancellation processed: ${exec.cancel_reason}`)
    sendJson(res, 200, exec)
    return
  }

  // Sources: List (GET /api/v1/projects/:projectId/sources)
  const sourcesListMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/sources$/)
  if (sourcesListMatch && req.method === 'GET') {
    sendJson(res, 200, [
      {
        id: 'src-sample-1',
        filename: 'math_utils.py',
        current_revision: 2,
        created_at: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        id: 'src-sample-2',
        filename: 'string_parser.py',
        current_revision: 1,
        created_at: new Date(Date.now() - 43200000).toISOString(),
      },
    ])
    return
  }

  // Sources: Get Version (GET /api/v1/projects/:projectId/sources/:sourceId/versions/:revision)
  const sourceVerMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/sources\/([^/]+)\/versions\/(\d+)$/)
  if (sourceVerMatch && req.method === 'GET') {
    const sourceId = sourceVerMatch[2]
    if (sourceId === 'src-sample-1') {
      sendJson(res, 200, {
        id: 'src-sample-1',
        filename: 'math_utils.py',
        current_revision: 2,
        functions: [
          { name: 'calculate_tax', line: 12 },
          { name: 'format_currency', line: 28 },
          { name: 'apply_discount', line: 45 },
          { name: 'sum_line_items', line: 62 },
        ],
      })
      return
    }
    sendJson(res, 200, {
      id: sourceId,
      filename: 'string_parser.py',
      current_revision: 1,
      functions: [
        { name: 'parse_tokens', line: 8 },
        { name: 'sanitize_identifier', line: 24 },
      ],
    })
    return
  }

  // Fallback 404
  sendJson(res, 404, { detail: { message: `Not found: ${req.method} ${path}` } })
})

server.listen(PORT, () => {
  console.log(`\n🚀 Mock Backend running at http://localhost:${PORT}`)
  console.log(`✨ You can now run 'npm run dev' and test the full UI without Docker or Python backend!`)
  console.log(`📌 Demo Project available at: http://localhost:5173/projects/demo-project?tab=datasets\n`)
})
