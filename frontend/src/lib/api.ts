const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export type HealthResponse = { status: string }

export async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}/health`)
  if (!response.ok) throw new Error('API health check failed')
  return (await response.json()) as HealthResponse
}
