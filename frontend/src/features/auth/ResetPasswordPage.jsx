import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthApiError, resetPassword } from '../../services/api'
import { AuthField, AuthLayout, authButton, authLink } from './AuthLayout'
import { tokenFromFragment } from './token'

export function ResetPasswordPage() {
  const started = useRef(false)
  const busy = useRef(false)
  const [token, setToken] = useState(undefined)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [status, setStatus] = useState('idle')
  const [passwordError, setPasswordError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const mismatch = Boolean((confirmation || submitted) && password !== confirmation)

  useEffect(() => {
    if (started.current) return
    started.current = true
    setToken(tokenFromFragment(window.location.hash))
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [])

  async function submit(event) {
    event.preventDefault()
    if (!token || busy.current || status === 'invalid') return
    setSubmitted(true)
    const length = [...password].length
    if (length < 12 || length > 1024) {
      setPasswordError('Use 12 to 1024 characters.')
      event.currentTarget.elements.namedItem('new-password')?.focus()
      return
    }
    setPasswordError('')
    if (password !== confirmation) {
      event.currentTarget.elements.namedItem('confirm-password')?.focus()
      return
    }
    busy.current = true
    setStatus('saving')
    try {
      await resetPassword(token, password)
      setPassword('')
      setConfirmation('')
      setStatus('done')
    } catch (error) {
      if (error instanceof AuthApiError && error.status === 400) setStatus('invalid')
      else if (error instanceof AuthApiError && error.status === 429) setStatus('limited')
      else setStatus('error')
    } finally {
      busy.current = false
    }
  }

  return (
    <AuthLayout title="Reset your password" description="Choose a new password for your Test Quality Lab account.">
      {token === undefined && <p role="status">Checking your link…</p>}
      {token === null && <p role="alert">This link is invalid or has expired.</p>}
      {status === 'done' && <p role="status" className="text-emerald-200">Password changed. You can now sign in.</p>}
      {token && status !== 'done' && (
        <form className="space-y-4" onSubmit={submit} noValidate>
          <AuthField name="new-password" label="New password" type="password" autoComplete="new-password"
            required value={password} hint="Use at least 12 characters." error={passwordError}
            onChange={(event) => setPassword(event.target.value)} />
          <AuthField name="confirm-password" label="Confirm password" type="password" autoComplete="new-password"
            required value={confirmation} error={mismatch ? 'Passwords do not match.' : undefined}
            onChange={(event) => setConfirmation(event.target.value)} />
          {status === 'invalid' && <p role="alert" className="text-rose-300">This link is invalid or has expired. Request a new reset email.</p>}
          {status === 'error' && <p role="alert" className="text-rose-300">Password reset is temporarily unavailable. Please try again.</p>}
          {status === 'limited' && <p role="alert" className="text-rose-300">Too many attempts. Wait a moment and try again.</p>}
          <button className={authButton} type="submit" disabled={status === 'saving' || status === 'invalid' || mismatch}>
            {status === 'saving' ? 'Saving…' : 'Save password'}
          </button>
        </form>
      )}
      <nav aria-label="Password recovery options" className="flex flex-wrap gap-4 text-sm">
        <Link className={authLink} to="/login">Back to sign in</Link>
        {(token === null || status === 'invalid') && <Link className={authLink} to="/forgot-password">Request a new link</Link>}
      </nav>
    </AuthLayout>
  )
}
