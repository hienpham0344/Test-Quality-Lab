// Tokens live in sessionStorage: cleared when the tab closes, never in localStorage.
const KEY = 'tql.session'

function storage() {
  try {
    return globalThis.sessionStorage ?? null
  } catch {
    return null
  }
}

export function readSession() {
  try {
    const session = JSON.parse(storage()?.getItem(KEY) ?? 'null')
    return session?.accessToken && session?.refreshToken ? session : null
  } catch {
    return null
  }
}

/** Store the token pair returned by /auth/login or /auth/refresh. */
export function saveSession(tokens) {
  storage()?.setItem(
    KEY,
    JSON.stringify({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token }),
  )
}

export function clearSession() {
  storage()?.removeItem(KEY)
}
