// @vitest-environment jsdom
// Issue #87: projects API client, query hooks and messages (FR-PRJ-001/002/003, UC-03).
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  getProject,
  getProjectHistory,
  listAllProjects,
  listProjects,
  updateProject,
  withSessionRefresh,
} from '../../src/services/api'
import {
  projectKeys,
  useCreateProject,
  useProject,
  useProjects,
  useUpdateProject,
} from '../../src/features/projects/queries'
import { PROJECT_MESSAGES, projectErrorKey, projectErrorMessage, projectFieldErrors } from '../../src/features/projects/messages'

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const errorBody = (code, message, fields = {}) => ({ detail: { code, message, fields } })

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const urlOf = (call = fetchMock.mock.calls.at(-1)) => new URL(call[0], 'http://test.local')

describe('listProjects', () => {
  it('sends only non-empty params and returns items with the X-Total-Count total', async () => {
    fetchMock.mockResolvedValue(json([{ id: 'p1' }], 200, { 'X-Total-Count': '41' }))
    const result = await listProjects('t', { q: '  demo ', sort: 'name', order: 'asc', limit: 20, offset: 40, extra: undefined })
    expect(result).toEqual({ items: [{ id: 'p1' }], total: 41 })
    const url = urlOf()
    expect(url.pathname).toMatch(/\/api\/v1\/projects$/)
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'demo', sort: 'name', order: 'asc', limit: '20', offset: '40' })
  })

  it('omits the query string when nothing is set and handles an empty list', async () => {
    fetchMock.mockResolvedValue(json([], 200, { 'X-Total-Count': '0' }))
    expect(await listProjects('t', { q: '   ' })).toEqual({ items: [], total: 0 })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/projects$/)
  })

  it('falls back to the page length when the total header is missing or invalid', async () => {
    fetchMock.mockResolvedValue(json([{ id: 'a' }, { id: 'b' }], 200, { 'X-Total-Count': 'abc' }))
    expect((await listProjects('t')).total).toBe(2)
  })

  it('throws ApiError with fields for 422 INPUT_INVALID', async () => {
    fetchMock.mockResolvedValue(json(errorBody('INPUT_INVALID', 'Invalid request', { limit: 'Input should be less than or equal to 100' }), 422))
    await expect(listProjects('t', { limit: 101 })).rejects.toMatchObject({
      status: 422, code: 'INPUT_INVALID', fields: { limit: 'Input should be less than or equal to 100' },
    })
  })
})

describe('listAllProjects', () => {
  it('pages through every project in steps of 100', async () => {
    const page = (start, size) => Array.from({ length: size }, (_, i) => ({ id: `p${start + i}` }))
    fetchMock
      .mockResolvedValueOnce(json(page(0, 100), 200, { 'X-Total-Count': '150' }))
      .mockResolvedValueOnce(json(page(100, 50), 200, { 'X-Total-Count': '150' }))
    const items = await listAllProjects('t')
    expect(items).toHaveLength(150)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/projects$/)
    expect(Object.fromEntries(urlOf(fetchMock.mock.calls[1]).searchParams)).toEqual({ limit: '100', offset: '100' })
  })
})

