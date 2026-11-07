import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  getCurrentUser,
  getHealth,
  login,
  logout,
  refreshSession,
  registerAccount,
  requestVerificationEmail,
  resetPassword,
  verifyEmail,
} from './api'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(status = 200, body = { status: 'ok' }) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastRequest(fetchMock) {
  const [url, options] = fetchMock.mock.calls.at(-1)
  return { url, options, body: options.body ? JSON.parse(options.body) : undefined }
}

describe('API health', () => {
  it('returns the health payload from the configured API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(getHealth()).resolves.toEqual({ status: 'ok' })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/health$/)
  })

  it('rejects unsuccessful health responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await expect(getHealth()).rejects.toThrow('API health check failed')
  })
})

describe('auth API calls', () => {
  it('sends registration fields in the contract format', async () => {
    const fetchMock = stubFetch(201)
    await registerAccount({ email: 'a@example.com', password: 'p'.repeat(12), confirmPassword: 'p'.repeat(12), displayName: '' })
    const { url, options, body } = lastRequest(fetchMock)
    expect(url).toMatch(/\/api\/v1\/auth\/register$/)
    expect(options.method).toBe('POST')
    expect(body).toEqual({ email: 'a@example.com', password: 'p'.repeat(12), confirm_password: 'p'.repeat(12), display_name: null })
  })

  it('returns login tokens and sends refresh tokens in the body', async () => {
    const fetchMock = stubFetch(200, { access_token: 'a', refresh_token: 'r' })
    await expect(login('a@example.com', 'secret-password')).resolves.toMatchObject({ access_token: 'a' })
    await refreshSession('r')
    expect(lastRequest(fetchMock).body).toEqual({ token: 'r' })
  })

  it('sends the access token only as a bearer header', async () => {
    const fetchMock = stubFetch(200, { id: '1' })
    await getCurrentUser('access-token')
    expect(lastRequest(fetchMock).options.headers).toEqual({ Authorization: 'Bearer access-token' })
    await logout('access-token')
    const { url, options } = lastRequest(fetchMock)
    expect(url).toMatch(/\/auth\/logout$/)
    expect(options.headers.Authorization).toBe('Bearer access-token')
    expect(url).not.toContain('access-token')
  })

  it('sends one-time link tokens in the request body only', async () => {
    const fetchMock = stubFetch()
    await resetPassword('test-link-token', 'new-test-password')
    const { url, body } = lastRequest(fetchMock)
    expect(url).toMatch(/\/api\/v1\/auth\/password\/reset$/)
    expect(url).not.toContain('test-link-token')
    expect(body).toEqual({ token: 'test-link-token', new_password: 'new-test-password' })
    await requestVerificationEmail('a@example.com')
    expect(lastRequest(fetchMock).body).toEqual({ email: 'a@example.com' })
  })

  it('exposes status, code and field errors from the standard error body', async () => {
    stubFetch(400, { detail: { code: 'AUTH_INVALID_INPUT', message: 'Invalid input', fields: { email: 'bad' } } })
    const error = await registerAccount({}).catch((caught) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, code: 'AUTH_INVALID_INPUT', fields: { email: 'bad' }, message: 'Invalid input' })
  })

  it('keeps the status when the error has no JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(verifyEmail('test-link-token')).rejects.toMatchObject({ status: 503, code: null, fields: {} })
  })
})
