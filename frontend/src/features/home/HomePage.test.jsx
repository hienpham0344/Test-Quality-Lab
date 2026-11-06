import { describe, expect, it } from 'vitest'
import { APP_CONFIG } from '../../config'
import { HomePage } from './HomePage'

describe('HomePage & scaffold', () => {
  it('documents the application identity', () => {
    expect(APP_CONFIG.name).toContain('Test Quality')
    expect(APP_CONFIG.description).toBe('Build trustworthy Python test evaluations.')
  })

  it('exports HomePage component', () => {
    expect(typeof HomePage).toBe('function')
  })
})
