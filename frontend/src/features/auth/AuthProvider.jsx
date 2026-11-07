import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentUser, login, logout, refreshSession } from '../../services/api'
import { AuthContext } from './authContext'
import { clearSession, readSession, saveSession } from './session'

// reason: why the user is anonymous - null, 'expired' or 'signedOut'.
const ANONYMOUS = { status: 'anonymous', user: null, reason: null }

/** Load the user with the stored access token; on 401 refresh once (FR-AUT-003). */
async function restoreUser(session) {
  try {
    return await getCurrentUser(session.accessToken)
  } catch (error) {
    if (error.status !== 401) throw error
    const tokens = await refreshSession(session.refreshToken)
    saveSession(tokens)
    return getCurrentUser(tokens.access_token)
  }
}

export function AuthProvider({ children }) {
  const [state, setState] = useState(() =>
    readSession() ? { ...ANONYMOUS, status: 'loading' } : ANONYMOUS,
  )
  const restoring = useRef(false)

  useEffect(() => {
    const session = readSession()
    if (restoring.current || !session) return
    restoring.current = true
    restoreUser(session)
      .then((user) => setState({ status: 'authenticated', user, reason: null }))
      .catch((error) => {
        if (error.status === 401) clearSession()
        setState({ ...ANONYMOUS, reason: error.status === 401 ? 'expired' : null })
      })
  }, [])

  const signIn = useCallback(async (email, password) => {
    const tokens = await login(email, password)
    saveSession(tokens)
    const user = await getCurrentUser(tokens.access_token)
    setState({ status: 'authenticated', user, reason: null })
  }, [])

  const signOut = useCallback(async () => {
    const session = readSession()
    try {
      if (session) await logout(session.accessToken)
    } catch {
      // The local session is removed even if the server cannot be reached.
    } finally {
      clearSession()
      setState({ ...ANONYMOUS, reason: 'signedOut' })
    }
  }, [])

  const value = useMemo(() => ({ ...state, signIn, signOut }), [state, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
