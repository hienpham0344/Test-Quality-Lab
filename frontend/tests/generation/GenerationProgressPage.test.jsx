// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenerationProgressPage } from '../../src/features/generation/GenerationProgressPage'

const session = { accessToken: 'test-token' }
const queryKey = ['private', 'generation', 'demo-project']
const approved = { id: 'approved-1', name: 'Coverage baseline', run_count: 2, can_start: true }
const unavailable = { id: 'draft-1', name: 'Draft', run_count: 2, can_start: false }
const run = { id: 'run-1', function_name: 'add', model: 'example-model', strategy: 'L1', repeat: 1 }
const onExpire = vi.fn()
let root
let container
let client
let fetchMock

function progress(runs = [], snapshots = [approved, unavailable]) {
  return Response.json({ launch_enabled: true, approved_snapshots: snapshots, runs })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  client = new QueryClient()
  onExpire.mockClear()
})

afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  container.remove()
  vi.unstubAllGlobals()
})

async function renderPage() {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/demo-project/generation']}>
        <Routes>
          <Route path="/projects/:projectId/generation" element={<GenerationProgressPage session={session} onExpire={onExpire} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  ))
}

const get = (selector) => container.querySelector(selector)
const postCalls = () => fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')

async function selectApproved() {
  await vi.waitFor(() => expect(get('#generation-snapshot')).not.toBeNull())
  await act(async () => {
    const select = get('#generation-snapshot')
    select.value = approved.id
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function submit() {
  get('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

describe('Generation progress (#42)', () => {
  it('submits only an approved snapshot, deduplicates clicks, and fetches queued runs', async () => {
    let finish
    fetchMock
      .mockResolvedValueOnce(progress())
      .mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
      .mockResolvedValueOnce(progress([{ ...run, status: 'QUEUED' }], []))
    await renderPage()
    await vi.waitFor(() => expect(get('#generation-snapshot')).not.toBeNull())
    expect(get('option[value="draft-1"]')).toBeNull()
    expect(get('button[type=submit]').disabled).toBe(true)
    await act(async () => submit())
    await selectApproved()
    await act(async () => { submit(); submit() })
    expect(postCalls()).toHaveLength(1)
    expect(get('button[type=submit]').disabled).toBe(true)
    const body = JSON.parse(postCalls()[0][1].body)
    expect(body).toEqual({ snapshot_id: approved.id, request_id: expect.any(String) })
    await act(async () => finish(Response.json({ job_id: 'job-1' }, { status: 202 })))
    await vi.waitFor(() => expect(get('tbody').textContent).toContain('Queued'))
    expect(get('[role=status]').textContent).toContain('Generation job accepted')
  })

  it('renders failed and successful runs and preserves confirmed statuses after a failed refresh', async () => {
    const updated = [
      { ...run, status: 'COMPLETED' },
      { ...run, id: 'run-2', status: 'FAILED', error: {
        stage: 'Parse', code: 'ARTIFACT_INVALID', message: 'Missing required field.',
        occurred_at: '2026-11-24T09:00:00Z',
      } },
      { ...run, id: 'run-3', status: 'UNKNOWN' },
    ]
    fetchMock
      .mockResolvedValueOnce(progress([{ ...run, status: 'RUNNING' }]))
      .mockResolvedValueOnce(progress(updated))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    await renderPage()
    await vi.waitFor(() => expect(get('tbody').textContent).toContain('Running'))
    await act(async () => client.refetchQueries({ queryKey }))
    await vi.waitFor(() => expect(get('tbody').textContent).toContain('ARTIFACT_INVALID'))
    expect(get('progress').value).toBe(2)
    expect(get('progress').max).toBe(3)
    expect(get('tbody').textContent).toContain('Unconfirmed')
    expect(get('time').dateTime).toBe('2026-11-24T09:00:00Z')
    await act(async () => client.refetchQueries({ queryKey }))
    await vi.waitFor(() => expect(get('[role=alert]').textContent).toContain('last confirmed'))
    expect(get('tbody').textContent).toContain('Missing required field')
    expect(get('button[type=submit]').disabled).toBe(true)
  })

  it('reuses the same request ID after an uncertain start', async () => {
    fetchMock
      .mockResolvedValueOnce(progress())
      .mockRejectedValueOnce(new TypeError('Network error'))
      .mockResolvedValueOnce(Response.json({ job_id: 'job-1' }, { status: 202 }))
      .mockResolvedValueOnce(progress([{ ...run, status: 'QUEUED' }], []))
    await renderPage()
    await selectApproved()
    await act(async () => submit())
    expect(get('[role=alert]').textContent).toContain('same request')
    await act(async () => submit())
    expect(postCalls()).toHaveLength(2)
    expect(postCalls()[1][1].body).toBe(postCalls()[0][1].body)
  })

  it('keeps launch unavailable for a missing service and clears an expired session', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
    await renderPage()
    await vi.waitFor(() => expect(get('[role=alert]').textContent).toContain('not available'))
    expect(get('button[type=submit]')).toBeNull()
    await act(async () => get('header button').click())
    await vi.waitFor(() => expect(onExpire).toHaveBeenCalledWith(session))
    expect(postCalls()).toHaveLength(0)
  })
})
