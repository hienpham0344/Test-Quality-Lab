import { ApiError } from '../../services/api'

/** User-facing text for project API errors, chosen by status + code (never by server message text). */
export const PROJECT_MESSAGES = {
  INPUT_INVALID: 'Some project details are not valid. Check the highlighted fields.',
  NOT_FOUND: 'Project not found or you don’t have access to it.',
  AUTH_SESSION_INVALID: 'Your session has ended. Please sign in again.',
  SERVICE_UNAVAILABLE: 'The project service is temporarily unavailable. Please try again.',
  NETWORK: 'Could not reach the project service. Check your connection and try again.',
  UNKNOWN: 'Something went wrong. Please try again.',
}

export function projectErrorKey(error) {
  if (!(error instanceof ApiError)) return 'NETWORK'
  if (error.status === 401) return 'AUTH_SESSION_INVALID'
  if (error.status === 404 || error.code === 'NOT_FOUND') return 'NOT_FOUND'
  if (error.status === 422 || error.code === 'INPUT_INVALID') return 'INPUT_INVALID'
  if (error.status === 503 || error.code === 'SERVICE_UNAVAILABLE') return 'SERVICE_UNAVAILABLE'
  return 'UNKNOWN'
}

export function projectErrorMessage(error) {
  return PROJECT_MESSAGES[projectErrorKey(error)]
}

/** Field errors keyed by input name (`name`, `description`, `q`, `limit`, ...); `{}` when none. */
export function projectFieldErrors(error) {
  return error instanceof ApiError && error.fields && typeof error.fields === 'object' ? error.fields : {}
}
