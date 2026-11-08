import { APP_CONFIG } from '../config'
const baseUrl = APP_CONFIG.apiUrl;
export class AuthApiError extends Error {
    status;
    detail;
    constructor(status, detail) {
        super(detail || `Authentication request failed (${status})`);
        this.status = status;
        this.detail = detail;
    }
}
export async function getHealth() {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok)
        throw new Error('API health check failed');
    return (await response.json());
}
async function postAuth(path, payload) {
    const response = await fetch(`${baseUrl}/api/v1/auth/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
    });
    if (!response.ok) {
        let detail
        try {
            const data = await response.json()
            if (typeof data?.detail === 'string') detail = data.detail
        } catch {
            // non-JSON response
        }
        throw new AuthApiError(response.status, detail);
    }
    return response;
}
export async function login(email, password) {
    const response = await postAuth('login', { email, password })
    const { access_token: accessToken } = await response.json()
    if (typeof accessToken !== 'string' || !accessToken) throw new Error('Invalid sign-in response')
    return { accessToken }
}
export function register(email, password) {
    return postAuth('register', { email, password })
}
export function forgotPassword(email) {
    return postAuth('password/forgot', { email })
}
export function requestVerification(email) {
    return postAuth('verification/request', { email })
}
async function sessionRequest(path, accessToken, options = {}) {
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
    }
    const response = await fetch(`${baseUrl}/api/v1/${path}`, {
        ...options,
        headers,
        cache: 'no-store',
    })
    if (!response.ok) {
        let detail
        try {
            const data = await response.json()
            if (typeof data?.detail === 'string') detail = data.detail
        } catch {
            // non-JSON response
        }
        throw new AuthApiError(response.status, detail)
    }
    return response
}
export async function listProjects(accessToken, signal) {
    const response = await sessionRequest('projects', accessToken, { signal })
    const projects = await response.json()
    if (!Array.isArray(projects)) throw new Error('Invalid project list')
    return projects
}
export async function getProject(accessToken, projectId, signal) {
    const response = await sessionRequest(`projects/${projectId}`, accessToken, { signal })
    return response.json()
}
export async function createProject(accessToken, { name, description }, signal) {
    const response = await sessionRequest('projects', accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: typeof name === 'string' ? name.trim() : name,
            description: typeof description === 'string' ? (description.trim() || null) : (description ?? null),
        }),
        signal,
    })
    return response.json()
}
export async function updateProject(accessToken, projectId, { name, description }, signal) {
    const payload = {}
    if (name !== undefined) {
        payload.name = typeof name === 'string' ? name.trim() : name
    }
    if (description !== undefined) {
        payload.description = typeof description === 'string' ? (description.trim() || null) : (description ?? null)
    }
    const response = await sessionRequest(`projects/${projectId}`, accessToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
    })
    return response.json()
}
export async function getProjectHistory(accessToken, projectId, signal) {
    const response = await sessionRequest(`projects/${projectId}/history`, accessToken, { signal })
    const history = await response.json()
    if (!Array.isArray(history)) throw new Error('Invalid project history')
    return history
}
export function logout(accessToken) {
    return sessionRequest('auth/logout', accessToken, { method: 'POST', signal: AbortSignal.timeout(10000) })
}
export function verifyEmail(token) {
    return postAuth('verify', { token });
}
export function resetPassword(token, newPassword) {
    return postAuth('password/reset', { token, new_password: newPassword });
}
