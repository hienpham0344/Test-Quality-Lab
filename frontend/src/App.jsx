import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppRoutes from './routes'
import { AuthApiError, logout } from './services/api'

export function App() {
  const [auth, setAuth] = useState({ session: null, expired: false })
  const [signingOut, setSigningOut] = useState(false)
  const logoutInProgress = useRef(false)
  const navigate = useNavigate()

  function signIn(session) {
    setAuth({ session, expired: false })
  }

  const expire = useCallback((rejectedSession) => {
    setAuth((current) => current.session === rejectedSession
      ? { session: null, expired: true }
      : current)
  }, [])

  async function signOut() {
    if (!auth.session || logoutInProgress.current) return
    logoutInProgress.current = true
    setSigningOut(true)
    let confirmed = false
    try {
      await logout(auth.session.accessToken)
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
