// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentSetupPage } from '../../src/features/experiments/ExperimentSetupPage'
import WorkspaceLayout from '../../src/components/layout/WorkspaceLayout'

const session = { accessToken: 'example-token' }
const source = { id: 'source-1', filename: 'math.py', current_revision: 2 }
const other = { id: 'source-2', filename: 'strings.py', current_revision: 1 }
const functions = [{ name: 'add', line: 1 }, { name: 'multiply', line: 9 }]
const storageKey = 'test-quality-lab:experiment-draft:project-1'
const onExpire = vi.fn()
let container
let root
let client
let fetchMock

beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchMock = vi.fn(async (url) => {
    if (url.endsWith('/sources')) return Response.json([source, other])
    if (url.endsWith('/source-1/versions/2')) return Response.json({ functions })
    if (url.endsWith('/source-2/versions/1')) return Response.json({ functions: [{ name: 'join', line: 2 }] })
    throw Error('Unexpected request')
  })
  vi.stubGlobal('fetch', fetchMock)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  client = new QueryClient()
  onExpire.mockClear()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  client.clear()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

async function renderWizard(path = '/projects/project-1/experiments/new') {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<WorkspaceLayout session={session} />}>
            <Route path="/projects/:projectId" element={<h1>Project details</h1>} />
            <Route path="/projects/:projectId/experiments/new" element={<ExperimentSetupPage session={session} onExpire={onExpire} />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
}

const get = (selector) => container.querySelector(selector)
const button = (label) => [...container.querySelectorAll('button')].find((item) => item.textContent.trim() === label)

