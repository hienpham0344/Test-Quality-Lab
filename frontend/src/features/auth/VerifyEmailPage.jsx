import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Button } from '../../components/common'
import { verifyEmail } from '../../services/api'
import { AuthLayout } from './components/AuthLayout'
import { ResendVerificationForm } from './components/ResendVerificationForm'
import { tokenFromFragment } from './token'

/** UC-01: consume the one-time link, then redirect to sign in (UC-02). */
export function VerifyEmailPage() {
  const started = useRef(false)
  const tokenRef = useRef(null)
  const [status, setStatus] = useState('checking')

  async function submitToken(token) {
    setStatus('checking')
    try {
      await verifyEmail(token)
      tokenRef.current = null
      setStatus('verified')
    } catch (error) {
      setStatus(error.status === 400 ? 'invalid' : 'unavailable')
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    const token = tokenFromFragment(window.location.hash)
    tokenRef.current = token
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    if (!token) {
      setStatus('invalid')
      return
    }
    void submitToken(token)
  }, [])

  if (status === 'verified') return <Navigate to="/login" replace state={{ notice: 'verified' }} />

  return (
    <AuthLayout title="Verify your email">
      {status === 'checking' && <p role="status">Checking your link…</p>}
      {status === 'unavailable' && (
        <>
          <p role="status">Verification is temporarily unavailable. Please try again.</p>
          <Button onClick={() => { if (tokenRef.current) void submitToken(tokenRef.current) }}>Try again</Button>
        </>
      )}
      {status === 'invalid' && (
        <>
          <p role="alert">This link is invalid or has expired. Request a new verification email.</p>
          <ResendVerificationForm />
        </>
      )}
      <Link className="text-indigo-300 underline" to="/">Back to home</Link>
    </AuthLayout>
  )
}
