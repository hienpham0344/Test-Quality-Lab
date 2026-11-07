import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { Button, TextField } from '../../components/common'
import { useAuth } from './authContext'
import { AuthLayout } from './components/AuthLayout'
import { ResendVerificationForm } from './components/ResendVerificationForm'
import { fieldErrors, messageFor } from './messages'

const NOTICES = {
  verified: 'Your email is verified. You can now sign in.',
  signedOut: 'You have signed out.',
  expired: messageFor({ code: 'AUTH_SESSION_INVALID' }),
}

/** UC-02: sign in, then continue to the project workspace. */
export function LoginPage() {
  const { status, reason, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'authenticated') {
    return <Navigate to={location.state?.from ?? '/projects'} replace />
  }

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setFailure(null)
    try {
      await signIn(email, password)
    } catch (error) {
      setFailure(error)
      setPassword('')
      setSubmitting(false)
    }
  }

  const notice = NOTICES[reason] ?? NOTICES[location.state?.notice]
  const errors = fieldErrors(failure)
  const needsVerification = failure?.code === 'AUTH_EMAIL_NOT_VERIFIED'

  return (
    <AuthLayout title="Sign in">
      {notice && <p role="status">{notice}</p>}
      <form aria-label="Sign in" className="space-y-4" noValidate onSubmit={(event) => { void submit(event) }}>
        <TextField label="Email" name="email" type="email" autoComplete="email" required
          value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} />
        <TextField label="Password" name="password" type="password" autoComplete="current-password"
          required value={password} onChange={(event) => setPassword(event.target.value)}
          error={errors.password} />
        {failure && <p role="alert">{messageFor(failure)}</p>}
        <Button type="submit" disabled={submitting}>Sign in</Button>
      </form>
      {needsVerification && <ResendVerificationForm initialEmail={email} />}
      <p>
        New here? <Link className="text-indigo-300 underline" to="/register">Create an account</Link>
      </p>
    </AuthLayout>
  )
}
