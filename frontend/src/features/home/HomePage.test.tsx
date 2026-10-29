import { describe, expect, it } from 'vitest'

describe('scaffold', () => {
  it('documents the application identity', () => {
    expect('Test Quality Lab').toContain('Test Quality')
  })
})
