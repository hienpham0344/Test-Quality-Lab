import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  createProject,
  getProject,
  getProjectHistory,
  listProjects,
  updateProject,
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

describe('project API calls', () => {
    const accessToken = 'valid-token';

    it('lists projects with authorization header and cache control', async () => {
        const mockProjects = [{ id: 'p1', name: 'Project 1' }];
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockProjects,
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await listProjects(accessToken);
        expect(result).toEqual(mockProjects);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toMatch(/\/api\/v1\/projects$/);
        expect(options.headers.Authorization).toBe('Bearer valid-token');
        expect(options.cache).toBe('no-store');
    });

    it('gets a single project by id', async () => {
        const mockProject = { id: 'p1', name: 'Project 1', current_revision: 1 };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => mockProject,
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await getProject(accessToken, 'p1');
        expect(result).toEqual(mockProject);
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/projects\/p1$/);
    });

    it('creates a project with trimmed name and null description if blank', async () => {
        const created = { id: 'p2', name: 'New Project', description: null, current_revision: 1 };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => created,
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await createProject(accessToken, { name: '  New Project  ', description: '   ' });
        expect(result).toEqual(created);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toMatch(/\/api\/v1\/projects$/);
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ name: 'New Project', description: null });
    });

    it('updates a project with patch payload', async () => {
        const updated = { id: 'p1', name: 'Renamed', description: 'Updated desc', current_revision: 2 };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => updated,
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await updateProject(accessToken, 'p1', { name: 'Renamed', description: 'Updated desc' });
        expect(result).toEqual(updated);
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toMatch(/\/api\/v1\/projects\/p1$/);
        expect(options.method).toBe('PATCH');
        expect(JSON.parse(options.body)).toEqual({ name: 'Renamed', description: 'Updated desc' });
    });

    it('gets revision history for a project', async () => {
        const history = [
            { revision: 1, name: 'Initial', description: null, changed_at: '2026-11-08T00:00:00Z' },
            { revision: 2, name: 'Renamed', description: 'Updated', changed_at: '2026-11-08T01:00:00Z' },
        ];
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => history,
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await getProjectHistory(accessToken, 'p1');
        expect(result).toEqual(history);
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/projects\/p1\/history$/);
    });

    it('captures server error detail in AuthApiError', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 422,
            json: async () => ({ detail: 'Project name must contain 1 to 120 characters' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(createProject(accessToken, { name: '' })).rejects.toMatchObject({
            status: 422,
            detail: 'Project name must contain 1 to 120 characters',
        });
    });
});
