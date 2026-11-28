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

async function requestWithHeaders(path, { method = 'GET', body, accessToken, signal } = {}) {
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
  return { data, headers: response.headers }
}

async function request(path, options) {
  return (await requestWithHeaders(path, options)).data
}

/** `?a=1&b=2` from defined, non-empty values only; '' when nothing is set. */
function queryString(params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const text = typeof value === 'string' ? value.trim() : String(value)
    if (text) query.set(key, text)
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

function totalFrom(headers, fallback) {
  const raw = headers?.get?.('X-Total-Count')
  const total = raw === null || raw === undefined ? Number.NaN : Number(raw)
  return Number.isInteger(total) && total >= 0 ? total : fallback
}

/**
 * Runs `call(accessToken)`; on 401 asks `onRefresh(session)` once for a new session and retries.
 * `onRefresh` returns the refreshed session or null. A second 401 is thrown to the caller.
 */
export async function withSessionRefresh(session, onRefresh, call) {
  try {
    return await call(session?.accessToken)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !onRefresh) throw error
    const refreshed = await onRefresh(session)
    if (!refreshed?.accessToken) throw error
    return call(refreshed.accessToken)
  }
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

export const PROJECT_PAGE_LIMIT = 100

/** FR-PRJ-003: one page of owned projects. Params: q, sort (created_at|updated_at|name), order, limit (1-100), offset. */
export async function listProjects(accessToken, { q, sort, order, limit, offset } = {}, signal) {
  const { data, headers } = await requestWithHeaders(
    `/projects${queryString({ q, sort, order, limit, offset })}`,
    { accessToken, signal },
  )
  if (!Array.isArray(data)) throw new Error('Invalid project list')
  return { items: data, total: totalFrom(headers, data.length) }
}

/** Every owned project, fetched in pages of 100 (the API maximum). Used by the dashboard summary. */
export async function listAllProjects(accessToken, { q, sort, order } = {}, signal) {
  const items = []
  for (let page = 0; page < 1000; page += 1) {
    // The first page relies on the server defaults (limit 100, offset 0); later pages page by offset.
    const paging = items.length ? { limit: PROJECT_PAGE_LIMIT, offset: items.length } : {}
    const result = await listProjects(accessToken, { q, sort, order, ...paging }, signal)
    items.push(...result.items)
    if (result.items.length < PROJECT_PAGE_LIMIT || items.length >= result.total) break
  }
  return items
}

export function getProject(accessToken, projectId, signal) {
  return request(`/projects/${encodeURIComponent(projectId)}`, { accessToken, signal })
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
  return request(`/projects/${encodeURIComponent(projectId)}`, {
    accessToken,
    method: 'PATCH',
    body: payload,
    signal,
  })
}

export async function getProjectHistory(accessToken, projectId, { from, to, limit, offset } = {}, signal) {
  const data = await request(
    `/projects/${encodeURIComponent(projectId)}/history${queryString({ from, to, limit, offset })}`,
    { accessToken, signal },
  )
  if (!Array.isArray(data)) throw new Error('Invalid project history')
  return data
}

// --- UC-05 Datasets & CSV input ---
export function createDataset(accessToken, projectId, { rows }, signal) {
  return request(`/projects/${projectId}/datasets`, {
    accessToken,
    method: 'POST',
    body: { rows },
    signal,
  })
}

export async function listDatasets(accessToken, projectId, signal) {
  const data = await request(`/projects/${projectId}/datasets`, { accessToken, signal })
  if (!Array.isArray(data)) throw new Error('Invalid dataset list')
  return data
}

export function getDataset(accessToken, projectId, datasetId, signal) {
  return request(`/projects/${projectId}/datasets/${datasetId}`, { accessToken, signal })
}

export function getDatasetVersion(accessToken, projectId, datasetId, revision, signal) {
  return request(`/projects/${projectId}/datasets/${datasetId}/versions/${revision}`, { accessToken, signal })
}

export function selectDatasetRows(accessToken, projectId, datasetId, rowNumbers, signal) {
  return request(`/projects/${projectId}/datasets/${datasetId}/selection`, {
    accessToken,
    method: 'POST',
    body: { row_numbers: rowNumbers },
    signal,
  })
}

export function linkDatasetReference(accessToken, projectId, datasetId, sourceId, revision, signal) {
  return request(`/projects/${projectId}/datasets/${datasetId}/reference`, {
    accessToken,
    method: 'POST',
    body: { source_id: sourceId, revision },
    signal,
  })
}

// --- UC-04 Sources & Python input ---
/** UC-04: Server validates Python syntax and returns available functions. Never execute uploaded code in the browser. */
export function createPythonSource(accessToken, projectId, code, signal) {
  return request(`/projects/${encodeURIComponent(projectId)}/sources`, {
    method: 'POST',
    accessToken,
    body: { code },
    signal,
  })
}

export function listPythonSources(accessToken, projectId, signal) {
  return request(`/projects/${encodeURIComponent(projectId)}/sources`, { accessToken, signal })
}

export function getPythonSource(accessToken, projectId, source, signal) {
  return request(`/projects/${encodeURIComponent(projectId)}/sources/${source.id}/versions/${source.current_revision}`, {
    accessToken,
    signal,
  })
}

export async function getGenerationProgress(accessToken, projectId, signal) {
  const data = await request(`/projects/${encodeURIComponent(projectId)}/generation`, { accessToken, signal })
  if (!Array.isArray(data?.approved_snapshots) || !Array.isArray(data?.runs) || typeof data?.launch_enabled !== 'boolean') {
    throw new Error('Invalid generation response')
  }
  return data
}

export async function getGenerationArtifacts(accessToken, projectId, runId, signal) {
  const project = encodeURIComponent(projectId)
  const run = encodeURIComponent(runId)
  const data = await request(`/projects/${project}/generation/runs/${run}/artifacts`, { accessToken, signal })
  if (!data || !['raw_response', 'parsed_test'].every((field) =>
    data[field] === null || typeof data[field] === 'string')) {
    throw new Error('Invalid generation artifacts response')
  }
  return data
}

export function startGeneration(accessToken, projectId, snapshotId, requestId) {
  return request(`/projects/${encodeURIComponent(projectId)}/generation`, {
    accessToken, method: 'POST', body: { snapshot_id: snapshotId, request_id: requestId },
  })
}

// --- UC-08 Execution status and cancellation (S5) ---
export async function listExecutions(accessToken, projectId, signal) {
  const data = await request(`/projects/${projectId}/executions`, { accessToken, signal })
  if (!Array.isArray(data)) throw new Error('Invalid execution list')
  return data
}

export function getExecution(accessToken, projectId, executionId, signal) {
  return request(`/projects/${projectId}/executions/${executionId}`, { accessToken, signal })
}

export function triggerExecution(accessToken, projectId, { datasetId, sourceId, suiteName } = {}, signal) {
  return request(`/projects/${projectId}/executions`, {
    accessToken,
    method: 'POST',
    body: {
      dataset_id: datasetId || null,
      source_id: sourceId || null,
      suite_name: suiteName || 'Test Suite Execution',
    },
    signal,
  })
}

export function cancelExecution(accessToken, projectId, executionId, { reason } = {}, signal) {
  return request(`/projects/${projectId}/executions/${executionId}/cancel`, {
    accessToken,
    method: 'POST',
    body: {
      reason: reason || 'Cancelled by user',
    },
    signal,
  })
}

// --- UC-11 Results dashboard, history and filters (S7, FR-RPT-001/002/003) ---
/**
 * FR-RPT-001/002/003: every run of the project (generation outcome + evaluated metrics) with the summary.
 * Metric values are numbers or the state strings 'N/A' | 'FAILED' | 'TIMEOUT' (never coerced to 0).
 * Errors are thrown; there is no silent fallback to other data.
 */
export async function getProjectResults(accessToken, projectId, signal) {
  const data = await request(`/projects/${encodeURIComponent(projectId)}/reports/results`, { accessToken, signal })
  if (!data || !Array.isArray(data.runs)) throw new Error('Invalid results response')
  return data
}

