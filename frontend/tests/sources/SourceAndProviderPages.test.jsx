// @vitest-environment jsdom
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  const client = new QueryClient()
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/projects/project-1/${type}`]}>
          <Routes>
            <Route path="/projects/:projectId/sources/new" element={<PythonSourcePage session={session} onExpire={onExpire} />} />
            <Route path="/projects/:projectId/ai-config" element={<ProviderConfigurationPage session={session} onExpire={onExpire} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

function typeInto(input, value) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fetchMock = vi.fn(async (url) => ({
    ok: true,
    json: async () => url.endsWith('/projects/project-1') ? { name: 'Python examples' } : [],
  }))
  vi.stubGlobal('fetch', fetchMock)
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  onExpire.mockReset()
})

it.each([
  ['sources/new', 'Python source'],
  ['ai-config', 'AI configuration'],
])('links %s back to the named project', async (path, label) => {
  await renderScreen(path)
  const breadcrumb = container.querySelector('nav[aria-label="Breadcrumb"]')
  await vi.waitFor(() => expect(breadcrumb.textContent).toContain('Python examples'))
  expect([...breadcrumb.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual([
    '/projects', '/projects/project-1',
  ])
  expect(breadcrumb.querySelector('[aria-current="page"]').textContent).toBe(label)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('Python source (#27)', () => {
  it('highlights Python tokens without changing the editable source', async () => {
    await renderScreen('sources/new')
    const editor = container.querySelector('#python-code')
    const code = 'def greet():\n    return "<tag>" # comment'
    await act(async () => typeInto(editor, code))
    const preview = container.querySelector('pre[aria-hidden="true"]')
    expect(preview.querySelector('.text-violet-300').textContent).toBe('def')
    expect(preview.querySelector('.text-emerald-300').textContent).toBe('"<tag>"')
    expect(preview.querySelector('tag')).toBeNull()
    expect(editor.value).toBe(code)
  })

  it('disables validation when code is empty', async () => {
    await renderScreen('sources/new')
    expect(container.querySelector('button[type=submit]').disabled).toBe(true)
    expect(container.textContent).toContain('Python source')
  })

  it('saves pasted code and lists it as an uploaded source', async () => {
    fetchMock.mockImplementation(async (_url, options) => ({
      ok: true,
      json: async () => options.method === 'POST'
        ? { source_id: 'source-1', revision: 1, functions: [{ name: 'add', line: 1 }] } : [],
    }))
    await renderScreen('sources/new')
    await act(async () => typeInto(container.querySelector('#python-code'), 'def add(a, b): return a + b'))
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    const [url, options] = fetchMock.mock.calls.find(([, request]) => request.method === 'POST')
    expect(JSON.parse(options.body).code).toContain('def add')
    expect(url).toContain('/projects/project-1/sources')
    expect(container.textContent).toContain('Untitled source source-1')
    expect(container.textContent).not.toContain('Available functions')
  })

  it('saves multiple Python files and retries only the failed file', async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      if (options.method !== 'POST') return { ok: true, json: async () => [] }
      const { code } = JSON.parse(options.body)
      if (code === 'def broken(') {
        return { ok: false, status: 422, json: async () => ({ detail: 'Syntax error' }) }
      }
      return { ok: true, json: async () => ({ source_id: code, revision: 1 }) }
    })
    await renderScreen('sources/new')
    const upload = container.querySelector('input[type=file]')
    const code = 'def uploaded(): return 1'
    expect(upload.multiple).toBe(true)
    Object.defineProperty(upload, 'files', { value: [
      { name: 'sample.py', size: code.length, text: async () => code },
      { name: 'broken.py', size: 11, text: async () => 'def broken(' },
    ] })
    await act(async () => upload.dispatchEvent(new Event('change', { bubbles: true })))
    expect(container.querySelector('#python-code').value).toBe(code)
    await act(async () => container.querySelector('form').requestSubmit())
    expect(container.querySelector('[aria-label="Uploaded files"]').textContent).toContain('sample.py')
    expect(container.querySelector('[role=alert]').textContent).toContain('Syntax error')
    await act(async () => typeInto(container.querySelector('#python-code'), 'def fixed(): pass'))
    await act(async () => container.querySelector('form').requestSubmit())
    expect(container.querySelector('[aria-label="Uploaded files"]').textContent).toContain('broken.py')
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === 'POST' && JSON.parse(options.body).code === code)).toHaveLength(1)
  })

  it('shows syntax validation feedback from API', async () => {
    fetchMock.mockImplementation(async (_url, options) => options.method === 'POST'
      ? { ok: false, status: 422, json: async () => ({ detail: 'Syntax error on line 1' }) }
      : { ok: true, json: async () => [] })
    await renderScreen('sources/new')
    await act(async () => typeInto(container.querySelector('#python-code'), 'def broken('))
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await vi.waitFor(() => expect(container.querySelector('[role=alert]')?.textContent).toContain('Syntax error'))
  })
})

describe('AI provider configuration (#35)', () => {
  it('does not call backend or persist secrets during field validation', async () => {
    await renderScreen('ai-config')
    fetchMock.mockClear()
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(container.querySelectorAll('[role=alert]').length).toBe(3)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.querySelector('[role=note]')).toBeNull()
  })

  it('clears a validated key without sending or storing it', async () => {
    await renderScreen('ai-config')
    fetchMock.mockClear()
    const provider = container.querySelector('#ai-provider')
    const key = container.querySelector('#ai-secret')
    await act(async () => {
      provider.value = 'openai'
      provider.dispatchEvent(new Event('change', { bubbles: true }))
      typeInto(container.querySelector('#ai-model'), 'test-model')
      typeInto(key, 'example-test-key')
    })
    await act(async () => container.querySelector('form').requestSubmit())
    expect(container.querySelector('[role=status]').textContent).toContain('The key was cleared.')
    expect(key.value).toBe('')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defaults key visibility to hidden', async () => {
    await renderScreen('ai-config')
    expect(container.querySelector('#ai-secret').type).toBe('password')
    await act(async () => container.querySelector('[aria-label="Show API key"]').click())
    expect(container.querySelector('#ai-secret').type).toBe('text')
  })
})
