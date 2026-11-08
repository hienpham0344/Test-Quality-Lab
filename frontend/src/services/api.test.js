import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createProject,
    getHealth,
    getProject,
    getProjectHistory,
    listProjects,
    resetPassword,
    updateProject,
    verifyEmail,
} from './api';
afterEach(() => vi.unstubAllGlobals());
describe('API health', () => {
    it('returns the health payload from the configured API', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });
        vi.stubGlobal('fetch', fetchMock);
        await expect(getHealth()).resolves.toEqual({ status: 'ok' });
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/health$/);
    });

    it('rejects unsuccessful health responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        await expect(getHealth()).rejects.toThrow('API health check failed');
    });
});
describe('email link API calls', () => {
    it('sends the token in the request body only', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        await resetPassword('test-link-token', 'new-test-password');
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toMatch(/\/api\/v1\/auth\/password\/reset$/);
        expect(url).not.toContain('test-link-token');
        expect(JSON.parse(options.body)).toEqual({ token: 'test-link-token', new_password: 'new-test-password' });
    });
    it('preserves the status so the screen can distinguish an invalid link from downtime', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
        await expect(verifyEmail('test-link-token')).rejects.toMatchObject({ status: 503 });
    });
});
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
