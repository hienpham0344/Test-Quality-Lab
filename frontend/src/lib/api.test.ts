import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetPassword, verifyEmail } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('email link API calls', () => {
  it('sends the token in the request body only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await resetPassword('test-link-token', 'new-test-password')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/v1\/auth\/password\/reset$/)
    expect(url).not.toContain('test-link-token')
    expect(JSON.parse(options.body)).toEqual({ token: 'test-link-token', new_password: 'new-test-password' })
  })

  it('preserves the status so the screen can distinguish an invalid link from downtime', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(verifyEmail('test-link-token')).rejects.toMatchObject({ status: 503 })
  })
})
