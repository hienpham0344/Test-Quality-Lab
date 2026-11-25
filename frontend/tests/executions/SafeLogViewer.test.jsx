// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SafeLogViewer } from '../../src/features/executions/SafeLogViewer'

let container
let root

function setInputValue(element, value) {
  const isTextArea = element instanceof HTMLTextAreaElement
  const prototype = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

const sampleLogs = [
  '[17:00:01] Sandbox initialized with policy: read-only rootfs, network disabled, timeout 60s.',
  '[17:00:02] [SECURITY] Outbound socket connection blocked by sandbox policy',
  '[17:00:05] Case #1 (test_add): PASSED (12ms)',
  '[17:00:15] Case #2 (test_edge_cases): FAILED (AssertionError: 0 != 1)',
]

describe('SafeLogViewer component (UC-09)', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    container = null
  })

  it('renders log lines with stream badges, line numbers, and security banner', async () => {
    await act(async () => {
      root.render(<SafeLogViewer logs={sampleLogs} />)
    })

    expect(container.textContent).toContain('Sandbox Execution Logs (4 of 4)')
    expect(container.textContent).toContain('Sanitized Output • Untrusted Execution Disabled')
    expect(container.textContent).toContain('Case #1 (test_add): PASSED (12ms)')
    expect(container.textContent).toContain('AssertionError: 0 != 1')
  })

  it('filters logs by stream tab', async () => {
    await act(async () => {
      root.render(<SafeLogViewer logs={sampleLogs} />)
    })

    // Click 'stderr' stream tab
    const stderrBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('stderr')
    )
    expect(stderrBtn).toBeDefined()

    await act(async () => {
      stderrBtn.click()
    })

    expect(container.textContent).toContain('test_edge_cases')
    expect(container.textContent).not.toContain('test_add')

    // Click 'system' stream tab
    const systemBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('system')
    )
    await act(async () => {
      systemBtn.click()
    })

    expect(container.textContent).toContain('Sandbox initialized')
    expect(container.textContent).not.toContain('test_edge_cases')
  })

  it('filters logs by search query and allows clearing search', async () => {
    await act(async () => {
      root.render(<SafeLogViewer logs={sampleLogs} />)
    })

    const searchInput = container.querySelector('input[placeholder="Search logs..."]')
    expect(searchInput).not.toBeNull()

    await act(async () => {
      setInputValue(searchInput, 'AssertionError')
    })

    expect(container.textContent).toContain('test_edge_cases')
    expect(container.textContent).not.toContain('test_add')

    // Clear search button
    const clearBtn = container.querySelector('button[aria-label="Clear search"]')
    expect(clearBtn).not.toBeNull()

    await act(async () => {
      clearBtn.click()
    })

    expect(container.textContent).toContain('test_add')
  })

  it('displays active test case filter and triggers onClearCaseFilter', async () => {
    const handleClear = vi.fn()

    await act(async () => {
      root.render(
        <SafeLogViewer
          logs={sampleLogs}
          activeCaseFilter="test_edge_cases"
          onClearCaseFilter={handleClear}
        />
      )
    })

    expect(container.textContent).toContain('Filtered for test case:')
    expect(container.textContent).toContain('test_edge_cases')
    expect(container.textContent).not.toContain('test_add')

    const clearCaseBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Clear filter')
    )
    expect(clearCaseBtn).toBeDefined()

    await act(async () => {
      clearCaseBtn.click()
    })

    expect(handleClear).toHaveBeenCalledTimes(1)
  })

  it('toggles diagnostic explanations on and off', async () => {
    await act(async () => {
      root.render(<SafeLogViewer logs={sampleLogs} />)
    })

    // Initially Explanations is on by default
    expect(container.textContent).toContain('Assertion Failure')
    expect(container.textContent).toContain('Check edge cases')

    // Toggle off
    const explanationsBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Explanations')
    )
    await act(async () => {
      explanationsBtn.click()
    })

    expect(container.textContent).not.toContain('Check edge cases')
  })

  it('copies sanitized logs to clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })

    await act(async () => {
      root.render(<SafeLogViewer logs={sampleLogs} />)
    })

    const copyBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Copy')
    )
    expect(copyBtn).toBeDefined()

    await act(async () => {
      copyBtn.click()
    })

    expect(writeTextMock).toHaveBeenCalled()
    expect(container.textContent).toContain('Copied')
  })
})
