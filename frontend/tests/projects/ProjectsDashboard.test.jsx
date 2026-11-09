// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsPage } from '../../src/features/projects/ProjectsPage'

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

async function renderPage() {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectsPage session={session} onExpire={onExpire} />
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

describe('ProjectsDashboard', () => {
  it('shows checking access while pending', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    await renderPage()
    expect(container.querySelector('[role=status]').textContent).toContain('Checking access to your projects…')
  })

  it('renders empty state when user has no projects', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    await renderPage()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('You don’t have any projects yet.')
      expect(container.textContent).toContain('Create your first project')
    })
  })

  it('renders list of projects with details, revisions, and edit links', async () => {
    const mockProjects = [
      {
        id: 'p-1',
        name: 'Evaluation Suite Alpha',
        description: 'Testing prompt variation L1',
        current_revision: 3,
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-05T12:00:00Z',
      },
      {
        id: 'p-2',
        name: 'Benchmark Beta',
        description: null,
        current_revision: 1,
        created_at: '2026-11-02T10:00:00Z',
        updated_at: '2026-11-02T10:00:00Z',
      },
    ]

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockProjects,
    })

    await renderPage()
    await vi.waitFor(() => {
      expect(container.querySelector('h2').textContent).toBe('Evaluation Suite Alpha')
    })

    expect(container.textContent).toContain('Testing prompt variation L1')
    expect(container.textContent).toContain('v3')
    expect(container.textContent).toContain('Benchmark Beta')
    expect(container.textContent).toContain('No description provided')
    expect(container.textContent).toContain('v1')

    const editLinks = container.querySelectorAll('a[href^="/projects/"]')
    expect(editLinks.length).toBe(2)
    expect(editLinks[0].getAttribute('href')).toBe('/projects/p-1')
    expect(editLinks[1].getAttribute('href')).toBe('/projects/p-2')
  })

  it('filters projects by search term and resets search', async () => {
    const mockProjects = [
      { id: '1', name: 'Alpha Suite', description: 'Evaluation', current_revision: 1 },
      { id: '2', name: 'Beta Runner', description: 'Execution', current_revision: 2 },
    ]
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => mockProjects,
    })

    await renderPage()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Alpha Suite')
      expect(container.textContent).toContain('Beta Runner')
    })

    const searchInput = container.querySelector('#search-projects')
    await act(async () => {
      setInputValue(searchInput, 'Beta')
    })

    expect(container.textContent).not.toContain('Alpha Suite')
    expect(container.textContent).toContain('Beta Runner')

    // Search with no results
    await act(async () => {
      setInputValue(searchInput, 'Nonexistent')
    })
    expect(container.textContent).toContain('No projects match “Nonexistent”.')

    // Click reset
    const resetButton = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Reset search'))
    await act(async () => resetButton.click())
    expect(container.textContent).toContain('Alpha Suite')
    expect(container.textContent).toContain('Beta Runner')
  })

  it('shows error state and retries fetching', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    await renderPage()

    await vi.waitFor(() => {
      expect(container.querySelector('[role=alert]').textContent).toContain('We couldn’t load your projects. Please try again.')
    })

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'p-1', name: 'Recovered Project', current_revision: 1 }],
    })

    const retryButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Try again')
    await act(async () => retryButton.click())

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Recovered Project')
    })
  })

  it('calls onExpire when projects request returns 401', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    await renderPage()

    await vi.waitFor(() => {
      expect(onExpire).toHaveBeenCalledWith(session)
    })
  })

  it('opens create project modal and creates a project successfully', async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            id: 'p-new',
            name: 'New Test Project',
            description: 'My description',
            current_revision: 1,
          }),
        }
      }
      return {
        ok: true,
        json: async () => [],
      }
    })

    await renderPage()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('You don’t have any projects yet.')
    })

    const openButton = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Create your first project'))
    await act(async () => openButton.click())

    // Modal is open
    expect(container.querySelector('[role=dialog]')).not.toBeNull()
    const nameInput = container.querySelector('#project-create-name')
    const descInput = container.querySelector('#project-create-description')

    await act(async () => {
      setInputValue(nameInput, '  New Test Project  ')
      setInputValue(descInput, 'My description')
    })

    const form = container.querySelector('[role=dialog] form')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('[role=dialog]')).toBeNull()
    })

    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')
    expect(postCall).toBeDefined()
    expect(JSON.parse(postCall[1].body)).toEqual({
      name: 'New Test Project',
      description: 'My description',
    })
  })

  it('validates project name and displays 422 error detail in modal', async () => {
    fetchMock.mockImplementation(async (url, options) => {
      if (options?.method === 'POST') {
        return {
          ok: false,
          status: 422,
          json: async () => ({ detail: 'Project name must contain 1 to 120 characters' }),
        }
      }
      return {
        ok: true,
        json: async () => [{ id: 'p-1', name: 'Existing', current_revision: 1 }],
      }
    })

    await renderPage()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Existing')
    })

    const openButton = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('+ New project'))
    await act(async () => openButton.click())

    const nameInput = container.querySelector('#project-create-name')
    await act(async () => {
      setInputValue(nameInput, 'Test')
    })

    const form = container.querySelector('[role=dialog] form')
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('[role=dialog] [role=alert]').textContent).toContain('Project name must contain 1 to 120 characters')
    })
  })
})
