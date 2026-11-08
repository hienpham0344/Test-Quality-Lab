import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AuthApiError, forgotPassword, login, register, requestVerification } from '../../services/api'
import { AuthField, AuthLayout, authButton, authLink } from '../../components/auth/AuthLayout'
import { AuthPanel } from '../../components/login/LoginLayout'

const screens = {
  login: { title: 'Sign in', description: 'Access your test projects and experiment results.', submit: 'Sign in', request: login },
  signup: { title: 'Create an account', description: 'Register to access your Python test projects and experiments.', submit: 'Create account', request: register },
  forgot: { title: 'Forgot your password?', description: 'Enter your registered email address and we’ll send you instructions to reset your password.', submit: 'Send reset link', request: forgotPassword },
  resend: { title: 'Resend verification', description: 'Request a new link to verify your email address.', submit: 'Send verification link', request: requestVerification },
}

function requestError(error, mode) {
  const status = error instanceof AuthApiError ? error.status : 0
  if (status === 401 && mode === 'login') return 'Sign-in failed. Check your credentials and make sure your email is verified.'
  if (status === 422 && mode === 'signup') return 'Unable to create this account. Check your details or sign in if you already registered.'
  if (status === 422) return 'Check the email address and try again.'
  if (status === 429) return 'Too many attempts. Wait a moment and try again.'
  return 'The service is temporarily unavailable. Please try again.'
}

export function AuthPage({ mode, onSignIn }) {
  const screen = screens[mode]
  const isLogin = mode === 'login'
  const isSignup = mode === 'signup'
  const hasPassword = isLogin || isSignup
  const isForgot = mode === 'forgot'
  const usesLoginShell = isLogin || isSignup || isForgot
  const Layout = usesLoginShell ? AuthPanel : AuthLayout
  const navigate = useNavigate()
  const location = useLocation()
  const busy = useRef(false)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (busy.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email')).trim()
    const password = String(data.get('password') ?? '')
    const length = [...password].length
    const invalid = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) invalid.email = 'Enter a valid email address.'
    if (isLogin && (!length || length > 1024)) invalid.password = 'Enter your password (up to 1024 characters).'
    if (isSignup && (length < 12 || length > 1024)) invalid.password = 'Use 12 to 1024 characters.'
    if (isSignup && password !== data.get('confirmation')) invalid.confirmation = 'Passwords do not match.'
    setErrors(invalid)
    setMessage('')
    const firstError = Object.keys(invalid)[0]
    if (firstError) {
      form.elements.namedItem(firstError)?.focus()
      return
    }

    busy.current = true
    setPending(true)
    try {
      const result = await screen.request(email, password)
      if (isLogin) {
        onSignIn(result)
        const target = location.state?.returnTo
        const destination = target?.pathname === '/projects'
          ? { pathname: '/projects', search: target.search?.startsWith('?') ? target.search : '' }
          : '/'
        navigate(destination, { replace: true })
      } else {
        form.reset()
        setDone(true)
      }
    } catch (error) {
      setMessage(requestError(error, mode))
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return (
    <Layout title={screen.title} description={screen.description} centered={hasPassword}
      badge={isForgot ? 'Account recovery' : isSignup ? 'Account registration' : isLogin ? 'Account sign-in' : undefined}>
      {isLogin && location.state?.expired && <p role="status" className="text-sm text-amber-200">Your session expired. Sign in again to continue.</p>}
      {isLogin && location.state?.returnTo && !location.state.expired && <p role="status" className="text-sm text-indigo-200">Sign in to open your projects.</p>}
      {isLogin && location.state?.logoutUnconfirmed && <p role="alert" className="text-sm text-amber-200">You signed out of this tab, but the server could not confirm sign-out.</p>}
      {isLogin && location.state?.loggedOut && <p role="status" className="text-sm text-emerald-200">You have signed out.</p>}
      {done ? (
        <div className="space-y-4">
          <p role="status" className="text-sm leading-6 text-emerald-200">
            {isSignup ? 'Check your inbox for a verification link before signing in.'
              : mode === 'forgot' ? 'If an eligible account exists, a password reset link will be sent.'
                : 'If an eligible account exists, a verification link will be sent.'}
          </p>
          {!usesLoginShell && <Link to="/login" className={authLink}>Back to sign in</Link>}
        </div>
      ) : (
        <form className={hasPassword ? 'space-y-4 [&_label]:font-mono [&_label]:text-xs [&_label]:uppercase [&_label]:tracking-wide [&_label]:text-slate-300' : 'space-y-4'}
          onSubmit={submit} noValidate>
          <AuthField name="email" label="Email address" type="email" autoComplete="email" required
            error={errors.email} icon={usesLoginShell ? Mail : undefined}
            placeholder={usesLoginShell ? 'engineer@example.com' : undefined}
            hint={isForgot && <span className="inline-flex items-center gap-2">
              <ShieldCheck size={16} aria-hidden="true" className="shrink-0 text-indigo-300" />
              Reset links expire after 30 minutes.
            </span>} />
          {hasPassword && <AuthField name="password" label="Password" type={showPassword ? 'text' : 'password'}
            autoComplete={isLogin ? 'current-password' : 'new-password'} required
            icon={LockKeyhole}
            labelAction={isLogin && <Link className={authLink + ' text-sm'} to="/forgot-password">Forgot password?</Link>}
            action={(
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center rounded-r-lg text-slate-300 hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-300">
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            )}
            hint={isSignup ? 'Use 12 to 1024 characters.' : undefined} error={errors.password} />}
          {isSignup && <AuthField name="confirmation" label="Confirm password" type="password"
            autoComplete="new-password" required icon={LockKeyhole} error={errors.confirmation} />}
          {isSignup && <p className="text-sm leading-6 text-slate-300">Verify your email after registration to sign in.</p>}
          {message && <p role="alert" className="text-sm text-rose-300">{message}</p>}
          <button className={usesLoginShell
            ? 'inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-linear-to-r px-4 py-3 font-semibold shadow-lg shadow-indigo-600/20 hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-60 ' +
              (hasPassword ? 'from-indigo-300 to-sky-400 font-mono text-sm uppercase tracking-wide text-slate-950' : 'from-indigo-500 to-indigo-700 text-white')
            : authButton} disabled={pending} type="submit">
            {pending ? 'Please wait…' : screen.submit}
            {usesLoginShell && !pending && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form>
      )}
      {isLogin ? (
        <nav aria-label="Account options" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pt-5 text-sm">
          <p className="text-[#c7c4d7]">
            Don't have a lab account?{' '}
            <Link className={authLink + ' whitespace-nowrap decoration-indigo-300/50'} to="/signup">Request Access</Link>
          </p>
          <Link className="whitespace-nowrap text-[#a7a5b6] hover:text-indigo-100 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300"
            to="/resend-verification">Resend verification email</Link>
        </nav>
      ) : isSignup ? (
        <p className="text-center text-sm text-slate-300">
          Already have an account?{' '}<Link className={authLink} to="/login">Sign in</Link>
        </p>
      ) : usesLoginShell ? (
        <nav aria-label="Account options" className="border-t border-slate-700/50 pt-4">
          <Link className={authLink + ' inline-flex min-h-10 items-center gap-2 text-sm'} to="/login">
            <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
          </Link>
        </nav>
      ) : !done && <Link className={authLink} to="/login">Back to sign in</Link>}
    </Layout>
  )
}
