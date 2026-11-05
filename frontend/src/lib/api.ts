const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export type HealthResponse = { status: string }

export class AuthApiError extends Error {
  constructor(readonly status: number) {
    super(`Authentication request failed (${status})`)
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}/health`)
  if (!response.ok) throw new Error('API health check failed')
  return (await response.json()) as HealthResponse
}

async function postAuth(path: string, payload: Record<string, string>): Promise<void> {
  const response = await fetch(`${baseUrl}/api/v1/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new AuthApiError(response.status)
}

export function verifyEmail(token: string): Promise<void> {
  return postAuth('verify', { token })
}

export function resetPassword(token: string, newPassword: string): Promise<void> {
  return postAuth('password/reset', { token, new_password: newPassword })
}
