import { useState } from 'react'
import { Button, TextField } from '../../../components/common'
import { requestVerificationEmail } from '../../../services/api'
import { messageFor } from '../messages'

/** UC-01 A1: ask for a new verification link. */
export function ResendVerificationForm({ initialEmail = '' }) {
  const [email, setEmail] = useState(initialEmail)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)

  async function submit(event) {
    event.preventDefault()
    setStatus('sending')
    setError(null)
    try {
      await requestVerificationEmail(email)
      setStatus('sent')
    } catch (requestError) {
      setError(requestError)
      setStatus('idle')
    }
  }

  return (
    <form aria-label="Resend verification email" className="space-y-3" onSubmit={(event) => { void submit(event) }}>
      <TextField
        label="Email"
        name="resend-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={status === 'sending'}>
        Resend verification email
      </Button>
      {status === 'sent' && (
        <p role="status">If the account still needs verification, a new link is on its way.</p>
      )}
      {error && <p role="alert">{messageFor(error)}</p>}
    </form>
  )
}
