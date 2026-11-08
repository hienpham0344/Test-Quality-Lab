// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'

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
