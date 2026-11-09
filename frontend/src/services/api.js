import { APP_CONFIG } from '../config'

const baseUrl = APP_CONFIG.apiUrl

/** Error returned by the API: {"detail": {"code", "message", "fields"}} (docs/api/contracts). */
export class ApiError extends Error {
  constructor(status, code = null, fields = {}, message = `Request failed (${status})`) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
    this.detail = message
  }
}

export { ApiError as AuthApiError }

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function request(path, { method = 'GET', body, accessToken, signal } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    signal,
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await readJson(response)
  if (!response.ok) {
    const detail = data?.detail ?? {}
    throw new ApiError(response.status, detail.code ?? null, detail.fields ?? {}, typeof detail === 'string' ? detail : detail.message)
  }
  return data
}

export async function getHealth() {
  const response = await fetch(`${baseUrl}/health`)
  if (!response.ok) throw new Error('API health check failed')
  return response.json()
}

// --- UC-01 registration and email verification ---
export function registerAccount({ email, password, confirmPassword, displayName }) {
  return request('/auth/register', {
    method: 'POST',
    body: {
      email,
      password,
      confirm_password: confirmPassword,
      display_name: displayName || null,
    },
  })
}

export function register(email, password, confirmPassword, displayName) {
  return registerAccount({ email, password, confirmPassword, displayName })
}

export function forgotPassword(email) {
  return request('/auth/password/forgot', { method: 'POST', body: { email } })
}

export { requestVerificationEmail as requestVerification }

export function requestVerificationEmail(email) {
  return request('/auth/verification/request', { method: 'POST', body: { email } })
}

export function verifyEmail(token) {
  return request('/auth/verify', { method: 'POST', body: { token } })
}

// --- UC-02 sessions ---
export function login(email, password) {
  return request('/auth/login', { method: 'POST', body: { email, password } })
}

export function refreshSession(refreshToken) {
  return request('/auth/refresh', { method: 'POST', body: { token: refreshToken } })
}

export function logout(accessToken) {
  return request('/auth/logout', { method: 'POST', accessToken, signal: AbortSignal.timeout(10000) })
}

export function getCurrentUser(accessToken) {
  return request('/auth/me', { accessToken })
}

// --- UC-12 password reset ---
export function resetPassword(token, newPassword) {
  return request('/auth/password/reset', {
    method: 'POST',
    body: { token, new_password: newPassword },
  })
}

export async function listProjects(accessToken, signal) {
  const data = await request('/projects', { accessToken, signal })
  if (!Array.isArray(data)) throw new Error('Invalid project list')
  return data
}

export function getProject(accessToken, projectId, signal) {
  return request(`/projects/${projectId}`, { accessToken, signal })
}

export function createProject(accessToken, { name, description }, signal) {
  return request('/projects', {
    accessToken,
    method: 'POST',
    body: {
      name: typeof name === 'string' ? name.trim() : name,
      description: typeof description === 'string' ? (description.trim() || null) : (description ?? null),
    },
    signal,
  })
}

export function updateProject(accessToken, projectId, { name, description }, signal) {
  const payload = {}
  if (name !== undefined) {
    payload.name = typeof name === 'string' ? name.trim() : name
  }
  if (description !== undefined) {
    payload.description = typeof description === 'string' ? (description.trim() || null) : (description ?? null)
  }
  return request(`/projects/${projectId}`, {
    accessToken,
    method: 'PATCH',
    body: payload,
    signal,
  })
}

export async function getProjectHistory(accessToken, projectId, signal) {
  const data = await request(`/projects/${projectId}/history`, { accessToken, signal })
  if (!Array.isArray(data)) throw new Error('Invalid project history')
  return data
}