async function setInput(selector, value) {
  const element = get(selector)
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

async function selectSource(id) {
  await vi.waitFor(() => expect(get('#experiment-source')).not.toBeNull())
  await setInput('#experiment-source', id)
  await vi.waitFor(() => expect(get('input[type=checkbox]')).not.toBeNull())
}

describe('Experiment setup (#36)', () => {
  it('opens the wizard from the current project sidebar and highlights its link', async () => {
    await renderWizard('/projects/project-1')
    const setup = get('nav[aria-label="Workspace"] a[href="/projects/project-1/experiments/new"]')
    expect(setup.textContent.trim()).toBe('Set up experiment')
    await act(async () => setup.click())
    expect(get('main h1').textContent).toBe('Set up experiment')
    expect(setup.getAttribute('aria-current')).toBe('page')
  })

  it('selects a source revision, functions and strategies, then saves and restores the run matrix', async () => {
    await renderWizard()
    await selectSource(source.id)
    await act(async () => button('Continue').click())
    expect(get('[role=alert]').textContent).toContain('at least one available function')
    await act(async () => button('Select all functions').click())
    await act(async () => button('Continue').click())
    await setInput('#experiment-models', '  model-a\nmodel-b\nmodel-a')
    await setInput('#experiment-repeats', '3')
    const choices = container.querySelectorAll('input[type=checkbox]')
    await act(async () => { choices[0].click(); choices[2].click() })
    expect(get('[aria-live="polite"]').textContent).toBe('24')
    await act(async () => button('Continue').click())
    expect(get('form').textContent).toContain('math.py · Revision 2')
    await act(async () => button('Save draft').click())
    expect(get('[role=status]').textContent).toBe('Draft saved in this tab.')
    expect(JSON.parse(sessionStorage.getItem(storageKey))).toEqual({
      version: 1, source: { id: source.id, revision: 2 }, functions,
      models: ['model-a', 'model-b'], strategies: ['L1', 'L3'], repeats: 3,
    })
    expect(fetchMock.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true)

    await act(async () => root.unmount())
    root = createRoot(container)
    await renderWizard()
    await vi.waitFor(() => expect(get('#experiment-source')?.value).toBe(source.id))
    await vi.waitFor(() => expect(container.querySelectorAll('input:checked')).toHaveLength(2))
    expect(get('[aria-live="polite"]').textContent).toBe('24')
  })

  it('clears prior function selections when changing source and rejects a matrix over 1,000 runs', async () => {
    await renderWizard()
    await selectSource(source.id)
    await act(async () => button('Select all functions').click())
    await selectSource(other.id)
    await vi.waitFor(() => expect(container.textContent).toContain('join'))
    expect(get('input[type=checkbox]').checked).toBe(false)
    await act(async () => button('Select all functions').click())
    await act(async () => button('Continue').click())
    await setInput('#experiment-models', 'model-a\nmodel-b')
    await setInput('#experiment-repeats', '501')
    await act(async () => get('input[type=checkbox]').click())
    await act(async () => button('Continue').click())
    expect(get('[role=alert]').textContent).toContain('exceeds 1,000 runs')
    expect(button('Save draft')).toBeUndefined()
  })

  it('links to Python source when there are no saved files', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([]))
    await renderWizard()
    await vi.waitFor(() => expect(container.textContent).toContain('No Python sources yet'))
    expect(get('a[href="/projects/project-1/sources/new"]')).not.toBeNull()
    expect(button('Continue').disabled).toBe(true)
  })

  it('previews experiment matrix with configured functions, L1-L5 options, models, and repetitions in Step 2 (#69)', async () => {
    await renderWizard()
    await selectSource(source.id)
    await act(async () => button('Select all functions').click())
    await act(async () => button('Continue').click())

    await setInput('#experiment-models', 'gpt-4o\nclaude-3-5')
    await setInput('#experiment-repeats', '2')
    const choices = container.querySelectorAll('input[type=checkbox]')
    await act(async () => {
      choices[0].click() // L1
      choices[1].click() // L2
    })
    expect(get('[aria-live="polite"]').textContent).toBe('16')

    await act(async () => button('Continue').click())

    // Review / Matrix Preview step
    expect(get('[data-testid="experiment-matrix-preview"]')).not.toBeNull()
    expect(get('[data-testid="matrix-total-runs"]').textContent).toBe('16')
    expect(get('[data-testid="matrix-functions-count"]').textContent).toBe('2')
    expect(get('[data-testid="matrix-models-count"]').textContent).toBe('2')
    expect(get('[data-testid="matrix-status-valid"]').textContent).toContain('Valid Configuration')

    // Check Matrix Grid view
    expect(get('[data-testid="matrix-grid-view"]')).not.toBeNull()

    // Switch to Planned Runs list
    await act(async () => get('[data-testid="tab-matrix-plan"]').click())
    expect(get('[data-testid="matrix-plan-view"]')).not.toBeNull()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(16)
  })

  it('rejects invalid configuration when model identifier exceeds 120 characters (#69)', async () => {
    await renderWizard()
    await selectSource(source.id)
    await act(async () => button('Select all functions').click())
    await act(async () => button('Continue').click())

    const longModel = 'a'.repeat(121)
    await setInput('#experiment-models', longModel)
    await setInput('#experiment-repeats', '2')
    await act(async () => container.querySelector('input[type=checkbox]').click())

    await act(async () => button('Continue').click())
    expect(get('[role=alert]').textContent).toContain('120 characters or fewer')
    expect(button('Save draft')).toBeUndefined()
  })

  it('rejects invalid configuration when no prompt strategies are selected (#69)', async () => {
    await renderWizard()
    await selectSource(source.id)
    await act(async () => button('Select all functions').click())
    await act(async () => button('Continue').click())

    await setInput('#experiment-models', 'gpt-4o')
    await setInput('#experiment-repeats', '2')
    // No checkboxes checked

    await act(async () => button('Continue').click())
    expect(get('[role=alert]').textContent).toContain('Select at least one prompt strategy')
    expect(button('Save draft')).toBeUndefined()
  })

  it('retries a source list error and handles an expired session', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
    await renderWizard()
    await vi.waitFor(() => expect(get('[role=alert]').textContent).toContain('Could not load Python sources'))
    await act(async () => button('Retry').click())
    await vi.waitFor(() => expect(onExpire).toHaveBeenCalledWith(session))
  })
})