describe('project detail, update and history', () => {
  it('maps 404 NOT_FOUND to ApiError and encodes the id', async () => {
    fetchMock.mockResolvedValue(json(errorBody('NOT_FOUND', 'Project not found'), 404))
    await expect(getProject('t', 'a/b')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND', fields: {} })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/projects\/a%2Fb$/)
  })

  it('returns field errors for 422 on update', async () => {
    fetchMock.mockResolvedValue(json(errorBody('INPUT_INVALID', 'Project name must contain 1 to 120 characters', { name: 'Project name must contain 1 to 120 characters' }), 422))
    const error = await updateProject('t', 'p1', { name: '' }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(projectFieldErrors(error)).toEqual({ name: 'Project name must contain 1 to 120 characters' })
  })

  it('sends history filters', async () => {
    fetchMock.mockResolvedValue(json([]))
    await getProjectHistory('t', 'p1', { from: '2026-11-01', to: '2026-11-30', limit: 5, offset: 0 })
    const url = urlOf()
    expect(url.pathname).toMatch(/\/projects\/p1\/history$/)
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-11-01', to: '2026-11-30', limit: '5', offset: '0' })
  })
})

describe('withSessionRefresh', () => {
  const session = { accessToken: 'old', refreshToken: 'r' }

  it('refreshes once on 401 and retries with the new token', async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(new ApiError(401, 'AUTH_SESSION_INVALID'))
      .mockResolvedValueOnce('ok')
    const onRefresh = vi.fn().mockResolvedValue({ accessToken: 'new', refreshToken: 'r2' })
    await expect(withSessionRefresh(session, onRefresh, call)).resolves.toBe('ok')
    expect(onRefresh).toHaveBeenCalledWith(session)
    expect(call.mock.calls.map(([token]) => token)).toEqual(['old', 'new'])
  })

  it('throws the 401 when refresh is unavailable or fails, and never retries twice', async () => {
    const unauthorized = new ApiError(401)
    const call = vi.fn().mockRejectedValue(unauthorized)
    await expect(withSessionRefresh(session, null, call)).rejects.toBe(unauthorized)
    await expect(withSessionRefresh(session, vi.fn().mockResolvedValue(null), call)).rejects.toBe(unauthorized)
    const onRefresh = vi.fn().mockResolvedValue({ accessToken: 'new' })
    await expect(withSessionRefresh(session, onRefresh, call)).rejects.toBe(unauthorized)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh for other errors', async () => {
    const onRefresh = vi.fn()
    const call = vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND'))
    await expect(withSessionRefresh(session, onRefresh, call)).rejects.toMatchObject({ status: 404 })
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('messages', () => {
  it('maps by status and code, never by message text', () => {
    expect(projectErrorKey(new ApiError(422, 'INPUT_INVALID', {}, 'anything'))).toBe('INPUT_INVALID')
    expect(projectErrorKey(new ApiError(404, 'NOT_FOUND'))).toBe('NOT_FOUND')
    expect(projectErrorKey(new ApiError(401))).toBe('AUTH_SESSION_INVALID')
    expect(projectErrorKey(new ApiError(503, 'SERVICE_UNAVAILABLE'))).toBe('SERVICE_UNAVAILABLE')
    expect(projectErrorKey(new ApiError(500))).toBe('UNKNOWN')
    expect(projectErrorKey(new TypeError('Failed to fetch'))).toBe('NETWORK')
    expect(projectErrorMessage(new ApiError(404, 'NOT_FOUND'))).toBe(PROJECT_MESSAGES.NOT_FOUND)
    expect(projectFieldErrors(new Error('x'))).toEqual({})
  })
})

describe('query hooks', () => {
  let container
  let root
  let client

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.body.appendChild(document.createElement('div'))
    root = createRoot(container)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    client.clear()
  })

  async function renderHook(useHook) {
    const result = { current: null }
    function Probe() {
      result.current = useHook()
      return null
    }
    await act(async () => root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>))
    return result
  }

  it('useProjects keys by params and refreshes the session once on 401', async () => {
    const onRefresh = vi.fn().mockResolvedValue({ accessToken: 'fresh' })
    fetchMock
      .mockResolvedValueOnce(json(errorBody('AUTH_SESSION_INVALID', 'expired'), 401))
      .mockResolvedValueOnce(json([{ id: 'p1' }], 200, { 'X-Total-Count': '1' }))
    const params = { q: 'demo', limit: 10 }
    const result = await renderHook(() => useProjects({ session: { accessToken: 'stale' }, onRefresh }, params))
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ items: [{ id: 'p1' }], total: 1 })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh')
    expect(client.getQueryData(projectKeys.page(params))).toEqual({ items: [{ id: 'p1' }], total: 1 })
  })

  it('useProject surfaces 404 as ApiError', async () => {
    fetchMock.mockResolvedValue(json(errorBody('NOT_FOUND', 'Project not found'), 404))
    const result = await renderHook(() => useProject({ session: { accessToken: 't' } }, 'missing'))
    await vi.waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('mutations invalidate list, detail and history keys', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fetchMock.mockResolvedValue(json({ id: 'p1', name: 'Renamed' }))
    const auth = { session: { accessToken: 't' } }
    const update = await renderHook(() => useUpdateProject(auth, 'p1'))
    await act(async () => { await update.current.mutateAsync({ name: 'Renamed' }) })
    const keys = invalidate.mock.calls.map(([arg]) => arg.queryKey)
    expect(keys).toEqual(expect.arrayContaining([projectKeys.all(), projectKeys.detail('p1'), projectKeys.historyAll('p1')]))
    expect(client.getQueryData(projectKeys.detail('p1'))).toEqual({ id: 'p1', name: 'Renamed' })

    invalidate.mockClear()
    fetchMock.mockResolvedValue(json({ id: 'p2', name: 'New' }, 201))
    const create = await renderHook(() => useCreateProject(auth))
    await act(async () => { await create.current.mutateAsync({ name: 'New' }) })
    expect(invalidate.mock.calls.map(([arg]) => arg.queryKey)).toEqual([projectKeys.all()])
    expect(client.getQueryData(projectKeys.detail('p2'))).toEqual({ id: 'p2', name: 'New' })
  })
})
