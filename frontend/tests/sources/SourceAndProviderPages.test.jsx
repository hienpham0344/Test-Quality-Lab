// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PythonSourcePage } from '../../src/features/sources/PythonSourcePage'
import { ProviderConfigurationPage } from '../../src/features/ai-config/ProviderConfigurationPage'

let container
let root
let fetchMock
const session = { accessToken: 'test-token' }
const onExpire = vi.fn()

async function renderScreen(type) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/projects/project-1/${type}`]}>
        <Routes>
          <Route path="/projects/:projectId/sources/new" element={<PythonSourcePage session={session} onExpire={onExpire} />} />
          <Route path="/projects/:projectId/ai-config" element={<ProviderConfigurationPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })
}

function typeInto(input, value) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  onExpire.mockReset()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Python source (#27)', () => {
  it('disables validation when code is empty', async () => {
    await renderScreen('sources/new')
    expect(container.querySelector('button[type=submit]').disabled).toBe(true)
    expect(container.textContent).toContain('Python source')
  })

  it('submits code and shows server-inspected functions', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ revision: 1, functions: [{ name: 'add', line: 1 }] }),
    })
    await renderScreen('sources/new')
    await act(async () => typeInto(container.querySelector('#python-code'), 'def add(a, b): return a + b'))
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await vi.waitFor(() => expect(container.textContent).toContain('add'))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).code).toContain('def add')
    expect(fetchMock.mock.calls[0][0]).toContain('/projects/project-1/sources')
  })

  it('shows syntax validation feedback from API', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'Syntax error on line 1' }) })
    await renderScreen('sources/new')
    await act(async () => typeInto(container.querySelector('#python-code'), 'def broken('))
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await vi.waitFor(() => expect(container.querySelector('[role=alert]')?.textContent).toContain('Syntax error'))
  })
})

describe('AI provider configuration (#35)', () => {
  it('does not call backend or persist secrets during field validation', async () => {
    await renderScreen('ai-config')
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(container.querySelectorAll('[role=alert]').length).toBe(3)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Credential storage is not yet available')
  })

  it('defaults key visibility to hidden', async () => {
    await renderScreen('ai-config')
    expect(container.querySelector('#ai-secret').type).toBe('password')
    await act(async () => container.querySelector('[aria-label="Show API key"]').click())
    expect(container.querySelector('#ai-secret').type).toBe('text')
  })
})
