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
          <Route
            path="/projects"
            element={<div data-testid="projects-page">Projects Page</div>}
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

describe('ProjectEditorPage (FR-PRJ-002, Issue #90)', () => {
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

  // DoD: 404 page
  describe('404 page', () => {
    it('shows "Project not found" page for missing project (404)', async () => {
      fetchMock.mockImplementation(async (url) => {
        if (url.endsWith('/history')) return { ok: true, json: async () => [] }
        return { ok: false, status: 404, json: async () => ({ detail: 'Project not found' }) }
      })

      await renderEditor('/projects/p-nonexistent')
      await vi.waitFor(() => {
        expect(container.textContent).toContain('Project not found')
        expect(container.querySelector('[role=alert]').textContent).toContain(
          'Project not found or you don’t have access to it.'
        )
        const backLink = container.querySelector('a[href="/projects"]')
        expect(backLink).not.toBeNull()
        expect(backLink.textContent).toContain('Back to projects')
      })
    })

    it('shows identical "Project not found" page for another user\'s private project (404)', async () => {
      // Backend returns 404 for unauthorized owner access to avoid leaking project existence
      fetchMock.mockImplementation(async (url) => {
        if (url.endsWith('/history')) return { ok: true, json: async () => [] }
        return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) }
      })

      await renderEditor('/projects/p-other-user')
      await vi.waitFor(() => {
        expect(container.textContent).toContain('Project not found')
        expect(container.querySelector('[role=alert]').textContent).toContain(
          'Project not found or you don’t have access to it.'
        )
        const backLink = container.querySelector('a[href="/projects"]')
        expect(backLink).not.toBeNull()
      })
    })
  })

  it('triggers onExpire when session is rejected (401)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    await renderEditor('/projects/p-1')
    await vi.waitFor(() => {
      expect(onExpire).toHaveBeenCalledWith(session)
    })
  })

  // DoD: view
  it('view: renders project details, timestamps, revision, tabs, and frozen experiments note', async () => {
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

    // Check name and description fields
    const nameInput = container.querySelector('#edit-project-name')
    const descInput = container.querySelector('#edit-project-description')
    expect(nameInput.value).toBe('LLM Evaluator')
    expect(descInput.value).toBe('Testing models')

    // Check revision badge and timestamps
    expect(container.textContent).toContain('Revision 2')
    expect(container.textContent).toContain('Created')
    expect(container.textContent).toContain('Last modified')

    // Check tabs: Overview, History (F5), Experiments (F6)
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.some((b) => b.textContent.includes('Overview'))).toBe(true)
    expect(buttons.some((b) => b.textContent.includes('History (F5)'))).toBe(true)
    expect(buttons.some((b) => b.textContent.includes('Experiments (F6)'))).toBe(true)

    // Check note on screen (FR-PRJ-002)
    expect(container.textContent).toContain(
      'Editing metadata does not change experiments already frozen (FR-PRJ-002).'
    )

    // Switch to History (F5) tab
    const historyTabBtn = buttons.find((b) => b.textContent.includes('History (F5)'))
    await act(async () => historyTabBtn.click())
    expect(container.textContent).toContain('LLM Evaluator (Draft)')

    // Switch to Experiments (F6) tab
    const expTabBtn = buttons.find((b) => b.textContent.includes('Experiments (F6)'))
    await act(async () => expTabBtn.click())
    expect(container.textContent).toContain('Frozen per revision')
    expect(container.textContent).toContain('No experiments recorded yet')
  })

  // DoD: edit success
  it('edit success: allows editing fields, updates cache, and displays success feedback', async () => {
    const updatedProject = {
      ...mockProject,
      name: 'Updated Evaluator',
      description: 'New evaluation description',
      current_revision: 3,
      updated_at: '2026-11-06T10:00:00Z',
    }

    fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => updatedProject,
        }
      }
      if (url.endsWith('/history')) return { ok: true, json: async () => mockHistory }
      return { ok: true, json: async () => mockProject }
    })

    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

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
      setInputValue(descInput, 'New evaluation description')
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

    // Verify cache update and invalidation
    expect(client.getQueryData(['private', 'project', 'p-1'])).toEqual(updatedProject)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['private', 'projects'] })

    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH')
    expect(patchCall).toBeDefined()
    expect(JSON.parse(patchCall[1].body)).toEqual({
      name: 'Updated Evaluator',
      description: 'New evaluation description',
    })

    // After success, form is in sync with updated values and Save is disabled
    expect(saveButton.disabled).toBe(true)
  })

  // DoD: validation error keeps input
  it('validation error keeps input: server validation failure retains user input and displays field errors', async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === 'PATCH') {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            detail: 'Project name already in use',
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

    await act(async () => {
      setInputValue(nameInput, 'Duplicate Project Name')
      setInputValue(descInput, 'Some new description')
    })

    const form = container.querySelector('form')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('[role=alert]').textContent).toContain('Project name already in use')
    })

    // Form input MUST be retained, not wiped
    expect(nameInput.value).toBe('Duplicate Project Name')
    expect(descInput.value).toBe('Some new description')
  })

  // DoD: cancel
  it('cancel: restores original values and resets Save button to disabled', async () => {
    fetchMock.mockImplementation(async (url) => {
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
    const cancelButton = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Cancel'))

    expect(cancelButton.disabled).toBe(true)
    expect(saveButton.disabled).toBe(true)

    // User modifies values
    await act(async () => {
      setInputValue(nameInput, 'Temporarily Changed Name')
      setInputValue(descInput, 'Temporarily Changed Description')
    })

    expect(nameInput.value).toBe('Temporarily Changed Name')
    expect(cancelButton.disabled).toBe(false)
    expect(saveButton.disabled).toBe(false)

    // User clicks Cancel
    await act(async () => cancelButton.click())

    // Form restored to original project values
    expect(nameInput.value).toBe('LLM Evaluator')
    expect(descInput.value).toBe('Testing models')
    expect(cancelButton.disabled).toBe(true)
    expect(saveButton.disabled).toBe(true)
  })

  // DoD: unsaved-changes guard
  it('unsaved-changes guard: warns when leaving with unsaved edits, allows staying or discarding', async () => {
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
      setInputValue(nameInput, 'Unsaved Name Edit')
    })

    // Test beforeunload event listener
    const beforeUnloadEvent = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnloadEvent)
    expect(beforeUnloadEvent.defaultPrevented).toBe(true)

    // Test breadcrumb navigation interception
    const breadcrumbProjectsBtn = container.querySelector('nav[aria-label="Breadcrumb"] button')
    await act(async () => breadcrumbProjectsBtn.click())

    // Unsaved changes dialog should be visible
    expect(container.querySelector('[role=dialog]')).not.toBeNull()
    expect(container.textContent).toContain('Unsaved changes')
    expect(container.textContent).toContain(
      'You have unsaved changes to this project. If you leave now, your changes will be discarded.'
    )

    // Click "Keep editing"
    const keepEditingBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Keep editing')
    await act(async () => keepEditingBtn.click())

    // Modal closed and edits still present
    expect(container.querySelector('[role=dialog]')).toBeNull()
    expect(nameInput.value).toBe('Unsaved Name Edit')

    // Click breadcrumb again and choose "Discard changes"
    await act(async () => breadcrumbProjectsBtn.click())
    expect(container.querySelector('[role=dialog]')).not.toBeNull()

    const discardBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Discard changes')
    await act(async () => discardBtn.click())

    // Modal closed and navigated to /projects
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="projects-page"]')).not.toBeNull()
    })
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

