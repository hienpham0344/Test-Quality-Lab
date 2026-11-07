// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiError, clickButton, mockApi, renderApp, submitForm, typeInto } from '../../test-utils/app'

let view

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(async () => {
  await view?.unmount()
  vi.unstubAllGlobals()
})

async function fillForm(password = 'long-enough-password', confirmation = password) {
  await typeInto(view.container, 'email', 'new@example.com')
  await typeInto(view.container, 'displayName', 'Hoa')
  await typeInto(view.container, 'password', password)
  await typeInto(view.container, 'confirmPassword', confirmation)
}

describe('UC-01 registration', () => {
  it('registers, shows the pending screen and can resend the link (A1)', async () => {
    const calls = mockApi({
      'POST /auth/register': [[201, { status: 'verification_requested', message: 'ok' }]],
      'POST /auth/verification/request': [[200, { status: 'request_accepted', message: 'ok' }]],
    })
    view = await renderApp('/register')
    await fillForm()
    await submitForm(view.container, 'Register')

    expect(calls[0].body).toEqual({
      email: 'new@example.com', password: 'long-enough-password',
      confirm_password: 'long-enough-password', display_name: 'Hoa',
    })
    expect(view.container.textContent).toContain('Check your email')
    expect(view.container.textContent).toContain('new@example.com')

    await submitForm(view.container, 'Resend verification email')
    expect(calls[1]).toMatchObject({ key: 'POST /auth/verification/request', body: { email: 'new@example.com' } })
    expect(view.container.textContent).toContain('a new link is on its way')
  })

  it('shows server field errors next to each field', async () => {
    mockApi({
      'POST /auth/register': [apiError(400, 'AUTH_INVALID_INPUT', {
        email: 'Enter a valid email address', confirm_password: 'Passwords do not match on server',
      })],
    })
    view = await renderApp('/register')
    await fillForm()
    await submitForm(view.container, 'Register')

    expect(view.container.querySelector('input[name="email"]').getAttribute('aria-invalid')).toBe('true')
    expect(view.container.textContent).toContain('Enter a valid email address')
    expect(view.container.textContent).toContain('Passwords do not match on server')
    expect(view.container.textContent).toContain('Check the highlighted fields.')
  })

  it('explains a duplicate email', async () => {
    mockApi({ 'POST /auth/register': [apiError(409, 'AUTH_DUPLICATE_EMAIL', { email: 'This email is already registered' })] })
    view = await renderApp('/register')
    await fillForm()
    await submitForm(view.container, 'Register')

    expect(view.container.textContent).toContain('already registered. Sign in instead.')
  })

  it('blocks submission while the passwords differ', async () => {
    const calls = mockApi({})
    view = await renderApp('/register')
    await fillForm('long-enough-password', 'something-else-1')
    await submitForm(view.container, 'Register')

    expect(calls).toEqual([])
    expect(view.container.textContent).toContain('Passwords do not match')
    expect(view.container.querySelector('button[type="submit"]').disabled).toBe(true)
  })

  it('reports a failed resend', async () => {
    mockApi({
      'POST /auth/register': [[201, { status: 'verification_requested', message: 'ok' }]],
      'POST /auth/verification/request': [apiError(429, 'AUTH_RATE_LIMITED')],
    })
    view = await renderApp('/register')
    await fillForm()
    await submitForm(view.container, 'Register')
    await clickButton(view.container, 'Resend verification email')

    expect(view.container.textContent).toContain('Too many attempts')
  })
})
