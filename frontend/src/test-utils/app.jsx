import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { App } from '../App'

function response(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function apiError(status, code, fields = {}) {
  return [status, { detail: { code, message: code, fields } }]
}

/**
 * Stub fetch with fake API routes: { 'POST /auth/login': [[200, body], ...] }.
 * Responses are used in order; the last one repeats.
 */
export function mockApi(routes) {
  const calls = []
  const fetchMock = vi.fn(async (url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname.replace('/api/v1', '')}`
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers ?? {} })
    const queue = routes[key]
    if (!queue) throw new Error(`Unexpected request: ${key}`)
    const [status, body] = queue.length > 1 ? queue.shift() : queue[0]
    return response(status, body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

export async function settle() {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

export async function renderApp(path, state) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(
    <StrictMode>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}><App /></MemoryRouter>
    </StrictMode>,
  ))
  await settle()
  return {
    container,
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

export async function typeInto(container, name, value) {
  const input = container.querySelector(`input[name="${name}"]`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export async function submitForm(container, label) {
  const form = container.querySelector(`form[aria-label="${label}"]`)
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await settle()
}

export async function clickButton(container, text) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === text)
  await act(async () => button.click())
  await settle()
}
