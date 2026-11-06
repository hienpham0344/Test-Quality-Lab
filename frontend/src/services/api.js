import { APP_CONFIG } from '../config'

export async function getHealth() {
  const response = await fetch(`${APP_CONFIG.apiUrl}/health`)
  if (!response.ok) {
    throw new Error('API health check failed')
  }
  return response.json()
}
