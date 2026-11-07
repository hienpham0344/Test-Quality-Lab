// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { clearSession, readSession, saveSession } from './session'

afterEach(() => sessionStorage.clear())

describe('session storage', () => {
  it('stores only the token pair in sessionStorage and clears it', () => {
    saveSession({ access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 900 })
    expect(JSON.parse(sessionStorage.getItem('tql.session'))).toEqual({ accessToken: 'a', refreshToken: 'r' })
    expect(readSession()).toEqual({ accessToken: 'a', refreshToken: 'r' })
    expect(localStorage.length).toBe(0)
    clearSession()
    expect(readSession()).toBeNull()
  })

  it('ignores corrupted or incomplete data', () => {
    sessionStorage.setItem('tql.session', '{not json')
    expect(readSession()).toBeNull()
    sessionStorage.setItem('tql.session', JSON.stringify({ accessToken: 'a' }))
    expect(readSession()).toBeNull()
  })
})
