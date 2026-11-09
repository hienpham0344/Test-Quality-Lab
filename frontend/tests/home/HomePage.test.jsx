import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../src/config'
import { HomePage } from '../../src/features/home/HomePage'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import App from '../../src/App'

describe('HomePage & scaffold', () => {
  it('documents the application identity', () => {
    expect(APP_CONFIG.name).toContain('Test Quality')
    expect(APP_CONFIG.description).toBe('Build trustworthy Python test evaluations.')
  })

  it('exports HomePage component', () => {
    expect(typeof HomePage).toBe('function')
  })

  it('renders the home route with its shared layout and API status', () => {
    const client = new QueryClient()
    client.setQueryData(['health'], { status: 'ok' })
    const html = renderToString(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/']}><App /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(html).toContain('<header')
    expect(html).toContain('<footer')
    expect(html).toContain('API online')
    expect(html).toContain('Planned modules')
    for (const item of APP_CONFIG.plannedModules) {
      expect(html).toContain(item.title.replaceAll('&', '&amp;'))
    }
    client.clear()
  })
})
