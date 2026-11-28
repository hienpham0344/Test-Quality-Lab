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

  it('shows why a failed run failed and never a fake response (#39, #41)', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      status: 'FAILED', raw_response: null, parsed_test: null, response_metadata: null, validation: null,
      error: { stage: 'provider', code: 'PROVIDER_AUTH_FAILED', message: 'groq returned HTTP 401: Invalid API Key',
        occurred_at: '2026-11-28T03:29:28Z' },
    }))
    await renderViewer()
    await vi.waitFor(() => expect(container.querySelector('[aria-labelledby=run-error]')).not.toBeNull())
    const panel = container.querySelector('[aria-labelledby=run-error]').textContent
    expect(panel).toContain('PROVIDER_AUTH_FAILED')
    expect(panel).toContain('provider')
    expect(panel).toContain('Invalid API Key')
    expect(container.querySelector('[data-testid=run-status]').textContent).toBe('FAILED')
    expect(container.textContent).toContain('No raw model response')
    expect(container.querySelector('[aria-labelledby=validation]')).toBeNull()
    expect(container.querySelector('code')).toBeNull()
  })

  it('lists every validation step and the response details (#40, #39)', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      status: 'COMPLETED', raw_response: '```python\ndef test_add(): ...\n```', parsed_test: 'def test_add(): ...',
      error: null,
      validation: {
        eligible: false, failed_stage: 'target_linked', reason: 'No test calls add',
        collected_tests: ['test_add'],
        stages: { generated: 'PASSED', parsed: 'PASSED', syntax_valid: 'PASSED', structure_valid: 'PASSED',
          target_linked: 'FAILED', collected: 'SKIPPED', executable: 'NOT_VERIFIED' },
      },
      response_metadata: { provider: 'groq', model_requested: 'm1', model_returned: 'm1-2026', finish_reason: 'length',
        truncated: true, usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 }, latency_ms: 0 },
    }))
    await renderViewer()
    await vi.waitFor(() => expect(container.querySelector('[aria-labelledby=validation]')).not.toBeNull())
    const stage = (name) => container.querySelector(`[data-testid=stage-${name}]`).textContent
    expect(stage('parsed')).toContain('Passed')
    expect(stage('target_linked')).toContain('Failed')
    expect(stage('collected')).toContain('Skipped')
    expect(stage('executable')).toContain('Not verified')
    expect(container.textContent).toContain('Not eligible for execution')
    expect(container.textContent).toContain('No test calls add')
    const details = container.querySelector('[aria-labelledby=response-details]').textContent
    expect(details).toContain('m1-2026')
    expect(details).toContain('Yes (hit the token limit)')
    expect(details).toContain('10 / 0 / 10') // numeric zero shown, not dropped
    expect(details).toContain('0 ms')
    expect(container.querySelector('[aria-labelledby=run-error]')).toBeNull()
  })

  it('expires an unauthorized session', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
    await renderViewer()
    await vi.waitFor(() => expect(onExpire).toHaveBeenCalledWith(session))
    expect(container.querySelector('code')).toBeNull()
  })
})
