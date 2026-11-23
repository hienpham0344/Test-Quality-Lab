import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppRoutes from './routes'
import { AuthApiError, logout } from './services/api'

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

  return <AppRoutes {...auth} signingOut={signingOut} onSignIn={signIn} onSignOut={signOut} onExpire={expire} />
}

export default App
