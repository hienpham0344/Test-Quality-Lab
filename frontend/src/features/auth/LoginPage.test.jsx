// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, clickButton, mockApi, renderApp, submitForm, typeInto } from '../../test-utils/app'
import { readSession, saveSession } from './session'

const TOKENS = { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'bearer', expires_in: 900 }
const USER = { id: 'user-1', email: 'user@example.com', display_name: 'Hoa' }
let view

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  await view?.unmount()
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

async function signIn(password = 'long-enough-password') {
  await typeInto(view.container, 'email', 'user@example.com')
  await typeInto(view.container, 'password', password)
  await submitForm(view.container, 'Sign in')
}

describe('UC-02 sign in', () => {
  it('opens a session and redirects to the project workspace', async () => {
    const calls = mockApi({ 'POST /auth/login': [[200, TOKENS]], 'GET /auth/me': [[200, USER]] })
    view = await renderApp('/login')
    await signIn()

    expect(calls[0].body).toEqual({ email: 'user@example.com', password: 'long-enough-password' })
    expect(calls[1].headers.Authorization).toBe('Bearer access-1')
    expect(view.container.textContent).toContain('Project workspace')
    expect(view.container.textContent).toContain('Signed in as Hoa')
    expect(readSession()).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  })

  it('shows one generic message for wrong credentials and clears the password', async () => {
    mockApi({ 'POST /auth/login': [apiError(401, 'AUTH_INVALID_CREDENTIALS')] })
    view = await renderApp('/login')
    await signIn('wrong-password-1')

    expect(view.container.textContent).toContain('Email or password is incorrect.')
    expect(view.container.querySelector('input[name="password"]').value).toBe('')
    expect(readSession()).toBeNull()
  })

  it('asks an unverified user to verify and offers a new link', async () => {
    mockApi({ 'POST /auth/login': [apiError(403, 'AUTH_EMAIL_NOT_VERIFIED')] })
    view = await renderApp('/login')
    await signIn()

    expect(view.container.textContent).toContain('Verify your email before signing in.')
    expect(view.container.querySelector('input[name="resend-email"]').value).toBe('user@example.com')
  })

  it('sends anonymous visitors of protected pages to sign in', async () => {
    mockApi({})
    view = await renderApp('/projects')
    expect(view.container.querySelector('form[aria-label="Sign in"]')).not.toBeNull()
  })

  it('shows the email-verified notice after the verification redirect', async () => {
    mockApi({})
    view = await renderApp('/login', { notice: 'verified' })
    expect(view.container.textContent).toContain('Your email is verified. You can now sign in.')
  })
})

describe('UC-02 sign out and session expiry (FR-AUT-003)', () => {
  it('signs out on the server, clears the local session and returns to sign in', async () => {
    saveSession(TOKENS)
    const calls = mockApi({ 'GET /auth/me': [[200, USER]], 'POST /auth/logout': [[200, { status: 'logged_out' }]] })
    view = await renderApp('/projects')
    await clickButton(view.container, 'Sign out')

    const logout = calls.find((call) => call.key === 'POST /auth/logout')
    expect(logout.headers.Authorization).toBe('Bearer access-1')
    expect(readSession()).toBeNull()
    expect(view.container.textContent).toContain('You have signed out.')
  })

  it('still signs out locally when the server is unreachable', async () => {
    saveSession(TOKENS)
    mockApi({ 'GET /auth/me': [[200, USER]], 'POST /auth/logout': [apiError(503, 'SERVICE_UNAVAILABLE')] })
    view = await renderApp('/projects')
    await clickButton(view.container, 'Sign out')

    expect(readSession()).toBeNull()
    expect(view.container.querySelector('form[aria-label="Sign in"]')).not.toBeNull()
  })

  it('refreshes an expired access token once and keeps the user signed in', async () => {
    saveSession(TOKENS)
    const rotated = { ...TOKENS, access_token: 'access-2', refresh_token: 'refresh-2' }
    const calls = mockApi({
      'GET /auth/me': [apiError(401, 'AUTH_SESSION_INVALID'), [200, USER]],
      'POST /auth/refresh': [[200, rotated]],
    })
    view = await renderApp('/projects')

    expect(calls.map((call) => call.key)).toEqual(['GET /auth/me', 'POST /auth/refresh', 'GET /auth/me'])
    expect(calls[1].body).toEqual({ token: 'refresh-1' })
    expect(view.container.textContent).toContain('Signed in as Hoa')
    expect(readSession().accessToken).toBe('access-2')
  })

  it('asks to sign in again when the refresh token has expired too', async () => {
    saveSession(TOKENS)
    mockApi({
      'GET /auth/me': [apiError(401, 'AUTH_SESSION_INVALID')],
      'POST /auth/refresh': [apiError(401, 'AUTH_SESSION_INVALID')],
    })
    view = await renderApp('/projects')

    expect(view.container.textContent).toContain('Your session has expired. Sign in again.')
    expect(readSession()).toBeNull()
  })

  it('keeps stored tokens when the API is down during restore', async () => {
    saveSession(TOKENS)
    mockApi({ 'GET /auth/me': [apiError(503, 'SERVICE_UNAVAILABLE')] })
    view = await renderApp('/projects')

    expect(view.container.querySelector('form[aria-label="Sign in"]')).not.toBeNull()
    expect(readSession()).not.toBeNull()
  })
})
