import { useQuery } from '@tanstack/react-query'
import { getHealth } from '../services/api'

export function useApiHealth() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    retry: 1,
  })

  const statusText = query.isPending
    ? 'Checking API…'
    : query.isError
      ? 'API unavailable'
      : query.data?.status === 'ok'
        ? 'API online'
        : 'API unavailable'

  return {
    ...query,
    statusText,
  }
}

export default useApiHealth
