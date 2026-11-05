import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('email link routes', () => {
  it('renders verification and password reset screens', () => {
    const verify = renderToString(<MemoryRouter initialEntries={['/verify-email']}><App /></MemoryRouter>)
    const reset = renderToString(<MemoryRouter initialEntries={['/reset-password']}><App /></MemoryRouter>)
    expect(verify).toContain('Verify your email')
    expect(reset).toContain('Reset your password')
  })
})
