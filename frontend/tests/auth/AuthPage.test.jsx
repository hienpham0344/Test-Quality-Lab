// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'

let container
let root
let fetchMock
let client

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  client = new QueryClient()
  client.setQueryData(['health'], { status: 'ok' })
  client.setQueryDefaults(['health'], { staleTime: Infinity })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  client.clear()
  vi.unstubAllGlobals()
})

async function open(path) {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>
    </QueryClientProvider>,
  ))
}

async function submit(fields) {
  for (const [name, value] of Object.entries(fields)) container.querySelector('#' + name).value = value
  await act(async () => container.querySelector('form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  ))
}

describe('authentication forms', () => {
  it.each([
    ['/forgot-password', 'Forgot your password?'],
    ['/signup', 'Create an account'],
  ])('replaces only the form when navigating to %s', async (path, title) => {
    await open('/login')
    const workflow = container.querySelector('.login-workflow')
    expect(workflow).not.toBeNull()

    await act(async () => container.querySelector(`a[href="${path}"]`).click())
    expect(container.querySelector('h1').textContent).toBe(title)
    expect(container.querySelector('.login-workflow')).toBe(workflow)

    await act(async () => container.querySelector('a[href="/login"]').click())
    expect(container.querySelector('h1').textContent).toBe('Sign in')
    expect(container.querySelector('.login-workflow')).toBe(workflow)
  })

  it('focuses an invalid signup field and does not send the request', async () => {
    await open('/signup')
    await submit({ email: 'invalid', password: 'short', confirmation: 'different' })
    expect(container.textContent).toContain('Use 12 to 1024 characters.')
    expect(container.textContent).toContain('Passwords do not match.')
    expect(document.activeElement.id).toBe('email')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('registers valid input and prompts the user to verify their email', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
    await open('/signup')
    await submit({ email: 'test@example.com', password: 'example-password', confirmation: 'example-password' })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/register$/)
    expect(container.querySelector('[role=status]').textContent).toContain('verification link')
  })

  it('signs in and shows the signed-in state on the home page', async () => {
    fetchMock.mockResolvedValue(Response.json({ access_token: 'test-access', refresh_token: 'test-refresh' }))
    await open('/login')
    await submit({ email: 'test@example.com', password: 'example-password' })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/login$/)
    expect(container.textContent).toContain('Signed in')
  })

  it('shows generic feedback for rejected credentials', async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: 'Private server detail' }, { status: 401 }))
    await open('/login')
    await submit({ email: 'test@example.com', password: 'example-password' })
    expect(container.querySelector('[role=alert]').textContent).toContain('Sign-in failed')
    expect(container.textContent).not.toContain('Private server detail')
  })

  it('uses an account-neutral confirmation after a recovery request', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    await open('/forgot-password')
    await submit({ email: 'test@example.com' })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/password\/forgot$/)
    expect(container.querySelector('[role=status]').textContent).toContain('If an eligible account exists')
  })

  it('shows retry guidance when verification resend is rate limited', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }))
    await open('/resend-verification')
    await submit({ email: 'test@example.com' })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/verification\/request$/)
    expect(container.querySelector('[role=alert]').textContent).toContain('Too many attempts')
  })
})

describe('protected routing and session UX', () => {
  const credentials = { email: 'test@example.com', password: 'example-password' }
  const accessToken = 'test-access'

  function mockSession({ projects = () => Response.json([{ id: 'project-1', name: 'Private workspace' }]),
    logoutStatus = 200 } = {}) {
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/auth/login')) return Response.json({ access_token: accessToken })
      if (url.endsWith('/projects')) return projects()
      if (url.endsWith('/auth/logout')) return new Response(null, { status: logoutStatus })
      throw new Error('Unexpected request')
    })
  }

  async function clickButton(label) {
    const button = [...container.querySelectorAll('button')].find((item) => item.textContent.trim() === label)
    await act(async () => button.click())
  }

  it('redirects guests without requesting projects', async () => {
    await open('/projects')
    expect(container.querySelector('h1').textContent).toBe('Sign in')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns to protected projects after sign-in and authenticates the request', async () => {
    mockSession()
    await open('/projects?view=list')
    await submit(credentials)
    await vi.waitFor(() => expect(container.querySelector('h2')?.textContent).toBe('Private workspace'))
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/projects$/),
      expect.objectContaining({ headers: { Authorization: 'Bearer ' + accessToken }, cache: 'no-store' }))
  })

  it('clears private content and prompts for sign-in after session rejection', async () => {
    let rejected = false
    mockSession({ projects: () => rejected
      ? new Response(null, { status: 401 })
      : Response.json([{ id: 'project-1', name: 'Private workspace' }]) })
    await open('/projects')
    await submit(credentials)
    await vi.waitFor(() => expect(container.textContent).toContain('Private workspace'))
    rejected = true
    await act(async () => client.refetchQueries({ queryKey: ['private', 'projects'] }))
    await vi.waitFor(() => expect(container.textContent).toContain('Your session expired'))
    expect(container.textContent).not.toContain('Private workspace')
  })

  it('keeps the session when the projects API is temporarily unavailable', async () => {
    let unavailable = true
    mockSession({ projects: () => unavailable ? new Response(null, { status: 503 }) : Response.json([]) })
    await open('/projects')
    await submit(credentials)
    await vi.waitFor(() => expect(container.textContent).toContain('Please try again'))
    unavailable = false
    await clickButton('Try again')
    await vi.waitFor(() => expect(container.textContent).toContain('You don’t have any projects yet'))
  })

  it.each([
    [200, 'You have signed out.'],
    [503, 'the server could not confirm sign-out'],
  ])('clears the session after logout responds %s', async (logoutStatus, message) => {
    mockSession({ logoutStatus })
    await open('/projects')
    await submit(credentials)
    await vi.waitFor(() => expect(container.textContent).toContain('Private workspace'))
    await clickButton('Sign out')
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/logout$/),
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer ' + accessToken } }))
    expect(container.querySelector('h1').textContent).toBe('Sign in')
    expect(container.textContent).toContain(message)
    expect(container.textContent).not.toContain('Private workspace')
  })
})
