// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectEditorPage } from '../../src/features/projects/ProjectEditorPage'

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

    const nameInput = container.querySelector('#edit-project-name')
    const descInput = container.querySelector('#edit-project-description')
    expect(nameInput.value).toBe('LLM Evaluator')
    expect(descInput.value).toBe('Testing models')

    expect(container.textContent).toContain('Revision 2')
    expect(container.textContent).toContain('Revision history')
    expect(container.textContent).toContain('LLM Evaluator (Draft)')
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
})
