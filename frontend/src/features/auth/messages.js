// User-facing text per API error code (docs/api/contracts/auth.md).
const MESSAGES = {
  AUTH_INVALID_INPUT: 'Check the highlighted fields.',
  AUTH_DUPLICATE_EMAIL: 'This email is already registered. Sign in instead.',
  AUTH_INVALID_CREDENTIALS: 'Email or password is incorrect.',
  AUTH_EMAIL_NOT_VERIFIED: 'Verify your email before signing in.',
  AUTH_INVALID_TOKEN: 'This link is invalid or has expired.',
  AUTH_SESSION_INVALID: 'Your session has expired. Sign in again.',
  AUTH_RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
}
const FALLBACK = 'The service is temporarily unavailable. Please try again.'

export function messageFor(error) {
  return MESSAGES[error?.code] ?? FALLBACK
}

const FIELD_NAMES = { confirm_password: 'confirmPassword', display_name: 'displayName' }

/** Map API field errors (snake_case) to form field names (camelCase). */
export function fieldErrors(error) {
  return Object.fromEntries(
    Object.entries(error?.fields ?? {}).map(([field, text]) => [FIELD_NAMES[field] ?? field, text]),
  )
}
