import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, TextField } from '../../components/common'
import { registerAccount } from '../../services/api'
import { AuthLayout } from './components/AuthLayout'
import { ResendVerificationForm } from './components/ResendVerificationForm'
import { fieldErrors, messageFor } from './messages'

const EMPTY_FORM = { email: '', displayName: '', password: '', confirmPassword: '' }

/** UC-01: register, then wait for the verification email. */
export function RegisterPage() {
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [failure, setFailure] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState(null)
  const passwordsDiffer = Boolean(form.confirmPassword) && form.password !== form.confirmPassword

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  }

  async function submit(event) {
    event.preventDefault()
    if (passwordsDiffer) return
    setSubmitting(true)
    setErrors({})
    setFailure(null)
    try {
      await registerAccount(form)
      setRegisteredEmail(form.email.trim())
      setForm(EMPTY_FORM)
    } catch (error) {
      setErrors(fieldErrors(error))
      setFailure(error)
    } finally {
      setSubmitting(false)
    }
  }

  if (registeredEmail) {
    return (
      <AuthLayout title="Check your email">
        <p role="status">
          We sent a verification link to <strong>{registeredEmail}</strong>. It is valid for 24 hours.
        </p>
        <ResendVerificationForm initialEmail={registeredEmail} />
        <Link className="text-indigo-300 underline" to="/login">Go to sign in</Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Create your account">
      <form aria-label="Register" className="space-y-4" noValidate onSubmit={(event) => { void submit(event) }}>
        <TextField label="Email" name="email" type="email" autoComplete="email" required
          value={form.email} onChange={update('email')} error={errors.email} />
        <TextField label="Display name (optional)" name="displayName" autoComplete="nickname" maxLength={100}
          value={form.displayName} onChange={update('displayName')} error={errors.displayName} />
        <TextField label="Password (at least 12 characters)" name="password" type="password"
          autoComplete="new-password" required value={form.password} onChange={update('password')}
          error={errors.password} />
        <TextField label="Confirm password" name="confirmPassword" type="password"
          autoComplete="new-password" required value={form.confirmPassword}
          onChange={update('confirmPassword')}
          error={passwordsDiffer ? 'Passwords do not match' : errors.confirmPassword} />
        {failure && <p role="alert">{messageFor(failure)}</p>}
        <Button type="submit" disabled={submitting || passwordsDiffer}>Create account</Button>
      </form>
      <p>
        Already registered? <Link className="text-indigo-300 underline" to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
