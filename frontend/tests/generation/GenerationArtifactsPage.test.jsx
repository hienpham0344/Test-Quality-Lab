// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenerationArtifactsPage } from '../../src/features/generation/GenerationArtifactsPage'

const session = { accessToken: 'test-token' }
const onExpire = vi.fn()
const fetchMock = vi.fn()
let container
let root
let client

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  onExpire.mockClear()
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  client = new QueryClient()
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})

async function renderViewer() {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/project%20one/generation/runs/run%3F1']}>
        <Routes>
          <Route path="/projects/:projectId/generation/runs/:runId"
            element={<GenerationArtifactsPage session={session} onExpire={onExpire} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
}

describe('Generation artifacts (#43)', () => {
  it('shows loading and then displays the parsed and raw artifacts as text', async () => {
    let respond
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { respond = resolve }))
    await renderViewer()
    expect(container.querySelector('[role=status]').textContent).toContain('Loading')
    const raw = '<img src=x onerror=alert(1)>'
    const parsed = 'def test_sum():\n    assert 1 + 1 == 2'
    await act(async () => respond(Response.json({ raw_response: raw, parsed_test: parsed })))
    await vi.waitFor(() => expect(container.querySelector('[aria-labelledby=parsed-test] code')?.textContent).toBe(parsed))
    expect(container.querySelector('[aria-labelledby=raw-response] code').textContent).toBe(raw)
    expect(container.querySelector('img')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/projects/project%20one/generation/runs/run%3F1/artifacts'),
      expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer test-token' } }))
  })

  it('retries a failed load and keeps raw response visible after a parse failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ raw_response: 'Invalid JSON', parsed_test: null }))
    await renderViewer()
    await vi.waitFor(() => expect(container.querySelector('[role=alert]')?.textContent).toContain('Could not load'))
    await act(async () => container.querySelector('button').click())
    await vi.waitFor(() => expect(container.textContent).toContain('No parsed test'))
    expect(container.querySelector('[aria-labelledby=raw-response] code').textContent).toBe('Invalid JSON')
  })

  it.each([
    [403, 'do not have permission'],
    [404, 'not available for this run'],
    [501, 'artifact service is not available yet'],
  ])('explains HTTP %i without displaying artifacts', async (status, message) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))
    await renderViewer()
    await vi.waitFor(() => expect(container.querySelector('[role=alert]')?.textContent).toContain(message))
    expect(container.querySelector('code')).toBeNull()
  })

  it('expires an unauthorized session', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
    await renderViewer()
    await vi.waitFor(() => expect(onExpire).toHaveBeenCalledWith(session))
    expect(container.querySelector('code')).toBeNull()
  })
})
