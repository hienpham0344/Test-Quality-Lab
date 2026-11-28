import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createProject,
  getProject,
  getProjectHistory,
  listAllProjects,
  listProjects,
  updateProject,
  withSessionRefresh,
} from '../../services/api'

/**
 * Query keys for the projects feature. `all()` is the full owned list used by the dashboard;
 * every other list key starts with it so one invalidation refreshes them all.
 */
export const projectKeys = {
  all: () => ['private', 'projects'],
  page: (params = {}) => ['private', 'projects', 'page', params],
  detail: (projectId) => ['private', 'project', projectId],
  history: (projectId, params = {}) => ['private', 'project-history', projectId, params],
  historyAll: (projectId) => ['private', 'project-history', projectId],
}

/** `auth` = { session, onRefresh }. A 401 refreshes the session once and retries the call. */
function authed(auth, call) {
  return withSessionRefresh(auth.session, auth.onRefresh, call)
}

const privateQuery = { retry: false, gcTime: 0 }

/** Every owned project (pages of 100), for the dashboard and its summary tiles. */
export function useAllProjects(auth, options = {}) {
  return useQuery({
    queryKey: projectKeys.all(),
    queryFn: ({ signal }) => authed(auth, (token) => listAllProjects(token, {}, signal)),
    ...privateQuery,
    ...options,
  })
}

/** One server-side page: `{ items, total }`. Params: q, sort, order, limit, offset. */
export function useProjects(auth, params = {}, options = {}) {
  return useQuery({
    queryKey: projectKeys.page(params),
    queryFn: ({ signal }) => authed(auth, (token) => listProjects(token, params, signal)),
    ...privateQuery,
    ...options,
  })
}

export function useProject(auth, projectId, options = {}) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: ({ signal }) => authed(auth, (token) => getProject(token, projectId, signal)),
    enabled: Boolean(projectId),
    ...privateQuery,
    ...options,
  })
}

export function useProjectHistory(auth, projectId, params = {}, options = {}) {
  return useQuery({
    queryKey: projectKeys.history(projectId, params),
    queryFn: ({ signal }) => authed(auth, (token) => getProjectHistory(token, projectId, params, signal)),
    enabled: Boolean(projectId),
    ...privateQuery,
    ...options,
  })
}

function invalidateProject(queryClient, projectId) {
  const keys = [projectKeys.all()]
  if (projectId) keys.push(projectKeys.detail(projectId), projectKeys.historyAll(projectId))
  return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

export function useCreateProject(auth) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values) => authed(auth, (token) => createProject(token, values)),
    onSuccess: async (created) => {
      queryClient.setQueryData(projectKeys.detail(created.id), created)
      await invalidateProject(queryClient, null)
    },
  })
}

export function useUpdateProject(auth, projectId) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values) => authed(auth, (token) => updateProject(token, projectId, values)),
    onSuccess: async (updated) => {
      queryClient.setQueryData(projectKeys.detail(projectId), updated)
      await invalidateProject(queryClient, projectId)
    },
  })
}
