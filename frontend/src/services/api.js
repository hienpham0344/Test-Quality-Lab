import { APP_CONFIG } from '../config'

const baseUrl = APP_CONFIG.apiUrl

/** Error returned by the API: {"detail": {"code", "message", "fields"}} (docs/api/contracts). */
export class ApiError extends Error {
  constructor(status, code = null, fields = {}, message = `Request failed (${status})`) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function request(path, { method = 'GET', body, accessToken } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await readJson(response)
  if (!response.ok) {
    const detail = data?.detail ?? {}
    throw new ApiError(response.status, detail.code ?? null, detail.fields ?? {}, detail.message)
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
  return request('/auth/logout', { method: 'POST', accessToken })
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
