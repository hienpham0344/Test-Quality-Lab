import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppRoutes from './routes'
import { AuthApiError, logout, refreshSession } from './services/api'

const SESSION_KEY = 'test-quality-lab:access-token'

function restoreSession() {
  try {
    const accessToken = sessionStorage.getItem(SESSION_KEY)
    return accessToken ? { accessToken } : null
  } catch {
    return null
  }
}

function saveSession(session) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, session.accessToken)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // The in-memory session still works when browser storage is unavailable.
  }
}

export function App() {
  const [auth, setAuth] = useState(() => ({ session: restoreSession(), expired: false }))
  const activeSession = useRef(auth.session)
  const [signingOut, setSigningOut] = useState(false)
  const logoutInProgress = useRef(false)
  const refreshInFlight = useRef(null)
  const navigate = useNavigate()

  function signIn(session) {
    activeSession.current = session
    saveSession(session)
    setAuth({ session, expired: false })
  }

  const expire = useCallback((rejectedSession) => {
    if (!rejectedSession || activeSession.current !== rejectedSession) return
    activeSession.current = null
    saveSession(null)
    setAuth({ session: null, expired: true })
  }, [])

  /** Exchanges the in-memory refresh token once for a new pair; concurrent 401s share one request. */
  const refresh = useCallback((staleSession) => {
    const current = activeSession.current
    if (!current || !current.refreshToken) return Promise.resolve(null)
    if (staleSession && current !== staleSession) return Promise.resolve(current)
    if (refreshInFlight.current) return refreshInFlight.current
    refreshInFlight.current = refreshSession(current.refreshToken)
      .then((result) => {
        if (activeSession.current !== current || typeof result?.access_token !== 'string') return null
        const next = { accessToken: result.access_token, refreshToken: result.refresh_token }
        activeSession.current = next
        saveSession(next)
        setAuth({ session: next, expired: false })
        return next
      })
      .catch(() => null)
      .finally(() => { refreshInFlight.current = null })
    return refreshInFlight.current
  }, [])

  async function signOut() {
    const session = activeSession.current
    if (!session || logoutInProgress.current) return
    logoutInProgress.current = true
    activeSession.current = null
    saveSession(null)
    setSigningOut(true)
    let confirmed = false
    try {
      await logout(session.accessToken)
      confirmed = true
    } catch (error) {
      confirmed = error instanceof AuthApiError && error.status === 401
    } finally {
      const logoutNotice = { loggedOut: confirmed, logoutUnconfirmed: !confirmed }
      setAuth({ session: null, expired: false, logoutNotice })
      setSigningOut(false)
      logoutInProgress.current = false
      navigate('/login', {
        replace: true,
        state: logoutNotice,
      })
    }
  }

  return <AppRoutes {...auth} signingOut={signingOut} onSignIn={signIn} onSignOut={signOut} onExpire={expire} onRefresh={refresh} />
}

export default App
