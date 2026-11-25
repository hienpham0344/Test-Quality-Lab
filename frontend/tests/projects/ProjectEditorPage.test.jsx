// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectEditorPage } from '../../src/features/projects/ProjectEditorPage'

HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
HTMLDialogElement.prototype.close ??= function () { this.open = false }

let container
let root
let fetchMock
let client
const session = { accessToken: 'test-token' }
let onExpire

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  onExpire = vi.fn()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  client.clear()
  vi.unstubAllGlobals()
})

async function renderEditor(initialPath = '/projects/p-1', mode = 'edit') {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/projects" element={<h1>Projects registry</h1>} />
          <Route
            path="/projects/:projectId"
            element={<ProjectEditorPage session={session} onExpire={onExpire} mode={mode} />}
          />
          <Route
            path="/projects/new"
            element={<ProjectEditorPage session={session} onExpire={onExpire} mode="create" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
}

function setInputValue(element, value) {
  const isTextArea = element instanceof HTMLTextAreaElement
  const prototype = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('ProjectEditorPage', () => {
  const mockProject = {
    id: 'p-1',
    name: 'LLM Evaluator',
    description: 'Testing models',
    current_revision: 2,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-05T15:30:00Z',
  }

  const mockHistory = [
    { revision: 1, name: 'LLM Evaluator (Draft)', description: 'Initial', changed_at: '2026-11-01T12:00:00Z' },
    { revision: 2, name: 'LLM Evaluator', description: 'Testing models', changed_at: '2026-11-05T15:30:00Z' },
  ]

  it('renders loading state while project is being fetched', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    await renderEditor('/projects/p-1')
    expect(container.querySelector('[role=status]').textContent).toContain('Loading project details…')
  })

  it('shows not found error when project does not exist (404)', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/history')) return { ok: true, json: async () => [] }
      return { ok: false, status: 404 }
    })

    await renderEditor('/projects/p-404')
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Project not found')
      expect(container.querySelector('[role=alert]').textContent).toContain('Project not found or you don’t have access to it')
      expect(container.querySelector('a[href="/projects"]')).not.toBeNull()
    })
  })

  it('triggers onExpire when session is rejected (401)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    await renderEditor('/projects/p-1')
    await vi.waitFor(() => {
      expect(onExpire).toHaveBeenCalledWith(session)
    })
  })

  it('renders project fields, revision badge, and revision history', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/history')) return { ok: true, json: async () => mockHistory }
      return { ok: true, json: async () => mockProject }
    })

    await renderEditor('/projects/p-1')
    await vi.waitFor(() => {
      expect(container.querySelector('h1').textContent).toBe('Edit project')
    })
    const backLink = container.querySelector('a[href="/projects"]')
    expect(backLink.textContent.trim()).toBe('Back to projects')
    expect(backLink.getAttribute('href')).toBe('/projects')

    const nameInput = container.querySelector('#edit-project-name')
    const descInput = container.querySelector('#edit-project-description')
    expect(nameInput.value).toBe('LLM Evaluator')
    expect(descInput.value).toBe('Testing models')

    expect(container.textContent).toContain('Revision 2')
    expect(container.textContent).toContain('Editing project metadata does not change existing experiment snapshots.')
    const historyTab = [...container.querySelectorAll('button')].find((button) => button.textContent === 'History')
    await act(async () => historyTab.click())
    await vi.waitFor(() => expect(container.textContent).toContain('LLM Evaluator (Draft)'))
    expect(historyTab.getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('Revision history')
  })

  it('sorts revisions, paginates, and filters by inclusive local dates without losing change markers', async () => {
    const revisions = Array.from({ length: 7 }, (_, index) => ({
      revision: index + 1,
      name: index === 0 ? 'Original name' : 'Renamed project',
      description: index >= 2 ? 'Updated description' : null,
      changed_at: new Date(2026, 10, index + 1, 12).toISOString(),
    }))
    fetchMock.mockImplementation(async (url) => Response.json(url.endsWith('/history') ? revisions : mockProject))
    await renderEditor('/projects/p-1?tab=history')
    const rows = () => [...container.querySelectorAll('ol li')]
    const button = (name) => [...container.querySelectorAll('button')].find((item) => item.textContent === name)
    await vi.waitFor(() => expect(rows()).toHaveLength(5))
    expect(rows()[0].textContent).toContain('Revision 7')
    expect(rows()[4].textContent).toContain('Revision 3')
    expect(rows()[4].querySelectorAll('dt')[1].textContent).toBe('DescriptionChanged')
    expect(rows()[4].querySelectorAll('dt')[0].textContent).toBe('Name')
    expect(button('Previous').disabled).toBe(true)

    await act(async () => button('Next').click())
    expect(rows()).toHaveLength(2)
    expect(rows()[0].textContent).toContain('Revision 2')
    expect(rows()[0].querySelectorAll('dt')[0].textContent).toBe('NameChanged')
    expect(rows()[1].textContent).not.toContain('Changed')
    expect(button('Next').disabled).toBe(true)

    const dates = container.querySelectorAll('input[type=date]')
    await act(async () => {
      setInputValue(dates[0], '2026-11-03')
      setInputValue(dates[1], '2026-11-03')
    })
    expect(rows()).toHaveLength(1)
    expect(rows()[0].textContent).toContain('Revision 3')
    expect(rows()[0].querySelectorAll('dt')[1].textContent).toBe('DescriptionChanged')

    await act(async () => setInputValue(dates[1], '2026-11-02'))
    expect(container.querySelector('#history-date-error')).not.toBeNull()
    await act(async () => {
      setInputValue(dates[1], '2026-11-09')
      setInputValue(dates[0], '2026-11-08')
    })
    expect(rows()).toHaveLength(0)
    expect(container.textContent).toContain('No changes in this period')
    expect(container.querySelector('[role=alert]')).toBeNull()

    await act(async () => button('Clear dates').click())
    expect(rows()).toHaveLength(5)
    expect(rows()[0].textContent).toContain('Revision 7')
  })

  it('retries a history load failure without reloading project metadata', async () => {
    let attempts = 0
    fetchMock.mockImplementation(async (url) => {
      if (!url.endsWith('/history')) return Response.json(mockProject)
      attempts += 1
      return attempts === 1 ? new Response(null, { status: 503 }) : Response.json(mockHistory)
    })
    await renderEditor('/projects/p-1?tab=history')
    await vi.waitFor(() => expect(container.querySelector('[role=alert]')?.textContent).toContain('Could not load revision history'))
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Try again')
    await act(async () => retry.click())
    await vi.waitFor(() => expect(container.querySelectorAll('ol li')).toHaveLength(2))
    expect(attempts).toBe(2)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/projects/p-1'))).toHaveLength(1)
  })

  it('keeps edits on dismissal and discards only after confirming a tab switch', async () => {
    fetchMock.mockImplementation(async (url) => Response.json(url.endsWith('/history') ? mockHistory : url.endsWith('/datasets') ? [] : mockProject))
    await renderEditor()
    await vi.waitFor(() => expect(container.querySelector('#edit-project-name')?.value).toBe(mockProject.name))
    const name = container.querySelector('#edit-project-name')
    const button = (label) => [...container.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
    await act(async () => setInputValue(name, 'Unsaved name'))
    const unload = new Event('beforeunload', { cancelable: true })
    expect(window.dispatchEvent(unload)).toBe(false)
    await act(async () => button('Datasets (CSV)').click())
    expect(container.querySelector('dialog').open).toBe(true)
    expect(document.activeElement).toBe(button('Keep editing'))
    await act(async () => button('Keep editing').click())
    expect(name.value).toBe('Unsaved name')
    await act(async () => button('Datasets (CSV)').click())
    await act(async () => button('Discard changes').click())
    expect(container.querySelector('dialog')).toBeNull()
    expect(button('Datasets (CSV)').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('Project settings').click())
    expect(container.querySelector('#edit-project-name').value).toBe(mockProject.name)
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  })

  it('guards Back to projects and follows it after discard', async () => {
    fetchMock.mockImplementation(async (url) => Response.json(url.endsWith('/history') ? mockHistory : mockProject))
    await renderEditor()
    await vi.waitFor(() => expect(container.querySelector('#edit-project-name')?.value).toBe(mockProject.name))
    await act(async () => setInputValue(container.querySelector('#edit-project-name'), 'Unsaved name'))
    await act(async () => container.querySelector('a[href="/projects"]').click())
    const dialog = container.querySelector('dialog')
    expect(dialog).not.toBeNull()
    await act(async () => dialog.querySelector('button:last-child').click())
    expect(container.querySelector('h1').textContent).toBe('Projects registry')
  })

  it('allows editing fields, validates them, and saves changes', async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({
            ...mockProject,
            name: 'Updated Evaluator',
            description: 'New description',
            current_revision: 3,
          }),
        }
      }
      if (url.endsWith('/history')) return { ok: true, json: async () => mockHistory }
      return { ok: true, json: async () => mockProject }
    })

    await renderEditor('/projects/p-1')
    await vi.waitFor(() => {
      expect(container.querySelector('#edit-project-name').value).toBe('LLM Evaluator')
    })

    const nameInput = container.querySelector('#edit-project-name')
    const descInput = container.querySelector('#edit-project-description')
    const saveButton = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Save changes'))

    // Initially save is disabled because form is unchanged
    expect(saveButton.disabled).toBe(true)

    // Modify fields
    await act(async () => {
      setInputValue(nameInput, 'Updated Evaluator')
      setInputValue(descInput, 'New description')
    })

    expect(saveButton.disabled).toBe(false)

    // Submit form
    const form = container.querySelector('form')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('[role=status]').textContent).toContain('Project updated successfully')
    })

    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH')
    expect(patchCall).toBeDefined()
    expect(JSON.parse(patchCall[1].body)).toEqual({
      name: 'Updated Evaluator',
      description: 'New description',
    })
  })

  it('resets dirty form inputs on Reset click', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/history')) return { ok: true, json: async () => mockHistory }
      return { ok: true, json: async () => mockProject }
    })

    await renderEditor('/projects/p-1')
    await vi.waitFor(() => {
      expect(container.querySelector('#edit-project-name').value).toBe('LLM Evaluator')
    })

    const nameInput = container.querySelector('#edit-project-name')
    await act(async () => {
      setInputValue(nameInput, 'Something Else')
    })

    expect(nameInput.value).toBe('Something Else')
    const resetButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reset')
    await act(async () => resetButton.click())

    expect(nameInput.value).toBe('LLM Evaluator')
  })

  it('handles create mode at /projects/new', async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'p-new-123',
            name: 'Created from Page',
            description: 'Brand new',
            current_revision: 1,
          }),
        }
      }
      return { ok: true, json: async () => [] }
    })

    await renderEditor('/projects/new', 'create')
    expect(container.querySelector('h1').textContent).toBe('Create new project')

    const nameInput = container.querySelector('#edit-project-name')
    const descInput = container.querySelector('#edit-project-description')

    await act(async () => {
      setInputValue(nameInput, 'Created from Page')
      setInputValue(descInput, 'Brand new')
    })

    const form = container.querySelector('form')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')
    expect(postCall).toBeDefined()
    expect(JSON.parse(postCall[1].body)).toEqual({
      name: 'Created from Page',
      description: 'Brand new',
    })
  })

  it('switches to Executions (UC-08) tab and displays execution management UI', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('/api/v1/projects/p-1/executions')) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes('/api/v1/projects/p-1/history')) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes('/api/v1/projects/p-1')) {
        return { ok: true, json: async () => mockProject }
      }
      return { ok: true, json: async () => [] }
    })

    await renderEditor('/projects/p-1?tab=executions', 'edit')

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Sandbox Security Gate & Untrusted Execution Policy (UC-08)')
      expect(container.textContent).toContain('Execution Runs')
      expect(container.querySelector('[data-testid="trigger-new-run-btn"]')).not.toBeNull()
    })
  })
})

